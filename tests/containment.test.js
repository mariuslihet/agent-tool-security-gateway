import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, report, admin, testTool, allowTool } from './helpers.js';
import { workspaceHealth } from '../src/workspace-health.js';
import { digest } from '../src/util.js';

const operator = { tenant: 'demo', actor: 'reviewer' };
const hold = (f, input = {}) => f.gateway.containment.hold(operator, { kind: 'session', target: f.sessionId, expectedRevision: 0, durationMinutes: 30, reason: 'Investigate a synthetic task.', ...input });
const release = (f, r, reason = 'Investigation complete for this target.') => f.gateway.containment.release(operator, { kind: r.kind, target: r.target, expectedRevision: r.revision, reason });

test('session quarantine blocks a task and existing/new descendants while independent tasks keep running', async t => {
  const f = fixture(t), child = f.gateway.createSession('demo-agent', { parentId: f.sessionId }).sessionId;
  const independent = f.gateway.createSession('demo-agent').sessionId, held = hold(f);
  const grandchild = f.gateway.createSession('demo-agent', { parentId: child }).sessionId;
  for (const session of [f.sessionId, child, grandchild]) {
    const result = await f.gateway.execute('demo-agent', session, { id: 'read', tool: 'knowledge.read', arguments: { document: 'handbook' } });
    assert.equal(result.code, 'SESSION_QUARANTINED'); assert.equal(result.status, 'paused'); assert.equal(result.target, f.sessionId); assert.equal(result.retryable, true);
    assert.equal(f.store.session(session).calls, 0); assert.equal(f.store.session(session).cost, 0); assert.equal(f.store.request(session, 'read'), null);
  }
  assert.equal(f.gateway.inspectSession('demo', child).containment.target, f.sessionId);
  assert.equal((await f.gateway.execute('demo-agent', independent, { id: 'read', tool: 'knowledge.read', arguments: { document: 'handbook' } })).code, 'OK');
  release(f, held); assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'read')).code, 'OK');
});

test('tool holds cover every tenant task without blocking other tools or another tenant', async t => {
  const f = fixture(t); hold(f, { kind: 'tool', target: 'knowledge.read' });
  const another = f.gateway.createSession('demo-agent').sessionId;
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).code, 'TOOL_PAUSED');
  assert.equal((await f.gateway.execute('demo-agent', another, { id: 'read', tool: 'knowledge.read', arguments: { document: 'handbook' } })).code, 'TOOL_PAUSED');
  assert.equal((await f.run('text.encode', { text: 'safe text' })).code, 'OK');
  const other = f.gateway.createSession('other-agent').sessionId;
  assert.equal((await f.gateway.execute('other-agent', other, { id: 'read', tool: 'knowledge.read', arguments: { document: 'handbook' } })).code, 'OK');
  assert.equal(f.gateway.containment.list('other').items.length, 0);
});

test('overlapping tenant, ancestor, child and tool holds must all clear before dispatch', async t => {
  const f = fixture(t), child = f.gateway.createSession('demo-agent', { parentId: f.sessionId }).sessionId;
  const ancestor = hold(f), own = hold(f, { target: child }), tool = hold(f, { kind: 'tool', target: 'knowledge.read' });
  f.gateway.safety.pause(operator, { expectedRevision: 0, scope: 'all', durationMinutes: 30, reason: 'Tenant incident investigation' });
  const run = () => f.gateway.execute('demo-agent', child, { id: 'read', tool: 'knowledge.read', arguments: { document: 'handbook' } });
  assert.equal((await run()).code, 'TENANT_PAUSED'); f.gateway.safety.resume(operator, { expectedRevision: 1, reason: 'Tenant-wide pause reviewed' });
  assert.equal((await run()).code, 'SESSION_QUARANTINED'); release(f, own);
  assert.equal((await run()).target, f.sessionId); release(f, ancestor);
  assert.equal((await run()).code, 'TOOL_PAUSED'); release(f, tool); assert.equal((await run()).code, 'OK');
});

