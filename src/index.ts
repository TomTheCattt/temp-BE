import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { setupWebSocket } from './websocket/server';
import { registerJobs } from './jobs';

const app = createApp();
const server = http.createServer(app);
setupWebSocket(server);

async function start() {
  try {
    await prisma.$connect();
    registerJobs();
    console.log('[DB] Connected to PostgreSQL');

    server.listen(env.PORT, () => {
      console.log(`[Server] Running on http://localhost:${env.PORT}`);
      console.log(`[Server] Health check: http://localhost:${env.PORT}/health`);
      console.log(`[Server] API base: http://localhost:${env.PORT}/v1`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  server.close();
});

start();

export { server };
