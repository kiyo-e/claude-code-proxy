# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Code proxy service that translates between Anthropic's Claude API format and OpenAI-compatible API formats. Built with Hono framework on Bun runtime, it can be deployed to Cloudflare Workers, Docker, or as an npm package CLI.

## Architecture

### Core Components
- **`src/index.ts`** - Main Hono application with API proxy logic
- **`src/server.ts`** - Node.js server wrapper for CLI distribution with argument parsing

### API Translation Logic
The proxy service handles (in `src/index.ts:32-450`):
- **Message normalization**: Converts Claude's nested content arrays to OpenAI's flat structure
- **Tool call mapping**: Transforms Claude's `tool_use`/`tool_result` to OpenAI's `tool_calls`/`tool` roles
- **Schema transformation**: Removes `format: 'uri'` constraints from JSON schemas for compatibility
- **Model routing**: Dynamically selects models based on request type (reasoning vs completion)
- **Streaming support**: Handles both streaming and non-streaming responses with SSE

### Dual Runtime Support
- **Cloudflare Workers**: Uses Hono's built-in fetch handler (`src/index.ts`)
- **Node.js**: Uses `@hono/node-server` adapter (`src/server.ts`)

## Development Commands

```bash
# Install dependencies
bun install

# Local development server (hot reload)
bun run start

# Cloudflare Workers development
bun run dev

# Build CLI package
bun run build

# Deploy to Cloudflare Workers
bun run deploy
```

## CLI Package

The project builds to an executable CLI via `bun run build`:
- **Output**: `./bin` - Standalone Node.js executable
- **Version management**: Reads from `package.json` dynamically
- **CLI flags**: `-v/--version`, `--help`, `-p/--port`

## Environment Variables

Configure via `wrangler.toml` or environment:
- `CLAUDE_CODE_PROXY_API_KEY` - Bearer token for upstream API
- `ANTHROPIC_PROXY_BASE_URL` - Upstream API URL (default: https://models.github.ai/inference)
- `REASONING_MODEL` - Model for reasoning requests (default: openai/gpt-4.1)
- `COMPLETION_MODEL` - Model for completion requests (default: openai/gpt-4.1)
- `DEBUG` - Enable debug logging (default: false)
- `PORT` - Server port for Node.js mode (default: 3000)

## Deployment Options

### Cloudflare Workers
Uses `wrangler.toml` configuration:
```bash
bun run deploy
```

### Docker
Multi-stage build with production optimization:
```bash
docker build -t claude-code-proxy .
docker run -d -p 3000:3000 claude-code-proxy
```

### NPM Package
Published as `@kiyo-e/claude-code-proxy` with CLI binary:
```bash
npm install -g @kiyo-e/claude-code-proxy
claude-code-proxy --help
```

## GitHub Actions Integration

Service container setup for `@claude` mentions:
```yaml
services:
  claude-code-proxy:
    image: ghcr.io/kiyo-e/claude-code-proxy:latest
    ports: [3000:3000]
    env:
      CLAUDE_CODE_PROXY_API_KEY: ${{ secrets.GITHUB_TOKEN }}
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
echo "REASONING_MODEL=deepseek/deepseek-r1-0528:free" >> .env
docker run -d -p 3000:3000 --env-file .env ghcr.io/kiyo-e/claude-code-proxy:latest
```