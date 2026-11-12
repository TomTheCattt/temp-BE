/**
 * Chaos Experiment: Latency Injection
 * Tests timeout, retry, and circuit breaker behavior under high latency
 * Run with: k6 run tests/chaos/latency-injection.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { chaosConfig } from './chaos-config.js';

// Custom metrics
const timeoutRate = new Rate('timeout_rate');
const retryRate = new Rate('retry_rate');
const circuitBreakerOpen = new Rate('circuit_breaker_open');
const latencyOverhead = new Trend('latency_overhead_ms', true);

// Experiment configuration - API Latency
const EXPERIMENT_API = chaosConfig.scenarios.apiLatencyInjection;
const EXPERIMENT_DB = chaosConfig.scenarios.dbLatencyInjection;
const API_BASE = chaosConfig.apiBaseUrl;

// Run both experiments
const RUN_API = __ENV.CHAOS_TARGET === 'api' || !__ENV.CHAOS_TARGET;
const RUN_DB = __ENV.CHAOS_TARGET === 'db' || !__ENV.CHAOS_TARGET;

export const options = {
  scenarios: {
    // API Latency Experiment
    api_baseline: RUN_API ? {
      executor: 'constant-vus',
      vus: 30,
      duration: '30s',
      tags: { experiment: 'api', phase: 'baseline' },
    } : { executor: 'constant-vus', vus: 0, duration: '1s' },

    api_latency: RUN_API ? {
      executor: 'constant-vus',
      vus: 30,
      startTime: '30s',
      duration: '60s',
      tags: { experiment: 'api', phase: 'latency' },
    } : { executor: 'constant-vus', vus: 0, duration: '1s' },

    api_recovery: RUN_API ? {
      executor: 'constant-vus',
      vus: 30,
      startTime: '1m30s',
      duration: '30s',
      tags: { experiment: 'api', phase: 'recovery' },
    } : { executor: 'constant-vus', vus: 0, duration: '1s' },

    // DB Latency Experiment
    db_baseline: RUN_DB ? {
      executor: 'constant-vus',
      vus: 30,
      startTime: RUN_API ? '2m' : '0s',
      duration: '30s',
      tags: { experiment: 'db', phase: 'baseline' },
    } : { executor: 'constant-vus', vus: 0, duration: '1s' },

    db_latency: RUN_DB ? {
      executor: 'constant-vus',
      vus: 30,
      startTime: RUN_API ? '2m30s' : '30s',
      duration: '60s',
      tags: { experiment: 'db', phase: 'latency' },
    } : { executor: 'constant-vus', vus: 0, duration: '1s' },

    db_recovery: RUN_DB ? {
      executor: 'constant-vus',
      vus: 30,
      startTime: RUN_API ? '3m30s' : '1m30s',
      duration: '30s',
      tags: { experiment: 'db', phase: 'recovery' },
    } : { executor: 'constant-vus', vus: 0, duration: '1s' },
  },
  thresholds: {
    'http_req_failed{experiment:api,phase:baseline}': ['rate<0.001'],
    'http_req_failed{experiment:api,phase:latency}': ['rate<0.1'],
    'http_req_failed{experiment:api,phase:recovery}': ['rate<0.001'],
    'http_req_failed{experiment:db,phase:baseline}': ['rate<0.001'],
    'http_req_failed{experiment:db,phase:latency}': ['rate<0.1'],
    'http_req_failed{experiment:db,phase:recovery}': ['rate<0.001'],
  },
};

const ENDPOINTS = {
  health: '/health',
  feed: '/v1/posts/feed?limit=20',
  profile: '/v1/auth/me',
  search: '/v1/search?q=instagram&limit=10',
  // Write operations more sensitive to DB latency
  createPost: '/v1/posts',
  likePost: '/v1/posts/test-post/like',
};

export function setup() {
  console.log('Starting Latency Injection Chaos Experiment');
  console.log(`API Experiment: ${RUN_API ? 'ENABLED' : 'DISABLED'}`);
  console.log(`DB Experiment: ${RUN_DB ? 'ENABLED' : 'DISABLED'}`);

  const healthCheck = http.get(`${API_BASE}${ENDPOINTS.health}`);
  if (healthCheck.status !== 200) {
    throw new Error(`API not healthy: ${healthCheck.status}`);
  }

  return { startTime: Date.now() };
}

export default function (data) {
  const experiment = __ITER % 2 === 0 ? 'api' : 'db';
  const phase = ['baseline', 'latency', 'recovery'][Math.floor(__ITER / 20) % 3];

  // Skip if experiment not enabled
  if ((experiment === 'api' && !RUN_API) || (experiment === 'db' && !RUN_DB)) {
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${__ENV.TEST_TOKEN || 'test-token'}`,
  };

  // Select endpoints based on experiment type
  // DB latency affects write operations more
  const endpoints = experiment === 'db'
    ? [
        { name: 'feed', url: `${API_BASE}${ENDPOINTS.feed}`, method: 'GET' },
        { name: 'profile', url: `${API_BASE}${ENDPOINTS.profile}`, method: 'GET' },
        { name: 'createPost', url: `${API_BASE}${ENDPOINTS.createPost}`, method: 'POST', body: JSON.stringify({ caption: 'latency test', mediaIds: [] }) },
        { name: 'likePost', url: `${API_BASE}${ENDPOINTS.likePost}`, method: 'POST' },
      ]
    : [
        { name: 'health', url: `${API_BASE}${ENDPOINTS.health}`, method: 'GET' },
        { name: 'feed', url: `${API_BASE}${ENDPOINTS.feed}`, method: 'GET' },
        { name: 'search', url: `${API_BASE}${ENDPOINTS.search}`, method: 'GET' },
        { name: 'profile', url: `${API_BASE}${ENDPOINTS.profile}`, method: 'GET' },
      ];

  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

  group(`${experiment}:${phase}: ${endpoint.name}`, () => {
    const start = new Date();

    const params = {
      headers,
      tags: { experiment, phase, endpoint: endpoint.name },
      timeout: '10s', // Client timeout
    };

    if (endpoint.body) {
      params.body = endpoint.body;
    }

    const response = http.request(endpoint.method, endpoint.url, null, params);
    const latency = new Date() - start;

    // Check for timeout
    const isTimeout = response.timedOut || response.status === 0;
    const isCircuitBreaker = response.status === 503 && response.body?.includes('circuit');

    timeoutRate.add(isTimeout, { experiment, phase });
    circuitBreakerOpen.add(isCircuitBreaker, { experiment, phase });

    // Check for retry headers
    const hasRetryHeader = response.headers['X-Retry-Count'] !== undefined;
    retryRate.add(hasRetryHeader, { experiment, phase });

    // Calculate overhead (latency - expected baseline)
    const baselineLatency = experiment === 'api' ? 100 : 50; // Expected baseline
    const overhead = Math.max(0, latency - baselineLatency);
    latencyOverhead.add(overhead, { experiment, phase });

    const success = check(response, {
      [`${endpoint.name} handled`]: (r) => {
        // Accept success, timeout, circuit breaker, gateway timeout
        return [200, 201, 408, 503, 504, 0].includes(r.status);
      },
      [`${endpoint.name} no 500`]: (r) => r.status !== 500,
      [`${endpoint.name} timeout < 10s`]: () => latency < 10000,
    });

    if (!success) {
      console.warn(`${experiment}:${phase}: ${endpoint.name} failed: status=${response.status}, latency=${latency}ms, timeout=${isTimeout}`);
    }
  });

  sleep(0.5);
}

export function teardown(data) {
  console.log('Latency Injection Chaos Experiment completed');
  console.log('Verify: timeouts handled, circuit breakers activate, retries with backoff, quick recovery');
}