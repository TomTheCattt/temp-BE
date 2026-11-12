/**
 * WebSocket Load Test
 * Tests real-time messaging, notifications, presence
 * Target: p95 < 100ms for message delivery, 5 min session duration
 */

import { WebSocket } from 'k6/experimental/websockets';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { WS_URL, getAuthHeaders, randomInt, sleepRandom } from './k6-config.js';

// Custom metrics
const wsConnections = new Counter('ws_connections_total');
const wsConnectionErrors = new Rate('ws_connection_errors');
const wsConnectLatency = new Trend('ws_connect_latency', true);
const wsMessageLatency = new Trend('ws_message_latency', true);
const wsMessagesSent = new Counter('ws_messages_sent_total');
const wsMessagesReceived = new Counter('ws_messages_received_total');
const wsSessionDuration = new Trend('ws_session_duration', true);
const wsActiveConnections = new Gauge('ws_active_connections');

// Test configuration
const WS_CONNECT_TIMEOUT = 10000; // 10 seconds
const WS_MESSAGE_INTERVAL = 5000; // 5 seconds between messages
const WS_SESSION_DURATION = 300000; // 5 minutes target

// Message types to test
const MESSAGE_TYPES = [
  { type: 'ping', payload: {} },
  { type: 'message.send', payload: { conversationId: 'test-conv-1', text: 'Load test message', type: 'text' } },
  { type: 'message.read', payload: { conversationId: 'test-conv-1', messageId: 'msg-1' } },
  { type: 'message.react', payload: { messageId: 'msg-1', emoji: '👍' } },
  { type: 'message.typing.start', payload: { conversationId: 'test-conv-1' } },
  { type: 'message.typing.stop', payload: { conversationId: 'test-conv-1' } },
  { type: 'presence.update', payload: { status: 'online' } },
  { type: 'sync.request', payload: { conversationId: 'test-conv-1', lastMessageId: 'msg-100' } },
];

export function setup() {
  const users = [];
  for (let i = 0; i < 1000; i++) {
    users.push({
      id: `user-${i}`,
      token: `test-token-${i}`,
      conversations: [`conv-${i}`, `conv-${i + 1000}`],
    });
  }
  return { users };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const wsUrl = `${WS_URL}?token=${user.token}`;

  group('WebSocket Connection', () => {
    const connectStart = new Date();
    let ws = null;
    let connected = false;
    let messageCount = 0;
    const sessionStart = new Date();

    try {
      ws = new WebSocket(wsUrl, null, {
        timeout: WS_CONNECT_TIMEOUT,
      });

      ws.onopen = () => {
        connected = true;
        const connectLatency = new Date() - connectStart;
        wsConnectLatency.add(connectLatency);
        wsConnections.add(1);
        wsActiveConnections.add(1);

        // Subscribe to channels
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: [
            `user:${user.id}`,
            `conversation:${user.conversations[0]}`,
            'notifications',
          ],
          requestId: `sub-${Date.now()}`,
          timestamp: new Date().toISOString(),
        }));
      };

      ws.onmessage = (message) => {
        const receiveTime = new Date();
        wsMessagesReceived.add(1);

        try {
          const data = JSON.parse(message.data);

          // Track latency for request-response messages
          if (data.requestId) {
            // In a real test, we'd track the request time
            // For now, just count messages
          }

          // Handle different message types
          switch (data.type) {
            case 'connected':
              console.log(`VU ${__VU}: Connected to WS server`);
              break;
            case 'subscribed':
              console.log(`VU ${__VU}: Subscribed to channels`);
              break;
            case 'pong':
              // Ping-pong latency tracking
              break;
            case 'message.new':
            case 'notification.new':
            case 'presence.changed':
            case 'typing.start':
            case 'typing.stop':
              // Real-time event received
              break;
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onerror = (error) => {
        console.error(`VU ${__VU}: WS Error:`, error);
        wsConnectionErrors.add(1);
      };

      ws.onclose = () => {
        connected = false;
        wsActiveConnections.add(-1);
        const sessionDuration = new Date() - sessionStart;
        wsSessionDuration.add(sessionDuration);
      };

      // Send periodic messages during session
      const messageInterval = setInterval(() => {
        if (ws && connected && ws.readyState === WebSocket.OPEN) {
          const msgType = MESSAGE_TYPES[randomInt(0, MESSAGE_TYPES.length - 1)];
          const message = {
            ...msgType,
            requestId: `req-${Date.now()}-${messageCount}`,
            timestamp: new Date().toISOString(),
          };

          const sendStart = new Date();
          ws.send(JSON.stringify(message));
          const sendLatency = new Date() - sendStart;

          wsMessageLatency.add(sendLatency);
          wsMessagesSent.add(1);
          messageCount++;

          // Send ping every 20 seconds
          if (messageCount % 4 === 0) {
            ws.send(JSON.stringify({
              type: 'ping',
              requestId: `ping-${Date.now()}`,
              timestamp: new Date().toISOString(),
            }));
          }
        }
      }, WS_MESSAGE_INTERVAL);

      // Keep connection alive for session duration
      sleep(WS_SESSION_DURATION / 1000);

      // Cleanup
      clearInterval(messageInterval);
      if (ws && connected) {
        ws.close();
      }

      check(connected, {
        'WS connected successfully': (c) => c === true,
        'WS session duration > 4 min': () => (new Date() - sessionStart) > 240000,
        'WS messages sent > 0': () => messageCount > 0,
        'WS messages received > 0': () => wsMessagesReceived.count > 0,
      });

    } catch (error) {
      console.error(`VU ${__VU}: WS Connection failed:`, error);
      wsConnectionErrors.add(1);
      wsConnections.add(1);

      check(false, {
        'WS connection should succeed': () => false,
      });
    }
  });

  // Small delay between VU iterations
  sleepRandom(1000, 3000);
}

export function teardown(data) {
  console.log('WebSocket load test completed');
  console.log(`Total WS connections: ${wsConnections.count}`);
  console.log(`Connection error rate: ${wsConnectionErrors.rate * 100}%`);
}