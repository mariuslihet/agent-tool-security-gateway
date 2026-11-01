import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';
import { createGatewayServer } from '../src/server.js';

// Disposable test host. Known fixture tokens authorize only an in-memory demo gateway.
// It never opens .env, the persistent database or real side-effecting adapters.
const f = createDemo({ masterKey: randomBytes(32).toString('hex') });
const { sessionId } = f.gateway.createSession('demo-agent');
await f.gateway.execute('demo-agent', sessionId, { id: 'qa-publish', tool: 'report.publish', arguments: { url: 'https://reports.example.com/daily', body: 'Disposable browser QA summary.' } });
const server = createGatewayServer({ gateway: f.gateway, credentials: [
  { token: 'test-only-operator-'.repeat(4), principal: 'qa-operator', tenant: 'demo', role: 'operator' },
  { token: 'test-only-viewer-'.repeat(4), principal: 'qa-viewer', tenant: 'demo', role: 'viewer' },
] });
server.listen(8788, '127.0.0.1', () => console.log('Disposable browser QA host: http://127.0.0.1:8788 (in-memory state, simulated adapters only).'));
server.on('error', () => { console.error('QA host could not bind port 8788.'); f.store.close(); process.exitCode = 1; });
const close = () => { server.close(() => { f.store.close(); }); server.closeIdleConnections(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
