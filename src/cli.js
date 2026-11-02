#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDemo } from './demo.js';
import { createGatewayServer } from './server.js';
import { Metrics } from './telemetry.js';
import { attachMcp } from './mcp.js';
import { assert } from './util.js';
import { AgentRuntime } from './agent-runtime.js';
import { configuredOllama } from './ollama.js';

try {
  const command = process.argv[2] ?? 'serve';
  if (command === 'init') {
    const contents = `GATEWAY_MASTER_KEY=${randomBytes(32).toString('hex')}\nGATEWAY_AGENT_TOKEN=${randomBytes(32).toString('hex')}\nGATEWAY_OPERATOR_TOKEN=${randomBytes(32).toString('hex')}\nGATEWAY_VIEWER_TOKEN=${randomBytes(32).toString('hex')}\nGATEWAY_HOST=127.0.0.1\nGATEWAY_PORT=8787\nGATEWAY_DB=var/gateway.sqlite\n`;
    writeFileSync(resolve('.env'), contents, { flag: 'wx', mode: 0o600 });
    console.log('Created .env with fresh local credentials. Keep this file private. Run npm start.');
  } else {
    assert(['serve', 'mcp', 'verify-audit'].includes(command), 'UNKNOWN_COMMAND');
    const masterKey = process.env.GATEWAY_MASTER_KEY;
    assert(/^[a-f0-9]{64}$/.test(masterKey ?? ''), 'MASTER_KEY_REQUIRED');
    const path = resolve(process.env.GATEWAY_DB ?? 'var/gateway.sqlite');
    mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
    const metrics = new Metrics();
    const { store, gateway } = createDemo({ path, masterKey, onEvent: metrics.record });
    if (command === 'verify-audit') { console.log(JSON.stringify(store.verifyAudit(), null, 2)); store.close(); }
    else if (command === 'mcp') {
      attachMcp({ gateway, principal: 'demo-agent' });
      process.stdin.on('end', () => {});
    } else {
      const credentials = [
        { token: process.env.GATEWAY_AGENT_TOKEN, principal: 'demo-agent', tenant: 'demo', role: 'agent' },
        { token: process.env.GATEWAY_OPERATOR_TOKEN, principal: 'local-operator', tenant: 'demo', role: 'operator' },
      ];
      if (process.env.GATEWAY_VIEWER_TOKEN) credentials.push({ token: process.env.GATEWAY_VIEWER_TOKEN, principal: 'local-viewer', tenant: 'demo', role: 'viewer' });
      assert(credentials.every(c => /^[a-f0-9]{64}$/.test(c.token ?? '')), 'TOKENS_REQUIRED');
      const host = process.env.GATEWAY_HOST ?? '127.0.0.1', port = Number(process.env.GATEWAY_PORT ?? 8787);
      assert(Number.isSafeInteger(port) && port > 0 && port <= 65535, 'INVALID_PORT');
      const agentRuntime = new AgentRuntime({ gateway, provider: configuredOllama() });
      const server = createGatewayServer({ gateway, credentials, metrics, agentRuntime });
      server.on('error', () => { console.error('Gateway could not start. Check host, port and storage configuration.'); store.close(); process.exitCode = 1; });
      server.listen(port, host, () => console.log(`Gateway ready: http://${host}:${port}\nDemo mode: publishing and payments are simulated. Open the dashboard with the operator token in .env.`));
      let stopping = false;
      const stop = () => {
        if (stopping) return; stopping = true;
        agentRuntime.close();
        server.close(() => { store.close(); process.exitCode = 0; });
        server.closeIdleConnections();
        setTimeout(() => process.exit(1), 65000).unref();
      };
      process.on('SIGTERM', stop); process.on('SIGINT', stop);
    }
  }
} catch (error) { console.error(`Gateway stopped: ${error.code ?? 'CONFIGURATION_ERROR'}`); process.exitCode = 1; }
