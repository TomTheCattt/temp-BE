/**
 * Feed Load Test - Critical Path
 * Tests the home feed endpoint which is the most frequent API call
 * Target: p95 < 150ms, 10k concurrent users
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { BASE_URL, commonHeaders, getAuthHeaders, randomUserId, sleepRandom } from './k6-config.js';

// Custom metrics
const feedRequests = new Counter('feed_requests_total');
const feedErrors = new Rate('feed_errors');
const feedLatency = new Trend('feed_latency', true);
const feedItemsReturned = new Trend('feed_items_returned');
const feedCacheHitRate = new Rate('feed_cache_hit_rate');

// Test configuration
const FEED_ENDPOINT = '/v1/posts/feed';
const ITERATIONS_PER_USER = 20; // Simulate user scrolling

// Test user tokens (pre-generated)
const USER_TOKENS = new Map();
const TOKEN_FILE = './test-tokens.json';

export function setup() {
  // Load or generate test user tokens
  let tokens = [];
  try {
    const data = open(TOKEN_FILE);
    tokens = JSON.parse(data);
  } catch (e) {
    console.log('Generating test tokens...');
    // In real scenario, these would be pre-generated via auth API
    for (let i = 0; i < 1000; i++) {
      tokens.push(`test-token-${i}`);
    }
  }

  // Distribute tokens to VUs
  return { tokens };
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const headers = getAuthHeaders(token);

  // Simulate user session: multiple feed requests with pagination
  let cursor = null;

  for (let i = 0; i < ITERATIONS_PER_USER; i++) {
    group('Feed Request', () => {
      const params = {
        headers,
        tags: { type: 'feed' },
        timeout: '10s',
      };

      let url = `${BASE_URL}${FEED_ENDPOINT}?limit=20`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }

      const startTime = new Date();
      const response = http.get(url, params);
      const latency = new Date() - startTime;

      feedRequests.add(1);
      feedLatency.add(latency);

      const success = check(response, {
        'feed status 200': (r) => r.status === 200,
        'feed has items': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.items && body.items.length > 0;
          } catch {
            return false;
          }
        },
        'feed latency < 150ms': (r) => latency < 150,
        'feed response valid JSON': (r) => {
          try {
            JSON.parse(r.body);
            return true;
          } catch {
            return false;
          }
        },
      });

      feedErrors.add(!success);

      if (success) {
        try {
          const body = JSON.parse(response.body);
          feedItemsReturned.add(body.items?.length || 0);

          // Check for cache headers
          const cacheStatus = response.headers['X-Cache-Status'];
          if (cacheStatus) {
            feedCacheHitRate.add(cacheStatus === 'HIT');
          }

          // Use cursor for pagination
          cursor = body.nextCursor;
        } catch (e) {
          console.error('Failed to parse feed response:', e);
        }
      }

      // Simulate user think time (reading feed)
      sleepRandom(1000, 3000);
    });

    // Stop if no more pages
    if (!cursor) {
      break;
    }
  }
}

export function teardown(data) {
  console.log('Feed load test completed');
  console.log(`Total feed requests: ${feedRequests.count}`);
  console.log(`Error rate: ${feedErrors.rate * 100}%`);
}