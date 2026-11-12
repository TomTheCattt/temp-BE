/**
 * Chaos Experiment: Neon Branch Failover
 * Tests automatic failover from primary to read replica
 * Run with: k6 run tests/chaos/neon-branch-failover.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { chaosConfig } from './chaos-config.js';

// Custom metrics
const failoverDuration = new Trend('failover_duration_seconds', true);
const failoverErrors = new Rate('failover_errors');
const apiAvailability = new Gauge('api_availability');
const requestLatency = new Trend('request_latency_ms', true);
const errorRate = new Rate('error_rate');

// Experiment configuration
const EXPERIMENT = chaosConfig.scenarios.neonBranchFailover;
const API_BASE = chaosConfig.apiBaseUrl;
const DURATION = EXPERIMENT.duration;

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 50,
      duration: `${EXPERIMENT.steps[0].duration}s`,
      tags: { phase: 'baseline' },
    },
    failover: {
      executor: 'constant-vus',
      vus: 50,
      startTime: `${EXPERIMENT.steps[0].duration}s`,
      duration: `${EXPERIMENT.steps[1].duration}s`,
      tags: { phase: 'failover' },
    },
    impact: {
      executor: 'constant-vus',
      vus: 50,
      startTime: `${EXPERIMENT.steps[0].duration + EXPERIMENT.steps[1].duration}s`,
      duration: `${EXPERIMENT.steps[2].duration}s`,
      tags: { phase: 'impact' },
    },
    restore: {
      executor: 'constant-vus',
      vus: 50,
      startTime: `${EXPERIMENT.steps[0].duration + EXPERIMENT.steps[1].duration + EXPERIMENT.steps[2].duration}s`,
      duration: `${EXPERIMENT.steps[3].duration}s`,
      tags: { phase: 'restore' },
    },
    recovery: {
      executor: 'constant-vus',
      vus: 50,
      startTime: `${EXPERIMENT.steps[0].duration + EXPERIMENT.steps[1].duration + EXPERIMENT.steps[2].duration + EXPERIMENT.steps[3].duration}s`,
      duration: `${EXPERIMENT.steps[4].duration}s`,
      tags: { phase: 'recovery' },
    },
  },
  thresholds: {
    'http_req_failed{phase:baseline}': ['rate<0.001'],
    'http_req_failed{phase:failover}': ['rate<0.05'],  // Allow higher during failover
    'http_req_failed{phase:impact}': ['rate<0.01'],
    'http_req_failed{phase:restore}': ['rate<0.05'],
    'http_req_failed{phase:recovery}': ['rate<0.001'],
    'http_req_duration{phase:baseline}': ['p(95)<200'],
    'http_req_duration{phase:recovery}': ['p(95)<200'],
  },
};

const ENDPOINTS = {
  health: '/health',
  feed: '/v1/posts/feed?limit=10',
  profile: '/v1/auth/me',
};

export function setup() {
  console.log(`Starting chaos experiment: ${EXPERIMENT.name}`);
  console.log(`Description: ${EXPERIMENT.description}`);
  console.log(`Target API: ${API_BASE}`);
  console.log(`Duration: ${DURATION}s`);

  // Verify API is healthy before starting
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

  // Test multiple endpoints
  const endpoints = [
    { name: 'health', url: `${API_BASE}${ENDPOINTS.health}`, critical: true },
    { name: 'feed', url: `${API_BASE}${ENDPOINTS.feed}`, critical: true },
    { name: 'profile', url: `${API_BASE}${ENDPOINTS.profile}`, critical: false },
  ];

  endpoints.forEach(endpoint => {
    group(`${phase}: ${endpoint.name}`, () => {
      const start = new Date();
      const response = http.get(endpoint.url, {
        headers,
        tags: { phase, endpoint: endpoint.name },
        timeout: '10s',
      });
      const latency = new Date() - start;

      requestLatency.add(latency, { phase, endpoint: endpoint.name });

      const success = check(response, {
        [`${endpoint.name} status OK`]: (r) => r.status === 200 || (!endpoint.critical && r.status === 401),
        [`${endpoint.name} latency reasonable`]: () => latency < 5000,
      });

      errorRate.add(!success, { phase, endpoint: endpoint.name });
      apiAvailability.add(success ? 1 : 0, { phase, endpoint: endpoint.name });

      if (!success && endpoint.critical) {
        console.error(`${phase}: Critical endpoint ${endpoint.name} failed: ${response.status}`);
      }
    });
  });

  sleep(1);
}

export function teardown(data) {
  console.log(`Chaos experiment completed: ${EXPERIMENT.name}`);
  console.log('Check metrics for failover duration and error rates');
}