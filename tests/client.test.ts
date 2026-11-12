import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { status } from '@grpc/grpc-js';
import { ConfigurationClient } from '../src/client';
import { createConfig } from '../src/config';
import { ConfigurationException } from '../src/exception';
import type { RpcMessage, RpcStub } from '../src/rpc';
import { AttributeType, ConfigDefinitionScope, OverrideLevel } from '../src/types';

type Handler = (request: RpcMessage, deadline: Date) => Promise<RpcMessage>;

function fakeStub(
  overrides: Partial<Record<keyof RpcStub, Handler | (() => void)>> = {},
): RpcStub & { calls: RpcMessage[] } {
  const calls: RpcMessage[] = [];
  const fail = async (): Promise<RpcMessage> => {
    throw new Error('unexpected RPC');
  };
  const wrap =
    (handler: Handler): Handler =>
    async (request, deadline) => {
      calls.push(request);
      return handler(request, deadline);
    };
  return {
    calls,
    getFeatureToggleValue: wrap((overrides.getFeatureToggleValue as Handler) ?? fail),
    getDevToggleValue: wrap((overrides.getDevToggleValue as Handler) ?? fail),
    tryGetConfigurationDetails: wrap((overrides.tryGetConfigurationDetails as Handler) ?? fail),
    getConfigurationDetails: wrap((overrides.getConfigurationDetails as Handler) ?? fail),
    getAllAccountConfigurationByNamesAndPriorities: wrap(
      (overrides.getAllAccountConfigurationByNamesAndPriorities as Handler) ?? fail,
    ),
    getAllTogglesAndConfigurations: wrap((overrides.getAllTogglesAndConfigurations as Handler) ?? fail),
    getAllTogglesAndConfigurationsByNames: wrap(
      (overrides.getAllTogglesAndConfigurationsByNames as Handler) ?? fail,
    ),
    upsertConfiguration: wrap((overrides.upsertConfiguration as Handler) ?? fail),
    deleteConfiguration: wrap((overrides.deleteConfiguration as Handler) ?? fail),
    close: (overrides.close as () => void) ?? (() => undefined),
  };
}

function client(stub: RpcStub, extra: Parameters<typeof createConfig>[0] = { host: '127.0.0.1:1' }) {
  return new ConfigurationClient(
    stub,
    createConfig({
      insecure: true,
      ...extra,
      circuitBreaker: { enabled: false, ...extra.circuitBreaker },
      retryPolicy: { maxAttempts: 1, initialBackoffMs: 1, maxBackoffMs: 1, ...extra.retryPolicy },
    }),
  );
}

function makeClient(
  stub: RpcStub,
  extra: {
    timeoutMs?: number;
    retryPolicy?: Parameters<typeof createConfig>[0]['retryPolicy'];
    circuitBreaker?: Parameters<typeof createConfig>[0]['circuitBreaker'];
  } = {},
) {
  return new ConfigurationClient(
    stub,
    createConfig({
      host: '127.0.0.1:1',
      insecure: true,
      timeoutMs: extra.timeoutMs ?? 5000,
      retryPolicy: { maxAttempts: 1, initialBackoffMs: 1, maxBackoffMs: 1, ...extra.retryPolicy },
      circuitBreaker: { enabled: false, consecutiveFailures: 2, breakDurationMs: 30_000, ...extra.circuitBreaker },
    }),
  );
}

function grpcError(code: number, message = 'boom'): never {
  throw new ConfigurationException(`gRPC ${code}: ${message}`, code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rejectUnavailable(run: () => Promise<unknown>, message?: RegExp) {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof ConfigurationException);
    assert.equal(err.code, status.UNAVAILABLE);
    if (message) {
      assert.match(err.message, message);
    }
    return true;
  });
}

describe('ConfigurationClient requests', () => {
  it('sends name, account, and server scope by default', async () => {
    const stub = fakeStub({
      getFeatureToggleValue: async () => ({ value: true }),
    });
    await client(stub).isFeatureEnabled('is_memo_enabled', 10018);
    const request = stub.calls[0];
    assert.equal(request.name, 'is_memo_enabled');
    assert.deepEqual(request.condition, {
      accountId: { value: 10018 },
      configDefinitionScope: ConfigDefinitionScope.Server,
    });
  });

  it('sends optional ids when passed', async () => {
    const stub = fakeStub({
      getFeatureToggleValue: async () => ({ value: false }),
    });
    await client(stub).isFeatureEnabled('flag', 1, {
      userId: 2,
      locationId: 3,
      locationGroupId: 4,
      attributeArea: 5,
      configDefinitionScope: ConfigDefinitionScope.Client,
    });
    assert.deepEqual(stub.calls[0].condition, {
      accountId: { value: 1 },
      configDefinitionScope: ConfigDefinitionScope.Client,
      userId: { value: 2 },
      locationId: { value: 3 },
      locationGroupId: { value: 4 },
      attributeArea: { value: 5 },
    });
  });

  it('asks for named keys through GetAllTogglesAndConfigurationsByNames', async () => {
    const stub = fakeStub({
      getAllTogglesAndConfigurationsByNames: async () => ({ toggles: {}, configurations: {} }),
    });
    await client(stub).getAll(10018, ['is_memo_enabled', 'dni_regex']);
    assert.deepEqual(stub.calls[0].names, ['is_memo_enabled', 'dni_regex']);
  });
});

