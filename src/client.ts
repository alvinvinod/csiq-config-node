import { status } from '@grpc/grpc-js';
import { BrokenCircuitError, type CircuitBreakerPolicy } from 'cockatiel';
import type { IConfigurationClient } from './client-interface';
import { decode, encode } from './codec';
import type { ConfigurationClientConfig } from './config';
import { ConfigurationException } from './exception';
import { createCircuitBreaker } from './circuit-breaker';
import { conditionRequest, int32, namedRequest, unwrapInt, type RpcMessage, type RpcStub } from './rpc';
import { isRetryable, jitterMs, sleep } from './retry';
import type { ConditionOptions, ConfigurationDetails, Logger, ToggleSet } from './types';

/**
 * Unary gRPC client. Method contracts are on IConfigurationClient.
 *
 * The circuit breaker wraps the whole retry loop: an open breaker throws
 * ConfigurationException (UNAVAILABLE) and does not return a default or cached flag.
 */
export class ConfigurationClient implements IConfigurationClient {
  private readonly breaker: CircuitBreakerPolicy | null;

  constructor(
    private readonly rpc: RpcStub,
    private readonly config: ConfigurationClientConfig,
    private readonly logger: Logger | null = null,
  ) {
    this.breaker = createCircuitBreaker(config.circuitBreaker);
  }

  isFeatureEnabled(name: string, casTenantId: number, options?: ConditionOptions): Promise<boolean> {
    return this.call((deadline) =>
      this.rpc.getFeatureToggleValue(namedRequest(name, casTenantId, options), deadline),
    ).then((response) => Boolean(response.value));
  }

  isDevToggleEnabled(name: string, casTenantId: number, options?: ConditionOptions): Promise<boolean> {
    return this.call((deadline) =>
      this.rpc.getDevToggleValue(namedRequest(name, casTenantId, options), deadline),
    ).then((response) => Boolean(response.value));
  }

  async tryGet(name: string, casTenantId: number, options?: ConditionOptions): Promise<unknown> {
    const response = await this.call((deadline) =>
      this.rpc.tryGetConfigurationDetails(namedRequest(name, casTenantId, options), deadline),
    );
    const details = response.configurationDetails as RpcMessage | undefined;
    if (!details) {
      return null;
    }
    const pair = details.typeValuePair as RpcMessage | undefined;
    if (!pair) {
      return null;
    }
    return decodePair(pair, name);
  }

  async getConfigurationDetails(
    name: string,
    casTenantId: number,
    options?: ConditionOptions,
  ): Promise<ConfigurationDetails> {
    const response = await this.call((deadline) =>
      this.rpc.getConfigurationDetails(namedRequest(name, casTenantId, options), deadline),
    );
    return toDetails(response);
  }

  async getAllAccountConfigurations(
    name: string,
    casTenantId: number,
    overrideLevels: number[],
    options?: ConditionOptions,
  ): Promise<ConfigurationDetails[]> {
    const response = await this.call((deadline) =>
      this.rpc.getAllAccountConfigurationByNamesAndPriorities(
        {
          name,
          condition: conditionRequest(casTenantId, options),
          priorities: overrideLevels,
        },
        deadline,
      ),
    );
    const items = (response.items as RpcMessage[] | undefined) ?? [];
    return items.map(toDetails);
  }

  async getAll(casTenantId: number, names: string[] = [], options?: ConditionOptions): Promise<ToggleSet> {
    const condition = conditionRequest(casTenantId, options);
    const response =
      names.length === 0
        ? await this.call((deadline) => this.rpc.getAllTogglesAndConfigurations(condition, deadline))
        : await this.call((deadline) =>
            this.rpc.getAllTogglesAndConfigurationsByNames({ names, condition }, deadline),
          );

    const toggles: Record<string, boolean> = {};
    for (const [key, value] of Object.entries((response.toggles as Record<string, boolean>) ?? {})) {
      toggles[key] = Boolean(value);
    }

    const configurations: Record<string, unknown> = {};
    for (const [key, pair] of Object.entries((response.configurations as Record<string, RpcMessage>) ?? {})) {
      configurations[key] = decodePair(pair, key);
    }

    return { toggles, configurations };
  }

  async upsert(
    name: string,
    casTenantId: number,
    value: unknown,
    editedByUserId: number,
    options?: ConditionOptions,
  ): Promise<void> {
    const encoded = encode(value, name);
    await this.call((deadline) =>
      this.rpc.upsertConfiguration(
        {
          typeValuePair: { type: encoded.type, value: { value: encoded.json } },
          editedByUserId: int32(editedByUserId, 'editedByUserId'),
          condition: namedRequest(name, casTenantId, options),
        },
        deadline,
      ),
    );
  }

