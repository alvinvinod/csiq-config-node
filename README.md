# csiq-config-node

Node gRPC client for CareStack Configuration. Depend on `IConfigurationClient`. Create **one client per process** and reuse it.

The service resolves override layers. This client does not. Each public method is one unary RPC. Prefer `getAll(casTenantId, names)` over looping `isFeatureEnabled()`.

A down service throws `ConfigurationException`. It does not return `false` or a cached flag. There is no client-side cache. `casTenantId` is the CAS tenant id.

## Install

```bash
npm install csiq-config-node
```

## How to use

**Apps:** `getSharedClient()` — env, one client per process, prod guard.

```js
const { getSharedClient } = require('csiq-config-node');

const client = getSharedClient();
const memoOn = await client.isFeatureEnabled('is_memo_enabled', casTenantId);
const set = await client.getAll(casTenantId, ['is_memo_enabled', 'dni_regex'], { userId });
```

Call `client.close()` once on process shutdown.

Outside `local` / `development` / `test` / `testing`, loopback hosts (`127.0.0.0/8`, `localhost`, `::1`, `0.0.0.0`) and `insecure: true` throw. Scripts talking to a non-loopback host need `CONFIG_SERVICE_ALLOW_REMOTE=true`.

**Explicit config** (tests, custom host): `createConfigurationClient({ host, insecure, rootCertPath, … }, logger)`. **Env object:** `configFromEnvironment()`. **Scripts:** `createConfigurationClient()` (no singleton, no prod guard). Apps should use `getSharedClient()`.

Tests: `getSharedClient(fake)` or `resetSharedClient()`.

## Supported operations

Optional `options`: `{ userId, locationId, locationGroupId, attributeArea, configDefinitionScope }`. Omitted ids are not sent. Scope defaults to `ConfigDefinitionScope.Server`.

### Reads

| Method | Use when | Missing name / no stored row |
| --- | --- | --- |
| `isFeatureEnabled(name, casTenantId, options?)` | One **feature** toggle | `false`. Off, defined-but-empty, and unknown name are not distinguishable. A config or dev toggle name fails the call. |
| `isDevToggleEnabled(name, casTenantId, options?)` | One **dev** toggle | Same as `isFeatureEnabled`: `false`. |
| `tryGet(name, casTenantId, options?)` | One value, any type | `null` if the name is not a definition, or a non-toggle config has no value. A feature/dev toggle with no row is `false`, not `null`. |
| `getConfigurationDetails(name, casTenantId, options?)` | Winner plus which layer it came from | Throws `ConfigurationException`. Prefer `tryGet` when missing is expected. |
| `getAll(casTenantId, names?, options?)` | Several keys, **one RPC** | Named list → `GetAllTogglesAndConfigurationsByNames`. Empty `names` → every definition; use for dumps, not a request path. Toggles with no row are `false`. Configs and unknown names are **omitted**. |
| `getAllAccountConfigurations(name, casTenantId, overrideLevels, options?)` | Stored rows at given `OverrideLevel`s, not the winner | A toggle with no stored value is absent here even though `isFeatureEnabled` would be `false`. |

```js
const set = await client.getAll(casTenantId, ['is_memo_enabled', 'dni_regex'], { userId });
const memoOn = set.toggles.is_memo_enabled ?? false;
const regex = set.configurations.dni_regex ?? null;
// missing vs off: 'dni_regex' in set.configurations
```

### Writes

The definition must already exist. These calls do not create one.

| Method | Effect |
| --- | --- |
| `upsert(name, casTenantId, value, editedByUserId, options?)` | Insert or replace at that layer. `bool` → boolean, `int` → number, `string` → string, anything else → JSON. A lost response can be retried, so a write may be sent more than once. |
| `delete(name, casTenantId, deletedByUserId, options?)` | Remove the stored value. The definition stays. A later feature/dev toggle read is `false`. |

### Lifecycle

`close()` shuts the gRPC channel.

`isFeatureEnabled` returning `false` is a **successful** RPC. A dead service throws `ConfigurationException` (`code` is the gRPC status).

## Options / env

Used by `getSharedClient()` / `configFromEnvironment()` / no-arg `createConfigurationClient()`.

| Option | Env | Default | Effect |
| --- | --- | --- | --- |
| `host` | `CONFIG_SERVICE_URI` | `127.0.0.1:8081` | `host:port`. Use `localhost` if the cert SAN is not `127.0.0.1`. |
| `insecure` | `CONFIG_SERVICE_INSECURE` | `false` | `true` = plaintext HTTP/2. |
| `rootCertPath` | `CONFIG_SERVICE_ROOT_CERT_PATH` | required for TLS | PEM of the CA or self-signed server cert. `@grpc/grpc-js` `createSsl(pem)` does not use the OS trust store. |
| `timeoutMs` | `CONFIG_SERVICE_TIMEOUT_MS` | `10000` | Deadline for one call, retries included. |
| `retryPolicy.*` | `CONFIG_SERVICE_RETRY_*` | 3 attempts, 250ms | `INTERNAL`, `UNAVAILABLE`, `UNKNOWN`. |
| `keepaliveTimeMs` / `keepaliveTimeoutMs` | `CONFIG_SERVICE_KEEPALIVE_*` | 60000 / 10000 | HTTP/2 pings on the long-lived channel. |
| `circuitBreaker.*` | `CONFIG_SERVICE_CIRCUIT_BREAKER*` | on, 10 failures, 30s | Process-wide; wraps the whole retry loop. Only `UNAVAILABLE` trips it. |

Optional logger `{ warn, error }` as the second argument to `getSharedClient` / `createConfigurationClient`.

Local `dotnet run` gRPC is HTTPS HTTP/2 on **7154**. Port **5295** is HTTP/1.1 and cannot serve gRPC.

## Smoke and tests

```bash
npm test          # unit; no live service
npm run smoke     # live HTTPS localhost:7154; exports the ASP.NET cert unless CONFIG_SERVICE_ROOT_CERT_PATH is set
```

`SMOKE_TENANT_ID` (default `10001`), `SMOKE_FLAG`, `SMOKE_WRITE=true`.

Plaintext: `CONFIG_SERVICE_URI=127.0.0.1:8081 CONFIG_SERVICE_INSECURE=true npm run smoke`.

## Exports

`getSharedClient`, `resetSharedClient`, `assertProductionSafe`, `createConfigurationClient`, `createConfig`, `configFromEnvironment`, `ConfigurationClient`, `ConfigurationException`, `IConfigurationClient`, `AttributeType`, `AttributeArea`, `OverrideLevel`, `ConfigDefinitionScope`, `encode`, `decode`.
