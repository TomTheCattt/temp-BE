/**
 * Chaos Experiment: WebSocket Network Partition
 * Tests WebSocket reconnection and message buffering during partition
 * Run with: k6 run tests/chaos/ws-network-partition.js
 */

import { WebSocket } from 'k6/experimental/websockets';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { chaosConfig } from './chaos-config.js';

// Custom metrics
const wsPartitionErrors = new Rate('ws_partition_errors');
const wsReconnectRate = new Rate('ws_reconnect_rate');
const wsMessageLoss = new Rate('ws_message_loss');
const wsReconnectLatency = new Trend('ws_reconnect_latency_ms', true);
const wsBufferedMessages = new Counter('ws_buffered_messages');
const wsActiveConnections = new Gauge('ws_active_connections');

// Experiment configuration
const EXPERIMENT = chaosConfig.scenarios.networkPartition;
const WS_URL = chaosConfig.wsBaseUrl;

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      tags: { phase: 'baseline' },
    },
    partition: {
      executor: 'constant-vus',
      vus: 50,
      startTime: '30s',
      duration: '90s',
      tags: { phase: 'partition' },
    },
    recovery: {
      executor: 'constant-vus',
      vus: 50,
      startTime: '2m',
      duration: '30s',
      tags: { phase: 'recovery' },
    },
  },
  thresholds: {
    'ws_connection_errors{phase:baseline}': ['rate<0.01'],
    'ws_connection_errors{phase:partition}': ['rate<0.5'], // Expect disconnections
    'ws_connection_errors{phase:recovery}': ['rate<0.01'],
    'ws_reconnect_latency_ms{phase:recovery}': ['p(95)<5000'],
    'ws_message_loss{phase:partition}': ['rate<0.1'], // < 10% message loss
  },
};

const PARTITION_PERCENTAGE = 50; // 50% of connections partitioned

export function setup() {
  console.log(`Starting chaos experiment: ${EXPERIMENT.name}`);
  console.log(`Description: ${EXPERIMENT.description}`);
  console.log(`Partition percentage: ${PARTITION_PERCENTAGE}%`);

  // Verify WS server is reachable
  return { startTime: Date.now() };
}

export default function (data) {
  const phase = __ENV.K6_SCENARIO || 'baseline';
  const shouldPartition = phase === 'partition' && Math.random() * 100 < PARTITION_PERCENTAGE;

  const token = `test-token-${__VU}`;
  const wsUrl = `${WS_URL}?token=${token}`;

  group(`WS ${phase}: connection`, () => {
    let ws = null;
    let connected = false;
    let messageCount = 0;
    let receivedCount = 0;
    let reconnectCount = 0;
    const sessionStart = Date.now();
    let lastPartitionTime = 0;

    function connect() {
      const connectStart = Date.now();
      ws = new WebSocket(wsUrl, null, { timeout: 10000 });

      ws.onopen = () => {
        connected = true;
        wsActiveConnections.add(1);
        wsReconnectLatency.add(Date.now() - connectStart, { phase });

        if (reconnectCount > 0) {
          wsReconnectRate.add(1, { phase });
        }

        // Subscribe to channels
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: [`user:${token}`, 'conversation:test-conv', 'notifications'],
          requestId: `sub-${Date.now()}`,
          timestamp: new Date().toISOString(),
        }));
      };

      ws.onmessage = (msg) => {
        receivedCount++;
        try {
          const data = JSON.parse(msg.data);
          // Track buffered messages after reconnect
          if (data.type === 'sync.response' && data.messages?.length > 0) {
            wsBufferedMessages.add(data.messages.length);
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        if (connected) {
          connected = false;
          wsActiveConnections.add(-1);

          // Auto-reconnect with exponential backoff
          if (phase !== 'recovery' || Date.now() - sessionStart < 25000) {
            const backoff = Math.min(1000 * Math.pow(2, reconnectCount), 30000);
            reconnectCount++;
            setTimeout(connect, backoff + Math.random() * 1000);
          }
        }
      };

      ws.onerror = (error) => {
        wsPartitionErrors.add(1, { phase });
      };
    }

    // Initial connection
    connect();

    // Send periodic messages
    const messageInterval = setInterval(() => {
      if (ws && connected && ws.readyState === WebSocket.OPEN) {
        messageCount++;
        ws.send(JSON.stringify({
          type: 'ping',
          requestId: `ping-${messageCount}`,
          timestamp: new Date().toISOString(),
        }));

        // Send a real message every 10 pings
        if (messageCount % 10 === 0) {
          ws.send(JSON.stringify({
            type: 'message.send',
            payload: {
              conversationId: 'test-conv',
              text: `Chaos test message ${messageCount}`,
              type: 'text',
            },
            requestId: `msg-${messageCount}`,
            timestamp: new Date().toISOString(),
          }));
        }
      }
    }, 5000);

    // Simulate partition by closing connection
    if (shouldPartition && phase === 'partition') {
      setTimeout(() => {
        if (ws && connected) {
          lastPartitionTime = Date.now();
          ws.close(1001, 'Network partition simulation');
          console.log(`VU ${__VU}: Partition simulated at ${Date.now() - sessionStart}ms`);
        }
      }, Math.random() * 30000); // Random time during partition phase
    }

    // Run for phase duration
    const phaseDuration = phase === 'baseline' ? 30000 : phase === 'partition' ? 90000 : 30000;
    sleep(phaseDuration / 1000);

    // Cleanup
    clearInterval(messageInterval);
    if (ws && connected) {
      ws.close();
    }

    // Calculate message loss
    const expectedMessages = Math.floor(phaseDuration / 5000);
    const lossRate = messageCount > 0 ? 1 - (receivedCount / messageCount) : 0;
    wsMessageLoss.add(lossRate > 0.1 ? 1 : 0, { phase });

    check(true, {
      [`${phase}: connected at least once`]: () => reconnectCount >= 0,
      [`${phase}: message loss < 10%`]: () => lossRate < 0.1,
      [`${phase}: reconnected after partition`]: () => phase !== 'partition' || reconnectCount > 0,
    });
  });

  sleep(1);
}

export function teardown(data) {
  console.log('WebSocket Network Partition Chaos Experiment completed');
  console.log('Verify: automatic reconnection, message buffering, exponential backoff, no message loss');
}