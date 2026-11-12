/**
 * Post & Interaction Load Test
 * Tests post CRUD, likes, comments, saves, shares
 * Target: p95 < 200ms for API operations
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, commonHeaders, getAuthHeaders, randomUserId, randomInt, sleepRandom } from './k6-config.js';

// Custom metrics
const postRequests = new Counter('post_requests_total');
const postErrors = new Rate('post_errors');
const postLatency = new Trend('post_latency', true);
const createPostLatency = new Trend('create_post_latency', true);
const likeLatency = new Trend('like_latency', true);
const commentLatency = new Trend('comment_latency', true);

// Endpoints
const ENDPOINTS = {
  posts: '/v1/posts',
  postById: (id) => `/v1/posts/${id}`,
  likes: (id) => `/v1/posts/${id}/like`,
  comments: (id) => `/v1/posts/${id}/comments`,
  saves: (id) => `/v1/posts/${id}/save`,
  shares: (id) => `/v1/posts/${id}/share`,
};

export function setup() {
  // Create test users with tokens
  const users = [];
  for (let i = 0; i < 1000; i++) {
    users.push({
      id: `user-${i}`,
      token: `test-token-${i}`,
      username: `loadtestuser${i}`,
    });
  }
  return { users };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const headers = getAuthHeaders(user.token);
  let createdPostId = null;

  // Test 1: Create post (5% of iterations)
  if (__ITER % 20 === 0) {
    group('Create Post', () => {
      const postData = {
        caption: `Load test post from ${user.username} at ${new Date().toISOString()}`,
        mediaIds: [`media-${randomInt(1, 100)}`],
        location: 'Test Location',
        audience: 'public',
        tags: ['loadtest', 'performance'],
      };

      const startTime = new Date();
      const response = http.post(`${BASE_URL}${ENDPOINTS.posts}`, JSON.stringify(postData), {
        headers,
        tags: { type: 'api', operation: 'create_post' },
        timeout: '15s',
      });
      const latency = new Date() - startTime;

      postRequests.add(1, { operation: 'create_post' });
      createPostLatency.add(latency);
      postLatency.add(latency);

      const success = check(response, {
        'create post status 201': (r) => r.status === 201,
        'create post has id': (r) => {
          try {
            const body = JSON.parse(r.body);
            createdPostId = body.id;
            return body.id !== undefined;
          } catch {
            return false;
          }
        },
        'create post latency < 500ms': () => latency < 500,
      });

      postErrors.add(!success, { operation: 'create_post' });
      sleepRandom(1000, 2000);
    });
  }

  // Test 2: Get single post (30% of iterations)
  if (__ITER % 10 < 3) {
    group('Get Post', () => {
      // Use a mix of created posts and existing posts
      const postId = createdPostId || `post-${randomInt(1, 10000)}`;

      const startTime = new Date();
      const response = http.get(`${BASE_URL}${ENDPOINTS.postById(postId)}`, {
        headers,
        tags: { type: 'api', operation: 'get_post' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      postRequests.add(1, { operation: 'get_post' });
      postLatency.add(latency);

      const success = check(response, {
        'get post status 200': (r) => r.status === 200 || r.status === 404,
        'get post valid response': (r) => {
          try {
            JSON.parse(r.body);
            return true;
          } catch {
            return false;
          }
        },
        'get post latency < 200ms': () => latency < 200,
      });

      postErrors.add(!success, { operation: 'get_post' });
    });
  }

  // Test 3: Like/Unlike post (25% of iterations)
  if (__ITER % 4 === 0) {
    group('Like Post', () => {
      const postId = createdPostId || `post-${randomInt(1, 10000)}`;
      const isLike = Math.random() > 0.3; // 70% like, 30% unlike

      const startTime = new Date();
      const response = isLike
        ? http.post(`${BASE_URL}${ENDPOINTS.likes(postId)}`, null, { headers, tags: { type: 'api', operation: 'like' }, timeout: '10s' })
        : http.del(`${BASE_URL}${ENDPOINTS.likes(postId)}`, null, { headers, tags: { type: 'api', operation: 'unlike' }, timeout: '10s' });
      const latency = new Date() - startTime;

      postRequests.add(1, { operation: isLike ? 'like' : 'unlike' });
      likeLatency.add(latency);
      postLatency.add(latency);

      const success = check(response, {
        'like status 200/201': (r) => r.status === 200 || r.status === 201,
        'like latency < 150ms': () => latency < 150,
      });

      postErrors.add(!success, { operation: isLike ? 'like' : 'unlike' });
      sleepRandom(200, 500);
    });
  }

  // Test 4: Comment on post (15% of iterations)
  if (__ITER % 7 === 0) {
    group('Comment on Post', () => {
      const postId = createdPostId || `post-${randomInt(1, 10000)}`;

      const commentData = {
        text: `Load test comment from ${user.username} at ${Date.now()}`,
        parentId: null, // Top-level comment
      };

      const startTime = new Date();
      const response = http.post(`${BASE_URL}${ENDPOINTS.comments(postId)}`, JSON.stringify(commentData), {
        headers,
        tags: { type: 'api', operation: 'comment' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      postRequests.add(1, { operation: 'comment' });
      commentLatency.add(latency);
      postLatency.add(latency);

      const success = check(response, {
        'comment status 201': (r) => r.status === 201,
        'comment has id': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.id !== undefined;
          } catch {
            return false;
          }
        },
        'comment latency < 200ms': () => latency < 200,
      });

      postErrors.add(!success, { operation: 'comment' });
      sleepRandom(500, 1000);
    });
  }

  // Test 5: Get comments (20% of iterations)
  if (__ITER % 5 === 0) {
    group('Get Comments', () => {
      const postId = createdPostId || `post-${randomInt(1, 10000)}`;

      const startTime = new Date();
      const response = http.get(`${BASE_URL}${ENDPOINTS.comments(postId)}?limit=20`, {
        headers,
        tags: { type: 'api', operation: 'get_comments' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      postRequests.add(1, { operation: 'get_comments' });
      postLatency.add(latency);

      const success = check(response, {
        'get comments status 200': (r) => r.status === 200,
        'get comments valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.items !== undefined;
          } catch {
            return false;
          }
        },
        'get comments latency < 200ms': () => latency < 200,
      });

      postErrors.add(!success, { operation: 'get_comments' });
    });
  }

  // Test 6: Save/Unsave post (10% of iterations)
  if (__ITER % 10 === 0) {
    group('Save Post', () => {
      const postId = createdPostId || `post-${randomInt(1, 10000)}`;
      const isSave = Math.random() > 0.5;

      const response = isSave
        ? http.post(`${BASE_URL}${ENDPOINTS.saves(postId)}`, null, { headers, tags: { type: 'api', operation: 'save' }, timeout: '10s' })
        : http.del(`${BASE_URL}${ENDPOINTS.saves(postId)}`, null, { headers, tags: { type: 'api', operation: 'unsave' }, timeout: '10s' });

      postRequests.add(1, { operation: isSave ? 'save' : 'unsave' });

      check(response, {
        'save status 200/201': (r) => r.status === 200 || r.status === 201,
      });
    });
  }

  // Test 7: Share post (5% of iterations)
  if (__ITER % 20 === 0) {
    group('Share Post', () => {
      const postId = createdPostId || `post-${randomInt(1, 10000)}`;

      const response = http.post(`${BASE_URL}${ENDPOINTS.shares(postId)}`, JSON.stringify({
        type: 'dm',
        recipientIds: [data.users[randomInt(0, data.users.length - 1)].id],
      }), {
        headers,
        tags: { type: 'api', operation: 'share' },
        timeout: '10s',
      });

      postRequests.add(1, { operation: 'share' });

      check(response, {
        'share status 201': (r) => r.status === 201,
      });
    });
  }

  // Simulate user browsing behavior
  sleepRandom(500, 2000);
}

export function teardown(data) {
  console.log('Post load test completed');
  console.log(`Total post requests: ${postRequests.count}`);
  console.log(`Error rate: ${postErrors.rate * 100}%`);
}