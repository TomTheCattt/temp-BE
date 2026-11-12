/**
 * Chaos Engineering Configuration
 * Instagram Clone Backend - Phase 12 Production Hardening (BE-185)
 *
 * Scenarios:
 * 1. Neon branch failover
 * 2. Database connection pool exhaustion
 * 3. Latency injection
 * 4. Network partition
 * 5. Dependency failure (S3, Auth, etc.)
 * 6. Resource exhaustion (CPU, Memory)
 */

export const chaosConfig = {
  // Target environment
  environment: __ENV.CHAOS_ENV || 'staging',

  // Base URLs
  apiBaseUrl: __ENV.API_BASE_URL || 'https://api.instagram-clone.com',
  wsBaseUrl: __ENV.WS_BASE_URL || 'wss://api.instagram-clone.com/ws/v1',

  // Chaos experiment duration
  experimentDuration: parseInt(__ENV.CHAOS_DURATION) || 300, // 5 minutes default

  // Steady state hypothesis
  steadyState: {
    apiErrorRate: 0.001,      // < 0.1%
    apiP95Latency: 200,       // < 200ms
    wsConnectionDropRate: 0.01, // < 1%
    dbConnectionUsage: 0.8,   // < 80%
  },

  // Experiment scenarios
  scenarios: {
    // 1. Neon Branch Failover
    neonBranchFailover: {
      name: 'Neon Branch Failover',
      description: 'Simulate primary Neon branch failure and verify failover to read replica',
      type: 'infrastructure',
      severity: 'critical',
      duration: 120, // 2 minutes
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'failover_primary_branch', target: 'primary' },
        { action: 'measure_impact', duration: 60 },
        { action: 'restore_primary_branch', target: 'primary' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'API remains available with < 5s failover time, < 1% error rate during failover',
    },

    // 2. Database Connection Pool Exhaustion
    dbPoolExhaustion: {
      name: 'Database Connection Pool Exhaustion',
      description: 'Exhaust database connection pool and verify graceful degradation',
      type: 'resource',
      severity: 'high',
      duration: 180, // 3 minutes
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'exhaust_connection_pool', target: 'postgres', percentage: 95 },
        { action: 'measure_impact', duration: 90 },
        { action: 'release_connections', target: 'postgres' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Queue requests when pool exhausted, return 503 with retry-after, recover within 10s',
    },

    // 3. Latency Injection - API
    apiLatencyInjection: {
      name: 'API Latency Injection',
      description: 'Inject latency into API responses to test timeout and retry behavior',
      type: 'network',
      severity: 'medium',
      duration: 120,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'inject_latency', target: 'api', latency: 5000, jitter: 1000 }, // 5s ± 1s
        { action: 'measure_impact', duration: 60 },
        { action: 'remove_latency', target: 'api' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Client timeouts trigger retries, circuit breakers activate, no cascade failures',
    },

    // 4. Latency Injection - Database
    dbLatencyInjection: {
      name: 'Database Latency Injection',
      description: 'Inject latency into database queries',
      type: 'network',
      severity: 'high',
      duration: 120,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'inject_latency', target: 'database', latency: 2000, jitter: 500 },
        { action: 'measure_impact', duration: 60 },
        { action: 'remove_latency', target: 'database' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Query timeouts handled gracefully, connection pool not exhausted, fallback to cache',
    },

    // 5. Network Partition
    networkPartition: {
      name: 'Network Partition',
      description: 'Simulate network partition between services',
      type: 'network',
      severity: 'critical',
      duration: 180,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'partition_network', target: 'websocket', percentage: 50 },
        { action: 'measure_impact', duration: 90 },
        { action: 'heal_network', target: 'websocket' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'WebSocket clients reconnect automatically, message queue buffers during partition',
    },

    // 6. S3/Object Storage Failure
    s3Failure: {
      name: 'Object Storage Failure',
      description: 'Simulate S3/Neon Object Storage unavailability',
      type: 'dependency',
      severity: 'high',
      duration: 120,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'block_dependency', target: 's3' },
        { action: 'measure_impact', duration: 60 },
        { action: 'unblock_dependency', target: 's3' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Upload endpoints return 503, presigned URLs fail gracefully, retry queue persists',
    },

    // 7. Auth Service Failure
    authFailure: {
      name: 'Authentication Service Failure',
      description: 'Simulate Better Auth / Neon Auth unavailability',
      type: 'dependency',
      severity: 'critical',
      duration: 120,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'block_dependency', target: 'auth' },
        { action: 'measure_impact', duration: 60 },
        { action: 'unblock_dependency', target: 'auth' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Valid JWTs still work (stateless), token refresh fails gracefully, cached sessions survive',
    },

    // 8. Redis/Rate Limit Store Failure
    redisFailure: {
      name: 'Rate Limit Store Failure',
      description: 'Simulate Redis/Upstash unavailability for rate limiting',
      type: 'dependency',
      severity: 'medium',
      duration: 120,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'block_dependency', target: 'redis' },
        { action: 'measure_impact', duration: 60 },
        { action: 'unblock_dependency', target: 'redis' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Local in-memory fallback activates, rate limiting degrades gracefully',
    },

    // 9. CPU Exhaustion
    cpuExhaustion: {
      name: 'CPU Exhaustion',
      description: 'Exhaust CPU resources on API servers',
      type: 'resource',
      severity: 'high',
      duration: 180,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'stress_cpu', target: 'api', percentage: 90 },
        { action: 'measure_impact', duration: 90 },
        { action: 'relieve_cpu', target: 'api' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Auto-scaling triggers, request queue builds, priority requests served first',
    },

    // 10. Memory Exhaustion
    memoryExhaustion: {
      name: 'Memory Exhaustion',
      description: 'Exhaust memory on API servers',
      type: 'resource',
      severity: 'critical',
      duration: 180,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'stress_memory', target: 'api', percentage: 85 },
        { action: 'measure_impact', duration: 90 },
        { action: 'relieve_memory', target: 'api' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'OOM killer triggers gracefully, health checks fail, traffic routed to healthy instances',
    },

    // 11. WebSocket Storm
    wsStorm: {
      name: 'WebSocket Connection Storm',
      description: 'Simulate massive WebSocket reconnection storm',
      type: 'load',
      severity: 'high',
      duration: 120,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'ws_reconnect_storm', target: 'websocket', connections: 50000 },
        { action: 'measure_impact', duration: 60 },
        { action: 'stop_storm', target: 'websocket' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Connection manager handles storm, exponential backoff prevents thundering herd',
    },

    // 12. Cache Stampede
    cacheStampede: {
      name: 'Cache Stampede',
      description: 'Simulate cache expiration causing thundering herd on database',
      type: 'load',
      severity: 'high',
      duration: 120,
      steps: [
        { action: 'measure_baseline', duration: 30 },
        { action: 'invalidate_cache', target: 'feed_cache', pattern: 'mass' },
        { action: 'measure_impact', duration: 60 },
        { action: 'warm_cache', target: 'feed_cache' },
        { action: 'measure_recovery', duration: 30 },
      ],
      rollback: 'automatic',
      hypothesis: 'Cache locks prevent stampede, single request regenerates cache, others wait',
    },
  },

  // Safety controls
  safety: {
    maxExperimentDuration: 600, // 10 minutes max
    abortOnErrorRate: 0.05,     // Abort if error rate > 5%
    abortOnLatencyP99: 10000,   // Abort if p99 > 10s
    requireApproval: ['critical', 'high'],
    notifyChannels: ['#incidents', '#oncall'],
  },

  // Observability
  observability: {
    metricsEndpoint: __ENV.METRICS_ENDPOINT || 'http://prometheus:9090',
    logsEndpoint: __ENV.LOGS_ENDPOINT || 'http://loki:3100',
    tracesEndpoint: __ENV.TRACES_ENDPOINT || 'http://tempo:3200',
    dashboards: [
      'chaos-experiment-overview',
      'api-health',
      'database-health',
      'websocket-health',
    ],
  },
};

export default chaosConfig;