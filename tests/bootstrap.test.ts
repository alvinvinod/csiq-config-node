import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertProductionSafe,
  assertRemoteAllowed,
  getSharedClient,
  isLocalHost,
  resetSharedClient,
} from '../src/bootstrap';

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    isFeatureEnabled: async () => true,
    isDevToggleEnabled: async () => false,
    tryGet: async () => null,
    getConfigurationDetails: async () => ({ name: '', priority: 0, type: 0, value: null }),
    getAllAccountConfigurations: async () => [],
    getAll: async () => ({ toggles: {}, configurations: {} }),
    upsert: async () => undefined,
    delete: async () => undefined,
    close() {},
    ...overrides,
  };
}

describe('isLocalHost', () => {
  it('treats 127/8, 0.0.0.0, localhost, and ::1 as loopback', () => {
    assert.equal(isLocalHost('127.0.0.1:7154'), true);
    assert.equal(isLocalHost('127.0.0.2:7154'), true);
    assert.equal(isLocalHost('0.0.0.0:7154'), true);
    assert.equal(isLocalHost('localhost:7154'), true);
    assert.equal(isLocalHost('[::1]:7154'), true);
    assert.equal(isLocalHost('[::ffff:127.0.0.2]:7154'), true);
    assert.equal(isLocalHost('https://127.0.0.2:7154'), true);
    assert.equal(isLocalHost('config.example.com:443'), false);
    assert.equal(isLocalHost('10.0.0.1:7154'), false);
  });
});

describe('assertProductionSafe', () => {
  it('allows loopback and insecure in local/testing', () => {
    assertProductionSafe('127.0.0.1:7154', true, 'local');
    assertProductionSafe('localhost:7154', true, 'test');
    assertProductionSafe('127.0.0.2:7154', true, 'development');
  });

  it('rejects loopback outside local', () => {
    assert.throws(
      () => assertProductionSafe('127.0.0.1:7154', false, 'production'),
      /non-local host/,
    );
    assert.throws(
      () => assertProductionSafe('127.0.0.2:7154', false, 'production'),
      /non-local host/,
    );
    assert.throws(
      () => assertProductionSafe('0.0.0.0:7154', false, 'production'),
      /non-local host/,
    );
  });

  it('rejects insecure outside local', () => {
    assert.throws(
      () => assertProductionSafe('config.example.com:443', true, 'production'),
      /INSECURE=false/,
    );
  });

  it('allows TLS remote host in production', () => {
    assertProductionSafe('config.example.com:443', false, 'production');
  });
});

describe('assertRemoteAllowed', () => {
  it('allows loopback without the remote flag', () => {
    assertRemoteAllowed('127.0.0.2:7154', true, false);
  });

  it('rejects remote hosts without the flag', () => {
    assert.throws(
      () => assertRemoteAllowed('config.example.com:443', false, false),
      /CONFIG_SERVICE_ALLOW_REMOTE/,
    );
  });

  it('rejects insecure remote even with the flag', () => {
    assert.throws(
      () => assertRemoteAllowed('config.example.com:443', true, true),
      /INSECURE=false/,
    );
  });

  it('allows TLS remote with the flag', () => {
    assertRemoteAllowed('config.example.com:443', false, true);
  });
});

describe('getSharedClient', () => {
  afterEach(() => {
    resetSharedClient();
  });

  it('reuses one instance', () => {
    const fake = fakeClient();
    assert.equal(getSharedClient(fake), fake);
    assert.equal(getSharedClient(), fake);
  });

  it('replaces the shared instance when given a client', () => {
    const a = fakeClient();
    const b = fakeClient();
    getSharedClient(a);
    assert.equal(getSharedClient(b), b);
    assert.equal(getSharedClient(), b);
  });
});
