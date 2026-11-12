/**
 * Authentication Load Test
 * Tests login, register, refresh token flows
 * Target: p95 < 300ms, error rate < 0.5%
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, commonHeaders, randomInt, sleepRandom } from './k6-config.js';

// Custom metrics
const authRequests = new Counter('auth_requests_total');
const authErrors = new Rate('auth_errors');
const authLatency = new Trend('auth_latency', true);
const loginLatency = new Trend('login_latency', true);
const registerLatency = new Trend('register_latency', true);
const refreshLatency = new Trend('refresh_latency', true);

// Test endpoints
const ENDPOINTS = {
  login: '/v1/auth/login',
  register: '/v1/auth/register',
  refresh: '/v1/auth/refresh',
  logout: '/v1/auth/logout',
  me: '/v1/auth/me',
};

// Test data
const TEST_EMAIL_DOMAIN = 'loadtest.example.com';

export function setup() {
  // Pre-create some test users for login tests
  const users = [];
  for (let i = 0; i < 500; i++) {
    users.push({
      email: `loadtest${i}@${TEST_EMAIL_DOMAIN}`,
      password: 'LoadTest123!',
      deviceId: `device-${i}`,
    });
  }
  return { users };
}

export default function (data) {
  const user = data.users[__ITER % data.users.length];
  const headers = { ...commonHeaders };

  // Test 1: Register new user (10% of iterations)
  if (__ITER % 10 === 0) {
    group('Register', () => {
      const newUser = {
        email: `newuser${__VU}-${__ITER}@${TEST_EMAIL_DOMAIN}`,
        password: 'LoadTest123!',
        username: `loadtestuser${__VU}${__ITER}`,
        deviceId: `device-${__VU}-${__ITER}`,
      };

      const startTime = new Date();
      const response = http.post(`${BASE_URL}${ENDPOINTS.register}`, JSON.stringify(newUser), {
        headers,
        tags: { type: 'auth', operation: 'register' },
        timeout: '15s',
      });
      const latency = new Date() - startTime;

      authRequests.add(1, { operation: 'register' });
      registerLatency.add(latency);

      const success = check(response, {
        'register status 201': (r) => r.status === 201,
        'register has tokens': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.accessToken && body.refreshToken;
          } catch {
            return false;
          }
        },
        'register latency < 500ms': () => latency < 500,
      });

      authErrors.add(!success, { operation: 'register' });
      sleepRandom(500, 1000);
    });
  }

  // Test 2: Login (40% of iterations)
  if (__ITER % 5 < 2) {
    group('Login', () => {
      const loginData = {
        email: user.email,
        password: user.password,
        deviceId: user.deviceId,
      };

      const startTime = new Date();
      const response = http.post(`${BASE_URL}${ENDPOINTS.login}`, JSON.stringify(loginData), {
        headers,
        tags: { type: 'auth', operation: 'login' },
        timeout: '15s',
      });
      const latency = new Date() - startTime;

      authRequests.add(1, { operation: 'login' });
      loginLatency.add(latency);
      authLatency.add(latency);

      let tokens = null;
      const success = check(response, {
        'login status 200': (r) => r.status === 200,
        'login has access token': (r) => {
          try {
            const body = JSON.parse(r.body);
            tokens = body;
            return body.accessToken && body.refreshToken;
          } catch {
            return false;
          }
        },
        'login latency < 300ms': () => latency < 300,
      });

      authErrors.add(!success, { operation: 'login' });

      // Test 3: Get profile with token (if login successful)
      if (success && tokens) {
        group('Get Profile', () => {
          const authHeaders = {
            ...commonHeaders,
            'Authorization': `Bearer ${tokens.accessToken}`,
          };

          const profileStart = new Date();
          const profileResponse = http.get(`${BASE_URL}${ENDPOINTS.me}`, {
            headers: authHeaders,
            tags: { type: 'auth', operation: 'me' },
            timeout: '10s',
          });
          const profileLatency = new Date() - profileStart;

          authRequests.add(1, { operation: 'me' });
          authLatency.add(profileLatency);

          const profileSuccess = check(profileResponse, {
            'me status 200': (r) => r.status === 200,
            'me has user data': (r) => {
              try {
                const body = JSON.parse(r.body);
                return body.id && body.username;
              } catch {
                return false;
              }
            },
            'me latency < 200ms': () => profileLatency < 200,
          });

          authErrors.add(!profileSuccess, { operation: 'me' });
        });

        // Test 4: Refresh token (20% of logins)
        if (__ITER % 5 === 0) {
          group('Refresh Token', () => {
            const refreshData = {
              refreshToken: tokens.refreshToken,
              deviceId: user.deviceId,
            };

            const refreshStart = new Date();
            const refreshResponse = http.post(`${BASE_URL}${ENDPOINTS.refresh}`, JSON.stringify(refreshData), {
              headers,
              tags: { type: 'auth', operation: 'refresh' },
              timeout: '10s',
            });
            const refreshTime = new Date() - refreshStart;

            authRequests.add(1, { operation: 'refresh' });
            refreshLatency.add(refreshTime);
            authLatency.add(refreshTime);

            const refreshSuccess = check(refreshResponse, {
              'refresh status 200': (r) => r.status === 200,
              'refresh has new tokens': (r) => {
                try {
                  const body = JSON.parse(r.body);
                  return body.accessToken && body.refreshToken;
                } catch {
                  return false;
                }
              },
              'refresh latency < 300ms': () => refreshTime < 300,
            });

            authErrors.add(!refreshSuccess, { operation: 'refresh' });
          });
        }

        // Test 5: Logout (5% of logins)
        if (__ITER % 20 === 0) {
          group('Logout', () => {
            const logoutData = {
              refreshToken: tokens.refreshToken,
            };

            const logoutStart = new Date();
            const logoutResponse = http.post(`${BASE_URL}${ENDPOINTS.logout}`, JSON.stringify(logoutData), {
              headers: {
                ...commonHeaders,
                'Authorization': `Bearer ${tokens.accessToken}`,
              },
              tags: { type: 'auth', operation: 'logout' },
              timeout: '10s',
            });
            const logoutTime = new Date() - logoutStart;

            authRequests.add(1, { operation: 'logout' });
            authLatency.add(logoutTime);

            const logoutSuccess = check(logoutResponse, {
              'logout status 200': (r) => r.status === 200,
              'logout latency < 200ms': () => logoutTime < 200,
            });

            authErrors.add(!logoutSuccess, { operation: 'logout' });
          });
        }
      }

      sleepRandom(1000, 2000);
    });
  }

  // Test 6: Failed login attempts (rate limiting test) - 5%
  if (__ITER % 20 === 0) {
    group('Failed Login (Rate Limit)', () => {
      const badLogin = {
        email: user.email,
        password: 'WrongPassword123!',
        deviceId: user.deviceId,
      };

      const response = http.post(`${BASE_URL}${ENDPOINTS.login}`, JSON.stringify(badLogin), {
        headers,
        tags: { type: 'auth', operation: 'failed_login' },
        timeout: '10s',
      });

      authRequests.add(1, { operation: 'failed_login' });

      check(response, {
        'failed login returns 401': (r) => r.status === 401,
        'rate limit headers present': (r) => r.headers['X-RateLimit-Limit'] !== undefined,
      });
    });
  }
}

export function teardown(data) {
  console.log('Auth load test completed');
  console.log(`Total auth requests: ${authRequests.count}`);
  console.log(`Error rate: ${authErrors.rate * 100}%`);
}