  async delete(
    name: string,
    casTenantId: number,
    deletedByUserId: number,
    options?: ConditionOptions,
  ): Promise<void> {
    await this.call((deadline) =>
      this.rpc.deleteConfiguration(
        {
          deletedByUserId: int32(deletedByUserId, 'deletedByUserId'),
          condition: namedRequest(name, casTenantId, options),
        },
        deadline,
      ),
    );
  }

  close(): void {
    this.rpc.close();
  }

  /** Breaker around retries. Open state does not start a retry loop. */
  private async call(start: (deadline: Date) => Promise<RpcMessage>): Promise<RpcMessage> {
    try {
      if (this.breaker) {
        return await this.breaker.execute(() => this.callWithRetry(start));
      }
      return await this.callWithRetry(start);
    } catch (err) {
      if (err instanceof BrokenCircuitError) {
        throw new ConfigurationException('gRPC circuit breaker open', status.UNAVAILABLE);
      }
      throw err;
    }
  }

  /** timeoutMs covers attempts and backoff. A retry that would pass the deadline is not started. */
  private async callWithRetry(start: (deadline: Date) => Promise<RpcMessage>): Promise<RpcMessage> {
    const retry = this.config.retryPolicy;
    const started = Date.now();
    const deadlineAt = started + this.config.timeoutMs;
    let backoffMs = retry.initialBackoffMs;

    for (let attempt = 1; ; attempt++) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new ConfigurationException(
          `gRPC ${status.DEADLINE_EXCEEDED}: deadline exceeded (attempt ${attempt} of ${retry.maxAttempts})`,
          status.DEADLINE_EXCEEDED,
        );
      }
      try {
        const response = await start(new Date(Date.now() + remainingMs));
        if (attempt > 1) {
          this.log('warn', attempt, retry.maxAttempts, status.OK, '', started, false);
        }
        return response;
      } catch (err) {
        const failure = err instanceof ConfigurationException ? err : new ConfigurationException(String(err));
        const delayMs = jitterMs(backoffMs);
        const giveUp =
          attempt >= retry.maxAttempts ||
          !isRetryable(retry, failure.code) ||
          Date.now() + delayMs >= deadlineAt;
        this.log(
          giveUp ? 'error' : 'warn',
          attempt,
          retry.maxAttempts,
          failure.code,
          failure.message,
          started,
          !giveUp,
        );
        if (giveUp) {
          throw new ConfigurationException(
            `${failure.message} (attempt ${attempt} of ${retry.maxAttempts})`,
            failure.code,
          );
        }
        await sleep(delayMs);
        backoffMs = Math.min(Math.floor(backoffMs * retry.backoffMultiplier), retry.maxBackoffMs);
      }
    }
  }

  private log(
    level: 'warn' | 'error',
    attempt: number,
    maxAttempts: number,
    code: number,
    details: string,
    started: number,
    willRetry: boolean,
  ): void {
    if (!this.logger) {
      return;
    }
    this.logger[level](`gRPC ${code}: ${details} (attempt ${attempt} of ${maxAttempts})`, {
      attempt,
      max_attempts: maxAttempts,
      code,
      elapsed_ms: Math.round((Date.now() - started) * 100) / 100,
      will_retry: willRetry,
    });
  }
}

function decodePair(pair: RpcMessage, name = ''): unknown {
  const type = Number(pair.type ?? 0);
  const wrapped = pair.value as { value?: string } | string | undefined;
  const json = typeof wrapped === 'string' ? wrapped : wrapped?.value;
  return decode(type, json, name);
}

function toDetails(rpc: RpcMessage): ConfigurationDetails {
  const pair = rpc.typeValuePair as RpcMessage | undefined;
  const name = String(rpc.name ?? '');
  return {
    name,
    priority: Number(rpc.priority ?? 0),
    type: Number(rpc.type ?? 0),
    value: pair ? decodePair(pair, name) : null,
    accountId: unwrapInt(rpc.accountId as { value?: number } | number | null | undefined),
    userId: unwrapInt(rpc.userId as { value?: number } | number | null | undefined),
    locationGroupId: unwrapInt(rpc.locationGroupId as { value?: number } | number | null | undefined),
    locationId: unwrapInt(rpc.locationId as { value?: number } | number | null | undefined),
  };
}
