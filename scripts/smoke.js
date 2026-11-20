/**
 * Hit a running CareStack configuration service with IConfigurationClient.
 *
 *   npm run smoke
 *
 * Local `dotnet run --project CareStack.Configuration.Server` serves gRPC over
 * HTTPS HTTP/2 on localhost:7154. The HTTP URL on 5295 is HTTP/1.1 and will
 * fail with a protocol error. Override with CONFIG_SERVICE_URI.
 *
 * Plaintext HTTP/2 (mapped 8081):
 *   CONFIG_SERVICE_URI=127.0.0.1:8081 CONFIG_SERVICE_INSECURE=true npm run smoke
 *
 * Optional: SMOKE_TENANT_ID (10001), SMOKE_FLAG (first toggle from getAll, else EnableFoo),
 * SMOKE_WRITE=true to flip and restore a feature toggle.
 * CONFIG_SERVICE_ROOT_CERT_PATH overrides the exported ASP.NET HTTPS cert.
 * Non-loopback CONFIG_SERVICE_URI needs CONFIG_SERVICE_ALLOW_REMOTE=true.
 *
 * Uses compiled dist/ (npm run build). Not part of npm test.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  createConfigurationClient,
  ConfigurationException,
  OverrideLevel,
  assertRemoteAllowed,
} = require('../dist');

const casTenantId = intEnv('SMOKE_TENANT_ID', 10001);
const write = truthy(process.env.SMOKE_WRITE);
const host = process.env.CONFIG_SERVICE_URI || 'localhost:7154';
const insecure = truthy(process.env.CONFIG_SERVICE_INSECURE);
assertRemoteAllowed(host, insecure, truthy(process.env.CONFIG_SERVICE_ALLOW_REMOTE));

const rootCertPath = process.env.CONFIG_SERVICE_ROOT_CERT_PATH || (!insecure ? writeServerCert(host) : undefined);

function truthy(raw) {
  return ['1', 'true', 'yes', 'on'].includes(String(raw || '').trim().toLowerCase());
}

function intEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${key} must be a positive integer, got "${raw}"`);
  }
  return n;
}

function writeServerCert(target) {
  const colon = target.lastIndexOf(':');
  const hostname = colon === -1 ? target : target.slice(0, colon);
  const port = colon === -1 ? '7154' : target.slice(colon + 1);
  let output;
  try {
    output = execFileSync(
      'openssl',
      ['s_client', '-connect', `${hostname}:${port}`, '-servername', hostname, '-showcerts'],
      { input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr) : String(err);
    throw new Error(
      `could not read TLS cert from ${target}: ${stderr.trim() || err.message}. ` +
        'For plaintext HTTP/2 set CONFIG_SERVICE_INSECURE=true.',
    );
  }
  const pem = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!pem) {
    throw new Error(`no certificate in openssl output for ${target}`);
  }
  const certPath = path.join(os.tmpdir(), 'csiq-config-smoke-ca.pem');
  fs.writeFileSync(certPath, `${pem[0]}\n`);
  return certPath;
}

function show(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return String(value);
  return JSON.stringify(value);
}

async function main() {
  console.log(
    `smoke: ${host} insecure=${insecure} casTenantId=${casTenantId}` +
      (rootCertPath ? ` rootCertPath=${rootCertPath}` : ''),
  );

  const client = createConfigurationClient({
    host,
    insecure,
    rootCertPath,
  });

  try {
    const dump = await client.getAll(casTenantId);
    const toggleNames = Object.keys(dump.toggles);
    const configNames = Object.keys(dump.configurations);
    console.log(`getAll(): ${toggleNames.length} toggles, ${configNames.length} configurations`);
    if (toggleNames.length) {
      console.log(`  toggles: ${toggleNames.slice(0, 8).join(', ')}${toggleNames.length > 8 ? ', …' : ''}`);
    }

    const flag = process.env.SMOKE_FLAG || toggleNames[0] || 'EnableFoo';
    console.log(`flag: ${flag}`);

    const named = await client.getAll(casTenantId, [flag]);
    console.log(
      `getAll(names): toggle=${show(named.toggles[flag])} config=${
        flag in named.configurations ? show(named.configurations[flag]) : '(omitted)'
      }`,
    );

    const enabled = await client.isFeatureEnabled(flag, casTenantId);
    console.log(`isFeatureEnabled(): ${show(enabled)}`);

    try {
      const dev = await client.isDevToggleEnabled(flag, casTenantId);
      console.log(`isDevToggleEnabled(): ${show(dev)}`);
    } catch (err) {
      if (err instanceof ConfigurationException) {
        console.log(`isDevToggleEnabled(): ${err.message} (code=${err.code})`);
      } else {
        throw err;
      }
    }

    const tried = await client.tryGet(flag, casTenantId);
    console.log(`tryGet(): ${show(tried)}`);

    try {
      const details = await client.getConfigurationDetails(flag, casTenantId);
      console.log(
        `getConfigurationDetails(): name=${details.name} value=${show(details.value)} priority=${details.priority} type=${details.type} accountId=${details.accountId}`,
      );
    } catch (err) {
      if (err instanceof ConfigurationException) {
        console.log(`getConfigurationDetails(): throws code=${err.code} ${err.message}`);
      } else {
        throw err;
      }
    }

    const rows = await client.getAllAccountConfigurations(flag, casTenantId, [
      OverrideLevel.Practice,
      OverrideLevel.VoiceStack,
    ]);
    console.log(`getAllAccountConfigurations(): ${rows.length} row(s)`);
    for (const row of rows) {
      console.log(
        `  priority=${row.priority} value=${show(row.value)} accountId=${row.accountId} userId=${row.userId}`,
      );
    }

    try {
      await client.getConfigurationDetails('DoesNotExist_csiq_node_smoke', casTenantId);
      console.error('missing name should have thrown');
      process.exitCode = 1;
      return;
    } catch (err) {
      if (err instanceof ConfigurationException) {
        console.log('getConfigurationDetails(missing): throws');
      } else {
        throw err;
      }
    }

    if (write) {
      await client.upsert(flag, casTenantId, !enabled, 1);
      const flipped = await client.isFeatureEnabled(flag, casTenantId);
      console.log(`after upsert: ${show(flipped)}`);
      await client.upsert(flag, casTenantId, enabled, 1);
      console.log(`restored: ${show(await client.isFeatureEnabled(flag, casTenantId))}`);
    }
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof ConfigurationException ? `gRPC ${err.code}: ${err.message}` : err);
  process.exitCode = 1;
});
