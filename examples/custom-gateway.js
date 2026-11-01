import { randomBytes } from 'node:crypto';
import { Gateway, Store, Registry, Policy } from '../src/index.js';

const registry = new Registry();
const schema = { type: 'object', properties: { document: { type: 'string', enum: ['public-guide'] } }, required: ['document'], additionalProperties: false };
const fingerprint = registry.register({
  name: 'docs.read', description: 'Read the approved public guide', inputSchema: schema,
  outputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 1024 } }, required: ['text'], additionalProperties: false },
  egress: false, outputLabels: [], cost: 1, timeoutMs: 1000,
}, () => ({ text: 'Content from a host-controlled source.' }));
const policy = new Policy({ version: 'custom-v1', limits: { maxArgumentBytes: 8192, maxOutputBytes: 8192, approvalTtlMs: 60000 }, rules: [{ id: 'read-guide', tools: ['docs.read'], effect: 'allow', when: [] }] });
// Ephemeral key only for this executable example. Persistent storage needs a stable protected key.
const store = new Store(':memory:', randomBytes(32).toString('hex'));
const gateway = new Gateway({ store, registry, policy, profiles: [{ id: 'guide-agent', tenant: 'example', grants: [{ tool: 'docs.read', fingerprint, values: { document: ['public-guide'] }, origins: [] }], limits: { maxCalls: 10, maxConcurrent: 1, maxCost: 10, maxOutputBytes: 8192, ttlMs: 60000 } }] });
try {
  const { sessionId } = gateway.createSession('guide-agent');
  console.log(await gateway.execute('guide-agent', sessionId, { id: 'read-1', tool: 'docs.read', arguments: { document: 'public-guide' } }));
} finally { store.close(); }
