/**
 * POC: cockatiel circuit breaker matches csiq-config-node production wiring.
 *
 *   npm run poc:circuit-breaker
 *
 * Fast demo (3 failures, 2s open):
 *   POC_FAILURES=3 POC_BREAK_MS=2000 npm run poc:circuit-breaker
 *
 * Uses compiled output in dist/ (npm run build).
 */

const { status } = require('@grpc/grpc-js');
const { BrokenCircuitError } = require('cockatiel');
const { createCircuitBreaker } = require('../dist/circuit-breaker');
const { ConfigurationException } = require('../dist/exception');

const consecutiveFailures = intEnv('POC_FAILURES', 10);
const breakDurationMs = intEnv('POC_BREAK_MS', 3_000);
const waitForHalfOpenMs = intEnv('POC_WAIT_MS', breakDurationMs + 200);

function intEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${key} must be a positive integer, got "${raw}"`);
  }
  return n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unavailable() {
  throw new ConfigurationException('gRPC 14: simulated UNAVAILABLE', status.UNAVAILABLE);
}

async function main() {
  console.log('--- cockatiel POC (createCircuitBreaker) ---');
  console.log(`consecutiveFailures: ${consecutiveFailures}, halfOpenAfter: ${breakDurationMs}ms\n`);

  const breaker = createCircuitBreaker({
    enabled: true,
    consecutiveFailures,
    breakDurationMs,
  });
  if (!breaker) {
    throw new Error('breaker disabled');
  }

  let innerInvocations = 0;

  async function simulateRpc(outcome) {
    return breaker.execute(async () => {
      innerInvocations += 1;
      if (outcome === 'fail') {
        unavailable();
      }
      return 'ok';
    });
  }

  async function runCall(label, outcome) {
    const before = innerInvocations;
    try {
      const result = await simulateRpc(outcome);
      console.log(`  ${label}: success -> ${result} (inner: ${innerInvocations - before})`);
    } catch (err) {
      if (err instanceof BrokenCircuitError) {
        console.log(`  ${label}: BrokenCircuitError — open (inner: ${innerInvocations - before})`);
        return;
      }
      if (err instanceof ConfigurationException) {
        console.log(`  ${label}: ConfigurationException code=${err.code} (inner: ${innerInvocations - before})`);
        return;
      }
      throw err;
    }
  }

  console.log(`Phase 1: ${consecutiveFailures} consecutive UNAVAILABLE`);
  for (let i = 1; i <= consecutiveFailures; i++) {
    await runCall(`fail ${i}/${consecutiveFailures}`, 'fail');
  }

  console.log('\nPhase 2: while open (inner must not run)');
  const innerBefore = innerInvocations;
  await runCall('while open', 'fail');
  if (innerInvocations !== innerBefore) {
    console.error('FAIL: inner ran while open');
    process.exitCode = 1;
    return;
  }
  console.log('  OK: fail-fast');

  console.log(`\nPhase 3: wait ${waitForHalfOpenMs}ms, then success`);
  await sleep(waitForHalfOpenMs);
  await runCall('probe ok', 'ok');

  console.log('\nPhase 4: one failure after close');
  await runCall('fail after close', 'fail');
  console.log(`\nDone. inner invocations: ${innerInvocations}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
