import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertProductionSafe,
  getSharedClient,
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

describe('assertProductionSafe', () => {
  it('allows loopback and insecure in local/testing', () => {
    assertProductionSafe('127.0.0.1:7154', true, 'local');
    assertProductionSafe('localhost:7154', true, 'test');
  });

  it('rejects loopback outside local', () => {
    assert.throws(
      () => assertProductionSafe('127.0.0.1:7154', false, 'production'),
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
