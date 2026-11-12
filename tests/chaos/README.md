# Instagram Clone Backend - Chaos Engineering Tests

Chaos engineering experiments for Phase 12 Production Hardening (BE-185).

## Quick Start

```bash
# Install k6
brew install k6  # macOS

# List all available experiments
npm run chaos:list

# Run specific experiment
npm run chaos:neon-failover
npm run chaos:db-pool
npm run chaos:api-latency
npm run chaos:ws-partition
npm run chaos:s3-failure
npm run chaos:auth-failure
npm run chaos:cpu-stress
npm run chaos:memory-stress
```

## Experiments

| Experiment | Type | Severity | Description |
|------------|------|----------|-------------|
| Neon Branch Failover | Infrastructure | Critical | Primary DB branch failure → read replica failover |
| DB Pool Exhaustion | Resource | High | Connection pool exhaustion → graceful queue/reject |
| API Latency Injection | Network | Medium | 5s latency → timeout/retry/circuit breaker |
| DB Latency Injection | Network | High | 2s query latency → timeout handling |
| WebSocket Partition | Network | Critical | 50% connections dropped → reconnection/buffering |
| S3 Failure | Dependency | High | Object storage down → upload degradation |
| Auth Failure | Dependency | Critical | Auth service down → JWT validation, refresh failure |
| Redis Failure | Dependency | Medium | Rate limit store down → in-memory fallback |
| CPU Exhaustion | Resource | High | 90% CPU → auto-scaling, priority scheduling |
| Memory Exhaustion | Resource | Critical | 85% memory → OOM handling, health check failure |

## Environment Variables

```bash
# Required
export API_BASE_URL=https://staging-api.instagram-clone.com
export WS_BASE_URL=wss://staging-api.instagram-clone.com/ws/v1
export TEST_TOKEN=eyJhbGciOiJ...  # Valid JWT for test user

# Optional
export CHAOS_ENV=staging
export CHAOS_DURATION=300
export CHAOS_TARGET=api  # for latency-injection: api or db
export CHAOS_DEPENDENCY=s3  # for dependency-failure: s3, auth, redis
export CHAOS_RESOURCE=cpu  # for resource-exhaustion: cpu, memory
```

## Safety Controls

Experiments include automatic safety controls:

- **Max duration**: 10 minutes per experiment
- **Abort on error rate**: > 5% error rate
- **Abort on latency**: p99 > 10 seconds
- **Approval required**: Critical and High severity experiments
- **Notifications**: Sent to `#incidents` and `#oncall` Slack channels

## Running in CI/CD

```yaml
# .github/workflows/chaos-engineering.yml
name: Chaos Engineering
on:
  schedule:
    - cron: '0 3 * * 1'  # Weekly Monday 3 AM
  workflow_dispatch:
    inputs:
      experiment:
        type: choice
        options: [neon-failover, db-pool, api-latency, ws-partition, s3-failure, auth-failure, cpu-stress]
        required: true

jobs:
  chaos:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Run chaos experiment
        uses: grafana/k6-action@v0.2.0
        with:
          filename: tests/chaos/${{ github.event.inputs.experiment }}.js
          env: |
            API_BASE_URL=https://staging-api.instagram-clone.com
            WS_BASE_URL=wss://staging-api.instagram-clone.com/ws/v1
            TEST_TOKEN=${{ secrets.CHAOS_TEST_TOKEN }}
            CHAOS_ENV=staging
```

## Hypothesis Validation

Each experiment validates a specific hypothesis:

| Experiment | Hypothesis | Success Criteria |
|------------|------------|------------------|
| Neon Failover | Failover < 5s, < 1% errors | p99 recovery < 5s, error rate < 0.01 during failover |
| DB Pool | Queue with 503 + Retry-After | No 500s, recovery < 10s after pool release |
| API Latency | Circuit breaker activates | Timeouts handled, retries with backoff, no cascade |
| WS Partition | Auto-reconnect, message buffer | Reconnection < 5s, message loss < 10% |
| S3 Failure | Graceful 503 degradation | Upload endpoints return 503, presigned URLs fail |
| Auth Failure | Valid JWTs work, refresh fails | API accessible with valid token, refresh returns 401 |
| CPU Stress | Auto-scale triggers | New instances spawn, queue builds, priority served |

## Observability

Monitor experiments in real-time:

- **Grafana Dashboards**: `chaos-experiment-overview`, `api-health`, `database-health`, `websocket-health`
- **Prometheus Metrics**: Custom metrics prefixed with `chaos_`
- **Loki Logs**: Filter by `experiment="<name>"`
- **Tempo Traces**: Distributed traces during experiments

## Post-Experiment Analysis

After each experiment:

1. **Review metrics** in Grafana
2. **Check error budgets** - did we stay within SLO?
3. **Analyze traces** for cascade failures
4. **Update runbooks** with findings
5. **File issues** for any hypothesis violations

## Related Tasks

- BE-185: Chaos engineering (this deliverable)
- BE-184: Load testing (run chaos during load)
- BE-188: Disaster recovery (chaos validates DR)
- BE-212: Runbook (chaos informs incident response)