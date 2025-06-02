import { serve } from "@hono/node-server";
import app from './index'
import * as process from 'node:process';

const port = parseInt(process.env.PORT || '3000', 10);

console.log(`Listening on http://localhost:${port}`);

serve({
  port: port,
  fetch: app.fetch
})
