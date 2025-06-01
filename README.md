# Claude Code Proxy

A proxy service that translates between Anthropic's Claude API format and OpenAI-compatible API formats. Built with Hono framework on Bun runtime, deployable to Cloudflare Workers or Docker.

## Features

- API format translation between Claude and OpenAI formats
- Message content normalization and tool call mapping
- Streaming and non-streaming response handling
- JSON schema transformation for compatibility
- SSE (Server-Sent Events) support

## Quick Start

```bash
# Run the proxy with Docker (using GitHub token)
docker run -d -p 3000:3000 -e API_KEY=your_github_token ghcr.io/kiyo-e/claude_code_proxy:latest

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 claude "Help me review this code"
```

### Using Environment File (OpenRouter)

```bash
# Create .env file with OpenRouter configuration
echo "API_KEY=your_openrouter_api_key" > .env
echo "ANTHROPIC_PROXY_BASE_URL=https://openrouter.ai/api/v1" >> .env
echo "REASONING_MODEL=deepseek/deepseek-r1-0528:free" >> .env
echo "COMPLETION_MODEL=deepseek/deepseek-r1-0528:free" >> .env

# Run with env file
docker run -d -p 3000:3000 --env-file .env ghcr.io/kiyo-e/claude_code_proxy:latest

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 claude "Help me review this code"
```

### Development

```bash
# Install dependencies
bun install

# Hot reload development server
bun run start

# Cloudflare Workers development
bun run dev
```

### Deploy
```bash
# Deploy to Cloudflare Workers
bun run deploy
```

## Configuration

Configure via environment variables or `wrangler.toml`:

- `API_KEY` - Bearer token for upstream API
- `ANTHROPIC_PROXY_BASE_URL` - Upstream API URL (default: https://models.github.ai/inference)
- `REASONING_MODEL` - Model for reasoning requests (default: openai/gpt-4.1)
- `COMPLETION_MODEL` - Model for completion requests (default: openai/gpt-4.1)
- `DEBUG` - Enable debug logging (default: false)

## Usage with Claude Code

### Local Development
```bash
# Start the proxy
bun run start

# Use with Claude Code
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

# Example: Ask Claude Code to help with your project
ANTHROPIC_BASE_URL=http://localhost:3000 claude "Help me add error handling to the API endpoints"
```

### GitHub Actions
Add `.github/workflows/claude.yml` to enable `@claude` mentions in issues and PRs:

```yaml
name: Claude PR Assistant
on:
  issue_comment:
    types: [created]
  # ... other triggers
jobs:
  claude-code-action:
    runs-on: ubuntu-latest
    services:
      claude-code-proxy:
        image: ghcr.io/kiyo-e/claude-code-proxy:latest
        ports:
          - 3000:3000
        env:
          API_KEY: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@beta
        env:
          ANTHROPIC_BASE_URL: http://localhost:3000
```

## API Endpoints

- `GET /` - Health check
- `POST /v1/messages` - Claude API proxy endpoint

---

Built with [Bun](https://bun.sh) and [Hono](https://hono.dev/)
