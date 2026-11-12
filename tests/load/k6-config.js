/**
 * k6 Load Testing Configuration
 * Instagram Clone Backend - Phase 12 Production Hardening
 *
 * Target: 10k concurrent users
 * Performance Goals:
 * - Feed p95 < 150ms
 * - API p95 < 200ms
 * - Error rate < 0.1%
 */

export const options = {
  // Scenario definitions for different load patterns
  scenarios: {
    // Ramp-up to 10k concurrent users over 10 minutes
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 1000 },   // Warm-up
        { duration: '3m', target: 3000 },   // Gradual increase
        { duration: '3m', target: 6000 },   // Medium load
        { duration: '2m', target: 10000 },  // Peak load
        { duration: '10m', target: 10000 }, // Sustained peak
        { duration: '3m', target: 3000 },   // Ramp down
        { duration: '2m', target: 0 },      // Cool down
      ],
      gracefulRampDown: '30s',
    },

    // Spike test - sudden traffic spike
    spike: {
      executor: 'ramping-vus',
      startVUs: 1000,
      stages: [
        { duration: '10s', target: 5000 },  // Sudden spike
        { duration: '1m', target: 5000 },   // Hold
        { duration: '10s', target: 1000 },  // Drop
        { duration: '1m', target: 1000 },   // Recovery
      ],
      startTime: '12m',
      gracefulRampDown: '30s',
    },

    // Soak test - sustained load
    soak: {
      executor: 'constant-vus',
      vus: 5000,
      duration: '30m',
      startTime: '15m',
      gracefulRampDown: '30s',
    },

    // Stress test - beyond capacity
    stress: {
      executor: 'ramping-vus',
      startVUs: 1000,
      stages: [
        { duration: '2m', target: 10000 },
        { duration: '3m', target: 15000 },  // Beyond target
        { duration: '2m', target: 20000 },  // Breaking point
        { duration: '1m', target: 0 },
      ],
      startTime: '46m',
      gracefulRampDown: '30s',
    },
  },

  // Thresholds for pass/fail criteria
  thresholds: {
    // HTTP response time thresholds
    'http_req_duration{type:feed}': ['p(95)<150', 'p(99)<300'],
    'http_req_duration{type:api}': ['p(95)<200', 'p(99)<400'],
    'http_req_duration{type:auth}': ['p(95)<300', 'p(99)<500'],
    'http_req_duration{type:media}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{type:ws}': ['p(95)<100', 'p(99)<200'],

    // Error rate thresholds
    'http_req_failed{type:feed}': ['rate<0.001'],
    'http_req_failed{type:api}': ['rate<0.001'],
    'http_req_failed{type:auth}': ['rate<0.005'],
    'http_req_failed{type:media}': ['rate<0.01'],
    'http_req_failed{type:ws}': ['rate<0.001'],

    // Throughput thresholds
    'http_reqs{type:feed}': ['rate>1000'],
    'http_reqs{type:api}': ['rate>5000'],

    // WebSocket thresholds
    'ws_connecting': ['rate<0.01'],
    'ws_session_duration': ['p(95)>300000'], // 5 min minimum session

    // Custom business metrics
    'feed_items_returned': ['p(95)>15'],
    'search_results_returned': ['p(95)>5'],
  },

  // Output configuration
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'p(99.9)'],

  // Cloud/extension options
  ext: {
    loadimpact: {
      projectID: __ENV.K6_PROJECT_ID,
      name: 'Instagram Clone Load Test',
    },
  },
};

// Base URL configuration
export const BASE_URL = __ENV.API_BASE_URL || 'https://api.instagram-clone.com';
export const WS_URL = __ENV.WS_BASE_URL || 'wss://api.instagram-clone.com/ws/v1';

// Test data configuration
export const TEST_USERS = {
  count: 10000,
  prefix: 'loadtest',
};

// Common headers
export const commonHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'k6-load-test/1.0',
};

// Helper functions
export function getAuthHeaders(token) {
  return {
    ...commonHeaders,
    'Authorization': `Bearer ${token}`,
  };
}

export function randomUserId() {
  return `${TEST_USERS.prefix}_${Math.floor(Math.random() * TEST_USERS.count)}`;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleepRandom(min, max) {
  const duration = randomInt(min, max);
  return new Promise(resolve => setTimeout(resolve, duration));
}