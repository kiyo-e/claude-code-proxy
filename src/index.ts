import { Hono } from 'hono'
import { env } from 'hono/adapter'
import { transformOpenAIToClaude, transformClaudeToOpenAI, removeUriFormat } from './transform'

const app = new Hono<{
  Bindings: {
    REASONING_EFFORT?: string
    ANTHROPIC_PROXY_BASE_URL?: string
    CLAUDE_CODE_PROXY_API_KEY?: string
    REASONING_MODEL?: string
    COMPLETION_MODEL?: string
    REASONING_MAX_TOKENS?: string
    COMPLETION_MAX_TOKENS?: string
    DEBUG?: string
  }
}>()


const defaultModel = 'openai/gpt-4.1'

// Health check endpoint
app.get('/', (c) => {
  const { ANTHROPIC_PROXY_BASE_URL, REASONING_MODEL, COMPLETION_MODEL, REASONING_MAX_TOKENS, COMPLETION_MAX_TOKENS, REASONING_EFFORT } = env(c)

  return c.json({
    status: 'ok',
    message: 'Claude Code Proxy is running',
    config: {
      ANTHROPIC_PROXY_BASE_URL,
      REASONING_MODEL,
      COMPLETION_MODEL,
      REASONING_MAX_TOKENS,
      COMPLETION_MAX_TOKENS,
      REASONING_EFFORT
    }
  })
})

