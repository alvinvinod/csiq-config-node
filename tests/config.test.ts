import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { status } from '@grpc/grpc-js';
import { configFromEnvironment, createConfig } from '../src/config';
import { createConfigurationClient } from '../src/factory';

const keys = [
  'CONFIG_SERVICE_URI',
  'CONFIG_SERVICE_INSECURE',
  'CONFIG_SERVICE_TIMEOUT_MS',
  'CONFIG_SERVICE_RETRY_MAX_ATTEMPTS',
  'CONFIG_SERVICE_RETRY_INITIAL_BACKOFF_MS',
  'CONFIG_SERVICE_RETRY_MAX_BACKOFF_MS',
  'CONFIG_SERVICE_RETRY_BACKOFF_MULTIPLIER',
  'CONFIG_SERVICE_KEEPALIVE_TIME_MS',
  'CONFIG_SERVICE_KEEPALIVE_TIMEOUT_MS',
  'CONFIG_SERVICE_CIRCUIT_BREAKER',
  'CONFIG_SERVICE_CIRCUIT_BREAKER_FAILURES',
  'CONFIG_SERVICE_CIRCUIT_BREAKER_MS',
  'CONFIG_SERVICE_ROOT_CERT_PATH',
];

const saved: Record<string, string | undefined> = {};

function clearEnv(): void {
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of keys) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('createConfig', () => {
  it('defaults to TLS and a 10s deadline', () => {
    const config = createConfig({ host: '127.0.0.1:8081', rootCertPath: '/tmp/ca.pem' });
    assert.equal(config.insecure, false);
    assert.equal(config.timeoutMs, 10_000);
    assert.deepEqual(config.retryPolicy.retryableStatusCodes, [
      status.INTERNAL,
      status.UNAVAILABLE,
      status.UNKNOWN,
    ]);
    assert.equal(config.circuitBreaker.enabled, true);
    assert.equal(config.circuitBreaker.consecutiveFailures, 10);
    assert.equal(config.rootCertPath, '/tmp/ca.pem');
  });

  it('requires rootCertPath for TLS', () => {
    assert.throws(() => createConfig({ host: '127.0.0.1:8081' }), /rootCertPath is required for TLS/);
  });

  it('allows omitting rootCertPath when insecure', () => {
    const config = createConfig({ host: '127.0.0.1:8081', insecure: true });
    assert.equal(config.rootCertPath, undefined);
  });

  it('rejects timeoutMs below 1', () => {
    assert.throws(() => createConfig({ host: '127.0.0.1:8081', timeoutMs: 0 }), /timeoutMs/);
  });

  it('rejects circuitBreaker consecutiveFailures below 1', () => {
    assert.throws(
      () => createConfig({ host: '127.0.0.1:8081', circuitBreaker: { consecutiveFailures: 0 } }),
      /consecutiveFailures/,
    );
  });

  it('rejects circuitBreaker breakDurationMs below 1', () => {
    assert.throws(
      () => createConfig({ host: '127.0.0.1:8081', circuitBreaker: { breakDurationMs: 0 } }),
      /breakDurationMs/,
    );
  });

  it('rejects retry maxAttempts below 1', () => {
    assert.throws(
      () => createConfig({ host: '127.0.0.1:8081', retryPolicy: { maxAttempts: 0 } }),
      /maxAttempts/,
    );
  });
});

describe('configFromEnvironment', () => {
  afterEach(restoreEnv);

  it('defaults when nothing is set', () => {
    clearEnv();
    process.env.CONFIG_SERVICE_ROOT_CERT_PATH = '/etc/csiq/config-ca.pem';
    const config = configFromEnvironment();
    assert.equal(config.host, '127.0.0.1:8081');
    assert.equal(config.insecure, false);
    assert.equal(config.timeoutMs, 10_000);
    assert.equal(config.retryPolicy.maxAttempts, 3);
    assert.equal(config.circuitBreaker.breakDurationMs, 30_000);
    assert.equal(config.rootCertPath, '/etc/csiq/config-ca.pem');
  });

  it('requires rootCertPath for TLS from the environment', () => {
    clearEnv();
    assert.throws(() => configFromEnvironment(), /rootCertPath is required for TLS/);
  });

  it('reads insecure true only when set', () => {
    clearEnv();
    process.env.CONFIG_SERVICE_INSECURE = 'true';
    assert.equal(configFromEnvironment().insecure, true);
  });

  it('treats empty insecure as TLS', () => {
    clearEnv();
    process.env.CONFIG_SERVICE_INSECURE = '';
    process.env.CONFIG_SERVICE_ROOT_CERT_PATH = '/etc/csiq/config-ca.pem';
    assert.equal(configFromEnvironment().insecure, false);
  });

  it('reads retry and breaker env overrides', () => {
    clearEnv();
    process.env.CONFIG_SERVICE_ROOT_CERT_PATH = '/etc/csiq/config-ca.pem';
    process.env.CONFIG_SERVICE_RETRY_MAX_ATTEMPTS = '5';
    process.env.CONFIG_SERVICE_CIRCUIT_BREAKER = 'false';
    process.env.CONFIG_SERVICE_CIRCUIT_BREAKER_FAILURES = '4';
    process.env.CONFIG_SERVICE_CIRCUIT_BREAKER_MS = '1000';
    const config = configFromEnvironment();
    assert.equal(config.retryPolicy.maxAttempts, 5);
    assert.equal(config.circuitBreaker.enabled, false);
    assert.equal(config.circuitBreaker.consecutiveFailures, 4);
    assert.equal(config.circuitBreaker.breakDurationMs, 1000);
  });
});

describe('rootCertPath at channel open', () => {
  it('throws when the PEM file is missing', () => {
    assert.throws(
      () => createConfigurationClient({ host: 'localhost:7154', rootCertPath: '/no/such/csiq-ca.pem' }),
      /rootCertPath could not be read/,
    );
  });
});
