import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';
import { createGatewayServer } from '../src/server.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { OllamaProvider } from '../src/ollama.js';

// Disposable test host. Known fixture tokens authorize only an in-memory demo gateway.
// It never opens .env, the persistent database or real side-effecting adapters.
const f = createDemo({ masterKey: randomBytes(32).toString('hex') });
f.gateway.alerts.configure({ tenant: 'demo', actor: 'qa-operator' }, { expectedVersion: 0, title: 'Disposable blocked request alert', category: 'denials', threshold: 1, windowMinutes: 15, enabled: true, reason: 'Create an in-memory alert for UI verification.' });
const { sessionId } = f.gateway.createSession('demo-agent');
await f.gateway.execute('demo-agent', sessionId, { id: 'qa-publish', tool: 'report.publish', arguments: { url: 'https://reports.example.com/daily', body: 'Disposable browser QA summary.' } });
const sensitiveSession = f.gateway.createSession('demo-agent').sessionId;
await f.gateway.execute('demo-agent', sensitiveSession, { id: 'qa-sensitive-read', tool: 'vault.read', arguments: { record: 'invoice' } });
await f.gateway.execute('demo-agent', sensitiveSession, { id: 'qa-sensitive-export', tool: 'report.publish', arguments: { url: 'https://reports.example.com/daily', body: 'Synthetic incident fixture.' } });
const agentRuntime = new AgentRuntime({ gateway: f.gateway, provider: process.env.GATEWAY_QA_REAL_LLM === '1' ? new OllamaProvider({ model: process.env.LLM_MODEL ?? 'qwen3.5:4b' }) : null });
const server = createGatewayServer({ gateway: f.gateway, agentRuntime, credentials: [
  { token: 'test-only-operator-'.repeat(4), principal: 'qa-operator', tenant: 'demo', role: 'operator' },
  { token: 'test-only-viewer-'.repeat(4), principal: 'qa-viewer', tenant: 'demo', role: 'viewer' },
] });
server.listen(8788, '127.0.0.1', () => console.log('Disposable browser QA host: http://127.0.0.1:8788 (in-memory state, simulated adapters only).'));
server.on('error', () => { console.error('QA host could not bind port 8788.'); f.store.close(); process.exitCode = 1; });
const close = () => { agentRuntime.close(); server.close(() => { f.store.close(); }); server.closeIdleConnections(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