describe('ConfigurationClient codec via RPC', () => {
  it('encodes upsert by JS type', async () => {
    let sent: RpcMessage | undefined;
    const stub = fakeStub({
      upsertConfiguration: async (request) => {
        sent = request.typeValuePair as RpcMessage;
        return {};
      },
    });
    await client(stub).upsert('flag', 1, true, 9);
    assert.equal(sent?.type, AttributeType.Boolean);
    assert.deepEqual(sent?.value, { value: 'true' });
  });

  it('decodes tryGet by attribute type', async () => {
    const stub = fakeStub({
      tryGetConfigurationDetails: async () => ({
        configurationDetails: {
          typeValuePair: { type: AttributeType.String, value: { value: '"hello"' } },
        },
      }),
    });
    assert.equal(await client(stub).tryGet('flag', 1), 'hello');
  });

  it('returns null when tryGet matches nothing', async () => {
    const stub = fakeStub({
      tryGetConfigurationDetails: async () => ({}),
    });
    assert.equal(await client(stub).tryGet('missing', 1), null);
  });

  it('maps getAll toggles and configurations', async () => {
    const stub = fakeStub({
      getAllTogglesAndConfigurations: async () => ({
        toggles: { is_memo_enabled: true, is_fax_enabled: false },
        configurations: {
          dni_regex: { type: AttributeType.String, value: { value: '"^\\\\+1"' } },
          max_agents: { type: AttributeType.Number, value: { value: '25' } },
        },
      }),
    });
    const set = await client(stub).getAll(10018);
    assert.deepEqual(set.toggles, { is_memo_enabled: true, is_fax_enabled: false });
    assert.equal(set.configurations.dni_regex, '^\\+1');
    assert.equal(set.configurations.max_agents, 25);
  });
});

