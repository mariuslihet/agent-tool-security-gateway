import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';
import { VERSION } from '../src/version.js';
import { buildWorkspaceReport } from '../src/investigation.js';
import { workspaceHealth } from '../src/workspace-health.js';

// Generated exclusively from an isolated, ephemeral demonstration gateway.
// No configured credentials, local database or live operator information are read.
const { gateway, store, registry, policy } = createDemo({ masterKey: randomBytes(32).toString('hex') });
const run = (sessionId, id, tool, args) => gateway.execute('demo-agent', sessionId, { id, tool, arguments: args });
try {
  gateway.alerts.configure({ tenant: 'demo', actor: 'sample-operator' }, { expectedVersion: 0, title: 'Repeated blocked requests', category: 'denials', threshold: 2, windowMinutes: 15, enabled: true, reason: 'Demonstrate local threshold monitoring.' });
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
  await run(clean, 'sum', 'compute.sum', { numbers: [999] });
  const firstIncident = gateway.incidents.list('demo').items[0];
  gateway.incidents.update({ tenant: 'demo', actor: 'sample-operator' }, firstIncident.id, { expectedVersion: firstIncident.version, state: 'acknowledged', owner: 'security-team', reason: 'Reviewing this isolated sample event.' });
  gateway.containment.hold({ tenant: 'demo', actor: 'sample-operator' }, { kind: 'session', target: untrusted, expectedRevision: 0, durationMinutes: 30, reason: 'Quarantine this isolated sample task while reviewing external instructions.' });
  gateway.containment.hold({ tenant: 'demo', actor: 'sample-operator' }, { kind: 'tool', target: 'payment.send', expectedRevision: 0, durationMinutes: 15, reason: 'Pause simulated payments for an operator review.' });
  const audit = store.auditPage('demo', { limit: 100 });
  const sessions = gateway.sessions('demo', { limit: 100 });
  const details = Object.fromEntries(sessions.items.map(s => [s.id, { session: gateway.inspectSession('demo', s.id), events: store.auditPage('demo', { session: s.id, limit: 25 }).items }]));
  const output = {
    sample: true, generatedAt: Date.now(),
    status: { identity: { principal: 'sample-viewer', tenant: 'demo', role: 'viewer' }, version: VERSION, policy: { version: policy.data.version, hash: policy.hash }, registryHash: registry.hash,
      audit: { valid: null, verifiedAt: null }, statistics: store.statistics('demo'), approvals: gateway.approvals('demo'), events: audit.items.slice(0, 8), operations: { incidents: gateway.incidents.counts('demo'), safety: gateway.safety.get('demo') } },
    policy: { policy: policy.data, hash: policy.hash, tools: registry.list(), writable: false },
    sessions, details, audit: { ...audit, nextCursor: null }, incidents: gateway.incidents.list('demo'), safety: gateway.safety.get('demo'),
    requests: gateway.requests.list('demo', { limit: 100 }),
    containment: gateway.containment.list('demo'), health: workspaceHealth(gateway, 'demo'),
    requestDetails: Object.fromEntries(gateway.requests.list('demo', { limit: 100 }).items.map(r => [`${r.sessionId}:${r.requestId}`, gateway.requests.get('demo', r.sessionId, r.requestId)])),
    alertRules: { items: gateway.alerts.rules('demo') }, alerts: gateway.alerts.list('demo'), workspaceReport: { sample: true, report: buildWorkspaceReport(gateway, 'demo') },
  };
  writeFileSync(new URL('../web/preview.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
  console.log(`Built isolated sample workspace: ${sessions.items.length} sessions, ${audit.items.length} audit events. No live state was accessed.`);
} finally { store.close(); }
