import { loadConnectorConfig } from '../src/connectors.js';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';
import { createGatewayServer } from '../src/server.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { OllamaProvider } from '../src/ollama.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Disposable test host. Known fixture tokens authorize only an in-memory demo gateway.
// It never opens .env or persistent gateway storage. Opt-in workspace writes target only a disposable temporary directory.
let workspaceRoot;
if (process.env.GATEWAY_QA_WORKSPACE === '1') {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'gateway-browser-workspace-')); mkdirSync(join(workspaceRoot, 'input')); mkdirSync(join(workspaceRoot, 'reports'));
  writeFileSync(join(workspaceRoot, 'input', 'review-notes.md'), '# Review notes\nThe project has three milestones: review, test and document. Reports must remain local.\n');
  if (process.env.GATEWAY_QA_LIBRARY === '1') writeFileSync(join(workspaceRoot, 'reports', 'preview-report.md'), '# Disposable report\n\nThis file tests preview and download.\n\n<em>Plain text, not HTML.</em>\n');
  if (process.env.GATEWAY_QA_COMPARE === '1') {
    writeFileSync(join(workspaceRoot, 'reports', 'baseline.md'), '# Review summary\nStatus: draft\nMilestones: review, test\n<em>Literal markup</em>\n');
    writeFileSync(join(workspaceRoot, 'reports', 'revised.md'), '# Review summary\nStatus: reviewed\nMilestones: review, test, document\nNext: approve local report\n<em>Literal markup</em>\n');
  }
}
const connectorPath = process.env.GATEWAY_QA_CONNECTOR_FILE && resolve(process.env.GATEWAY_QA_CONNECTOR_FILE);
const f = createDemo({ masterKey: randomBytes(32).toString('hex'), workspaceRoot, connectorConfig: connectorPath ? loadConnectorConfig(connectorPath) : undefined, connectorBaseDir: connectorPath ? dirname(connectorPath) : undefined });
f.gateway.alerts.configure({ tenant: 'demo', actor: 'qa-operator' }, { expectedVersion: 0, title: 'Disposable blocked request alert', category: 'denials', threshold: 1, windowMinutes: 15, enabled: true, reason: 'Create an in-memory alert for UI verification.' });
const { sessionId } = f.gateway.createSession('demo-agent');
await f.gateway.execute('demo-agent', sessionId, { id: 'qa-publish', tool: 'report.publish', arguments: { url: 'https://reports.example.com/daily', body: 'Disposable browser QA summary.' } });
const sensitiveSession = f.gateway.createSession('demo-agent').sessionId;
await f.gateway.execute('demo-agent', sensitiveSession, { id: 'qa-sensitive-read', tool: 'vault.read', arguments: { record: 'invoice' } });
await f.gateway.execute('demo-agent', sensitiveSession, { id: 'qa-sensitive-export', tool: 'report.publish', arguments: { url: 'https://reports.example.com/daily', body: 'Synthetic incident fixture.' } });
const agentRuntime = new AgentRuntime({ gateway: f.gateway, provider: process.env.GATEWAY_QA_REAL_LLM === '1' ? new OllamaProvider({ model: process.env.LLM_MODEL ?? 'qwen3.5:4b' }) : null });
const server = createGatewayServer({ heavyRateLimit: 60, gateway: f.gateway, agentRuntime, workspaceFiles: f.workspace, credentials: [
  { token: 'test-only-operator-'.repeat(4), principal: 'qa-operator', tenant: 'demo', role: 'operator' },
  { token: 'test-only-viewer-'.repeat(4), principal: 'qa-viewer', tenant: 'demo', role: 'viewer' },
] });
server.listen(8788, '127.0.0.1', () => console.log('Disposable browser QA host: http://127.0.0.1:8788 (in-memory state; optional temporary filesystem workspace).'));
server.on('error', () => { console.error('QA host could not bind port 8788.'); f.store.close(); process.exitCode = 1; });
const close = () => { agentRuntime.close(); server.close(() => { f.store.close(); if (workspaceRoot) { if (!workspaceRoot.startsWith(join(tmpdir(), 'gateway-browser-workspace-'))) throw new Error('Unexpected QA workspace'); rmSync(workspaceRoot, { recursive: true, force: true }); } }); server.closeIdleConnections(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
