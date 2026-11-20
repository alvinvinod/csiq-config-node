import { createConfigurationClient } from './factory';
import { configFromEnvironment } from './config';
import type { IConfigurationClient } from './client-interface';

const LOCAL_ENVIRONMENTS = new Set(['local', 'development', 'test', 'testing']);

let shared: IConfigurationClient | undefined;

export function hostnameOf(uri: string): string {
  let value = uri.trim().toLowerCase();
  const scheme = value.match(/^[a-z][a-z0-9+.-]*:\/\//);
  if (scheme) {
    value = value.slice(scheme[0].length);
  }
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(1, end);
  }
  const cut = value.search(/[/?#]/);
  if (cut !== -1) {
    value = value.slice(0, cut);
  }
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && /^\d+$/.test(value.slice(colon + 1))) {
    return value.slice(0, colon);
  }
  return value;
}

export function isLocalHost(uri: string): boolean {
  const host = hostnameOf(uri);
  if (host === '' || host === 'localhost' || host === 'localhost.') {
    return host !== '';
  }
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }
  if (host.startsWith('::ffff:')) {
    return isLocalIpv4(host.slice(7));
  }
  return isLocalIpv4(host);
}

function isLocalIpv4(host: string): boolean {
  if (host === '0.0.0.0') {
    return true;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return false;
  }
  const octets = match.slice(1).map(Number);
  if (octets.some((n) => n > 255)) {
    return false;
  }
  return octets[0] === 127;
}

export function assertProductionSafe(
  host: string,
  insecure: boolean,
  env = process.env.NODE_ENV || '',
): void {
  if (LOCAL_ENVIRONMENTS.has(env)) {
    return;
  }
  if (isLocalHost(host)) {
    throw new Error(`CONFIG_SERVICE_URI must be a non-local host when NODE_ENV=${env || '(unset)'}`);
  }
  if (insecure) {
    throw new Error(`CONFIG_SERVICE_INSECURE=false is required when NODE_ENV=${env || '(unset)'}`);
  }
}

export function assertRemoteAllowed(host: string, insecure: boolean, allowRemote: boolean): void {
  if (isLocalHost(host)) {
    return;
  }
  if (!allowRemote) {
    throw new Error(
      'CONFIG_SERVICE_URI is not loopback; pass --allow-remote or set CONFIG_SERVICE_ALLOW_REMOTE=true',
    );
  }
  if (insecure) {
    throw new Error('CONFIG_SERVICE_INSECURE=false is required for a non-loopback URI');
  }
}

/**
 * One client per Node process. Pass a fake in tests.
 * Production NODE_ENV rejects loopback hosts and insecure=true.
 */
export function getSharedClient(override?: IConfigurationClient): IConfigurationClient {
  if (override) {
    shared = override;
    return shared;
  }
  if (!shared) {
    const config = configFromEnvironment();
    assertProductionSafe(config.host, config.insecure);
    shared = createConfigurationClient(config);
  }
  return shared;
}

export function resetSharedClient(): void {
  shared?.close();
  shared = undefined;
}
