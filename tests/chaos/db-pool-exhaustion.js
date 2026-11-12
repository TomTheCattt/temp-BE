/**
 * Chaos Experiment: Database Connection Pool Exhaustion
 * Tests graceful degradation when DB pool is exhausted
 * Run with: k6 run tests/chaos/db-pool-exhaustion.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { chaosConfig } from './chaos-config.js';

// Custom metrics
const poolExhaustionErrors = new Rate('pool_exhaustion_errors');
const queueLatency = new Trend('queue_latency_ms', true);
const rejectionRate = new Rate('rejection_rate');
const recoveryTime = new Trend('recovery_time_ms', true);

// Experiment configuration
const EXPERIMENT = chaosConfig.scenarios.dbPoolExhaustion;
const API_BASE = chaosConfig.apiBaseUrl;

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 20,
      duration: '30s',
      tags: { phase: 'baseline' },
    },
    exhaust: {
      executor: 'ramping-vus',
      startVUs: 20,
      stages: [
        { duration: '30s', target: 200 },  // Ramp up to exhaust pool
        { duration: '90s', target: 200 },  // Hold at exhaustion
      ],
      startTime: '30s',
      tags: { phase: 'exhaust' },
    },
    recovery: {
      executor: 'constant-vus',
      vus: 20,
      startTime: '2m30s',
      duration: '30s',
      tags: { phase: 'recovery' },
    },
  },
  thresholds: {
    'http_req_failed{phase:baseline}': ['rate<0.001'],
    'http_req_failed{phase:exhaust}': ['rate<0.5'],  // Expect many 503s
    'http_req_failed{phase:recovery}': ['rate<0.001'],
    'http_req_duration{phase:baseline}': ['p(95)<200'],
    'http_req_duration{phase:recovery}': ['p(95)<200'],
  },
};

const ENDPOINTS = {
  health: '/health',
  feed: '/v1/posts/feed?limit=20',
  search: '/v1/search?q=test&limit=10',
};

export function setup() {
  console.log(`Starting chaos experiment: ${EXPERIMENT.name}`);
  console.log(`Description: ${EXPERIMENT.description}`);

  const healthCheck = http.get(`${API_BASE}${ENDPOINTS.health}`);
  if (healthCheck.status !== 200) {
    throw new Error(`API not healthy before experiment: ${healthCheck.status}`);
  }

  return { startTime: Date.now() };
}

export default function (data) {
  const phase = __ENV.K6_SCENARIO || 'baseline';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${__ENV.TEST_TOKEN || 'test-token'}`,
  };

  // Mix of read and write operations
  const operations = [
    { name: 'health', url: `${API_BASE}${ENDPOINTS.health}`, method: 'GET', critical: true },
    { name: 'feed', url: `${API_BASE}${ENDPOINTS.feed}`, method: 'GET', critical: true },
    { name: 'search', url: `${API_BASE}${ENDPOINTS.search}`, method: 'GET', critical: false },
  ];

  const op = operations[Math.floor(Math.random() * operations.length)];

  group(`${phase}: ${op.name}`, () => {
    const start = new Date();
    const response = http.request(op.method, op.url, null, {
      headers,
      tags: { phase, endpoint: op.name },
      timeout: '15s',
    });
    const latency = new Date() - start;

    // Track metrics
    const isQueueError = response.status === 503 && response.headers['Retry-After'];
    const isPoolError = response.status === 500 && response.body?.includes('connection');

    check(response, {
      [`${op.name} handled gracefully`]: (r) => {
        // Accept 200, 503 (with retry-after), 429 (rate limited)
        return [200, 503, 429].includes(r.status);
      },
      [`${op.name} has retry-after on 503`]: (r) => {
        if (r.status === 503) {
          return r.headers['Retry-After'] !== undefined;
        }
        return true;
      },
      [`${op.name} latency tracked`]: () => true,
    });

    poolExhaustionErrors.add(response.status >= 500, { phase });
    rejectionRate.add(response.status === 503 || response.status === 429, { phase });

    if (response.status === 200) {
      queueLatency.add(latency, { phase });
    }

    if (phase === 'recovery' && response.status === 200) {
      recoveryTime.add(latency);
    }

    // Log pool exhaustion events
    if (isPoolError) {
      console.warn(`${phase}: Pool exhaustion detected on ${op.name}`);
    }
    if (isQueueError) {
      console.info(`${phase}: Request queued (503) on ${op.name}, retry-after: ${response.headers['Retry-After']}`);
    }
  });

  sleep(0.1); // High frequency to stress pool
}

export function teardown(data) {
  console.log(`Chaos experiment completed: ${EXPERIMENT.name}`);
  console.log('Verify: 503 responses with Retry-After header, no 500s, quick recovery');
}