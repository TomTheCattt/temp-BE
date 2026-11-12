/**
 * Chaos Experiment: Dependency Failure
 * Tests graceful degradation when external dependencies fail
 * Run with: k6 run tests/chaos/dependency-failure.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { chaosConfig } from './chaos-config.js';

// Custom metrics
const dependencyErrors = new Rate('dependency_errors');
const fallbackActivations = new Counter('fallback_activations');
const degradedResponses = new Rate('degraded_responses');
const recoveryLatency = new Trend('recovery_latency_ms', true);

// Experiment configuration
const EXPERIMENTS = {
  s3: chaosConfig.scenarios.s3Failure,
  auth: chaosConfig.scenarios.authFailure,
  redis: chaosConfig.scenarios.redisFailure,
};

const API_BASE = chaosConfig.apiBaseUrl;

// Run specific dependency test
const TARGET_DEP = __ENV.CHAOS_DEPENDENCY || 's3';
const EXPERIMENT = EXPERIMENTS[TARGET_DEP];

if (!EXPERIMENT) {
  throw new Error(`Unknown dependency: ${TARGET_DEP}. Options: s3, auth, redis`);
}

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 30,
      duration: '30s',
      tags: { phase: 'baseline', dependency: TARGET_DEP },
    },
    failure: {
      executor: 'constant-vus',
      vus: 30,
      startTime: '30s',
      duration: '60s',
      tags: { phase: 'failure', dependency: TARGET_DEP },
    },
    recovery: {
      executor: 'constant-vus',
      vus: 30,
      startTime: '1m30s',
      duration: '30s',
      tags: { phase: 'recovery', dependency: TARGET_DEP },
    },
  },
  thresholds: {
    'http_req_failed{phase:baseline}': ['rate<0.001'],
    'http_req_failed{phase:failure}': ['rate<0.3'],
    'http_req_failed{phase:recovery}': ['rate<0.001'],
  },
};

const ENDPOINTS = {
  health: '/health',
  feed: '/v1/posts/feed?limit=10',
  profile: '/v1/auth/me',
  uploadPresigned: '/v1/upload/presigned',
  uploadMultipart: '/v1/upload/multipart',
  uploadTus: '/v1/upload/tus/',
};

export function setup() {
  console.log(`Starting chaos experiment: ${EXPERIMENT.name}`);
  console.log(`Target dependency: ${TARGET_DEP}`);
  console.log(`Description: ${EXPERIMENT.description}`);

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

  // Select endpoints based on dependency being tested
  let endpoints = [
    { name: 'health', url: `${API_BASE}${ENDPOINTS.health}`, method: 'GET', critical: true },
    { name: 'feed', url: `${API_BASE}${ENDPOINTS.feed}`, method: 'GET', critical: true },
    { name: 'profile', url: `${API_BASE}${ENDPOINTS.profile}`, method: 'GET', critical: false },
  ];

  if (TARGET_DEP === 's3') {
    endpoints = endpoints.concat([
      { name: 'presigned', url: `${API_BASE}${ENDPOINTS.uploadPresigned}`, method: 'POST',
        body: JSON.stringify({ fileName: 'test.jpg', mimeType: 'image/jpeg', fileSize: 1024, type: 'image' }),
        critical: true },
    ]);
  } else if (TARGET_DEP === 'auth') {
    endpoints = endpoints.concat([
      { name: 'refresh', url: `${API_BASE}/v1/auth/refresh`, method: 'POST',
        body: JSON.stringify({ refreshToken: 'test-refresh', deviceId: 'test-device' }),
        critical: true },
    ]);
  } else if (TARGET_DEP === 'redis') {
    // Rate limiting endpoints
    endpoints = endpoints.concat([
      { name: 'search', url: `${API_BASE}/v1/search?q=test&limit=10`, method: 'GET', critical: false },
      { name: 'feed_heavy', url: `${API_BASE}${ENDPOINTS.feed}`, method: 'GET', critical: true },
    ]);
  }

  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

  group(`${TARGET_DEP}:${phase}: ${endpoint.name}`, () => {
    const start = Date.now();

    const params = {
      headers,
      tags: { phase, dependency: TARGET_DEP, endpoint: endpoint.name },
      timeout: '15s',
    };

    if (endpoint.body) {
      params.body = endpoint.body;
    }

    const response = http.request(endpoint.method, endpoint.url, null, params);
    const latency = Date.now() - start;

    // Check for graceful degradation indicators
    const isDegraded = response.status === 503 && response.headers['X-Degraded'] === 'true';
    const isFallback = response.headers['X-Fallback'] === 'true';
    const hasRetryAfter = response.headers['Retry-After'] !== undefined;

    dependencyErrors.add(response.status >= 500 && response.status !== 503, { phase });
    degradedResponses.add(isDegraded, { phase });
    fallbackActivations.add(isFallback ? 1 : 0, { phase });

    if (phase === 'recovery' && response.status === 200) {
      recoveryLatency.add(latency);
    }

    const success = check(response, {
      [`${endpoint.name} handled gracefully`]: (r) => {
        // Acceptable responses during failure
        const acceptable = [200, 201, 401, 429, 503];
        if (TARGET_DEP === 'auth' && endpoint.name === 'refresh') {
          acceptable.push(401); // Expected when auth is down
        }
        return acceptable.includes(r.status);
      },
      [`${endpoint.name} no unexpected 500`]: (r) => r.status !== 500,
      [`${endpoint.name} 503 has retry-after`]: (r) => r.status !== 503 || hasRetryAfter,
      [`${endpoint.name} degraded flag on 503`]: (r) => r.status !== 503 || isDegraded,
    });

    if (!success) {
      console.warn(`${TARGET_DEP}:${phase}: ${endpoint.name} failed: status=${response.status}, degraded=${isDegraded}, fallback=${isFallback}`);
    }

    // Log specific dependency behaviors
    if (TARGET_DEP === 's3' && endpoint.name === 'presigned' && response.status === 503) {
      console.info('S3 failure: Presigned URL generation degraded as expected');
    }
    if (TARGET_DEP === 'auth' && endpoint.name === 'refresh' && response.status === 401) {
      console.info('Auth failure: Token refresh failed, but valid JWTs should still work');
    }
    if (TARGET_DEP === 'redis' && isFallback) {
      console.info('Redis failure: In-memory rate limit fallback activated');
    }
  });

  sleep(0.5);
}

export function teardown(data) {
  console.log(`Dependency Failure Chaos Experiment completed: ${TARGET_DEP}`);
  console.log('Verify: graceful degradation, fallback activation, retry-after headers, quick recovery');
}