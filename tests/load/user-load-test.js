/**
 * User Profile & Social Graph Load Test
 * Tests user profiles, follow/unfollow, followers/following lists
 * Target: p95 < 200ms
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, commonHeaders, getAuthHeaders, randomInt, sleepRandom } from './k6-config.js';

// Custom metrics
const userRequests = new Counter('user_requests_total');
const userErrors = new Rate('user_errors');
const userLatency = new Trend('user_latency', true);
const profileLatency = new Trend('profile_latency', true);
const followLatency = new Trend('follow_latency', true);

// Endpoints
const ENDPOINTS = {
  profile: (username) => `/v1/users/${encodeURIComponent(username)}`,
  followers: (username) => `/v1/users/${encodeURIComponent(username)}/followers`,
  following: (username) => `/v1/users/${encodeURIComponent(username)}/following`,
  follow: (username) => `/v1/users/${encodeURIComponent(username)}/follow`,
  accept: (username) => `/v1/users/${encodeURIComponent(username)}/accept`,
  block: (username) => `/v1/users/${encodeURIComponent(username)}/block`,
  restrict: (username) => `/v1/users/${encodeURIComponent(username)}/restrict`,
  closeFriends: (username) => `/v1/users/${encodeURIComponent(username)}/close-friends`,
  posts: (username) => `/v1/users/${encodeURIComponent(username)}/posts`,
  reels: (username) => `/v1/users/${encodeURIComponent(username)}/reels`,
  saved: (username) => `/v1/users/${encodeURIComponent(username)}/saved`,
  highlights: (username) => `/v1/users/${encodeURIComponent(username)}/highlights`,
};

const TEST_USERNAMES = Array.from({ length: 10000 }, (_, i) => `loadtestuser${i}`);

export function setup() {
  const users = [];
  for (let i = 0; i < 1000; i++) {
    users.push({
      token: `test-token-${i}`,
      username: `loadtestuser${i}`,
    });
  }
  return { users };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const headers = getAuthHeaders(user.token);
  const targetUsername = TEST_USERNAMES[randomInt(0, TEST_USERNAMES.length - 1)];

  // Test 1: Get user profile (40% of iterations)
  if (__ITER % 5 < 2) {
    group('Get Profile', () => {
      const url = `${BASE_URL}${ENDPOINTS.profile(targetUsername)}`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'get_profile' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      userRequests.add(1, { operation: 'get_profile' });
      profileLatency.add(latency);
      userLatency.add(latency);

      const success = check(response, {
        'profile status 200/404': (r) => r.status === 200 || r.status === 404,
        'profile valid response': (r) => {
          try {
            JSON.parse(r.body);
            return true;
          } catch {
            return false;
          }
        },
        'profile latency < 200ms': () => latency < 200,
        'profile has privacy fields': (r) => {
          if (r.status === 200) {
            try {
              const body = JSON.parse(r.body);
              return body.isPrivate !== undefined && body.followStatus !== undefined;
            } catch {
              return false;
            }
          }
          return true; // 404 is valid for non-existent
        },
      });

      userErrors.add(!success, { operation: 'get_profile' });
      sleepRandom(500, 1500);
    });
  }

  // Test 2: Get followers (15% of iterations)
  if (__ITER % 7 === 0) {
    group('Get Followers', () => {
      const url = `${BASE_URL}${ENDPOINTS.followers(targetUsername)}?limit=20`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'get_followers' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      userRequests.add(1, { operation: 'get_followers' });
      userLatency.add(latency);

      check(response, {
        'followers status 200': (r) => r.status === 200,
        'followers valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.items !== undefined;
          } catch {
            return false;
          }
        },
        'followers latency < 200ms': () => latency < 200,
      });

      sleepRandom(1000, 2000);
    });
  }

  // Test 3: Get following (15% of iterations)
  if (__ITER % 7 === 0) {
    group('Get Following', () => {
      const url = `${BASE_URL}${ENDPOINTS.following(targetUsername)}?limit=20`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'get_following' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      userRequests.add(1, { operation: 'get_following' });
      userLatency.add(latency);

      check(response, {
        'following status 200': (r) => r.status === 200,
        'following valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.items !== undefined;
          } catch {
            return false;
          }
        },
        'following latency < 200ms': () => latency < 200,
      });

      sleepRandom(1000, 2000);
    });
  }

  // Test 4: Follow/Unfollow (15% of iterations)
  if (__ITER % 7 === 0 && targetUsername !== user.username) {
    group('Follow User', () => {
      const isFollow = Math.random() > 0.3; // 70% follow, 30% unfollow
      const url = `${BASE_URL}${ENDPOINTS.follow(targetUsername)}`;

      const startTime = new Date();
      const response = isFollow
        ? http.post(url, null, { headers, tags: { type: 'api', operation: 'follow' }, timeout: '10s' })
        : http.del(url, null, { headers, tags: { type: 'api', operation: 'unfollow' }, timeout: '10s' });
      const latency = new Date() - startTime;

      userRequests.add(1, { operation: isFollow ? 'follow' : 'unfollow' });
      followLatency.add(latency);
      userLatency.add(latency);

      const success = check(response, {
        'follow status 200/201/409': (r) => [200, 201, 409].includes(r.status), // 409 = already following
        'follow latency < 200ms': () => latency < 200,
        'follow returns status': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.status !== undefined; // pending, accepted, none
          } catch {
            return false;
          }
        },
      });

      userErrors.add(!success, { operation: isFollow ? 'follow' : 'unfollow' });
      sleepRandom(1000, 2000);
    });
  }

  // Test 5: Accept follow request (5% of iterations)
  if (__ITER % 20 === 0) {
    group('Accept Follow', () => {
      const url = `${BASE_URL}${ENDPOINTS.accept(targetUsername)}`;

      const startTime = new Date();
      const response = http.post(url, null, {
        headers,
        tags: { type: 'api', operation: 'accept_follow' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      userRequests.add(1, { operation: 'accept_follow' });
      userLatency.add(latency);

      check(response, {
        'accept status 200/404': (r) => r.status === 200 || r.status === 404, // 404 if no pending request
        'accept latency < 200ms': () => latency < 200,
      });
    });
  }

  // Test 6: Block/Unblock (5% of iterations)
  if (__ITER % 20 === 0 && targetUsername !== user.username) {
    group('Block User', () => {
      const isBlock = Math.random() > 0.5;
      const url = `${BASE_URL}${ENDPOINTS.block(targetUsername)}`;

      const response = isBlock
        ? http.post(url, null, { headers, tags: { type: 'api', operation: 'block' }, timeout: '10s' })
        : http.del(url, null, { headers, tags: { type: 'api', operation: 'unblock' }, timeout: '10s' });

      userRequests.add(1, { operation: isBlock ? 'block' : 'unblock' });

      check(response, {
        'block status 200/201/409': (r) => [200, 201, 409].includes(r.status),
      });
    });
  }

  // Test 7: Restrict/Unrestrict (3% of iterations)
  if (__ITER % 30 === 0 && targetUsername !== user.username) {
    group('Restrict User', () => {
      const isRestrict = Math.random() > 0.5;
      const url = `${BASE_URL}${ENDPOINTS.restrict(targetUsername)}`;

      const response = isRestrict
        ? http.post(url, null, { headers, tags: { type: 'api', operation: 'restrict' }, timeout: '10s' })
        : http.del(url, null, { headers, tags: { type: 'api', operation: 'unrestrict' }, timeout: '10s' });

      userRequests.add(1, { operation: isRestrict ? 'restrict' : 'unrestrict' });

      check(response, {
        'restrict status 200/201/409': (r) => [200, 201, 409].includes(r.status),
      });
    });
  }

  // Test 8: Close friends (2% of iterations)
  if (__ITER % 50 === 0 && targetUsername !== user.username) {
    group('Close Friends', () => {
      const isAdd = Math.random() > 0.5;
      const url = `${BASE_URL}${ENDPOINTS.closeFriends(targetUsername)}`;

      const response = isAdd
        ? http.post(url, null, { headers, tags: { type: 'api', operation: 'add_close_friend' }, timeout: '10s' })
        : http.del(url, null, { headers, tags: { type: 'api', operation: 'remove_close_friend' }, timeout: '10s' });

      userRequests.add(1, { operation: isAdd ? 'add_close_friend' : 'remove_close_friend' });

      check(response, {
        'close friends status 200/201/409': (r) => [200, 201, 409].includes(r.status),
      });
    });
  }

  // Test 9: User posts (3% of iterations)
  if (__ITER % 30 === 0) {
    group('User Posts', () => {
      const url = `${BASE_URL}${ENDPOINTS.posts(targetUsername)}?limit=20`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'user_posts' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      userRequests.add(1, { operation: 'user_posts' });
      userLatency.add(latency);

      check(response, {
        'user posts status 200': (r) => r.status === 200,
        'user posts valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.items !== undefined;
          } catch {
            return false;
          }
        },
        'user posts latency < 200ms': () => latency < 200,
      });
    });
  }

  // Test 10: User reels (2% of iterations)
  if (__ITER % 50 === 0) {
    group('User Reels', () => {
      const url = `${BASE_URL}${ENDPOINTS.reels(targetUsername)}?limit=20`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'user_reels' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      userRequests.add(1, { operation: 'user_reels' });
      userLatency.add(latency);

      check(response, {
        'user reels status 200': (r) => r.status === 200,
        'user reels latency < 200ms': () => latency < 200,
      });
    });
  }
}

export function teardown(data) {
  console.log('User profile load test completed');
  console.log(`Total user requests: ${userRequests.count}`);
  console.log(`Error rate: ${userErrors.rate * 100}%`);
}