/**
 * Chaos Experiment: Resource Exhaustion (CPU & Memory)
 * Tests auto-scaling, OOM handling, and graceful degradation
 * Run with: k6 run tests/chaos/resource-exhaustion.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { chaosConfig } from './chaos-config.js';

// Custom metrics
const cpuExhaustionErrors = new Rate('cpu_exhaustion_errors');
const memoryExhaustionErrors = new Rate('memory_exhaustion_errors');
const scalingEvents = new Counter('scaling_events');
const healthCheckFailures = new Rate('health_check_failures');
const requestQueueDepth = new Gauge('request_queue_depth');
const oomKills = new Counter('oom_kills');

// Experiment configuration
const CPU_EXPERIMENT = chaosConfig.scenarios.cpuExhaustion;
const MEM_EXPERIMENT = chaosConfig.scenarios.memoryExhaustion;
const API_BASE = chaosConfig.apiBaseUrl;

const TARGET_RESOURCE = __ENV.CHAOS_RESOURCE || 'cpu'; // 'cpu' or 'memory'

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 20,
      duration: '30s',
      tags: { phase: 'baseline', resource: TARGET_RESOURCE },
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 20,
      stages: [
        { duration: '30s', target: 100 },  // Ramp up
        { duration: '90s', target: 200 },  // Stress
      ],
      startTime: '30s',
      tags: { phase: 'stress', resource: TARGET_RESOURCE },
    },
    recovery: {
      executor: 'constant-vus',
      vus: 20,
      startTime: '2m30s',
      duration: '30s',
      tags: { phase: 'recovery', resource: TARGET_RESOURCE },
    },
  },
  thresholds: {
    'http_req_failed{phase:baseline}': ['rate<0.001'],
    'http_req_failed{phase:stress}': ['rate<0.2'],
    'http_req_failed{phase:recovery}': ['rate<0.001'],
    'http_req_duration{phase:baseline}': ['p(95)<200'],
    'http_req_duration{phase:recovery}': ['p(95)<500'], // May be slower during recovery
  },
};

const ENDPOINTS = {
  health: '/health',
  ready: '/ready',  // Kubernetes readiness probe
  feed: '/v1/posts/feed?limit=20',
  search: '/v1/search?q=test&limit=10',
};

export function setup() {
  const experiment = TARGET_RESOURCE === 'cpu' ? CPU_EXPERIMENT : MEM_EXPERIMENT;
  console.log(`Starting chaos experiment: ${experiment.name}`);
  console.log(`Target resource: ${TARGET_RESOURCE}`);
  console.log(`Description: ${experiment.description}`);

  const healthCheck = http.get(`${API_BASE}${ENDPOINTS.health}`);
  if (healthCheck.status !== 200) {
    throw new Error(`API not healthy: ${healthCheck.status}`);
  }

  return { startTime: Date.now() };
}

export default function (data) {
  const phase = __ENV.K6_SCENARIO || 'baseline';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${__ENV.TEST_TOKEN || 'test-token'}`,
  };

  // Test health/readiness endpoints more frequently during stress
  const endpoints = phase === 'stress'
    ? [
        { name: 'health', url: `${API_BASE}${ENDPOINTS.health}`, method: 'GET', weight: 10 },
        { name: 'ready', url: `${API_BASE}${ENDPOINTS.ready}`, method: 'GET', weight: 10 },
        { name: 'feed', url: `${API_BASE}${ENDPOINTS.feed}`, method: 'GET', weight: 5 },
        { name: 'search', url: `${API_BASE}${ENDPOINTS.search}`, method: 'GET', weight: 3 },
      ]
    : [
        { name: 'health', url: `${API_BASE}${ENDPOINTS.health}`, method: 'GET', weight: 2 },
        { name: 'feed', url: `${API_BASE}${ENDPOINTS.feed}`, method: 'GET', weight: 5 },
        { name: 'search', url: `${API_BASE}${ENDPOINTS.search}`, method: 'GET', weight: 3 },
      ];

  // Weighted random selection
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let random = Math.random() * totalWeight;
  let selectedEndpoint = endpoints[0];

  for (const ep of endpoints) {
    random -= ep.weight;
    if (random <= 0) {
      selectedEndpoint = ep;
      break;
    }
  }

  group(`${TARGET_RESOURCE}:${phase}: ${selectedEndpoint.name}`, () => {
    const start = Date.now();

    const response = http.request(selectedEndpoint.method, selectedEndpoint.url, null, {
      headers,
      tags: { phase, resource: TARGET_RESOURCE, endpoint: selectedEndpoint.name },
      timeout: phase === 'stress' ? '30s' : '10s',
    });

    const latency = Date.now() - start;

    // Check for resource exhaustion indicators
    const isHealthCheck = selectedEndpoint.name === 'health' || selectedEndpoint.name === 'ready';
    const isOOM = response.status === 0 && response.error?.includes('ECONNRESET');
    const isScaling = response.headers['X-Scaling'] === 'true';
    const isQueueFull = response.status === 503 && response.headers['X-Queue-Full'] === 'true';

    if (isOOM) {
      oomKills.add(1);
    }

    if (isScaling) {
      scalingEvents.add(1);
    }

    if (isHealthCheck) {
      healthCheckFailures.add(response.status !== 200);

      // Track queue depth from header
      const queueDepth = parseInt(response.headers['X-Queue-Depth'], 10);
      if (!isNaN(queueDepth)) {
        requestQueueDepth.add(queueDepth);
      }
    }

    // Track errors by resource type
    if (TARGET_RESOURCE === 'cpu') {
      cpuExhaustionErrors.add(response.status >= 500, { phase });
    } else {
      memoryExhaustionErrors.add(response.status >= 500, { phase });
    }

    const success = check(response, {
      [`${selectedEndpoint.name} handled`]: (r) => {
        // During stress, accept 503 with queue-full, 504 gateway timeout
        return [200, 201, 429, 503, 504].includes(r.status);
      },
      [`${selectedEndpoint.name} no 500`]: (r) => r.status !== 500,
      [`${selectedEndpoint.name} health check responds`]: () => !isHealthCheck || response.status !== 0,
    });

    if (!success) {
      console.warn(`${TARGET_RESOURCE}:${phase}: ${selectedEndpoint.name} failed: status=${response.status}, latency=${latency}ms`);
    }

    // Log specific events
    if (isScaling) {
      console.info(`${TARGET_RESOURCE}:${phase}: Auto-scaling triggered`);
    }
    if (isQueueFull) {
      console.info(`${TARGET_RESOURCE}:${phase}: Request queue full, shedding load`);
    }
    if (isOOM) {
      console.error(`${TARGET_RESOURCE}:${phase}: Possible OOM kill detected`);
    }
  });

  // Higher frequency during stress to trigger resource exhaustion
  sleep(phase === 'stress' ? 0.05 : 0.5);
}

export function teardown(data) {
  const experiment = TARGET_RESOURCE === 'cpu' ? CPU_EXPERIMENT : MEM_EXPERIMENT;
  console.log(`${experiment.name} Chaos Experiment completed`);
  console.log('Verify: auto-scaling triggered, health checks fail fast, OOM handled gracefully, quick recovery');
}