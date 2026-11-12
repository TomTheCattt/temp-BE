/**
 * Master Chaos Engineering Runner
 * Orchestrates all chaos experiments for Phase 12 (BE-185)
 * Run with: k6 run tests/chaos/master-chaos.js
 */

import { chaosConfig } from './chaos-config.js';

export const options = {
  // This is a meta-runner - actual experiments run separately
  scenarios: {
    list_experiments: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '10s',
    },
  },
  thresholds: {},
};

const EXPERIMENTS = Object.entries(chaosConfig.scenarios).map(([key, exp]) => ({
  id: key,
  name: exp.name,
  description: exp.description,
  type: exp.type,
  severity: exp.severity,
  duration: exp.duration,
  hypothesis: exp.hypothesis,
}));

export default function () {
  console.log('=== Instagram Clone Chaos Engineering Experiments ===');
  console.log('');
  console.log('Available Experiments:');
  console.log('');

  EXPERIMENTS.forEach((exp, i) => {
    console.log(`${i + 1}. ${exp.name} (${exp.severity.toUpperCase()})`);
    console.log(`   ID: ${exp.id}`);
    console.log(`   Type: ${exp.type}`);
    console.log(`   Duration: ${exp.duration}s`);
    console.log(`   Hypothesis: ${exp.hypothesis}`);
    console.log('');
  });

  console.log('=== Run Commands ===');
  console.log('');
  console.log('Individual experiments:');
  console.log('  k6 run tests/chaos/neon-branch-failover.js');
  console.log('  k6 run tests/chaos/db-pool-exhaustion.js');
  console.log('  k6 run tests/chaos/latency-injection.js --env CHAOS_TARGET=api');
  console.log('  k6 run tests/chaos/latency-injection.js --env CHAOS_TARGET=db');
  console.log('  k6 run tests/chaos/ws-network-partition.js');
  console.log('  k6 run tests/chaos/dependency-failure.js --env CHAOS_DEPENDENCY=s3');
  console.log('  k6 run tests/chaos/dependency-failure.js --env CHAOS_DEPENDENCY=auth');
  console.log('  k6 run tests/chaos/dependency-failure.js --env CHAOS_DEPENDENCY=redis');
  console.log('  k6 run tests/chaos/resource-exhaustion.js --env CHAOS_RESOURCE=cpu');
  console.log('  k6 run tests/chaos/resource-exhaustion.js --env CHAOS_RESOURCE=memory');
  console.log('');
  console.log('=== Required Environment Variables ===');
  console.log('  API_BASE_URL=https://api.instagram-clone.com');
  console.log('  WS_BASE_URL=wss://api.instagram-clone.com/ws/v1');
  console.log('  TEST_TOKEN=your-test-jwt-token');
  console.log('  CHAOS_ENV=staging');
  console.log('');
  console.log('=== Safety Controls ===');
  console.log(`  Max experiment duration: ${chaosConfig.safety.maxExperimentDuration}s`);
  console.log(`  Abort on error rate: ${chaosConfig.safety.abortOnErrorRate * 100}%`);
  console.log(`  Abort on p99 latency: ${chaosConfig.safety.abortOnLatencyP99}ms`);
  console.log(`  Approval required for: ${chaosConfig.safety.requireApproval.join(', ')}`);
  console.log('');
  console.log('=== Observability ===');
  console.log(`  Metrics: ${chaosConfig.observability.metricsEndpoint}`);
  console.log(`  Logs: ${chaosConfig.observability.logsEndpoint}`);
  console.log(`  Traces: ${chaosConfig.observability.tracesEndpoint}`);
  console.log(`  Dashboards: ${chaosConfig.observability.dashboards.join(', ')}`);
}

export function teardown() {
  console.log('');
  console.log('=== Experiment Complete ===');
  console.log('Review results in Grafana dashboards and incident channels');
}