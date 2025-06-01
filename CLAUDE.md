# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Code proxy service that translates between Anthropic's Claude API format and OpenAI-compatible API formats. Built with Hono framework on Bun runtime, it can be deployed to Cloudflare Workers or run locally.

## Architecture

The proxy service handles:
- API format translation between Claude and OpenAI formats
- Message content normalization and tool call mapping
- Streaming and non-streaming response handling 
- JSON schema transformation (removes `format: 'uri'` constraints)
- SSE (Server-Sent Events) for streaming responses

Core logic in `src/index.ts:34-450` handles the `/v1/messages` endpoint that performs the translation.

## Development Commands

```bash
# Install dependencies
bun install

# Local development (hot reload)
bun run start

# Cloudflare Workers development
bun run dev

# Deploy to Cloudflare Workers  
bun run deploy
```

## Environment Variables

Configure via `wrangler.toml` or environment:
- `API_KEY` - Bearer token for upstream API
- `ANTHROPIC_PROXY_BASE_URL` - Upstream API URL (default: https://models.github.ai/inference)  
- `REASONING_MODEL` - Model for reasoning requests (default: openai/gpt-4.1)
- `COMPLETION_MODEL` - Model for completion requests (default: openai/gpt-4.1)
- `DEBUG` - Enable debug logging (default: false)

## Deployment Options

### Cloudflare Workers
Uses `wrangler.toml` configuration and `bun run deploy`

### Docker/Compose  
Uses `Dockerfile` and `compose.yml` for containerized deployment on port 3000

## GitHub Actions Integration

This proxy can be used with Claude Code GitHub Actions via `.github/workflows/claude.yml`. The workflow:
- Triggers on `@claude` mentions in issues, PRs, and comments
- Runs the proxy as a service container on port 3000 
- Uses `anthropics/claude-code-action@beta` with `ANTHROPIC_BASE_URL: http://localhost:3000`

## Local Usage with Claude Code

### Development Server
```bash
# Start the proxy
bun run start

# In another terminal, use Claude Code with the proxy
ANTHROPIC_BASE_URL=http://localhost:8787 claude
```

### Docker Usage
```bash
# Build and run with Docker
docker build -t claude-code-proxy .
docker run -d -p 3000:3000 claude-code-proxy

# Verify the proxy is running
curl http://localhost:3000

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 claude

# Example usage
ANTHROPIC_BASE_URL=http://localhost:3000 claude "Review the API code and suggest improvements"
```