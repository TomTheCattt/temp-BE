/**
 * Master Load Test Runner
 * Combines all critical path load tests
 * Run with: k6 run tests/load/master-load-test.js
 */

import { BASE_URL, options } from './k6-config.js';

// Import all test modules
import feedTest from './feed-load-test.js';
import authTest from './auth-load-test.js';
import postTest from './post-load-test.js';
import searchTest from './search-load-test.js';
import wsTest from './websocket-load-test.js';
import mediaTest from './media-load-test.js';
import notificationTest from './notification-load-test.js';
import userTest from './user-load-test.js';

// Export combined options
export { options };

// Setup functions for each test
export function setup() {
  console.log('Starting master load test...');
  console.log(`Target API: ${BASE_URL}`);
  console.log('Test scenarios: ramp_up, spike, soak, stress');

  // Run all setup functions
  const feedData = feedTest.setup ? feedTest.setup() : {};
  const authData = authTest.setup ? authTest.setup() : {};
  const postData = postTest.setup ? postTest.setup() : {};
  const searchData = searchTest.setup ? searchTest.setup() : {};
  const wsData = wsTest.setup ? wsTest.setup() : {};
  const mediaData = mediaTest.setup ? mediaTest.setup() : {};
  const notifData = notificationTest.setup ? notificationTest.setup() : {};
  const userData = userTest.setup ? userTest.setup() : {};

  return {
    feed: feedData,
    auth: authData,
    post: postData,
    search: searchData,
    ws: wsData,
    media: mediaData,
    notification: notifData,
    user: userData,
  };
}

// Main test function - runs all tests in parallel via scenarios
export default function (data) {
  // Each VU will execute based on its assigned scenario
  // The scenario determines which test function runs

  // We use the scenario name to determine which test to run
  const scenario = __ENV.K6_SCENARIO || 'mixed';

  switch (scenario) {
    case 'feed':
      feedTest.default(data.feed);
      break;
    case 'auth':
      authTest.default(data.auth);
      break;
    case 'post':
      postTest.default(data.post);
      break;
    case 'search':
      searchTest.default(data.search);
      break;
    case 'ws':
      wsTest.default(data.ws);
      break;
    case 'media':
      mediaTest.default(data.media);
      break;
    case 'notification':
      notificationTest.default(data.notification);
      break;
    case 'user':
      userTest.default(data.user);
      break;
    case 'mixed':
    default:
      // Run a mix of operations based on iteration
      const testType = __ITER % 8;
      switch (testType) {
        case 0:
          feedTest.default(data.feed);
          break;
        case 1:
          authTest.default(data.auth);
          break;
        case 2:
          postTest.default(data.post);
          break;
        case 3:
          searchTest.default(data.search);
          break;
        case 4:
          wsTest.default(data.ws);
          break;
        case 5:
          mediaTest.default(data.media);
          break;
        case 6:
          notificationTest.default(data.notification);
          break;
        case 7:
          userTest.default(data.user);
          break;
      }
      break;
  }
}

// Teardown
export function teardown(data) {
  console.log('Master load test completed');

  if (feedTest.teardown) feedTest.teardown(data.feed);
  if (authTest.teardown) authTest.teardown(data.auth);
  if (postTest.teardown) postTest.teardown(data.post);
  if (searchTest.teardown) searchTest.teardown(data.search);
  if (wsTest.teardown) wsTest.teardown(data.ws);
  if (mediaTest.teardown) mediaTest.teardown(data.media);
  if (notificationTest.teardown) notificationTest.teardown(data.notification);
  if (userTest.teardown) userTest.teardown(data.user);
}