import { serve } from '@hono/node-server';
import app from './index';
import { env } from './config/env';

const port = env.PORT;

console.log(`Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});