app.post('/v1/messages', async (c) => {
  // Get environment variables from context
  const { CLAUDE_CODE_PROXY_API_KEY, ANTHROPIC_PROXY_BASE_URL, REASONING_MODEL, COMPLETION_MODEL, REASONING_MAX_TOKENS, COMPLETION_MAX_TOKENS, DEBUG, REASONING_EFFORT } = env(c)

  try {
    const baseUrl = ANTHROPIC_PROXY_BASE_URL || 'https://models.github.ai/inference'
    const key = CLAUDE_CODE_PROXY_API_KEY || null
    const models = {
      reasoning: REASONING_MODEL || defaultModel,
      completion: COMPLETION_MODEL || defaultModel,
    }

    function debug(...args: any[]) {
      if (!DEBUG || DEBUG === 'false') return
      console.log(...args)
    }

    function maskBearer(value: string): string {
      return value.replace(/Bearer\s+(\S+)/g, 'Bearer ********')
    }

    const claudePayload = await c.req.json()
    
    // Transform Claude format to OpenAI format
    const { claudeRequest, droppedParams } = transformOpenAIToClaude(claudePayload)

    // Convert messages from Claude to OpenAI format for upstream API
    const messages: any[] = []
    
    // Add system messages
    if (claudeRequest.system) {
      messages.push({
        role: 'system',
        content: claudeRequest.system
      })
    }
    
    // Process regular messages
    if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
      for (const msg of claudeRequest.messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          // Handle content blocks
          if (Array.isArray(msg.content)) {
            const textParts: string[] = []
            const toolCalls: any[] = []
            const toolResults: any[] = []
            
            for (const block of msg.content) {
              if (block.type === 'text') {
                textParts.push(block.text)
              } else if (block.type === 'tool_use') {
                toolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input)
                  }
                })
              } else if (block.type === 'tool_result') {
                toolResults.push({
                  role: 'tool',
                  content: block.content || '',
                  tool_call_id: block.tool_use_id
                })
              }
            }
            
            // Add main message if it has content
            if (textParts.length > 0 || toolCalls.length > 0) {
              const openAIMsg: any = { role: msg.role }
              if (textParts.length > 0) openAIMsg.content = textParts.join(' ')
              if (toolCalls.length > 0) openAIMsg.tool_calls = toolCalls
              messages.push(openAIMsg)
            }
            
            // Add tool result messages
            messages.push(...toolResults)
          } else if (typeof msg.content === 'string') {
            messages.push({
              role: msg.role,
              content: msg.content
            })
          }
        }
      }
    }

    // Process tools
    const tools = (claudeRequest.tools || [])
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
      // Existing fields kept as before

      model: claudePayload.thinking ? models.reasoning : models.completion,
      messages,
      temperature: claudeRequest.temperature !== undefined ? claudeRequest.temperature : 1,
      stream: claudeRequest.stream === true,
    }
    
    // Only add max_tokens if it's provided and not null/undefined
    if (claudeRequest.max_tokens !== null && claudeRequest.max_tokens !== undefined) {
      openaiPayload.max_tokens = claudeRequest.max_tokens
    }

    // Apply max_tokens override if configured
    const selectedModel = claudePayload.thinking ? models.reasoning : models.completion
    const reasoningMaxTokens = REASONING_MAX_TOKENS ? parseInt(REASONING_MAX_TOKENS) : undefined
    const completionMaxTokens = COMPLETION_MAX_TOKENS ? parseInt(COMPLETION_MAX_TOKENS) : undefined
    
    if (selectedModel === models.reasoning && reasoningMaxTokens) {
      openaiPayload.max_tokens = reasoningMaxTokens
    } else if (selectedModel === models.completion && completionMaxTokens) {
      openaiPayload.max_tokens = completionMaxTokens
    }
    
    // Apply reasoning_effort if configured and model is reasoning
    if (selectedModel === models.reasoning && REASONING_EFFORT) {
      openaiPayload.reasoning_effort = REASONING_EFFORT
    }
    // Add tool_choice if present
    if (claudeRequest.tool_choice) {
      if (claudeRequest.tool_choice.type === 'none') {
        openaiPayload.tool_choice = 'none'
      } else if (claudeRequest.tool_choice.type === 'auto') {
        openaiPayload.tool_choice = 'auto'
      } else if (claudeRequest.tool_choice.type === 'tool' && claudeRequest.tool_choice.name) {
        openaiPayload.tool_choice = {
          type: 'function',
          function: { name: claudeRequest.tool_choice.name }
        }
      }
    }
    
    if (tools.length > 0) openaiPayload.tools = tools
    
    debug('OpenAI payload:', JSON.stringify(openaiPayload, null, 2))

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }

    debug('Using base URL:', baseUrl)
    const maskedHeaders = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        key.toLowerCase() === 'authorization' ? maskBearer(value) : value
      ])
    )
    debug('Headers:', maskedHeaders)
    debug(`URL: ${baseUrl}/chat/completions`)

    const openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(openaiPayload)
    })

    // Add X-Dropped-Params header if any params were dropped
    if (droppedParams.length > 0) {
      c.header('X-Dropped-Params', droppedParams.join(', '))
    }

    if (!openaiResponse.ok) {
      const errorDetails = await openaiResponse.text()
      console.error(`OpenAI API error (${openaiResponse.status}):`, errorDetails)
      console.error('Failed request payload:', JSON.stringify(openaiPayload, null, 2))
      console.error('Dropped parameters:', droppedParams)
      return c.json({ error: errorDetails }, openaiResponse.status as any)
    }

    // If stream is not enabled, process the complete response
    if (!openaiPayload.stream) {
      const data: any = await openaiResponse.json()
      debug('OpenAI response:', JSON.stringify(data, null, 2))
      if (data.error) {
        throw new Error(data.error.message)
      }

      // Create Claude response from OpenAI data
      const choice = data.choices[0]
      const openaiMessage = choice.message
      
      // Build content blocks
      const content: any[] = []
      if (openaiMessage.content) {
        content.push({
          type: 'text',
          text: openaiMessage.content
        })
      }
      
      if (openaiMessage.tool_calls) {
        for (const toolCall of openaiMessage.tool_calls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments)
          })
        }
      }
      
      const claudeResponse = {
        id: data.id ? data.id.replace('chatcmpl', 'msg') : 'msg_' + Math.random().toString(36).substring(2, 26),
        type: 'message',
        role: 'assistant',
        model: openaiPayload.model,
        content,
        stop_reason: mapStopReason(choice.finish_reason),
        stop_sequence: null,
        usage: {
          input_tokens: data.usage?.prompt_tokens || 0,
          output_tokens: data.usage?.completion_tokens || 0
        }
      }
      
      debug('Claude response:', JSON.stringify(claudeResponse, null, 2))
      return c.json(claudeResponse)
    }

    // Streaming response using Server-Sent Events
    return c.body(new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        const sendSSE = (event: string, data: any) => {
          debug('Sending SSE:', { event, data: JSON.stringify(data, null, 2) })
          const sseMessage = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(sseMessage))
        }

        let isSucceeded = false
        const messageId = 'msg_' + Math.random().toString(36).substring(2, 26)

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
        let buffer = ''

        try {
          while (!done) {
            const { value, done: doneReading } = await reader.read()
            done = doneReading
            if (value) {
              const chunk = decoder.decode(value)
              debug('OpenAI response chunk:', chunk)
              
              // Append chunk to buffer to handle partial lines
              buffer += chunk
              const lines = buffer.split('\n')
              
              // Keep the last line in buffer if it doesn't end with newline
              // (it might be incomplete)
              if (!buffer.endsWith('\n')) {
                buffer = lines.pop() || ''
              } else {
                buffer = ''
              }

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
          
          // Process any remaining buffer content
          if (buffer.trim()) {
            debug('Processing remaining buffer:', buffer)
            const lines = buffer.split('\n')
            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed && trimmed.startsWith('data:')) {
                try {
                  const dataStr = trimmed.replace(/^data:\s*/, '')
                  if (dataStr !== '[DONE]') {
                    const parsed = JSON.parse(dataStr)
                    // Process the final chunk (same logic as above)
                    debug('Final chunk data:', parsed)
                  }
                } catch (e) {
                  debug('Failed to parse final buffer:', e)
                }
              }
            }
          }
        } catch (error) {
          console.error('Streaming error:', error)
          controller.error(error)
        } finally {
          try {
            controller.close()
          } catch {
            // Controller already closed, ignore
          }
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


function mapStopReason(finishReason: string): string {
  switch (finishReason) {
    case 'tool_calls': return 'tool_use'
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    default: return 'end_turn'
  }
}

export default app
