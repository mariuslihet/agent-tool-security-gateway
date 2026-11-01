import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fixture, report, admin } from './helpers.js';
import { createGatewayServer } from '../src/server.js';
import { validatePolicyDocument, previewPolicy } from '../src/policy-lab.js';
import { Policy } from '../src/policy.js';
import { digest } from '../src/util.js';

async function host(t) {
  const f = fixture(t), tokens = Object.fromEntries(['operator', 'viewer', 'agent', 'other'].map(role => [role, randomBytes(32).toString('hex')]));
  const server = createGatewayServer({ gateway: f.gateway, credentials: [
    { token: tokens.operator, principal: 'reviewer', tenant: 'demo', role: 'operator' },
    { token: tokens.viewer, principal: 'observer', tenant: 'demo', role: 'viewer' },
    { token: tokens.agent, principal: 'demo-agent', tenant: 'demo', role: 'agent' },
    { token: tokens.other, principal: 'other-observer', tenant: 'other', role: 'viewer' },
  ] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, role = 'viewer', body) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${tokens[role]}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ...f, request, base };
}
test('viewer can inspect the control plane but cannot approve, revoke or execute', async t => {
  const f = await host(t), p = await f.run('report.publish', report, 'review');
  for (const path of ['/v1/operator/status', '/v1/operator/policy', '/v1/operator/sessions', '/v1/operator/audit']) assert.equal((await f.request(path)).status, 200, path);
  const status = await (await f.request('/v1/operator/status')).json(); assert.equal(status.identity.role, 'viewer');
  assert.equal((await f.request('/v1/operator/approvals', 'viewer', { sessionId: f.sessionId, requestId: 'review', binding: p.binding, decision: 'approve' })).status, 403);
  assert.equal((await f.request('/v1/operator/revocations', 'viewer', { type: 'session', value: f.sessionId })).status, 403);
  assert.equal((await f.request('/v1/sessions', 'viewer', {})).status, 403);
});
test('audit cursors are tenant-bound, filter-bound, stable under new inserts and tamper-resistant', async t => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) await f.run('knowledge.read', { document: 'handbook' }, `r${i}`);
  const first = f.store.auditPage('demo', { limit: 3, type: 'execution.started' }); assert.equal(first.items.length, 3); assert.ok(first.nextCursor);
  await f.run('knowledge.read', { document: 'handbook' }, 'new');
  const second = f.store.auditPage('demo', { limit: 3, type: 'execution.started', cursor: first.nextCursor });
  assert.ok(second.items.every(x => x.sequence < first.items.at(-1).sequence)); assert.equal(second.snapshot, first.snapshot);
  assert.throws(() => f.store.auditPage('other', { cursor: first.nextCursor, type: 'execution.started' }), /INVALID_CURSOR/);
  assert.throws(() => f.store.auditPage('demo', { cursor: first.nextCursor, type: 'execution.finished' }), /INVALID_CURSOR/);
  assert.throws(() => f.store.auditPage('demo', { cursor: first.nextCursor + 'x', type: 'execution.started' }), /INVALID_CURSOR/);
});
test('audit search is literal and rejects invalid query shapes and unbounded limits', async t => {
  const f = await host(t); await f.run('knowledge.read', { document: 'handbook' }, 'find-this-request');
  const data = await (await f.request('/v1/operator/audit?search=find-this-request&limit=2')).json(); assert.equal(data.items.length, 2);
  assert.ok(data.items.every(e => e.request === 'find-this-request'));
  const injection = await (await f.request('/v1/operator/audit?search=' + encodeURIComponent("' OR 1=1 --"))).json(); assert.equal(injection.items.length, 0);
  for (const query of ['limit=0', 'limit=1000', 'limit=1&limit=2', 'sort=arbitrary', 'from=-1', 'from=20&to=10', 'type=%27']) assert.equal((await f.request('/v1/operator/audit?' + query)).status, 400, query);
});
test('audit export is tenant-scoped, bounded and includes a continuation manifest', async t => {
  const f = await host(t);
  f.store.transaction(() => { for (let i = 0; i < 1005; i++) f.store.append({ tenant: 'demo', type: 'test.event', request: `e${i}` }); f.store.append({ tenant: 'other', type: 'test.event', request: 'private-other' }); });
  const response = await f.request('/v1/operator/audit/export?type=test.event');
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8'); assert.ok(response.headers.get('content-disposition').includes('attachment'));
  const lines = (await response.text()).trim().split('\n').map(JSON.parse), manifest = lines[0];
  assert.equal(manifest.count, 1000); assert.equal(manifest.truncated, true); assert.ok(manifest.nextCursor);
  assert.equal(lines.length, 1001); assert.ok(lines.slice(1).every(e => e.tenant === 'demo' && e.previous && e.signature));
  const continuation = await f.request('/v1/operator/audit/export?type=test.event&cursor=' + encodeURIComponent(manifest.nextCursor));
  const tail = (await continuation.text()).trim().split('\n').map(JSON.parse); assert.equal(tail[0].count, 5); assert.equal(tail[0].truncated, false);
});
test('session inspection hides other tenants and never returns request payloads', async t => {
  const f = await host(t); await f.run('report.publish', report);
  const response = await f.request(`/v1/operator/sessions/${f.sessionId}`); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.session.principal, 'demo-agent'); assert.ok(data.session.grants.length);
  assert.ok(!JSON.stringify(data).includes(report.body));
  assert.equal((await f.request(`/v1/operator/sessions/${f.sessionId}`, 'other')).status, 400);
  assert.deepEqual((await (await f.request('/v1/operator/sessions', 'other')).json()).items, []);
});
test('session snapshots paginate with authenticated cursors', t => {
  const f = fixture(t); for (let i = 0; i < 5; i++) f.gateway.createSession('demo-agent');
  const first = f.gateway.sessions('demo', { limit: 2 }); assert.equal(first.items.length, 2);
  f.gateway.createSession('demo-agent');
  const second = f.gateway.sessions('demo', { limit: 2, cursor: first.nextCursor }); assert.equal(second.items.length, 2);
  assert.ok(second.items.every(s => !first.items.some(x => x.id === s.id)));
  assert.throws(() => f.gateway.sessions('other', { cursor: first.nextCursor }), /INVALID_CURSOR/);
});
test('session inspector reflects inherited classification, revocation and expiry', async t => {
  const f = fixture(t), child = f.gateway.createSession('demo-agent', { parentId: f.sessionId }).sessionId;
  await f.run('vault.read', { record: 'invoice' });
  assert.ok(f.gateway.inspectSession('demo', child).labels.includes('sensitive'));
  f.gateway.revoke(admin, { type: 'session', value: f.sessionId });
  assert.equal(f.gateway.inspectSession('demo', child).status, 'revoked');
  const other = fixture(t); other.advance(3600001); assert.equal(other.gateway.inspectSession('demo', other.sessionId).status, 'expired');
});
test('policy studio previews hard restrictions and rule explanations without mutating authority', async t => {
  const f = await host(t), before = digest(f.store.session(f.sessionId)), auditBefore = f.store.verifyAudit().count;
  const candidate = structuredClone(f.policy.data); candidate.rules = [{ id: 'broad', tools: ['*'], effect: 'allow', when: [] }];
  const body = { policy: candidate, tool: 'report.publish', arguments: report, labels: ['sensitive'] };
  const response = await f.request('/v1/operator/policy/preview', 'viewer', body); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.execution, false); assert.equal(data.candidate.code, 'SENSITIVE_EGRESS_DENIED'); assert.equal(data.candidate.capabilityChecks, false);
  assert.ok(data.candidate.explanation.rules.some(r => r.matched));
  assert.equal(digest(f.store.session(f.sessionId)), before); assert.equal(f.store.verifyAudit().count, auditBefore); assert.equal(f.gateway.policy.hash, f.policy.hash);
});
test('policy studio validation diagnoses broad grants and malformed contracts', t => {
  const f = fixture(t), candidate = structuredClone(f.policy.data); candidate.rules.push({ id: 'broad', tools: ['*'], effect: 'allow', when: [] });
  const result = validatePolicyDocument(candidate, f.registry); assert.equal(result.valid, true); assert.ok(result.diagnostics.some(d => d.code === 'BROAD_ALLOW'));
  assert.equal(validatePolicyDocument({ version: 'broken' }, f.registry).valid, false);
});
test('policy preview mirrors redaction and strict validation without exposing secret arguments', t => {
  const f = fixture(t), context = { registry: f.registry, policy: f.policy, tenant: 'demo', tool: 'report.publish', arguments: { ...report, body: 'Contact alice@example.com' } };
  const result = previewPolicy(context); assert.equal(result.decision, 'approval'); assert.equal(result.transformed, true); assert.ok(!JSON.stringify(result).includes('alice@example.com'));
  const bad = previewPolicy({ ...context, arguments: { ...report, extra: true } }); assert.equal(bad.code, 'UNKNOWN_ARGUMENT');
  const deny = new Policy({ ...structuredClone(f.policy.data), rules: [] }); assert.equal(previewPolicy({ ...context, policy: deny }).decision, 'deny');
});
test('approval notes are encrypted, redacted for display and only fingerprinted in audit', async t => {
  const f = fixture(t), p = await f.run('report.publish', report, 'note');
  f.gateway.decideApproval(admin, { sessionId: f.sessionId, requestId: 'note', binding: p.binding, decision: 'approve', reason: 'api_key=synthetic_private_note_value' });
  const note = f.gateway.approvals('demo')[0]; assert.equal(note.reason, '[REDACTED]'); assert.equal(note.approver, 'reviewer'); assert.ok(note.decidedAt);
  const event = f.store.events('demo').find(e => e.type === 'approval.approved'); assert.ok(event.reasonHash); assert.ok(!JSON.stringify(event).includes('synthetic_private'));
});
test('readiness fails on corrupted audit state and correlation/rate headers are provided', async t => {
  const f = await host(t); const response = await f.request('/v1/operator/status'); assert.ok(response.headers.get('x-request-id')); assert.equal(response.headers.get('x-ratelimit-limit'), '120');
  assert.equal((await fetch(f.base + '/readyz')).status, 200);
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=1').run('{'); f.store.verifyAudit();
  const ready = await fetch(f.base + '/readyz'); assert.equal(ready.status, 503); assert.deepEqual(await ready.json(), { status: 'unavailable' });
});
test('public sample workspace is isolated data and cannot grant control-plane access', async t => {
  const f = await host(t), preview = await (await fetch(f.base + '/preview.json')).json();
  assert.equal(preview.sample, true); assert.equal(preview.status.identity.role, 'viewer'); assert.equal(preview.status.audit.valid, null);
  assert.ok(preview.sessions.items.length > 0); assert.ok(!JSON.stringify(preview).includes('GATEWAY_MASTER_KEY'));
  const response = await fetch(f.base + '/v1/operator/status'); assert.equal(response.status, 401);
});

test('expensive control-plane operations have a separate rate budget with retry guidance', async t => {
  const f = await host(t);
  for (let i = 0; i < 6; i++) assert.equal((await f.request('/v1/operator/audit/verify', 'viewer', {})).status, 200);
  const limited = await f.request('/v1/operator/audit/export'); assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0); assert.equal((await limited.json()).code, 'RATE_LIMITED');
  assert.equal((await f.request('/v1/operator/status')).status, 200);
});
test('corruption detected while browsing audit records latches readiness and prevents new dispatch', async t => {
  const f = await host(t); await f.run('knowledge.read', { document: 'handbook' }, 'before-corruption');
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=1').run('{}');
  assert.equal((await f.request('/v1/operator/audit')).status, 503);
  assert.equal(f.store.readiness(), false);
  assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'after-corruption')).code, 'GATEWAY_UNAVAILABLE');
});
test('approval notes reject oversized or non-text input before changing the pending record', async t => {
  const f = fixture(t), p = await f.run('report.publish', report, 'bounded-note');
  for (const reason of ['x'.repeat(501), { approve: true }, 'invalid\0note']) assert.throws(() => f.gateway.decideApproval(admin, { sessionId: f.sessionId, requestId: 'bounded-note', binding: p.binding, decision: 'approve', reason }), /INVALID_REASON/);
  assert.equal(f.gateway.approvals('demo')[0].state, 'pending');
});

test('malformed candidate policies are client errors rather than gateway failures', async t => {
  const f = await host(t);
  for (const policy of [null, [], { ...structuredClone(f.policy.data), rules: [null] }]) {
    const response = await f.request('/v1/operator/policy/preview', 'viewer', { policy, tool: 'knowledge.read', arguments: { document: 'handbook' } });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID_POLICY');
  }
});
