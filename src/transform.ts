/**
 * Transform module for converting between OpenAI and Claude API formats
 * Design document reference: https://github.com/kiyo-e/claude-code-proxy/issues
 * Related classes: src/index.ts - Main proxy service implementation
 */

// OpenAI-specific parameters that Claude doesn't support
const DROP_KEYS = [
  'n',
  'presence_penalty',
  'frequency_penalty',
  'best_of',
  'logit_bias',
  'seed',
  'stream_options',
  'logprobs',
  'top_logprobs',
  'user',
  'response_format',
  'service_tier',
  'parallel_tool_calls',
  'functions',
  'function_call'
]

interface DroppedParams {
  keys: string[]
}

/**
 * Sanitize root-level parameters from OpenAI to Claude format
 */
export function sanitizeRoot(req: any): DroppedParams {
  const dropped: string[] = []
  
  // Rename stop → stop_sequences
  if (req.stop !== undefined) {
    req.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop]
    delete req.stop
    
  }
  
  // Convert user → metadata.user_id
  if (req.user) {
    req.metadata = { ...req.metadata, user_id: req.user }
    dropped.push('user')
    delete req.user
  }
  
  // Drop all unsupported OpenAI parameters
  for (const key of DROP_KEYS) {
    if (key in req) {
      dropped.push(key)
      delete req[key]
    }
  }
  
  // Ensure max_tokens is set (Claude requirement)
  if (req.max_tokens == null) {
    req.max_tokens = 4096 // Default max tokens
  }
  
  return { keys: dropped }
}

/**
 * Map OpenAI tools/functions to Claude tools format
 */
export function mapTools(req: any): void {
  // Combine tools and functions into a unified array
  const openAITools = (req.tools ?? [])
    .concat((req.functions ?? []).map((f: any) => ({
      type: 'function',
      function: f
    })))
  
  // Convert to Claude tool format
  req.tools = openAITools.map((t: any) => ({
    name: t.function?.name ?? t.name,
    description: t.function?.description ?? t.description,
    input_schema: removeUriFormat(t.function?.parameters ?? t.input_schema)
  }))
  
  // Clean up original fields
  delete req.functions
}

/**
 * Map OpenAI function_call to Claude tool_choice
 */
export function mapToolChoice(req: any): void {
  if (!req.function_call) return
  
  const fc = req.function_call
  
  // Convert to Claude tool_choice format
  if (typeof fc === 'string') {
    // Handle string values: 'auto', 'none'
    req.tool_choice = {
      type: fc === 'none' ? 'none' : 'auto'
    }
  } else if (fc && typeof fc === 'object' && fc.name) {
    // Handle specific function call
    req.tool_choice = {
      type: 'tool',
      name: fc.name
    }
  }
  
  delete req.function_call
}

/**
 * Transform messages from OpenAI to Claude format
 */
export function transformMessages(req: any): void {
  if (!req.messages || !Array.isArray(req.messages)) return
  
  const transformedMessages: any[] = []
  let systemMessages: string[] = []
  
  for (const msg of req.messages) {
    // Extract system messages
    if (msg.role === 'system') {
      systemMessages.push(msg.content)
      continue
    }
    
    // Handle function role → user role with tool_result
    if (msg.role === 'function') {
      transformedMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || msg.name,
          content: msg.content
        }]
      })
      continue
    }
    
    // Handle assistant messages with function_call
    if (msg.role === 'assistant' && msg.function_call) {
      const content: any[] = []
      
      // Add text content if present
      if (msg.content) {
        content.push({
          type: 'text',
          text: msg.content
        })
      }
      
      // Add tool_use block
      content.push({
        type: 'tool_use',
        id: msg.function_call.id || `call_${Math.random().toString(36).substring(2, 10)}`,
        name: msg.function_call.name,
        input: typeof msg.function_call.arguments === 'string' 
          ? JSON.parse(msg.function_call.arguments)
          : msg.function_call.arguments
      })
      
      transformedMessages.push({
        role: 'assistant',
        content
      })
      continue
    }
    
    // Handle assistant messages with tool_calls
    if (msg.role === 'assistant' && msg.tool_calls) {
      const content: any[] = []
      
      // Add text content if present
      if (msg.content) {
        content.push({
          type: 'text',
          text: msg.content
        })
      }
      
      // Add tool_use blocks
      for (const toolCall of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments
        })
      }
      
      transformedMessages.push({
        role: 'assistant',
        content
      })
      continue
    }
    
    // Handle tool role → user role with tool_result
    if (msg.role === 'tool') {
      transformedMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content
        }]
      })
      continue
    }
    
    // Pass through other messages
    transformedMessages.push(msg)
  }
  
  // Set system message (Claude takes a single system string, not array)
  if (systemMessages.length > 0) {
    req.system = systemMessages.join('\n\n')
  }
  
  req.messages = transformedMessages
}

/**
 * Recursively remove format: 'uri' from JSON schemas
 */
export function removeUriFormat(schema: any): any {
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

/**
 * Main transformation function from OpenAI to Claude format
 */
export function transformOpenAIToClaude(openAIRequest: any): { claudeRequest: any, droppedParams: string[] } {
  // Deep clone to avoid mutating original
  const req = JSON.parse(JSON.stringify(openAIRequest))
  
  // Apply transformations in order
  const dropped = sanitizeRoot(req)
  mapTools(req)
  mapToolChoice(req)
  transformMessages(req)
  
  return {
    claudeRequest: req,
    droppedParams: dropped.keys
  }
}

/**
 * Transform Claude response back to OpenAI format
 */
export function transformClaudeToOpenAI(claudeResponse: any, model: string): any {
  // Handle non-streaming response
  const openAIResponse: any = {
    id: claudeResponse.id || `chatcmpl-${Math.random().toString(36).substring(2, 15)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [],
    usage: {
      prompt_tokens: claudeResponse.usage?.input_tokens || 0,
      completion_tokens: claudeResponse.usage?.output_tokens || 0,
      total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0)
    }
  }
  
  // Build the message from Claude content blocks
  const message: any = {
    role: 'assistant',
    content: null
  }
  
  const textParts: string[] = []
  const toolCalls: any[] = []
  
  if (Array.isArray(claudeResponse.content)) {
    for (const block of claudeResponse.content) {
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
  } else if (typeof claudeResponse.content === 'string') {
    textParts.push(claudeResponse.content)
  }
  
  // Set content and tool_calls
  message.content = textParts.join('')
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls
  }
  
  // Map stop_reason to finish_reason
  let finishReason = 'stop'
  if (claudeResponse.stop_reason === 'tool_use') {
    finishReason = 'tool_calls'
  } else if (claudeResponse.stop_reason === 'max_tokens') {
    finishReason = 'length'
  } else if (claudeResponse.stop_reason === 'end_turn') {
    finishReason = 'stop'
  }
  
  openAIResponse.choices.push({
    index: 0,
    message,
    finish_reason: finishReason
  })
  
  return openAIResponse
}