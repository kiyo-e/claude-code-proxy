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

#### Global Installation
```bash
# Install globally
npm install -g @kiyo-e/claude-code-proxy

# Run on default port (3000)
claude-code-proxy

# Or specify a port
claude-code-proxy --port 8080
```

#### On-demand Execution (npx/bunx)
You can also run the proxy without installation:
```bash
# With npx on default port (3000)
npx @kiyo-e/claude-code-proxy

# With bunx on a specific port
bunx @kiyo-e/claude-code-proxy --port 8080
```

#### Using with Claude Code
```bash
# Set the proxy URL (use the port you started the proxy on)
export ANTHROPIC_BASE_URL=http://localhost:3000 

# Use claude command
claude "Help me review this code"
```

### Docker (Quick Start)

```bash
# GitHub Models (default)
docker run -d -p 3000:3000 -e CLAUDE_CODE_PROXY_API_KEY=your_github_token ghcr.io/kiyo-e/claude-code-proxy:latest

# OpenRouter
docker run -d -p 3000:3000 \
  -e CLAUDE_CODE_PROXY_API_KEY=your_openrouter_key \
  -e ANTHROPIC_PROXY_BASE_URL=https://openrouter.ai/api/v1 \
  -e REASONING_MODEL=z-ai/glm-4.5-air:free \
  -e COMPLETION_MODEL=z-ai/glm-4.5-air:free \
  -e REASONING_EFFORT=high \
  ghcr.io/kiyo-e/claude-code-proxy:latest

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 claude "Help me review this code"
```

### Environment File Configuration

```bash
# Create .env file
cat > .env << EOF
CLAUDE_CODE_PROXY_API_KEY=your_api_key
ANTHROPIC_PROXY_BASE_URL=https://openrouter.ai/api/v1
REASONING_MODEL=z-ai/glm-4.5-air:free
COMPLETION_MODEL=z-ai/glm-4.5-air:free
REASONING_MAX_TOKENS=4096
COMPLETION_MAX_TOKENS=2048
REASONING_EFFORT=high
DEBUG=false
EOF

# Run with env file
docker run -d -p 3000:3000 --env-file .env ghcr.io/kiyo-e/claude-code-proxy:latest
```

### Cloudflare Workers

```bash
# Deploy to Cloudflare Workers
bun run deploy

# Configure environment variables in Workers dashboard
# Or set them via wrangler CLI:
npx wrangler secret put CLAUDE_CODE_PROXY_API_KEY
npx wrangler secret put ANTHROPIC_PROXY_BASE_URL
```

After deployment, your proxy will be available at `https://your-worker-name.your-subdomain.workers.dev`

#### Using with Claude Code

```bash
# Set your deployed Worker URL as the base URL
export ANTHROPIC_BASE_URL=https://your-worker-name.your-subdomain.workers.dev

# Now use Claude Code normally
claude "Help me review this code"
claude "Explain this function and suggest improvements"
```

#### Complete Setup Example

1. **Deploy the proxy:**
```bash
git clone https://github.com/kiyo-e/claude-code-proxy
cd claude-code-proxy
bun install
bun run deploy
```

2. **Set environment variables:**
```bash
# For GitHub Models (recommended)
npx wrangler secret put CLAUDE_CODE_PROXY_API_KEY
# Enter your GitHub Personal Access Token

# For OpenRouter
npx wrangler secret put CLAUDE_CODE_PROXY_API_KEY
# Enter your OpenRouter API key
npx wrangler secret put ANTHROPIC_PROXY_BASE_URL
# Enter: https://openrouter.ai/api/v1
npx wrangler secret put REASONING_MODEL
# Enter: z-ai/glm-4.5-air:free
npx wrangler secret put COMPLETION_MODEL
# Enter: z-ai/glm-4.5-air:free
```

3. **Test the deployment:**
```bash
curl https://your-worker-name.your-subdomain.workers.dev
```

4. **Use with Claude Code:**
```bash
# Install Claude Code if not already installed
npm install -g @anthropics/claude-code

# Set the proxy URL
export ANTHROPIC_BASE_URL=https://your-worker-name.your-subdomain.workers.dev

# Use Claude Code
claude "Review this TypeScript code and suggest improvements"
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

### Build and Publish

```bash
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
- `REASONING_MAX_TOKENS` - Max tokens for reasoning model (optional)
- `COMPLETION_MAX_TOKENS` - Max tokens for completion model (optional)
- `REASONING_EFFORT` - Reasoning effort level for reasoning model (optional, e.g., "low", "medium", "high")
- `DEBUG` - Enable debug logging (default: false)
- `PORT` - Server port for CLI mode (default: 3000)

### Cloudflare Workers Configuration

For Cloudflare Workers deployment, set environment variables using the Workers dashboard or wrangler CLI:

```bash
# Set secrets (recommended for sensitive data)
npx wrangler secret put CLAUDE_CODE_PROXY_API_KEY
npx wrangler secret put ANTHROPIC_PROXY_BASE_URL

# Set regular environment variables
npx wrangler env put REASONING_MODEL "z-ai/glm-4.5-air:free"
npx wrangler env put COMPLETION_MODEL "z-ai/glm-4.5-air:free"
npx wrangler env put REASONING_EFFORT "high"
npx wrangler env put DEBUG "false"
```

Alternatively, configure via `wrangler.toml`:

```toml
[env.production.vars]
REASONING_MODEL = "z-ai/glm-4.5-air:free"
COMPLETION_MODEL = "z-ai/glm-4.5-air:free"
REASONING_EFFORT = "high"
DEBUG = "false"
```

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
          - 3000:3000
        env:
          CLAUDE_CODE_PROXY_API_KEY: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - name: Run Claude PR Action
        uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.GITHUB_TOKEN }}
        env:
          ANTHROPIC_BASE_URL: http://localhost:3000
```

## Usage Examples

### Claude Code with Cloudflare Workers

Once you have deployed the proxy to Cloudflare Workers:

```bash
# Set your Worker URL as the API base
export ANTHROPIC_BASE_URL=https://claude-proxy.your-subdomain.workers.dev

# Use Claude Code for various tasks
claude "Review this JavaScript function for potential bugs"
claude "Generate TypeScript interfaces for this API response"
claude "Optimize this React component for better performance"
claude "Explain what this complex regex pattern does"

# Use with specific files
claude "Check this package.json for security vulnerabilities" package.json
claude "Suggest improvements for this README" README.md
```

### Direct API Usage

You can also use the proxy directly with HTTP requests:

```bash
# Health check
curl https://claude-proxy.your-subdomain.workers.dev

# Send a message (example)
curl -X POST https://claude-proxy.your-subdomain.workers.dev/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "Hello, Claude!"
      }
    ]
  }'
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
