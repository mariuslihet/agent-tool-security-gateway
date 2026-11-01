import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';

// Generated exclusively from an isolated, ephemeral demonstration gateway.
// No configured credentials, local database or live operator information are read.
const { gateway, store, registry, policy } = createDemo({ masterKey: randomBytes(32).toString('hex') });
const run = (sessionId, id, tool, args) => gateway.execute('demo-agent', sessionId, { id, tool, arguments: args });
try {
  const clean = gateway.createSession('demo-agent').sessionId;
  for (let i = 0; i < 6; i++) await run(clean, `read-${i}`, 'knowledge.read', { document: 'handbook' });
  await run(clean, 'sum', 'compute.sum', { numbers: [120, 45, 87] });
  await run(clean, 'publish', 'report.publish', { url: 'https://reports.example.com/daily', body: 'The daily operations summary is ready for review.' });
  const sensitive = gateway.createSession('demo-agent').sessionId;
  await run(sensitive, 'invoice', 'vault.read', { record: 'invoice' });
  await run(sensitive, 'encode', 'text.encode', { text: 'Confidential sample record' });
  await run(sensitive, 'publish', 'report.publish', { url: 'https://reports.example.com/daily', body: 'Encoded sample data' });
  const untrusted = gateway.createSession('demo-agent').sessionId;
  await run(untrusted, 'external', 'external.read', { document: 'web-page' });
  await run(untrusted, 'publish', 'report.publish', { url: 'https://reports.example.com/daily', body: 'External sample data' });
  const finance = gateway.createSession('demo-agent').sessionId;
  await run(finance, 'payment', 'payment.send', { account: 'vendor-approved', amountCents: 12500 });
  await run(finance, 'excessive', 'payment.send', { account: 'vendor-approved', amountCents: 100001 });
  const constrained = gateway.createSession('demo-agent', { limits: { maxCalls: 2, maxConcurrent: 1, maxCost: 2, maxOutputBytes: 4096, ttlMs: 3600000 } }).sessionId;
  await run(constrained, 'one', 'knowledge.read', { document: 'handbook' });
  await run(constrained, 'two', 'knowledge.read', { document: 'handbook' });
  await run(constrained, 'three', 'knowledge.read', { document: 'handbook' });
  const revoked = gateway.createSession('demo-agent').sessionId;
  gateway.revoke({ tenant: 'demo', approver: 'sample-operator' }, { type: 'session', value: revoked });
  const audit = store.auditPage('demo', { limit: 100 });
  const sessions = gateway.sessions('demo', { limit: 100 });
  const details = Object.fromEntries(sessions.items.map(s => [s.id, { session: gateway.inspectSession('demo', s.id), events: store.auditPage('demo', { session: s.id, limit: 25 }).items }]));
  const output = {
    sample: true, generatedAt: Date.now(),
    status: { identity: { principal: 'sample-viewer', tenant: 'demo', role: 'viewer' }, version: '0.2.0', policy: { version: policy.data.version, hash: policy.hash }, registryHash: registry.hash,
      audit: { valid: null, verifiedAt: null }, statistics: store.statistics('demo'), approvals: gateway.approvals('demo'), events: audit.items.slice(0, 8) },
    policy: { policy: policy.data, hash: policy.hash, tools: registry.list(), writable: false },
    sessions, details, audit: { ...audit, nextCursor: null },
  };
  writeFileSync(new URL('../web/preview.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
  console.log(`Built isolated sample workspace: ${sessions.items.length} sessions, ${audit.items.length} audit events. No live state was accessed.`);
} finally { store.close(); }
