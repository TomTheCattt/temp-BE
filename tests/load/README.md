# Instagram Clone Backend - Load Tests

k6 load testing scripts for Phase 12 Production Hardening (BE-184).

## Quick Start

```bash
# Install k6
brew install k6  # macOS
# or
sudo apt-get install k6  # Ubuntu

# Run smoke test (quick validation)
npm run load:smoke

# Run full load test (10k concurrent users)
npm run load:all

# Run specific test
npm run load:feed
npm run load:auth
npm run load:post
npm run load:search
npm run load:ws
npm run load:media
npm run load:notification
npm run load:user
```

## Test Scenarios

| Scenario | Description | Duration | Peak VUs |
|----------|-------------|----------|----------|
| `ramp_up` | Gradual ramp to 10k users | ~25 min | 10,000 |
| `spike` | Sudden traffic spike | ~2 min | 5,000 |
| `soak` | Sustained load | 30 min | 5,000 |
| `stress` | Beyond capacity | ~8 min | 20,000 |

## Environment Variables

```bash
# Required
export API_BASE_URL=https://api.instagram-clone.com
export WS_BASE_URL=wss://api.instagram-clone.com/ws/v1

# Optional
export K6_PROJECT_ID=your-grafana-cloud-project-id
export K6_SCENARIO=ramp_up  # or spike, soak, stress, mixed
```

## Performance Targets (BE-184)

| Endpoint | p95 Latency | Error Rate | Throughput |
|----------|-------------|------------|------------|
| Feed (`/v1/posts/feed`) | < 150ms | < 0.1% | > 1000 req/s |
| API (general) | < 200ms | < 0.1% | > 5000 req/s |
| Auth | < 300ms | < 0.5% | - |
| Media Upload | < 500ms | < 1% | - |
| WebSocket | < 100ms | < 0.1% | - |

## Test Structure

```
tests/load/
├── k6-config.js              # Shared configuration, thresholds, helpers
├── master-load-test.js       # Main entry point, runs all tests
├── feed-load-test.js         # Home feed pagination
├── auth-load-test.js         # Login, register, refresh, logout
├── post-load-test.js         # Post CRUD, likes, comments, saves
├── search-load-test.js       # Unified search, typeahead, hashtags
├── websocket-load-test.js    # Real-time messaging, notifications
├── media-load-test.js        # TUS, multipart, presigned uploads
├── notification-load-test.js # Notification feed, read status
├── user-load-test.js         # Profiles, follow, social graph
├── package.json              # npm scripts
└── README.md                 # This file
```

## CI/CD Integration

Add to `.github/workflows/load-test.yml`:

```yaml
name: Load Test
on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run k6 load test
        uses: grafana/k6-action@v0.2.0
        with:
          filename: tests/load/master-load-test.js
          env: |
            API_BASE_URL=https://staging-api.instagram-clone.com
            WS_BASE_URL=wss://staging-api.instagram-clone.com/ws/v1
```

## Generating Reports

```bash
# HTML report
npm run report:html

# JSON output for custom analysis
k6 run --out json=results.json tests/load/master-load-test.js

# InfluxDB + Grafana (for historical trends)
k6 run --out influxdb=http://influxdb:8086/k6 tests/load/master-load-test.js
```

## Thresholds

Tests will fail if any threshold is exceeded:

```javascript
// From k6-config.js
thresholds: {
  'http_req_duration{type:feed}': ['p(95)<150', 'p(99)<300'],
  'http_req_duration{type:api}': ['p(95)<200', 'p(99)<400'],
  'http_req_failed{type:feed}': ['rate<0.001'],
  'http_req_failed{type:api}': ['rate<0.001'],
  // ... more thresholds
}
```

## Test Data Requirements

Before running full load tests, ensure:

1. **Test users exist** - 10,000+ users with valid tokens
2. **Test content exists** - Posts, reels, stories for feed/search
3. **Media storage configured** - S3/Neon Object Storage for uploads
4. **WebSocket server running** - At `WS_BASE_URL`

Generate test data:
```bash
# Create test users and content
npm run db:seed:loadtest
```

## Analyzing Results

Key metrics to review:

1. **Latency percentiles** - p50, p90, p95, p99, p99.9
2. **Error rates** - By endpoint and error type
3. **Throughput** - Requests/second sustained
4. **Resource utilization** - CPU, memory, DB connections
5. **WebSocket stability** - Connection drops, reconnection rate

## Troubleshooting

| Issue | Solution |
|-------|----------|
| High error rate | Check API logs, DB connection pool, rate limits |
| High latency | Check DB queries, cache hit rates, external API calls |
| WS connection drops | Check heartbeat interval, load balancer timeouts |
| OOM errors | Reduce VU count, check memory leaks in test scripts |

## Related Tasks

- BE-184: Load testing (this deliverable)
- BE-189: Performance benchmarks (uses these tests)
- BE-185: Chaos engineering (run during load)