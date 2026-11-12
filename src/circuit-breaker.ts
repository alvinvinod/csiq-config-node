import { ConsecutiveBreaker, circuitBreaker, handleWhen, type CircuitBreakerPolicy } from 'cockatiel';
import { status } from '@grpc/grpc-js';
import { ConfigurationException } from './exception';

/**
 * Consecutive UNAVAILABLE after retries. While open, the next call throws;
 * it does not return a cached or default flag.
 */
export type CircuitBreakerConfig = {
  enabled: boolean;
  consecutiveFailures: number;
  breakDurationMs: number;
};

export function defaultCircuitBreakerConfig(): CircuitBreakerConfig {
  return {
    enabled: true,
    consecutiveFailures: 10,
    breakDurationMs: 30_000,
  };
}

export function validateCircuitBreakerConfig(config: CircuitBreakerConfig): void {
  if (config.consecutiveFailures < 1) {
    throw new Error('consecutiveFailures must be at least 1');
  }
  if (config.breakDurationMs < 1) {
    throw new Error('breakDurationMs must be at least 1');
  }
}

export function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreakerPolicy | null {
  if (!config.enabled) {
    return null;
  }
  return circuitBreaker(
    handleWhen((err) => err instanceof ConfigurationException && err.code === status.UNAVAILABLE),
    {
      halfOpenAfter: config.breakDurationMs,
      breaker: new ConsecutiveBreaker(config.consecutiveFailures),
    },
  );
}
