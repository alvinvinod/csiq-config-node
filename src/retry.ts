import { status } from '@grpc/grpc-js';
import { stringToSubchannelAddress } from '@grpc/grpc-js/build/src/subchannel-address';

/**
 * Application-level retry. INTERNAL, UNAVAILABLE, UNKNOWN only.
 */
export type RetryPolicy = {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
};

export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: 3,
    initialBackoffMs: 250,
    maxBackoffMs: 250,
    backoffMultiplier: 1,
    retryableStatusCodes: [status.INTERNAL, status.UNAVAILABLE, status.UNKNOWN],
  };
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (policy.maxAttempts < 1) {
    throw new Error('maxAttempts must be at least 1');
  }
  if (policy.initialBackoffMs < 0) {
    throw new Error('initialBackoffMs must not be negative');
  }
  if (policy.maxBackoffMs < policy.initialBackoffMs) {
    throw new Error('maxBackoffMs must be at least initialBackoffMs');
  }
  if (policy.backoffMultiplier < 1) {
    throw new Error('backoffMultiplier must be at least 1');
  }
}

export function isRetryable(policy: RetryPolicy, statusCode: number): boolean {
  return policy.retryableStatusCodes.includes(statusCode);
}

/** Equal jitter: half the backoff plus a random remainder. */
export function jitterMs(backoffMs: number): number {
  if (backoffMs < 1) {
    return 0;
  }
  const half = Math.floor(backoffMs / 2);
  return half + Math.floor(Math.random() * (backoffMs - half + 1));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
