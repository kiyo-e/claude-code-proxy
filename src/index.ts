import { Hono } from 'hono'
import { env } from 'hono/adapter'

const app = new Hono<{
  Bindings: {
    ANTHROPIC_PROXY_BASE_URL?: string
    API_KEY?: string
    REASONING_MODEL?: string
    COMPLETION_MODEL?: string
    DEBUG?: string
  }
}>()

// Health check endpoint
app.get('/', (c) => {
  return c.json({ status: 'ok', message: 'Claude Code Proxy is running' })
})

// Helper function to send SSE events
const sendSSE = (writer: WritableStreamDefaultWriter, event: string, data: any) => {
  const sseMessage = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  writer.write(new TextEncoder().encode(sseMessage))
}

function mapStopReason(finishReason: string): string {
  switch (finishReason) {
    case 'tool_calls': return 'tool_use'
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    default: return 'end_turn'
  }
}

app.post('/v1/messages', async (c) => {
  // Get environment variables from context
  const { API_KEY, ANTHROPIC_PROXY_BASE_URL, REASONING_MODEL, COMPLETION_MODEL, DEBUG } = env(c)

  try {

    const baseUrl = ANTHROPIC_PROXY_BASE_URL || 'https://models.github.ai/inference'
    const key = API_KEY || null
    const defaultModel = 'openai/gpt-4.1'
    const models = {
      reasoning: REASONING_MODEL || defaultModel,
      completion: COMPLETION_MODEL || defaultModel,
    }

    function debug(...args: any[]) {
      if (!DEBUG || DEBUG === 'false') return
      console.log(...args)
    }

    const payload = await c.req.json()

    // Helper to normalize a message's content
    const normalizeContent = (content: any): string | null => {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content.map(item => item.text).join(' ')
      }
      return null
    }

    // Build messages array for the OpenAI payload
    const messages: any[] = []
    if (payload.system && Array.isArray(payload.system)) {
      payload.system.forEach((sysMsg: any) => {
        const normalized = normalizeContent(sysMsg.text || sysMsg.content)
        if (normalized) {
          messages.push({
            role: 'system',
            content: normalized
          })
        }
      })
    }

    // Then add user (or other) messages
    if (payload.messages && Array.isArray(payload.messages)) {
      payload.messages.forEach((msg: any) => {
        const toolCalls = (Array.isArray(msg.content) ? msg.content : [])
          .filter((item: any) => item.type === 'tool_use')
          .map((toolCall: any) => ({
            function: {
              type: 'function',
              id: toolCall.id,
              function: {
                name: toolCall.name,
                parameters: toolCall.input,
              },
            }
          }))

        const newMsg: any = { role: msg.role }
        const normalized = normalizeContent(msg.content)
        if (normalized) newMsg.content = normalized
        if (toolCalls.length > 0) newMsg.tool_calls = toolCalls
        if (newMsg.content || newMsg.tool_calls) messages.push(newMsg)

        if (Array.isArray(msg.content)) {
          const toolResults = msg.content.filter((item: any) => item.type === 'tool_result')
          toolResults.forEach((toolResult: any) => {
            messages.push({
              role: 'tool',
              content: toolResult.text || toolResult.content,
              tool_call_id: toolResult.tool_use_id,
            })
          })
        }
      })
    }

    // Helper function to recursively traverse JSON schema and remove format: 'uri'
    const removeUriFormat = (schema: any): any => {
      if (!schema || typeof schema !== 'object') return schema

      // If this is a string type with uri format, remove the format
      if (schema.type === 'string' && schema.format === 'uri') {
        const { format, ...rest } = schema
        return rest
      }

      // Handle array of schemas
      if (Array.isArray(schema)) {
        return schema.map(item => removeUriFormat(item))
      }

      // Recursively process all properties
      const result: any = {}
      for (const key in schema) {
        if (key === 'properties' && typeof schema[key] === 'object') {
          result[key] = {}
          for (const propKey in schema[key]) {
            result[key][propKey] = removeUriFormat(schema[key][propKey])
          }
        } else if (key === 'items' && typeof schema[key] === 'object') {
          result[key] = removeUriFormat(schema[key])
        } else if (key === 'additionalProperties' && typeof schema[key] === 'object') {
          result[key] = removeUriFormat(schema[key])
        } else if (['anyOf', 'allOf', 'oneOf'].includes(key) && Array.isArray(schema[key])) {
          result[key] = schema[key].map((item: any) => removeUriFormat(item))
        } else {
          result[key] = removeUriFormat(schema[key])
        }
      }
      return result
    }

    const tools = (payload.tools || [])
      .filter((tool: any) => !['BatchTool'].includes(tool.name))
      .map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: removeUriFormat(tool.input_schema),
        },
      }))

    const openaiPayload: any = {
      model: payload.thinking ? models.reasoning : models.completion,
      messages,
      max_tokens: payload.max_tokens,
      temperature: payload.temperature !== undefined ? payload.temperature : 1,
      stream: payload.stream === true,
    }
    if (tools.length > 0) openaiPayload.tools = tools
    debug('OpenAI payload:', openaiPayload)

    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    }

    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }

    debug('Using base URL:', baseUrl)
    debug('Headers:', headers)
    debug(`URL: ${baseUrl}/chat/completions`)

    const openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(openaiPayload)
    })

    if (!openaiResponse.ok) {
      const errorDetails = await openaiResponse.text()
      return c.json({ error: errorDetails }, openaiResponse.status as any)
    }

    // If stream is not enabled, process the complete response
    if (!openaiPayload.stream) {
      const data: any = await openaiResponse.json()
      debug('OpenAI response:', data)
      if (data.error) {
        throw new Error(data.error.message)
      }

      const choice = data.choices[0]
      const openaiMessage = choice.message

      // Map finish_reason to anthropic stop_reason
      const stopReason = mapStopReason(choice.finish_reason)
      const toolCalls = openaiMessage.tool_calls || []

      // Create a message id
      const messageId = data.id
        ? data.id.replace('chatcmpl', 'msg')
        : 'msg_' + Math.random().toString(36).substr(2, 24)

      const anthropicResponse = {
        content: [
          {
            text: openaiMessage.content,
            type: 'text'
          },
          ...toolCalls.map((toolCall: any) => ({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments),
          })),
        ],
        id: messageId,
        model: openaiPayload.model,
        role: openaiMessage.role,
        stop_reason: stopReason,
        stop_sequence: null,
        type: 'message',
        usage: {
          input_tokens: data.usage
            ? data.usage.prompt_tokens
            : messages.reduce((acc, msg) => acc + (msg.content?.split(' ').length || 0), 0),
          output_tokens: data.usage
            ? data.usage.completion_tokens
            : openaiMessage.content.split(' ').length,
        }
      }

      return c.json(anthropicResponse)
    }

    // Streaming response using Server-Sent Events
    return c.body(new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        const sendSSE = (event: string, data: any) => {
          const sseMessage = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(sseMessage))
        }

        let isSucceeded = false
        const messageId = 'msg_' + Math.random().toString(36).substr(2, 24)

        const sendSuccessMessage = () => {
          if (isSucceeded) return
          isSucceeded = true

          // Send initial SSE event for message start
          sendSSE('message_start', {
            type: 'message_start',
            message: {
              id: messageId,
              type: 'message',
              role: 'assistant',
              model: openaiPayload.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            }
          })

          // Send initial ping
          sendSSE('ping', { type: 'ping' })
        }

        // Prepare for reading streamed data
        let accumulatedContent = ''
        let accumulatedReasoning = ''
        let usage: any = null
        let textBlockStarted = false
        let encounteredToolCall = false
        const toolCallAccumulators: Record<number, string> = {}
        const decoder = new TextDecoder('utf-8')
        const reader = openaiResponse.body!.getReader()
        let done = false

        try {
          while (!done) {
            const { value, done: doneReading } = await reader.read()
            done = doneReading
            if (value) {
              const chunk = decoder.decode(value)
              debug('OpenAI response chunk:', chunk)
              const lines = chunk.split('\n')

              for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed === '' || !trimmed.startsWith('data:')) continue
                const dataStr = trimmed.replace(/^data:\s*/, '')
                if (dataStr === '[DONE]') {
                  // Finalize the stream with stop events
                  if (encounteredToolCall) {
                    for (const idx in toolCallAccumulators) {
                      sendSSE('content_block_stop', {
                        type: 'content_block_stop',
                        index: parseInt(idx, 10)
                      })
                    }
                  } else if (textBlockStarted) {
                    sendSSE('content_block_stop', {
                      type: 'content_block_stop',
                      index: 0
                    })
                  }
                  sendSSE('message_delta', {
                    type: 'message_delta',
                    delta: {
                      stop_reason: encounteredToolCall ? 'tool_use' : 'end_turn',
                      stop_sequence: null
                    },
                    usage: usage
                      ? { output_tokens: usage.completion_tokens }
                      : { output_tokens: accumulatedContent.split(' ').length + accumulatedReasoning.split(' ').length }
                  })
                  sendSSE('message_stop', {
                    type: 'message_stop'
                  })
                  controller.close()
                  return
                }

                try {
                  const parsed = JSON.parse(dataStr)
                  if (parsed.error) {
                    throw new Error(parsed.error.message)
                  }
                  sendSuccessMessage()

                  // Capture usage if available
                  if (parsed.usage) {
                    usage = parsed.usage
                  }

                  const delta = parsed.choices[0].delta
                  if (delta && delta.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                      encounteredToolCall = true
                      const idx = toolCall.index
                      if (toolCallAccumulators[idx] === undefined) {
                        toolCallAccumulators[idx] = ""
                        sendSSE('content_block_start', {
                          type: 'content_block_start',
                          index: idx,
                          content_block: {
                            type: 'tool_use',
                            id: toolCall.id,
                            name: toolCall.function.name,
                            input: {}
                          }
                        })
                      }
                      const newArgs = toolCall.function.arguments || ""
                      const oldArgs = toolCallAccumulators[idx]
                      if (newArgs.length > oldArgs.length) {
                        const deltaText = newArgs.substring(oldArgs.length)
                        sendSSE('content_block_delta', {
                          type: 'content_block_delta',
                          index: idx,
                          delta: {
                            type: 'input_json_delta',
                            partial_json: deltaText
                          }
                        })
                        toolCallAccumulators[idx] = newArgs
                      }
                    }
                  } else if (delta && delta.content) {
                    if (!textBlockStarted) {
                      textBlockStarted = true
                      sendSSE('content_block_start', {
                        type: 'content_block_start',
                        index: 0,
                        content_block: {
                          type: 'text',
                          text: ''
                        }
                      })
                    }
                    accumulatedContent += delta.content
                    sendSSE('content_block_delta', {
                      type: 'content_block_delta',
                      index: 0,
                      delta: {
                        type: 'text_delta',
                        text: delta.content
                      }
                    })
                  } else if (delta && delta.reasoning) {
                    if (!textBlockStarted) {
                      textBlockStarted = true
                      sendSSE('content_block_start', {
                        type: 'content_block_start',
                        index: 0,
                        content_block: {
                          type: 'text',
                          text: ''
                        }
                      })
                    }
                    accumulatedReasoning += delta.reasoning
                    sendSSE('content_block_delta', {
                      type: 'content_block_delta',
                      index: 0,
                      delta: {
                        type: 'thinking_delta',
                        thinking: delta.reasoning
                      }
                    })
                  }
                } catch (e) {
                  // Skip invalid JSON lines
                  continue
                }
              }
            }
          }
        } catch (error) {
          console.error('Streaming error:', error)
          controller.error(error)
        } finally {
          controller.close()
        }
      }
    }), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })
  } catch (err: any) {
    console.error(err)
    return c.json({ error: err.message }, 500)
  }
})

export default app