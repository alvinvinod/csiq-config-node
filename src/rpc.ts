import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConfigurationClientConfig } from './config';
import { ConfigurationException } from './exception';
import type { ConditionOptions } from './types';
import { ConfigDefinitionScope } from './types';

export type RpcMessage = Record<string, unknown>;

export type RpcStub = {
  getFeatureToggleValue(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  getDevToggleValue(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  tryGetConfigurationDetails(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  getConfigurationDetails(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  getAllAccountConfigurationByNamesAndPriorities(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  getAllTogglesAndConfigurations(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  getAllTogglesAndConfigurationsByNames(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  upsertConfiguration(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  deleteConfiguration(request: RpcMessage, deadline: Date): Promise<RpcMessage>;
  close(): void;
};

type UnaryClient = grpc.Client & Record<string, Function>;

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'configuration.proto');

export function wrapInt(value: number | undefined): { value: number } | undefined {
  return value === undefined ? undefined : { value };
}

export function unwrapInt(wrapper: { value?: number } | number | null | undefined): number | null {
  if (wrapper === null || wrapper === undefined) {
    return null;
  }
  if (typeof wrapper === 'number') {
    return wrapper;
  }
  return wrapper.value ?? null;
}

export function namedRequest(
  name: string,
  accountId: number,
  options: ConditionOptions = {},
): RpcMessage {
  return {
    name,
    condition: conditionRequest(accountId, options),
  };
}

export function conditionRequest(accountId: number, options: ConditionOptions = {}): RpcMessage {
  const condition: RpcMessage = {
    accountId: wrapInt(accountId),
    configDefinitionScope: options.configDefinitionScope ?? ConfigDefinitionScope.Server,
  };
  const userId = wrapInt(options.userId);
  if (userId) {
    condition.userId = userId;
  }
  const locationId = wrapInt(options.locationId);
  if (locationId) {
    condition.locationId = locationId;
  }
  const locationGroupId = wrapInt(options.locationGroupId);
  if (locationGroupId) {
    condition.locationGroupId = locationGroupId;
  }
  const attributeArea = wrapInt(options.attributeArea);
  if (attributeArea) {
    condition.attributeArea = attributeArea;
  }
  return condition;
}

/**
 * Long-lived channel. grpc-js is not given a ServiceConfig retry; retries live
 * in ConfigurationClient. Keepalives drop a dead HTTP/2 session.
 */
export function createGrpcStub(config: ConfigurationClientConfig): RpcStub {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: Number,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject;
  const pkg = loaded.carestack as grpc.GrpcObject;
  const configuration = pkg.configuration as grpc.GrpcObject;
  const Client = configuration.RpcConfigurationService as grpc.ServiceClientConstructor;
  const credentials = channelCredentials(config);
  const client = new Client(config.host, credentials, {
    'grpc.keepalive_time_ms': config.keepaliveTimeMs,
    'grpc.keepalive_timeout_ms': config.keepaliveTimeoutMs,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.max_receive_message_length': -1,
  }) as UnaryClient;

  const call = (method: string) => (request: RpcMessage, deadline: Date) =>
    unary(client, method, request, deadline);

  return {
    getFeatureToggleValue: call('getFeatureToggleValue'),
    getDevToggleValue: call('getDevToggleValue'),
    tryGetConfigurationDetails: call('tryGetConfigurationDetails'),
    getConfigurationDetails: call('getConfigurationDetails'),
    getAllAccountConfigurationByNamesAndPriorities: call('getAllAccountConfigurationByNamesAndPriorities'),
    getAllTogglesAndConfigurations: call('getAllTogglesAndConfigurations'),
    getAllTogglesAndConfigurationsByNames: call('getAllTogglesAndConfigurationsByNames'),
    upsertConfiguration: call('upsertConfiguration'),
    deleteConfiguration: call('deleteConfiguration'),
    close: () => client.close(),
  };
}

function channelCredentials(config: ConfigurationClientConfig): grpc.ChannelCredentials {
  if (config.insecure) {
    return grpc.credentials.createInsecure();
  }
  const certPath = config.rootCertPath;
  if (!certPath) {
    throw new Error('rootCertPath is required for TLS');
  }
  let pem: Buffer;
  try {
    pem = fs.readFileSync(certPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`rootCertPath could not be read (${certPath}): ${reason}`);
  }
  return grpc.credentials.createSsl(pem);
}

function unary(
  client: UnaryClient,
  method: string,
  request: RpcMessage,
  deadline: Date,
): Promise<RpcMessage> {
  const fn = client[method];
  if (typeof fn !== 'function') {
    return Promise.reject(new Error(`RPC method ${method} is not on the stub`));
  }
  const metadata = new grpc.Metadata();
  return new Promise((resolve, reject) => {
    fn.call(
      client,
      request,
      metadata,
      { deadline },
      (err: grpc.ServiceError | null, response: RpcMessage) => {
        if (err) {
          const code = err.code ?? grpc.status.UNKNOWN;
          reject(new ConfigurationException(`gRPC ${code}: ${err.details || err.message}`, code));
          return;
        }
        resolve(response ?? {});
      },
    );
  });
}
