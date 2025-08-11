import { Hono } from 'hono'
import { env } from 'hono/adapter'
import { cors } from 'hono/cors'
import { transformOpenAIToClaude, removeUriFormat } from './transform'

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

// Add CORS middleware
app.use('*', cors())

const defaultModel = 'openai/gpt-4.1'

// Health check endpoint
app.get('/', (c) => {
  const { ANTHROPIC_PROXY_BASE_URL, REASONING_MODEL, COMPLETION_MODEL, REASONING_MAX_TOKENS, COMPLETION_MAX_TOKENS, REASONING_EFFORT } = env(c)

  // Set headers to prevent caching issues
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
  c.header('Pragma', 'no-cache')
  c.header('Expires', '0')
  
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
    
    // Transform Claude format to OpenAI format for upstream API
    // FIXED: Using the correct transformation function (was using the wrong one)
    // The function name 'transformOpenAIToClaude' is misleading - it actually does Claude->OpenAI
    const { claudeRequest, droppedParams } = transformOpenAIToClaude(claudePayload)

    // Convert messages from Claude to OpenAI format for upstream API
    const messages: any[] = []
    
    // Add system messages
    if (claudeRequest.system) {
      let systemContent: string
      
      if (typeof claudeRequest.system === 'string') {
        systemContent = claudeRequest.system
      } else if (Array.isArray(claudeRequest.system)) {
        // Handle array of system messages (join them)
        systemContent = claudeRequest.system
          .map((item: any) => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object') {
              if (item.type === 'text' && item.text) return item.text
              if (item.content) return typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
            }
            return JSON.stringify(item)
          })
          .join('\n\n')
      } else if (typeof claudeRequest.system === 'object') {
        // Handle object system message (e.g., structured content)
        if (claudeRequest.system.text) {
          systemContent = claudeRequest.system.text
        } else if (claudeRequest.system.content) {
          systemContent = typeof claudeRequest.system.content === 'string' 
            ? claudeRequest.system.content 
            : JSON.stringify(claudeRequest.system.content)
        } else {
          systemContent = JSON.stringify(claudeRequest.system)
        }
      } else {
        systemContent = String(claudeRequest.system)
      }
      
      messages.push({
        role: 'system',
        content: systemContent
      })
    }
    
    // Process regular messages
    if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
      for (const msg of claudeRequest.messages) {
        if (msg.role === 'user') {
          // Handle user messages which may contain tool_result blocks
          if (Array.isArray(msg.content)) {
            const textParts: string[] = []
            const toolResults: any[] = []
            
            for (const block of msg.content) {
              if (block.type === 'text') {
                textParts.push(block.text)
              } else if (block.type === 'tool_result') {
                // Tool results should be separate tool messages
                toolResults.push({
                  role: 'tool',
                  content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                  tool_call_id: block.tool_use_id
                })
              }
            }
            
            // If we have tool results, they should be added as tool messages
            // OpenAI expects: assistant with tool_calls -> tool messages -> user message
            if (toolResults.length > 0) {
              // Add tool messages first
              messages.push(...toolResults)
              // Then add user message if it has text content
              if (textParts.length > 0) {
                messages.push({
                  role: 'user',
                  content: textParts.join(' ')
                })
              }
            } else if (textParts.length > 0) {
              // Regular user message without tool results
              messages.push({
                role: 'user',
                content: textParts.join(' ')
              })
            }
          } else if (typeof msg.content === 'string') {
            messages.push({
              role: 'user',
              content: msg.content
            })
          }
        } else if (msg.role === 'assistant') {
          // Handle assistant messages which may contain tool_use blocks
          if (Array.isArray(msg.content)) {
            const textParts: string[] = []
            const toolCalls: any[] = []
            
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
              }
            }
            
            // Add assistant message with content and/or tool calls
            const openAIMsg: any = { role: 'assistant' }
            // OpenAI requires content to be null when only tool_calls are present
            if (textParts.length > 0) {
              openAIMsg.content = textParts.join(' ')
            } else if (toolCalls.length > 0) {
              openAIMsg.content = null
            }
            if (toolCalls.length > 0) {
              openAIMsg.tool_calls = toolCalls
            }
            // Ensure we have either content or tool_calls
            if (textParts.length > 0 || toolCalls.length > 0) {
              messages.push(openAIMsg)
            }
          } else if (typeof msg.content === 'string') {
            messages.push({
              role: 'assistant',
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

    const selectedModel = claudePayload.thinking ? models.reasoning : models.completion
    const isO3Model = selectedModel && (selectedModel.includes('o3') || selectedModel.includes('gpt-5'))
    
    const openaiPayload: any = {
      // Existing fields kept as before

      model: selectedModel,
      messages,
      // o3/o1/gpt-5 models only support temperature=1 (default)
      temperature: isO3Model ? undefined : (claudeRequest.temperature !== undefined ? claudeRequest.temperature : 1),
      stream: claudeRequest.stream === true,
    }
    
    // Handle max_tokens vs max_completion_tokens based on model type
    const reasoningMaxTokens = REASONING_MAX_TOKENS ? parseInt(REASONING_MAX_TOKENS) : undefined
    const completionMaxTokens = COMPLETION_MAX_TOKENS ? parseInt(COMPLETION_MAX_TOKENS) : undefined
    
    let maxTokensValue = claudeRequest.max_tokens
    if (selectedModel === models.reasoning && reasoningMaxTokens) {
      maxTokensValue = reasoningMaxTokens
    } else if (selectedModel === models.completion && completionMaxTokens) {
      maxTokensValue = completionMaxTokens
    }
    
    // Use max_completion_tokens for o3/o1 models, max_tokens for others
    if (maxTokensValue !== null && maxTokensValue !== undefined) {
      if (isO3Model) {
        openaiPayload.max_completion_tokens = maxTokensValue
      } else {
        openaiPayload.max_tokens = maxTokensValue
      }
    }
    
    // Apply reasoning_effort if configured and model is reasoning
    if (selectedModel === models.reasoning && REASONING_EFFORT) {
      openaiPayload.reasoning_effort = REASONING_EFFORT
    }
    // Add tool_choice if present
    if (claudeRequest.tool_choice) {
      const { type, name } = claudeRequest.tool_choice
      openaiPayload.tool_choice = 
        type === 'tool' && name ? { type: 'function', function: { name } } :
        type === 'none' || type === 'auto' ? type : undefined
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
      debug('Processing non-streaming response...')
      const data: any = await openaiResponse.json()
      debug('OpenAI response received, parsing...')
      debug('OpenAI response:', JSON.stringify(data, null, 2))
      if (data.error) {
        console.error('OpenAI API returned error in response body:', data.error)
        return c.json({ error: data.error.message || 'Unknown error' }, 500)
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
          // Handle both old and new o3 tool call formats
          const toolId = toolCall.id || `tool_${Date.now()}`
          const toolName = toolCall.function?.name || toolCall.name
          const toolArguments = toolCall.function?.arguments || toolCall.arguments
          
          content.push({
            type: 'tool_use',
            id: toolId,
            name: toolName,
            input: typeof toolArguments === 'string' ? JSON.parse(toolArguments) : toolArguments
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
      debug('Attempting to return response to client...')
      
      // Set proper headers for Claude API response
      c.header('Content-Type', 'application/json')
      c.header('anthropic-version', '2023-06-01')
      
      try {
        const response = c.json(claudeResponse, 200)
        debug('Response created successfully')
        return response
      } catch (jsonError) {
        console.error('Error returning JSON response:', jsonError)
        console.error('Response object:', claudeResponse)
        // Fallback: return a simplified response
        return c.json({
          id: claudeResponse.id,
          type: 'message',
          role: 'assistant',
          model: claudeResponse.model,
          content: claudeResponse.content,
          stop_reason: claudeResponse.stop_reason,
          stop_sequence: null,
          usage: claudeResponse.usage
        }, 200)
      }
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
              usage: { 
                input_tokens: 0, 
                output_tokens: 0 
              },
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
                      ? { 
                          input_tokens: usage.prompt_tokens || 0,
                          output_tokens: usage.completion_tokens || 0
                        }
                      : { 
                          input_tokens: 0,
                          output_tokens: 0
                        }
                  })
                  sendSSE('message_stop', {
                    type: 'message_stop'
                  })
                  // Send an explicit end signal for SSE
                  controller.enqueue(encoder.encode('\n'))
                  controller.close()
                  return
                }

                try {
                  const parsed = JSON.parse(dataStr)
                  if (parsed.error) {
                    throw new Error(parsed.error.message)
                  }
                  
                  // Capture usage BEFORE sending success message
                  if (parsed.usage) {
                    usage = parsed.usage
                  }
                  
                  sendSuccessMessage()
                  
                  // Check if this is an empty response with finish_reason
                  const choice = parsed.choices[0]
                  if (choice.finish_reason && !choice.delta?.content && !choice.delta?.tool_calls) {
                    // Empty response, send minimal content block if none was sent
                    if (!textBlockStarted && !encounteredToolCall) {
                      textBlockStarted = true
                      sendSSE('content_block_start', {
                        type: 'content_block_start',
                        index: 0,
                        content_block: {
                          type: 'text',
                          text: ''
                        }
                      })
                      // Don't send content_block_stop here, it will be sent when [DONE] is received
                    }
                    // Continue to process finish_reason below
                  }

                  const delta = choice.delta
                  if (delta && delta.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                      encounteredToolCall = true
                      const idx = toolCall.index
                      if (toolCallAccumulators[idx] === undefined) {
                        toolCallAccumulators[idx] = ""
                        // Handle both old and new o3 tool call formats
                        const toolId = toolCall.id || `tool_${Date.now()}_${idx}`
                        const toolName = toolCall.function?.name || toolCall.name
                        sendSSE('content_block_start', {
                          type: 'content_block_start',
                          index: idx,
                          content_block: {
                            type: 'tool_use',
                            id: toolId,
                            name: toolName,
                            input: {}
                          }
                        })
                      }
                      // For streaming, arguments come as deltas that need to be accumulated
                      const deltaArgs = toolCall.function?.arguments || toolCall.arguments || ""
                      if (deltaArgs) {
                        toolCallAccumulators[idx] = (toolCallAccumulators[idx] || "") + deltaArgs
                        sendSSE('content_block_delta', {
                          type: 'content_block_delta',
                          index: idx,
                          delta: {
                            type: 'input_json_delta',
                            partial_json: deltaArgs
                          }
                        })
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
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
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
