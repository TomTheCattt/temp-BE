/**
 * Search Load Test
 * Tests unified search, typeahead, hashtag, location search
 * Target: p95 < 200ms
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, commonHeaders, getAuthHeaders, randomInt, sleepRandom } from './k6-config.js';

// Custom metrics
const searchRequests = new Counter('search_requests_total');
const searchErrors = new Rate('search_errors');
const searchLatency = new Trend('search_latency', true);
const typeaheadLatency = new Trend('typeahead_latency', true);
const searchResultsReturned = new Trend('search_results_returned');

// Endpoints
const ENDPOINTS = {
  search: '/v1/search',
  suggestions: '/v1/search/suggestions',
  hashtag: (tag) => `/v1/hashtags/${encodeURIComponent(tag)}`,
  location: (id) => `/v1/locations/${id}`,
  recent: '/v1/search/recent',
};

// Search queries for testing
const SEARCH_QUERIES = [
  'instagram', 'photo', 'video', 'reels', 'stories', 'travel', 'food',
  'fashion', 'fitness', 'art', 'music', 'nature', 'technology', 'design',
  'cats', 'dogs', 'sunset', 'beach', 'mountains', 'city', 'street',
];

const HASHTAGS = [
  '#instagood', '#photooftheday', '#love', '#fashion', '#beautiful',
  '#happy', '#cute', '#tbt', '#like4like', '#followme',
  '#picoftheday', '#follow', '#me', '#selfie', '#summer',
];

const LOCATION_IDS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
];

export function setup() {
  const users = [];
  for (let i = 0; i < 1000; i++) {
    users.push({
      token: `test-token-${i}`,
    });
  }
  return { users };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const headers = getAuthHeaders(user.token);

  // Test 1: Unified search (40% of iterations)
  if (__ITER % 5 < 2) {
    group('Unified Search', () => {
      const query = SEARCH_QUERIES[randomInt(0, SEARCH_QUERIES.length - 1)];
      const type = ['all', 'users', 'posts', 'reels', 'audio', 'hashtags', 'locations'][randomInt(0, 6)];

      const url = `${BASE_URL}${ENDPOINTS.search}?q=${encodeURIComponent(query)}&type=${type}&limit=20`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'search', search_type: type },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      searchRequests.add(1, { operation: 'search', search_type: type });
      searchLatency.add(latency);

      const success = check(response, {
        'search status 200': (r) => r.status === 200,
        'search valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            searchResultsReturned.add(body.results?.length || body.users?.length || body.posts?.length || 0);
            return true;
          } catch {
            return false;
          }
        },
        'search latency < 200ms': () => latency < 200,
        'search has results': (r) => {
          try {
            const body = JSON.parse(r.body);
            const total = (body.results?.length || 0) + (body.users?.length || 0) + (body.posts?.length || 0);
            return total > 0;
          } catch {
            return false;
          }
        },
      });

      searchErrors.add(!success, { operation: 'search' });
      sleepRandom(500, 1500);
    });
  }

  // Test 2: Typeahead suggestions (30% of iterations)
  if (__ITER % 10 < 3) {
    group('Typeahead Suggestions', () => {
      const prefix = SEARCH_QUERIES[randomInt(0, SEARCH_QUERIES.length - 1)].substring(0, randomInt(2, 4));

      const url = `${BASE_URL}${ENDPOINTS.suggestions}?q=${encodeURIComponent(prefix)}&limit=10`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'typeahead' },
        timeout: '5s',
      });
      const latency = new Date() - startTime;

      searchRequests.add(1, { operation: 'typeahead' });
      typeaheadLatency.add(latency);
      searchLatency.add(latency);

      const success = check(response, {
        'typeahead status 200': (r) => r.status === 200,
        'typeahead valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.suggestions !== undefined;
          } catch {
            return false;
          }
        },
        'typeahead latency < 100ms': () => latency < 100,
      });

      searchErrors.add(!success, { operation: 'typeahead' });
      sleepRandom(100, 300);
    });
  }

  // Test 3: Hashtag search (15% of iterations)
  if (__ITER % 7 === 0) {
    group('Hashtag Search', () => {
      const tag = HASHTAGS[randomInt(0, HASHTAGS.length - 1)].replace('#', '');

      const url = `${BASE_URL}${ENDPOINTS.hashtag(tag)}?limit=20`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'hashtag' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      searchRequests.add(1, { operation: 'hashtag' });
      searchLatency.add(latency);

      const success = check(response, {
        'hashtag status 200': (r) => r.status === 200,
        'hashtag valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            searchResultsReturned.add(body.posts?.length || body.reels?.length || 0);
            return true;
          } catch {
            return false;
          }
        },
        'hashtag latency < 200ms': () => latency < 200,
      });

      searchErrors.add(!success, { operation: 'hashtag' });
      sleepRandom(1000, 2000);
    });
  }

  // Test 4: Location search (10% of iterations)
  if (__ITER % 10 === 0) {
    group('Location Search', () => {
      const locationId = LOCATION_IDS[randomInt(0, LOCATION_IDS.length - 1)];

      const url = `${BASE_URL}${ENDPOINTS.location(locationId)}?limit=20`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'location' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      searchRequests.add(1, { operation: 'location' });
      searchLatency.add(latency);

      const success = check(response, {
        'location status 200': (r) => r.status === 200,
        'location valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            searchResultsReturned.add(body.posts?.length || 0);
            return true;
          } catch {
            return false;
          }
        },
        'location latency < 200ms': () => latency < 200,
      });

      searchErrors.add(!success, { operation: 'location' });
      sleepRandom(1000, 2000);
    });
  }

  // Test 5: Recent searches (5% of iterations)
  if (__ITER % 20 === 0) {
    group('Recent Searches', () => {
      const url = `${BASE_URL}${ENDPOINTS.recent}`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'recent_searches' },
        timeout: '5s',
      });
      const latency = new Date() - startTime;

      searchRequests.add(1, { operation: 'recent_searches' });
      searchLatency.add(latency);

      check(response, {
        'recent searches status 200': (r) => r.status === 200,
        'recent searches latency < 100ms': () => latency < 100,
      });
    });
  }
}

export function teardown(data) {
  console.log('Search load test completed');
  console.log(`Total search requests: ${searchRequests.count}`);
  console.log(`Error rate: ${searchErrors.rate * 100}%`);
}