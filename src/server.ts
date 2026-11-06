import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import app from "./index";
import { setupWebSocket } from "./websocket/local-server";

const port = Number(process.env.PORT) || 3000;

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Setup WebSocket handlers
setupWebSocket(wss);

// Start HTTP server with WebSocket support
serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
  websocket: {
    server: wss,
  },
}, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  wss.close(() => {
    console.log('WebSocket server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  wss.close(() => {
    console.log('WebSocket server closed');
    process.exit(0);
  });
});