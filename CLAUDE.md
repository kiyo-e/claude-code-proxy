# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Code proxy service that translates between Anthropic's Claude API format and OpenAI-compatible API formats. Built with Hono framework on Bun runtime, it can be deployed to Cloudflare Workers, Docker, or as an npm package CLI.

## Architecture

### Core Components
- **`src/index.ts`** - Main Hono application with API proxy logic (src/index.ts:39-516)
- **`src/server.ts`** - Node.js server wrapper for CLI distribution with argument parsing
- **`src/transform.ts`** - API format transformation utilities between OpenAI and Claude formats

### API Translation Logic (src/index.ts:39-516)
The proxy handles `/v1/messages` POST requests and transforms between formats:
- **Message normalization**: Converts Claude's nested content arrays to OpenAI's flat structure
- **Tool call mapping**: Transforms Claude's `tool_use`/`tool_result` to OpenAI's `tool_calls`/`tool` roles
- **Schema transformation**: Removes `format: 'uri'` constraints from JSON schemas for compatibility
- **Model routing**: Dynamically selects models based on `thinking` flag in request
- **Streaming support**: Handles both streaming and non-streaming responses with SSE

### Transformation Module (src/transform.ts)
Key exported functions:
- `transformOpenAIToClaude()`: Main transformation from OpenAI to Claude format
- `sanitizeRoot()`: Drops unsupported OpenAI parameters and ensures Claude requirements
- `mapTools()`: Converts OpenAI tools/functions to Claude tool format
- `mapToolChoice()`: Maps OpenAI function_call to Claude tool_choice
- `transformMessages()`: Converts message roles and content blocks
- `removeUriFormat()`: Recursively removes format:'uri' from JSON schemas
- `transformClaudeToOpenAI()`: Converts Claude responses back to OpenAI format

### Dual Runtime Support
- **Cloudflare Workers**: Uses Hono's built-in fetch handler (`src/index.ts`)
- **Node.js**: Uses `@hono/node-server` adapter (`src/server.ts`)

## Development Commands

```bash
# Install dependencies
bun install

# Local development server (hot reload on port 3000)
bun run start

# Cloudflare Workers development (local testing)
bun run dev

# Build CLI binary to ./bin
bun run build

# Test the built CLI
bun run bin --help
./bin --help
./bin -p 8080  # Run on different port

# Deploy to Cloudflare Workers
bun run deploy

# Set environment variables for Cloudflare Workers
npx wrangler secret put CLAUDE_CODE_PROXY_API_KEY
npx wrangler env put REASONING_MODEL "z-ai/glm-4.5-air:free"

# Publishing to npm
npm version patch  # or minor/major
npm publish
```

## CLI Package

The project builds to an executable CLI via `bun run build`:
- **Output**: `./bin` - Standalone Node.js executable with ES module format
- **Version management**: Reads dynamically from `package.json`
- **CLI flags**: 
  - `-v/--version`: Show version
  - `--help`: Show help information
  - `-p/--port <PORT>`: Set server port (default: 3000)
- **Build process**: Uses Bun's native TypeScript compilation with executable permission

## Environment Variables

Configure via `wrangler.toml` or environment:

### Required
- `CLAUDE_CODE_PROXY_API_KEY` - Bearer token for upstream API authentication

### Optional Configuration
- `ANTHROPIC_PROXY_BASE_URL` - Upstream API URL (default: https://models.github.ai/inference)
- `REASONING_MODEL` - Model for reasoning requests (default: openai/gpt-4.1)
- `COMPLETION_MODEL` - Model for completion requests (default: openai/gpt-4.1)
- `REASONING_MAX_TOKENS` - Max tokens for reasoning model (overrides request setting)
- `COMPLETION_MAX_TOKENS` - Max tokens for completion model (overrides request setting)
- `REASONING_EFFORT` - Reasoning effort level for reasoning model (values: "low", "medium", "high")
- `DEBUG` - Enable debug logging (default: false)
- `PORT` - Server port for Node.js mode (default: 3000)

### Model Selection Logic
- When request contains `thinking: true`, uses `REASONING_MODEL`
- Otherwise uses `COMPLETION_MODEL`
- `REASONING_EFFORT` only applies when using reasoning models
- Max tokens overrides take precedence over request-provided values

## Deployment Options

### Cloudflare Workers
Uses `wrangler.toml` configuration:
```bash
bun run deploy
```

### Docker
Multi-stage build with production optimization using distroless image:
```bash
# Build image
docker build -t claude-code-proxy .

# Run with environment variables
docker run -d -p 3000:3000 \
  -e CLAUDE_CODE_PROXY_API_KEY=your_token \
  -e ANTHROPIC_PROXY_BASE_URL=https://models.github.ai/inference \
  claude-code-proxy

# Development with hot reload (using compose.yml)
docker compose up
```

### NPM Package
Published as `@kiyo-e/claude-code-proxy` with CLI binary:
```bash
npm install -g @kiyo-e/claude-code-proxy
claude-code-proxy --help
```

## GitHub Actions Integration

Service container setup for `@claude` mentions in GitHub Actions:
```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    services:
      claude-code-proxy:
        image: ghcr.io/kiyo-e/claude-code-proxy:latest
        ports:
          - 3000:3000
        env:
          CLAUDE_CODE_PROXY_API_KEY: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_PROXY_BASE_URL: https://models.github.ai/inference
          REASONING_MODEL: openai/gpt-4.1
          COMPLETION_MODEL: openai/gpt-4.1
    
    steps:
      - uses: actions/checkout@v4
      - name: Run Claude Code
        run: |
          export ANTHROPIC_BASE_URL=http://localhost:3000
          claude "Review the changes in this PR"
```

## Local Usage with Claude Code

### Development Server
```bash
# Start proxy (port 3000 by default)
bun run start

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 claude
```

### Docker Usage
```bash
# Quick start with GitHub token
docker run -d -p 3000:3000 -e CLAUDE_CODE_PROXY_API_KEY=your_token ghcr.io/kiyo-e/claude-code-proxy:latest

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 claude "Review the API code and suggest improvements"
```

### OpenRouter Configuration
```bash
# Using environment file
echo "ANTHROPIC_PROXY_BASE_URL=https://openrouter.ai/api/v1" > .env
echo "REASONING_MODEL=z-ai/glm-4.5-air:free" >> .env
echo "COMPLETION_MODEL=z-ai/glm-4.5-air:free" >> .env
echo "REASONING_EFFORT=high" >> .env
docker run -d -p 3000:3000 --env-file .env ghcr.io/kiyo-e/claude-code-proxy:latest
```

### Development with Local Claude Code
```bash
# Start the proxy
bun run start

# In another terminal, use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 \
CLAUDE_CODE_PROXY_API_KEY=your_token \
claude "Review this code and suggest improvements"

# Debug mode
DEBUG=true bun run start
```

## Important Implementation Notes

### Request Flow
1. Client sends Claude API format request to `/v1/messages`
2. Proxy transforms to OpenAI format using `transformOpenAIToClaude()`
3. Request forwarded to upstream API (configured via `ANTHROPIC_PROXY_BASE_URL`)
4. Response transformed back to Claude format
5. Streaming responses handled with Server-Sent Events (SSE)

### Error Handling
- HTTP errors from upstream API: Returns same status code with error details
- API errors in response body: Returns 500 with error message
- Dropped parameters tracked in `X-Dropped-Params` header

### Debugging
- Enable `DEBUG=true` to log request/response payloads
- Bearer tokens are automatically masked in logs
- Check health endpoint at `/` for configuration status