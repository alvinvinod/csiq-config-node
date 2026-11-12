import type { IConfigurationClient } from './client-interface';
import {
  configFromEnvironment,
  createConfig,
  type ConfigurationClientConfigInput,
} from './config';
import { createConfigurationClient } from './factory';
import type { Logger } from './types';

const LOCAL_ENVS = new Set(['local', 'development', 'test', 'testing']);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

let shared: IConfigurationClient | null = null;

export function assertProductionSafe(
  host: string,
  insecure: boolean,
  nodeEnv: string = process.env.NODE_ENV ?? '',
): void {
  const env = nodeEnv.toLowerCase();
  if (LOCAL_ENVS.has(env)) {
    return;
  }
  const hostname = String(host)
    .replace(/^[a-z]+:\/\//i, '')
    .split(':')[0]
    .toLowerCase();
  if (insecure || LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      'CONFIG_SERVICE_URI must be a non-local host with CONFIG_SERVICE_INSECURE=false outside local/testing',
    );
  }
}

/**
 * One client per process. First call builds it (env if `input` omitted). Later calls reuse it.
 * Pass an `IConfigurationClient` (test fake) to replace the shared instance.
 */
export function getSharedClient(
  input?: ConfigurationClientConfigInput | IConfigurationClient,
  logger?: Logger,
): IConfigurationClient {
  if (isClient(input)) {
    shared = input;
    return shared;
  }
  if (shared) {
    return shared;
  }
  const resolved = input ?? configFromEnvironment();
  const config = createConfig(resolved);
  assertProductionSafe(config.host, config.insecure);
  shared = createConfigurationClient(resolved, logger);
  return shared;
}

export function resetSharedClient(): void {
  shared = null;
}

function isClient(value: unknown): value is IConfigurationClient {
  return value != null && typeof (value as IConfigurationClient).isFeatureEnabled === 'function';
}