test('expiry automatically removes enforcement and stale revisions cannot release or renew a newer hold', async t => {
  const f = fixture(t), held = hold(f, { durationMinutes: 1 }); f.advance(60000);
  assert.equal(f.gateway.containment.get('demo', 'session', f.sessionId).state, 'expired');
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).code, 'OK');
  const renewed = hold(f, { expectedRevision: held.revision }); assert.equal(renewed.revision, 2);
  assert.throws(() => release(f, held), /VERSION_CONFLICT/); assert.throws(() => hold(f, { expectedRevision: 1 }), /VERSION_CONFLICT/);
  release(f, renewed); assert.equal(f.gateway.containment.get('demo', 'session', f.sessionId).state, 'released');
});

test('quarantine preserves an approved request for the same retry and never consumes its approval', async t => {
  const f = fixture(t), pending = await f.run('report.publish', report, 'publish');
  f.gateway.decideApproval(admin, { sessionId: f.sessionId, requestId: 'publish', binding: pending.binding, decision: 'approve' });
  const held = hold(f), before = f.store.session(f.sessionId);
  assert.equal((await f.run('report.publish', report, 'publish')).code, 'SESSION_QUARANTINED');
  assert.equal(f.store.request(f.sessionId, 'publish').approval.state, 'approved'); assert.equal(f.store.session(f.sessionId).calls, before.calls); assert.equal(f.store.session(f.sessionId).cost, before.cost);
  release(f, held); assert.equal((await f.run('report.publish', report, 'publish')).code, 'OK');
});

test('cached results remain available and release does not clear taint, revocation or policy denials', async t => {
  const f = fixture(t); const done = await f.run('knowledge.read', { document: 'handbook' }, 'cached'); const held = hold(f);
  assert.deepEqual(await f.run('knowledge.read', { document: 'handbook' }, 'cached'), done); release(f, held);
  await f.run('vault.read', { record: 'invoice' }); assert.equal((await f.run('report.publish', report)).code, 'SENSITIVE_EGRESS_DENIED');
  const tool = hold(f, { kind: 'tool', target: 'knowledge.read' }); f.gateway.revoke(admin, { type: 'tool', value: 'knowledge.read' }); release(f, tool);
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).code, 'REVOKED');
  const clean = f.gateway.createSession('demo-agent').sessionId;
  assert.equal((await f.gateway.execute('demo-agent', clean, { id: 'payment', tool: 'payment.send', arguments: { account: 'vendor-approved', amountCents: 100001 } })).code, 'POLICY_DENIED');
});

test('containment does not cancel a tool that was already reserved', async t => {
  let finish, started; const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { register: registry => registry.register(testTool('slow.read'), () => { started(); return new Promise(resolve => { finish = resolve; }); }), policy: allowTool('slow.read') });
  const running = f.run('slow.read', {}); await ready;
  assert.equal(workspaceHealth(f.gateway, 'demo').checks.find(c => c.id === 'running').count, 1);
  hold(f); finish({ text: 'Completed already reserved work' });
  assert.equal((await running).code, 'OK'); assert.equal((await f.run('slow.read', {})).code, 'SESSION_QUARANTINED');
});

test('health reports actual uncertain executions without cached output access', async t => {
  const f = fixture(t, { register: registry => registry.register(testTool('failing.read'), async () => { throw new Error('private-adapter-failure-7912'); }), policy: allowTool('failing.read') });
  assert.equal((await f.run('failing.read', {})).status, 'indeterminate');
  const health = workspaceHealth(f.gateway, 'demo'); assert.equal(health.checks.find(c => c.id === 'uncertain').count, 1); assert.ok(!JSON.stringify(health).includes('private-adapter-failure-7912'));
});

