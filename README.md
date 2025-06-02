# Claude Code Proxy

A proxy service that translates between Anthropic's Claude API format and OpenAI-compatible API formats. Built with Hono framework on Bun runtime, deployable to Cloudflare Workers, Docker, or as a standalone CLI.

## Features

- **API Translation**: Seamless format conversion between Claude and OpenAI APIs
- **Message Normalization**: Handles nested content arrays and tool call mapping
- **Streaming Support**: Both streaming and non-streaming response handling
- **Multiple Deployment Options**: Cloudflare Workers, Docker, or npm package
- **CLI Interface**: Standalone executable with version and help flags
- **Model Routing**: Dynamic model selection for reasoning vs completion tasks

## Installation & Usage

### NPM Package (Recommended)

```bash
# Install globally
npm install -g @kiyo-e/claude-code-proxy

# Run the proxy
claude-code-proxy --help
claude-code-proxy --port 8080

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 claude "Help me review this code"
```

### Docker (Quick Start)

```bash
# GitHub Models (default)
docker run -d -p 8787:8787 -e CLAUDE_CODE_PROXY_API_KEY=your_github_token ghcr.io/kiyo-e/claude-code-proxy:latest

# OpenRouter
docker run -d -p 8787:8787 \
  -e CLAUDE_CODE_PROXY_API_KEY=your_openrouter_key \
  -e ANTHROPIC_PROXY_BASE_URL=https://openrouter.ai/api/v1 \
  -e REASONING_MODEL=deepseek/deepseek-r1-0528:free \
  -e COMPLETION_MODEL=deepseek/deepseek-r1-0528:free \
  ghcr.io/kiyo-e/claude-code-proxy:latest

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:8787 claude "Help me review this code"
```

### Environment File Configuration

```bash
# Create .env file
cat > .env << EOF
CLAUDE_CODE_PROXY_API_KEY=your_api_key
ANTHROPIC_PROXY_BASE_URL=https://openrouter.ai/api/v1
REASONING_MODEL=deepseek/deepseek-r1-0528:free
COMPLETION_MODEL=deepseek/deepseek-r1-0528:free
DEBUG=false
EOF

# Run with env file
docker run -d -p 8787:8787 --env-file .env ghcr.io/kiyo-e/claude-code-proxy:latest
```

## Development

### Local Development

```bash
# Install dependencies
bun install

# Hot reload development server (port 3000)
bun run start

# Cloudflare Workers development
bun run dev

# Build CLI package
bun run build

# Test CLI
./bin --help
```

### Deploy

```bash
# Deploy to Cloudflare Workers
bun run deploy

# Build and publish npm package
bun run build
npm publish
```

## Configuration

### Environment Variables

- `CLAUDE_CODE_PROXY_API_KEY` - Bearer token for upstream API
- `ANTHROPIC_PROXY_BASE_URL` - Upstream API URL (default: https://models.github.ai/inference)
- `REASONING_MODEL` - Model for reasoning requests (default: openai/gpt-4.1)
- `COMPLETION_MODEL` - Model for completion requests (default: openai/gpt-4.1)
- `DEBUG` - Enable debug logging (default: false)
- `PORT` - Server port for CLI mode (default: 3000)

### CLI Options

```bash
claude-code-proxy [options]

Options:
  -v, --version    Show version number
  -h, --help       Show help message
  -p, --port PORT  Set server port (default: 3000)
```

## GitHub Actions Integration

Enable `@claude` mentions in issues and PRs:

```yaml
name: Claude PR Assistant
on:
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]

jobs:
  claude-code-action:
    if: contains(github.event.comment.body, '@claude') || github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    services:
      claude-code-proxy:
        image: ghcr.io/kiyo-e/claude-code-proxy:latest
        ports:
          - 8787:8787
        env:
          CLAUDE_CODE_PROXY_API_KEY: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - name: Run Claude PR Action
        uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.GITHUB_TOKEN }}
        env:
          ANTHROPIC_BASE_URL: http://localhost:8787
```

## API Endpoints

- `GET /` - Health check and configuration status
- `POST /v1/messages` - Claude API proxy endpoint with OpenAI compatibility

## Architecture

The proxy handles:
- **Message Translation**: Converts Claude's nested content structure to OpenAI's flat format
- **Tool Call Mapping**: Transforms `tool_use`/`tool_result` to `tool_calls`/`tool` roles
- **Schema Transformation**: Removes `format: 'uri'` constraints for compatibility
- **Streaming**: SSE support for real-time responses
- **Model Selection**: Dynamic routing based on request characteristics

## Supported Providers

- **GitHub Models** (default) - Uses GitHub token for authentication
- **OpenRouter** - Supports various open-source models
- **Custom OpenAI-compatible APIs** - Any API following OpenAI format

---

Built with [Bun](https://bun.sh) and [Hono](https://hono.dev/)