describe('ConfigurationClient retry', () => {
  it('does not retry a first-attempt success', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempt += 1;
        return { value: true };
      },
    });
    assert.equal(await makeClient(stub, { retryPolicy: { maxAttempts: 3 } }).isFeatureEnabled('flag', 1), true);
    assert.equal(attempt, 1);
  });

  it('does not retry a successful false toggle', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempt += 1;
        return { value: false };
      },
    });
    assert.equal(await makeClient(stub, { retryPolicy: { maxAttempts: 3 } }).isFeatureEnabled('flag', 1), false);
    assert.equal(attempt, 1);
  });

  it('retries UNAVAILABLE until success', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempt += 1;
        if (attempt < 3) {
          grpcError(status.UNAVAILABLE);
        }
        return { value: true };
      },
    });
    const c = makeClient(stub, { retryPolicy: { maxAttempts: 3 } });
    assert.equal(await c.isFeatureEnabled('flag', 1), true);
    assert.equal(attempt, 3);
  });

  it('retries INTERNAL until success', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempt += 1;
        if (attempt < 2) {
          grpcError(status.INTERNAL);
        }
        return { value: true };
      },
    });
    assert.equal(await makeClient(stub, { retryPolicy: { maxAttempts: 3 } }).isFeatureEnabled('flag', 1), true);
    assert.equal(attempt, 2);
  });

  it('retries UNKNOWN until the budget is spent', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempt += 1;
        grpcError(status.UNKNOWN, 'missing');
      },
    });
    const c = makeClient(stub, { retryPolicy: { maxAttempts: 5 } });
    await assert.rejects(() => c.isFeatureEnabled('flag', 1), (err: unknown) => {
      assert.ok(err instanceof ConfigurationException);
      assert.equal(err.code, status.UNKNOWN);
      assert.match(err.message, /attempt 5 of 5/);
      return true;
    });
    assert.equal(attempt, 5);
  });

  it('does not retry INVALID_ARGUMENT, NOT_FOUND, or DEADLINE_EXCEEDED', async () => {
    for (const code of [status.INVALID_ARGUMENT, status.NOT_FOUND, status.DEADLINE_EXCEEDED]) {
      let attempt = 0;
      const stub = fakeStub({
        getFeatureToggleValue: async () => {
          attempt += 1;
          grpcError(code);
        },
      });
      const c = makeClient(stub, { retryPolicy: { maxAttempts: 5 } });
      await assert.rejects(() => c.isFeatureEnabled('flag', 1), (err: unknown) => {
        assert.ok(err instanceof ConfigurationException);
        assert.equal(err.code, code);
        assert.match(err.message, /attempt 1 of 5/);
        return true;
      });
      assert.equal(attempt, 1, `status ${code} should not retry`);
    }
  });

  it('does not sleep when maxAttempts is 1', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempt += 1;
        grpcError(status.UNAVAILABLE);
      },
    });
    const started = Date.now();
    const c = makeClient(stub, { retryPolicy: { maxAttempts: 1, initialBackoffMs: 200, maxBackoffMs: 200 } });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /attempt 1 of 1/);
    assert.equal(attempt, 1);
    assert.ok(Date.now() - started < 100);
  });

  it('does not start a retry that would pass the deadline', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempt += 1;
        grpcError(status.UNAVAILABLE);
      },
    });
    const c = makeClient(stub, {
      timeoutMs: 20,
      retryPolicy: { maxAttempts: 5, initialBackoffMs: 100, maxBackoffMs: 100 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /attempt 1 of 5/);
    assert.equal(attempt, 1);
  });

  it('gives each retry only the time left on the call deadline', async () => {
    const remainingMs: number[] = [];
    const stub = fakeStub({
      getFeatureToggleValue: async (_request, deadline) => {
        remainingMs.push(deadline.getTime() - Date.now());
        if (remainingMs.length < 3) {
          await sleep(20);
          grpcError(status.UNAVAILABLE);
        }
        return { value: true };
      },
    });
    await makeClient(stub, {
      timeoutMs: 2000,
      retryPolicy: { maxAttempts: 3 },
    }).isFeatureEnabled('flag', 1);
    assert.equal(remainingMs.length, 3);
    assert.ok(remainingMs[1]! < remainingMs[0]!);
    assert.ok(remainingMs[2]! < remainingMs[1]!);
  });

  it('retries getConfigurationDetails UNKNOWN then throws', async () => {
    let attempt = 0;
    const stub = fakeStub({
      getConfigurationDetails: async () => {
        attempt += 1;
        grpcError(status.UNKNOWN, 'missing');
      },
    });
    const c = makeClient(stub, { retryPolicy: { maxAttempts: 3 } });
    await assert.rejects(() => c.getConfigurationDetails('flag', 1), (err: unknown) => {
      assert.ok(err instanceof ConfigurationException);
      assert.equal(err.code, status.UNKNOWN);
      assert.match(err.message, /attempt 3 of 3/);
      return true;
    });
    assert.equal(attempt, 3);
  });
});

describe('ConfigurationClient circuit breaker', () => {
  it('fails fast after consecutive UNAVAILABLE calls', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        grpcError(status.UNAVAILABLE, 'down');
      },
    });
    const c = makeClient(stub, {
      circuitBreaker: { enabled: true, consecutiveFailures: 2, breakDurationMs: 30_000 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /circuit breaker open/);
    assert.equal(attempts, 2);
  });

  it('does not return false while open', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        grpcError(status.UNAVAILABLE, 'down');
      },
    });
    const c = makeClient(stub, {
      circuitBreaker: { enabled: true, consecutiveFailures: 1, breakDurationMs: 30_000 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    const result = c.isFeatureEnabled('flag', 1);
    await rejectUnavailable(() => result, /circuit breaker open/);
    assert.equal(attempts, 1);
  });

  it('does not count INTERNAL, UNKNOWN, or INVALID_ARGUMENT toward the breaker', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        const code =
          attempts === 1 ? status.INTERNAL : attempts === 2 ? status.UNKNOWN : status.INVALID_ARGUMENT;
        grpcError(code);
      },
    });
    const c = makeClient(stub, {
      circuitBreaker: { enabled: true, consecutiveFailures: 1, breakDurationMs: 30_000 },
    });
    await assert.rejects(() => c.isFeatureEnabled('flag', 1));
    await assert.rejects(() => c.isFeatureEnabled('flag', 1));
    await assert.rejects(() => c.isFeatureEnabled('flag', 1));
    assert.equal(attempts, 3);
  });

  it('resets consecutive UNAVAILABLE after a success', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        if (attempts === 2) {
          return { value: true };
        }
        grpcError(status.UNAVAILABLE, 'down');
      },
    });
    const c = makeClient(stub, {
      circuitBreaker: { enabled: true, consecutiveFailures: 2, breakDurationMs: 30_000 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    assert.equal(await c.isFeatureEnabled('flag', 1), true);
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /circuit breaker open/);
    assert.equal(attempts, 4);
  });

  it('does not fail fast when disabled', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        grpcError(status.UNAVAILABLE, 'down');
      },
    });
    const c = makeClient(stub, {
      circuitBreaker: { enabled: false, consecutiveFailures: 1 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    assert.equal(attempts, 3);
  });

  it('closes after a successful half-open probe', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        if (attempts === 1) {
          grpcError(status.UNAVAILABLE, 'down');
        }
        return { value: true };
      },
    });
    const c = makeClient(stub, {
      circuitBreaker: { enabled: true, consecutiveFailures: 1, breakDurationMs: 50 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /circuit breaker open/);
    await sleep(80);
    assert.equal(await c.isFeatureEnabled('flag', 1), true);
    assert.equal(await c.isFeatureEnabled('flag', 1), true);
    assert.equal(attempts, 3);
  });

  it('re-opens when the half-open probe is UNAVAILABLE', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        grpcError(status.UNAVAILABLE, 'down');
      },
    });
    const c = makeClient(stub, {
      circuitBreaker: { enabled: true, consecutiveFailures: 1, breakDurationMs: 50 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await sleep(80);
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /circuit breaker open/);
    assert.equal(attempts, 2);
  });
});

