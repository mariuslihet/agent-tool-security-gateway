import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, report, admin, testTool, allowTool } from './helpers.js';
import { runPolicySuite } from '../src/policy-lab.js';
import { digest } from '../src/util.js';
import { readFileSync } from 'node:fs';

const operator = { tenant: 'demo', actor: 'reviewer' };
const pause = (f, input = {}) => f.gateway.safety.pause(operator, { expectedRevision: 0, scope: 'all', durationMinutes: 30, reason: 'Investigating a test signal.', ...input });

test('all-tool pause blocks reservations without consuming call/cost budgets and expires automatically', async t => {
  const f = fixture(t), baseline = f.store.session(f.sessionId); pause(f, { durationMinutes: 1 });
  const paused = await f.run('knowledge.read', { document: 'handbook' }, 'same');
  assert.equal(paused.status, 'paused'); assert.equal(paused.retryable, true); assert.equal(paused.code, 'TENANT_PAUSED');
  assert.equal(f.store.session(f.sessionId).calls, baseline.calls); assert.equal(f.store.session(f.sessionId).cost, baseline.cost);
  assert.equal(f.store.request(f.sessionId, 'same'), null);
  f.advance(60000); assert.equal(f.gateway.safety.get('demo').status, 'expired');
  assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'same')).status, 'completed');
});
test('outbound-only pause permits internal tools and is shared across child sessions', async t => {
  const f = fixture(t), child = f.gateway.createSession('demo-agent', { parentId: f.sessionId }).sessionId;
  pause(f, { scope: 'outbound' });
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).status, 'completed');
  const result = await f.gateway.execute('demo-agent', child, { id: 'publish', tool: 'report.publish', arguments: report });
  assert.equal(result.code, 'TENANT_PAUSED'); assert.equal(f.gateway.approvals('demo').length, 0);
});
test('pause preserves exact-request approval for a later retry and does not consume it', async t => {
  const f = fixture(t), p = await f.run('report.publish', report, 'approved');
  f.gateway.decideApproval(admin, { sessionId: f.sessionId, requestId: 'approved', binding: p.binding, decision: 'approve' });
  const hold = pause(f);
  assert.equal((await f.run('report.publish', report, 'approved')).code, 'TENANT_PAUSED');
  assert.equal(f.store.request(f.sessionId, 'approved').approval.state, 'approved');
  f.gateway.safety.resume(operator, { expectedRevision: hold.revision, reason: 'Investigation complete.' });
  assert.equal((await f.run('report.publish', report, 'approved')).status, 'completed');
});
test('cached outcomes remain readable during a pause; stale hold revisions cannot resume a newer pause', async t => {
  const f = fixture(t); const cached = await f.run('knowledge.read', { document: 'handbook' }, 'cached');
  const first = pause(f), second = pause(f, { expectedRevision: first.revision, scope: 'outbound' });
  assert.deepEqual(await f.run('knowledge.read', { document: 'handbook' }, 'cached'), cached);
  assert.throws(() => f.gateway.safety.resume(operator, { expectedRevision: first.revision, reason: 'Stale request.' }), /VERSION_CONFLICT/);
  assert.equal(f.gateway.safety.get('demo').revision, second.revision);
});
test('resuming containment cannot clear provenance, revocation or normal policy denials', async t => {
  const f = fixture(t); await f.run('vault.read', { record: 'invoice' }); const hold = pause(f);
  f.gateway.safety.resume(operator, { expectedRevision: hold.revision, reason: 'Stop temporary hold only.' });
  assert.equal((await f.run('report.publish', report)).code, 'SENSITIVE_EGRESS_DENIED');
  assert.equal((await f.run('payment.send', { account: 'vendor-approved', amountCents: 100001 })).status, 'denied');
  f.gateway.revoke(admin, { type: 'tool', value: 'knowledge.read' });
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).code, 'REVOKED');
});
test('a pause does not cancel an already reserved operation', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { policy: allowTool('slow.tool'), register: registry => registry.register(testTool('slow.tool'), async () => { await wait; return { text: 'done' }; }) });
  const running = f.run('slow.tool', {}, 'running'); pause(f); release();
  assert.equal((await running).status, 'completed');
});
test('incident grouping counts new source evaluations, avoids cached retry inflation and reopens on recurrence', async t => {
  const f = fixture(t); await f.run('vault.read', { record: 'invoice' });
  await f.run('report.publish', report, 'first'); await f.run('report.publish', report, 'first');
  const [initial] = f.gateway.incidents.list('demo').items; assert.equal(initial.occurrences, 1); assert.equal(initial.severity, 'high');
  await f.run('report.publish', report, 'second');
  const grouped = f.gateway.incidents.get('demo', initial.id); assert.equal(grouped.occurrences, 2);
  f.gateway.incidents.update(operator, initial.id, { expectedVersion: grouped.version, state: 'resolved', owner: 'security-team', reason: 'Reviewed test data classification.' });
  await f.run('report.publish', report, 'third');
  const reopened = f.gateway.incidents.get('demo', initial.id); assert.equal(reopened.state, 'open'); assert.equal(reopened.occurrences, 3); assert.equal(reopened.owner, 'security-team');
  assert.ok(f.store.events('demo').some(e => e.type === 'incident.reopened'));
});
test('incident updates require matching versions, isolate tenants and redact operator notes', async t => {
  const f = fixture(t); await f.run('external.read', { document: 'web-page' }); await f.run('report.publish', report);
  const [incident] = f.gateway.incidents.list('demo').items;
  assert.deepEqual(f.gateway.incidents.list('other').items, []);
  assert.throws(() => f.gateway.incidents.get('other', incident.id), /INCIDENT_NOT_FOUND/);
  const updated = f.gateway.incidents.update(operator, incident.id, { expectedVersion: incident.version, state: 'acknowledged', reason: 'api_key=synthetic_private_note_value' });
  assert.equal(updated.notes[0].text, '[REDACTED]');
  assert.throws(() => f.gateway.incidents.update(operator, incident.id, { expectedVersion: incident.version, state: 'resolved', reason: 'Stale disposition.' }), /VERSION_CONFLICT/);
  assert.ok(!JSON.stringify(f.store.events('demo')).includes('synthetic_private_note_value'));
});
test('resolving an incident does not resume safety controls or erase the incident evidence', async t => {
  const f = fixture(t); await f.run('vault.read', { record: 'invoice' }); await f.run('report.publish', report);
  const [incident] = f.gateway.incidents.list('demo').items; pause(f);
  f.gateway.incidents.update(operator, incident.id, { expectedVersion: incident.version, state: 'resolved', reason: 'Evidence reviewed; containment retained.' });
  assert.equal(f.gateway.safety.get('demo').active, true); assert.equal(f.gateway.incidents.get('demo', incident.id).state, 'resolved');
});
test('uncertain execution and idempotency conflicts produce incident records without raw arguments', async t => {
  const f = fixture(t, { policy: allowTool('broken.tool'), register: registry => registry.register(testTool('broken.tool'), () => { throw new Error('private_exception_payload'); }) });
  await f.run('broken.tool', {}, 'broken');
  await f.run('knowledge.read', { document: 'handbook' }, 'same');
  await f.run('knowledge.read', { document: 'different' }, 'same');
  const incidents = f.gateway.incidents.list('demo').items;
  assert.ok(incidents.some(i => i.code === 'EXECUTION_UNCERTAIN')); assert.ok(incidents.some(i => i.code === 'IDEMPOTENCY_CONFLICT'));
  assert.ok(incidents.every(i => i.sessionId === f.sessionId)); assert.ok(!JSON.stringify(incidents).includes('private_exception_payload'));
});
test('safety input validation and audit failure cannot leave a partially applied pause', t => {
  const f = fixture(t);
  for (const input of [{ durationMinutes: 0 }, { durationMinutes: 1441 }, { scope: 'anything' }, { reason: 'x' }, { expectedRevision: -1 }]) assert.throws(() => pause(f, input));
  f.store.db.exec("CREATE TRIGGER fail_safety_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'offline'); END;");
  assert.throws(() => pause(f)); assert.equal(f.gateway.safety.get('demo').revision, 0);
});
test('incident projection failures roll back the source evaluation rather than bypassing logging', async t => {
  const f = fixture(t); await f.run('vault.read', { record: 'invoice' });
  f.store.db.exec("CREATE TRIGGER fail_incident BEFORE INSERT ON incidents BEGIN SELECT RAISE(ABORT,'offline'); END;");
  const result = await f.run('report.publish', report, 'failed-incident');
  assert.equal(result.code, 'GATEWAY_UNAVAILABLE'); assert.equal(f.store.request(f.sessionId, 'failed-incident'), null);
});
test('policy regression suite is bounded, detects changed decisions and never modifies runtime state', t => {
  const f = fixture(t), before = digest(f.store.session(f.sessionId)), auditBefore = f.store.verifyAudit().count;
  const cases = JSON.parse(readFileSync(new URL('../policies/regression.json', import.meta.url), 'utf8'));
  const result = runPolicySuite({ registry: f.registry, policy: f.policy, tenant: 'demo', cases });
  assert.equal(result.passed, 8); assert.equal(result.failed, 0); assert.equal(result.execution, false);
  assert.equal(result.policyHash, f.policy.hash); assert.equal(result.suiteHash, digest(cases)); assert.ok(result.generatedAt > 0);
  cases[0].expected.decision = 'deny';
  assert.equal(runPolicySuite({ registry: f.registry, policy: f.policy, tenant: 'demo', cases }).failed, 1);
  assert.equal(digest(f.store.session(f.sessionId)), before); assert.equal(f.store.verifyAudit().count, auditBefore);
  for (const invalid of [[], Array(51).fill(cases[0]), [cases[0], cases[0]], [{ ...cases[0], identity: 'forged' }]]) assert.throws(() => runPolicySuite({ registry: f.registry, policy: f.policy, tenant: 'demo', cases: invalid }), /INVALID_SUITE/);
});
