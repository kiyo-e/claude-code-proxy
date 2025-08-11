import { serve } from "@hono/node-server";
import app from './index'
import * as process from 'node:process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Try multiple possible paths for package.json
    const possiblePaths = [
      join(__dirname, '..', 'package.json'),  // Development
      join(__dirname, 'package.json'),        // npm install
      join(__dirname, '..', '..', 'package.json')  // Other scenarios
    ];

    for (const packagePath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
        return packageJson.version;
      } catch {
        continue;
      }
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}


function showHelp() {
  console.log(`Claude Code Proxy v${getPackageVersion()}

Usage: claude-code-proxy [options]

Options:
  -v, --version    Show version number
  -h, --help       Show this help message
  -p, --port PORT  Set server port (default: 3000)

Environment Variables:
  PORT                      Server port (default: 3000)
  CLAUDE_CODE_PROXY_API_KEY Bearer token for upstream API authentication
  ANTHROPIC_PROXY_BASE_URL  Upstream API URL (default: https://models.github.ai/inference)
  REASONING_MODEL           Model for reasoning requests (default: openai/gpt-4.1)
  COMPLETION_MODEL          Model for completion requests (default: openai/gpt-4.1)
  REASONING_MAX_TOKENS      Max tokens override for reasoning model
  COMPLETION_MAX_TOKENS     Max tokens override for completion model
  REASONING_EFFORT          Reasoning effort (low|medium|high)
  DEBUG                     Enable debug logging (default: false)

Examples:
  claude-code-proxy
  claude-code-proxy --port 8080
  PORT=8787 claude-code-proxy`);
}

if (args.includes('-v') || args.includes('--version')) {
  console.log(getPackageVersion());
  process.exit(0);
}

if (args.includes('-h') || args.includes('--help')) {
  showHelp();
  process.exit(0);
}

let port = parseInt(process.env.PORT || '3000', 10);

const portIndex = args.findIndex(arg => arg === '-p' || arg === '--port');
if (portIndex !== -1 && args[portIndex + 1]) {
  port = parseInt(args[portIndex + 1], 10);
  if (isNaN(port)) {
    console.error('Error: Invalid port number');
    process.exit(1);
  }
}

console.log(`Listening on http://localhost:${port}`);

serve({
  port: port,
  fetch: app.fetch
})