describe('ConfigurationClient retry and breaker together', () => {
  it('counts one breaker failure per call, not per retry attempt', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        grpcError(status.UNAVAILABLE, 'down');
      },
    });
    const c = makeClient(stub, {
      retryPolicy: { maxAttempts: 3 },
      circuitBreaker: { enabled: true, consecutiveFailures: 2, breakDurationMs: 30_000 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /attempt 3 of 3/);
    assert.equal(attempts, 3);
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /attempt 3 of 3/);
    assert.equal(attempts, 6);
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /circuit breaker open/);
    assert.equal(attempts, 6);
  });

  it('does not start the retry loop while open', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        grpcError(status.UNAVAILABLE, 'down');
      },
    });
    const c = makeClient(stub, {
      retryPolicy: { maxAttempts: 3 },
      circuitBreaker: { enabled: true, consecutiveFailures: 1, breakDurationMs: 30_000 },
    });
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1));
    assert.equal(attempts, 3);
    await rejectUnavailable(() => c.isFeatureEnabled('flag', 1), /circuit breaker open/);
    assert.equal(attempts, 3);
  });

  it('does not count a call that succeeds after retries', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        if (attempts < 3) {
          grpcError(status.UNAVAILABLE, 'down');
        }
        return { value: true };
      },
    });
    const c = makeClient(stub, {
      retryPolicy: { maxAttempts: 3 },
      circuitBreaker: { enabled: true, consecutiveFailures: 1, breakDurationMs: 30_000 },
    });
    assert.equal(await c.isFeatureEnabled('flag', 1), true);
    assert.equal(attempts, 3);
    assert.equal(await c.isFeatureEnabled('flag', 1), true);
    assert.equal(attempts, 4);
  });

  it('does not open on INTERNAL after retries', async () => {
    let attempts = 0;
    const stub = fakeStub({
      getFeatureToggleValue: async () => {
        attempts += 1;
        grpcError(status.INTERNAL);
      },
    });
    const c = makeClient(stub, {
      retryPolicy: { maxAttempts: 3 },
      circuitBreaker: { enabled: true, consecutiveFailures: 1, breakDurationMs: 30_000 },
    });
    await assert.rejects(() => c.isFeatureEnabled('flag', 1), (err: unknown) => {
      assert.ok(err instanceof ConfigurationException);
      assert.equal(err.code, status.INTERNAL);
      return true;
    });
    await assert.rejects(() => c.isFeatureEnabled('flag', 1), (err: unknown) => {
      assert.ok(err instanceof ConfigurationException);
      assert.equal(err.code, status.INTERNAL);
      assert.doesNotMatch(err.message, /circuit breaker open/);
      return true;
    });
    assert.equal(attempts, 6);
  });
});

describe('getConfigurationDetails', () => {
  it('maps every field', async () => {
    const stub = fakeStub({
      getConfigurationDetails: async () => ({
        name: 'is_audio_download_enabled',
        priority: OverrideLevel.User,
        type: AttributeType.Boolean,
        typeValuePair: { type: AttributeType.Boolean, value: { value: 'true' } },
        accountId: { value: 10018 },
        userId: { value: 7 },
        locationGroupId: { value: 4 },
        locationId: { value: 3 },
      }),
    });
    assert.deepEqual(await client(stub).getConfigurationDetails('is_audio_download_enabled', 10018, { userId: 7 }), {
      name: 'is_audio_download_enabled',
      priority: OverrideLevel.User,
      type: AttributeType.Boolean,
      value: true,
      accountId: 10018,
      userId: 7,
      locationGroupId: 4,
      locationId: 3,
    });
  });
});