test('scoped target register enforces its deployment bound and still permits renewing an existing target', async t => {
  const f = fixture(t); const original = hold(f);
  for (let i = 1; i < 100; i++) { const target = f.gateway.createSession('demo-agent').sessionId; hold(f, { target }); }
  const extra = f.gateway.createSession('demo-agent').sessionId;
  assert.throws(() => hold(f, { target: extra }), /CONTAINMENT_LIMIT/); assert.equal(f.gateway.containment.list('demo').items.length, 100);
  assert.equal(hold(f, { expectedRevision: original.revision }).revision, 2);
});

test('target identity, ownership, bounded durations and notes are validated before writing', async t => {
  const f = fixture(t), other = f.gateway.createSession('other-agent').sessionId;
  for (const input of [{ kind: 'principal' }, { target: other }, { target: '../escape' }, { durationMinutes: 0 }, { durationMinutes: 1441 }, { reason: 'x' }, { expectedRevision: -1 }, { kind: 'tool', target: 'unregistered.tool' }]) assert.throws(() => hold(f, input));
  assert.equal(f.gateway.containment.list('demo').items.length, 0);
  const reason = 'password=uniquePrivateSecret'; const held = hold(f, { reason });
  assert.ok(!held.reason.includes('uniquePrivateSecret')); assert.ok(!f.store.db.prepare('SELECT data FROM scoped_holds').get().data.includes(reason));
  const event = f.store.events('demo')[0]; assert.equal(event.reasonHash, digest(reason)); assert.ok(!JSON.stringify(event).includes(reason));
  assert.throws(() => f.gateway.containment.get('other', 'session', f.sessionId), /SESSION_NOT_FOUND/);
});

test('mandatory audit failure rolls back both hold and release, and encrypted row relocation is rejected', async t => {
  const f = fixture(t), append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('audit unavailable'); };
  assert.throws(() => hold(f), /audit unavailable/); assert.equal(f.gateway.containment.list('demo').items.length, 0);
  f.store.append = append; const held = hold(f); f.store.append = () => { throw new Error('audit unavailable'); };
  assert.throws(() => release(f, held), /audit unavailable/); assert.equal(f.gateway.containment.get('demo', 'session', f.sessionId).active, true);
  f.store.append = append; const next = f.gateway.createSession('demo-agent').sessionId;
  f.store.db.prepare('UPDATE scoped_holds SET target=? WHERE target=?').run(next, f.sessionId);
  assert.throws(() => f.gateway.containment.get('demo', 'session', next), /STORAGE_INTEGRITY_FAILURE/);
});

test('operational health distinguishes approvals, expiry, uncertainty, configuration drift and containment without payload disclosure', async t => {
  const f = fixture(t); await f.run('report.publish', { ...report, body: 'private-health-body-7211' }, 'review'); hold(f);
  const raw = f.store.session(f.sessionId); raw.policyHash = 'old-configuration'; f.store.saveSession(raw);
  const health = workspaceHealth(f.gateway, 'demo'), checks = Object.fromEntries(health.checks.map(c => [c.id, c]));
  assert.equal(checks.pending.count, 1); assert.equal(checks.holds.count, 1); assert.equal(checks.drift.count, 1); assert.ok(!JSON.stringify(health).includes('private-health-body-7211'));
  f.advance(f.policy.data.limits.approvalTtlMs); const after = Object.fromEntries(workspaceHealth(f.gateway, 'demo').checks.map(c => [c.id, c])); assert.equal(after.expired.count, 1); assert.equal(after.pending.count, 0);
  assert.equal(workspaceHealth(f.gateway, 'other').coverage.sessionSample, 0);
});

test('health sampling is explicitly bounded and never changes audit or execution state', async t => {
  const f = fixture(t); for (let i = 0; i < 100; i++) f.gateway.createSession('demo-agent');
  const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, state = f.store.session(f.sessionId);
  const health = workspaceHealth(f.gateway, 'demo'); assert.equal(health.coverage.sessionSample, 100); assert.equal(health.coverage.sessionsTruncated, true);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, before); assert.deepEqual(f.store.session(f.sessionId), state);
});
