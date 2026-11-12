import { defaultCircuitBreakerConfig, validateCircuitBreakerConfig, type CircuitBreakerConfig } from './circuit-breaker';
import { defaultRetryPolicy, validateRetryPolicy, type RetryPolicy } from './retry';

export type ConfigurationClientConfig = {
  host: string;
  insecure: boolean;
  /** Deadline for one client call, retries and backoff included. */
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  /** HTTP/2 ping interval on the long-lived channel. */
  keepaliveTimeMs: number;
  /** How long to wait for a ping ACK before dropping the session. */
  keepaliveTimeoutMs: number;
  circuitBreaker: CircuitBreakerConfig;
  /**
   * PEM of the CA (or self-signed server cert) that signed the gRPC endpoint.
   * Required when insecure is false. This client does not use the OS trust store.
   */
  rootCertPath?: string;
};

export type ConfigurationClientConfigInput = {
  host: string;
  insecure?: boolean;
  timeoutMs?: number;
  retryPolicy?: Partial<RetryPolicy>;
  keepaliveTimeMs?: number;
  keepaliveTimeoutMs?: number;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  rootCertPath?: string;
};

export function createConfig(input: ConfigurationClientConfigInput): ConfigurationClientConfig {
  const retryPolicy: RetryPolicy = { ...defaultRetryPolicy(), ...input.retryPolicy };
  const circuitBreaker: CircuitBreakerConfig = { ...defaultCircuitBreakerConfig(), ...input.circuitBreaker };
  const config: ConfigurationClientConfig = {
    host: input.host,
    insecure: input.insecure ?? false,
    timeoutMs: input.timeoutMs ?? 10_000,
    retryPolicy,
    keepaliveTimeMs: input.keepaliveTimeMs ?? 60_000,
    keepaliveTimeoutMs: input.keepaliveTimeoutMs ?? 10_000,
    circuitBreaker,
    rootCertPath: input.rootCertPath || undefined,
  };
  if (config.timeoutMs < 1) {
    throw new Error('timeoutMs must be at least 1');
  }
  if (config.keepaliveTimeMs < 1) {
    throw new Error('keepaliveTimeMs must be at least 1');
  }
  if (config.keepaliveTimeoutMs < 1) {
    throw new Error('keepaliveTimeoutMs must be at least 1');
  }
  validateRetryPolicy(config.retryPolicy);
  validateCircuitBreakerConfig(config.circuitBreaker);
  if (!config.insecure && !config.rootCertPath) {
    throw new Error('rootCertPath is required for TLS');
  }
  return config;
}

export function configFromEnvironment(): ConfigurationClientConfig {
  const defaults = defaultRetryPolicy();
  const breaker = defaultCircuitBreakerConfig();
  return createConfig({
    host: process.env.CONFIG_SERVICE_URI || '127.0.0.1:8081',
    insecure: boolEnv('CONFIG_SERVICE_INSECURE', false),
    timeoutMs: intEnv('CONFIG_SERVICE_TIMEOUT_MS', 10_000),
    retryPolicy: {
      maxAttempts: intEnv('CONFIG_SERVICE_RETRY_MAX_ATTEMPTS', defaults.maxAttempts),
      initialBackoffMs: intEnv('CONFIG_SERVICE_RETRY_INITIAL_BACKOFF_MS', defaults.initialBackoffMs),
      maxBackoffMs: intEnv('CONFIG_SERVICE_RETRY_MAX_BACKOFF_MS', defaults.maxBackoffMs),
      backoffMultiplier: floatEnv('CONFIG_SERVICE_RETRY_BACKOFF_MULTIPLIER', defaults.backoffMultiplier),
    },
    keepaliveTimeMs: intEnv('CONFIG_SERVICE_KEEPALIVE_TIME_MS', 60_000),
    keepaliveTimeoutMs: intEnv('CONFIG_SERVICE_KEEPALIVE_TIMEOUT_MS', 10_000),
    circuitBreaker: {
      enabled: boolEnv('CONFIG_SERVICE_CIRCUIT_BREAKER', breaker.enabled),
      consecutiveFailures: intEnv('CONFIG_SERVICE_CIRCUIT_BREAKER_FAILURES', breaker.consecutiveFailures),
      breakDurationMs: intEnv('CONFIG_SERVICE_CIRCUIT_BREAKER_MS', breaker.breakDurationMs),
    },
    rootCertPath: process.env.CONFIG_SERVICE_ROOT_CERT_PATH || undefined,
  });
}

function intEnv(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be an integer, got "${value}"`);
  }
  return parsed;
}

function floatEnv(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number, got "${value}"`);
  }
  return parsed;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`${key} must be a boolean, got "${value}"`);
}
