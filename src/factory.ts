import type { IConfigurationClient } from './client-interface';
import { ConfigurationClient } from './client';
import { configFromEnvironment, createConfig, type ConfigurationClientConfigInput } from './config';
import { createGrpcStub } from './rpc';
import type { Logger } from './types';

/** Build a client from `CONFIG_SERVICE_*` or an explicit config. Create one per process and reuse it. */
export function createConfigurationClient(
  input?: ConfigurationClientConfigInput,
  logger?: Logger,
): IConfigurationClient {
  const config = input ? createConfig(input) : configFromEnvironment();
  return new ConfigurationClient(createGrpcStub(config), config, logger ?? null);
}
