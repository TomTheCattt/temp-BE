/**
 * Notification Load Test
 * Tests notification feed, read status, real-time delivery
 * Target: p95 < 200ms
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, commonHeaders, getAuthHeaders, randomInt, sleepRandom } from './k6-config.js';

// Custom metrics
const notifRequests = new Counter('notification_requests_total');
const notifErrors = new Rate('notification_errors');
const notifLatency = new Trend('notification_latency', true);
const notifItemsReturned = new Trend('notification_items_returned');

// Endpoints
const ENDPOINTS = {
  feed: '/v1/notifications',
  unreadCount: '/v1/notifications/unread-count',
  read: (id) => `/v1/notifications/${id}/read`,
  readAll: '/v1/notifications/read-all',
  delete: (id) => `/v1/notifications/${id}`,
};

export function setup() {
  const users = [];
  for (let i = 0; i < 1000; i++) {
    users.push({
      token: `test-token-${i}`,
      id: `user-${i}`,
    });
  }
  return { users };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const headers = getAuthHeaders(user.token);
  let notificationIds = [];

  // Test 1: Get notification feed (40% of iterations)
  if (__ITER % 5 < 2) {
    group('Notification Feed', () => {
      const url = `${BASE_URL}${ENDPOINTS.feed}?limit=30`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'notification_feed' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      notifRequests.add(1, { operation: 'notification_feed' });
      notifLatency.add(latency);

      const success = check(response, {
        'notif feed status 200': (r) => r.status === 200,
        'notif feed valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            if (body.items) {
              notifItemsReturned.add(body.items.length);
              notificationIds = body.items.map(n => n.id).slice(0, 5);
            }
            return true;
          } catch {
            return false;
          }
        },
        'notif feed latency < 200ms': () => latency < 200,
        'notif feed grouped': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.items?.some(n => n.groupKey !== undefined);
          } catch {
            return false;
          }
        },
      });

      notifErrors.add(!success, { operation: 'notification_feed' });
      sleepRandom(1000, 3000);
    });
  }

  // Test 2: Get unread count (30% of iterations)
  if (__ITER % 10 < 3) {
    group('Unread Count', () => {
      const url = `${BASE_URL}${ENDPOINTS.unreadCount}`;

      const startTime = new Date();
      const response = http.get(url, {
        headers,
        tags: { type: 'api', operation: 'unread_count' },
        timeout: '5s',
      });
      const latency = new Date() - startTime;

      notifRequests.add(1, { operation: 'unread_count' });
      notifLatency.add(latency);

      const success = check(response, {
        'unread count status 200': (r) => r.status === 200,
        'unread count valid response': (r) => {
          try {
            const body = JSON.parse(r.body);
            return typeof body.count === 'number';
          } catch {
            return false;
          }
        },
        'unread count latency < 100ms': () => latency < 100,
      });

      notifErrors.add(!success, { operation: 'unread_count' });
      sleepRandom(500, 1500);
    });
  }

  // Test 3: Mark notification as read (20% of iterations)
  if (__ITER % 5 === 0 && notificationIds.length > 0) {
    group('Mark Read', () => {
      const notifId = notificationIds[randomInt(0, notificationIds.length - 1)];
      const url = `${BASE_URL}${ENDPOINTS.read(notifId)}`;

      const startTime = new Date();
      const response = http.patch(url, null, {
        headers,
        tags: { type: 'api', operation: 'mark_read' },
        timeout: '5s',
      });
      const latency = new Date() - startTime;

      notifRequests.add(1, { operation: 'mark_read' });
      notifLatency.add(latency);

      check(response, {
        'mark read status 200': (r) => r.status === 200,
        'mark read latency < 150ms': () => latency < 150,
      });

      sleepRandom(200, 500);
    });
  }

  // Test 4: Mark all as read (5% of iterations)
  if (__ITER % 20 === 0) {
    group('Mark All Read', () => {
      const url = `${BASE_URL}${ENDPOINTS.readAll}`;

      const startTime = new Date();
      const response = http.post(url, null, {
        headers,
        tags: { type: 'api', operation: 'read_all' },
        timeout: '10s',
      });
      const latency = new Date() - startTime;

      notifRequests.add(1, { operation: 'read_all' });
      notifLatency.add(latency);

      check(response, {
        'read all status 200': (r) => r.status === 200,
        'read all latency < 300ms': () => latency < 300,
      });

      sleepRandom(500, 1000);
    });
  }

  // Test 5: Delete notification (5% of iterations)
  if (__ITER % 20 === 0 && notificationIds.length > 0) {
    group('Delete Notification', () => {
      const notifId = notificationIds[randomInt(0, notificationIds.length - 1)];
      const url = `${BASE_URL}${ENDPOINTS.delete(notifId)}`;

      const startTime = new Date();
      const response = http.del(url, null, {
        headers,
        tags: { type: 'api', operation: 'delete_notification' },
        timeout: '5s',
      });
      const latency = new Date() - startTime;

      notifRequests.add(1, { operation: 'delete_notification' });
      notifLatency.add(latency);

      check(response, {
        'delete status 200/204': (r) => r.status === 200 || r.status === 204,
        'delete latency < 150ms': () => latency < 150,
      });
    });
  }
}

export function teardown(data) {
  console.log('Notification load test completed');
  console.log(`Total notification requests: ${notifRequests.count}`);
  console.log(`Error rate: ${notifErrors.rate * 100}%`);
}