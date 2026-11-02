import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, report } from './helpers.js';
import { buildWorkspaceReport } from '../src/investigation.js';
import { digest } from '../src/util.js';
const identity = { tenant: 'demo', actor: 'reviewer' };
const rule = { expectedVersion: 0, title: 'Repeated denials', category: 'denials', threshold: 2, windowMinutes: 5, enabled: true, reason: 'Monitor repeated boundary denials.' };

test('request explorer returns explicit metadata and exact request timelines without arguments or cached outputs', async t => {
  const f = fixture(t); await f.run('text.encode', { text: 'private-body-7091' }, 'encode');
  await f.run('knowledge.read', { document: 'handbook' }, 'encode-other');
  const page = f.gateway.requests.list('demo'); assert.equal(page.items.length, 2);
  const detail = f.gateway.requests.get('demo', f.sessionId, 'encode');
  assert.ok(detail.events.length >= 2); assert.ok(detail.events.every(e => e.request === 'encode'));
  assert.equal(detail.argumentsIncluded, false); assert.equal(detail.outputsIncluded, false);
  const text = JSON.stringify([page, detail]); assert.ok(!text.includes('private-body-7091')); assert.ok(!text.includes('output":'));
  assert.equal(f.gateway.requests.list('other').items.length, 0);
  assert.throws(() => f.gateway.requests.get('other', f.sessionId, 'encode'), /REQUEST_NOT_FOUND/);
});

test('request cursors bind tenant and filters, reject tampering and exclude later inserts', async t => {
  const f = fixture(t); for (let i = 0; i < 4; i++) await f.run('knowledge.read', { document: 'handbook' }, 'r' + i);
  const page = f.gateway.requests.list('demo', { limit: 2, status: 'completed' }); assert.ok(page.nextCursor);
  await f.run('knowledge.read', { document: 'handbook' }, 'later');
  const next = f.gateway.requests.list('demo', { limit: 2, status: 'completed', cursor: page.nextCursor }); assert.equal(next.items.length, 2); assert.ok(next.items.every(r => r.requestId !== 'later'));
  for (const [tenant, options] of [['other', { status: 'completed' }], ['demo', { status: 'denied' }], ['demo', { status: 'completed', search: '%' }]]) assert.throws(() => f.gateway.requests.list(tenant, { ...options, cursor: page.nextCursor }), /INVALID_CURSOR/);
  assert.throws(() => f.gateway.requests.list('demo', { status: 'completed', cursor: page.nextCursor + 'x' }), /INVALID_CURSOR/);
  assert.throws(() => f.gateway.requests.list('demo', { limit: 1001 }), /INVALID_QUERY/);
  assert.equal(f.gateway.requests.list('demo', { search: '%' }).items.length, 0);
});

test('argument inspection redacts known secrets, audits the reason hash and fails before disclosure when auditing fails', async t => {
  const f = fixture(t); await f.run('text.encode', { text: 'password=abc12345 person@example.com' }, 'inspect');
  const input = { sessionId: f.sessionId, requestId: 'inspect', reason: 'private inspection reason 7310' };
  const data = f.gateway.requests.inspect(identity, input); assert.ok(!JSON.stringify(data).includes('abc12345')); assert.ok(!JSON.stringify(data).includes('person@example.com'));
  const audit = f.store.events('demo'); assert.equal(audit[0].type, 'request.inspected'); assert.equal(audit[0].reasonHash, digest(input.reason)); assert.ok(!JSON.stringify(audit).includes(input.reason));
  assert.throws(() => f.gateway.requests.inspect(identity, { ...input, reason: 'x' }), /INVALID_INSPECTION/);
  assert.throws(() => f.gateway.requests.inspect({ ...identity, tenant: 'other' }, input), /REQUEST_NOT_FOUND/);
  f.store.append = () => { throw new Error('audit unavailable'); };
  assert.throws(() => f.gateway.requests.inspect(identity, input), /audit unavailable/);
});

test('request index authentication rejects modified status or cross-tenant metadata', async t => {
  const f = fixture(t); await f.run('knowledge.read', { document: 'handbook' }, 'one');
  f.store.db.prepare('UPDATE request_index SET status=? WHERE session=?').run('denied', f.sessionId);
  assert.throws(() => f.gateway.requests.list('demo'), /STORAGE_INTEGRITY_FAILURE/);
});

test('threshold alerts deduplicate, avoid replay inflation, isolate tenants and reopen only after cooldown', async t => {
  const f = fixture(t); f.gateway.alerts.configure(identity, rule);
  await f.run('unknown.tool', {}, 'one'); assert.equal(f.gateway.alerts.list('demo').items.length, 0);
  await f.run('unknown.tool', {}, 'two'); let a = f.gateway.alerts.list('demo').items[0]; assert.equal(a.count, 2);
  await f.run('unknown.tool', {}, 'two'); assert.equal(f.gateway.alerts.list('demo').items[0].version, a.version);
  await f.run('unknown.tool', {}, 'three'); a = f.gateway.alerts.list('demo').items[0]; assert.equal(a.count, 3); assert.equal(f.gateway.alerts.list('demo').items.length, 1);
  assert.equal(f.gateway.alerts.list('other').items.length, 0);
  assert.throws(() => f.gateway.alerts.update({ ...identity, tenant: 'other' }, a.id, { expectedVersion: a.version, state: 'resolved', reason: 'Not in this tenant' }), /ALERT_NOT_FOUND/);
  f.gateway.alerts.update(identity, a.id, { expectedVersion: a.version, state: 'resolved', reason: 'Investigated repeated denied calls.' });
  await f.run('unknown.tool', {}, 'four'); assert.equal(f.gateway.alerts.list('demo').items[0].state, 'resolved');
  f.advance(300001); await f.run('unknown.tool', {}, 'five'); assert.equal(f.gateway.alerts.list('demo').items[0].state, 'resolved');
  await f.run('unknown.tool', {}, 'six'); assert.equal(f.gateway.alerts.list('demo').items[0].state, 'open'); assert.equal(f.store.verifyAudit().valid, true);
});

test('alert rule revisions and dispositions require exact versions and encrypted notes', async t => {
  const f = fixture(t), created = f.gateway.alerts.configure(identity, { ...rule, threshold: 1 });
  assert.throws(() => f.gateway.alerts.configure(identity, { ...rule, id: created.id }), /VERSION_CONFLICT/);
  await f.run('unknown.tool', {}, 'one'); const a = f.gateway.alerts.list('demo').items[0];
  const reason = 'private-investigation-9981'; f.gateway.alerts.update(identity, a.id, { expectedVersion: a.version, state: 'acknowledged', reason });
  assert.throws(() => f.gateway.alerts.update(identity, a.id, { expectedVersion: a.version, state: 'resolved', reason }), /VERSION_CONFLICT/);
  assert.ok(!f.store.db.prepare('SELECT data FROM console_alerts WHERE id=?').get(a.id).data.includes(reason)); assert.ok(!JSON.stringify(f.store.events('demo')).includes(reason));
  f.gateway.alerts.configure(identity, { ...rule, id: created.id, expectedVersion: 1, enabled: false }); await f.run('unknown.tool', {}, 'two'); assert.equal(f.gateway.alerts.list('demo').items.length, 1);
  f.gateway.alerts.configure(identity, { ...rule, id: created.id, expectedVersion: 2, threshold: 1 }); await f.run('unknown.tool', {}, 'three'); assert.equal(f.gateway.alerts.list('demo').items.length, 2);
});

test('alert windows exclude expired signals, enforce caps and validate configuration before changes', async t => {
  const f = fixture(t); f.gateway.alerts.configure(identity, rule); await f.run('unknown.tool', {}, 'one'); f.advance(300001); await f.run('unknown.tool', {}, 'two'); assert.equal(f.gateway.alerts.list('demo').items.length, 0);
  for (const input of [{ threshold: 0 }, { threshold: 1001 }, { windowMinutes: 0 }, { category: 'arbitrary' }, { enabled: 'true' }, { reason: '' }]) assert.throws(() => f.gateway.alerts.configure(identity, { ...rule, ...input }), /INVALID_ALERT_RULE/);
  for (let i = 1; i < 20; i++) f.gateway.alerts.configure(identity, rule);
  assert.throws(() => f.gateway.alerts.configure(identity, rule), /ALERT_RULE_LIMIT/);
});

test('mandatory alert persistence failures roll back the source evaluation and rule audit failures roll back configuration', async t => {
  const f = fixture(t); const append = f.store.append.bind(f.store);
  f.store.append = e => { if (e.type === 'alert.rule_configured') throw new Error('audit offline'); return append(e); };
  assert.throws(() => f.gateway.alerts.configure(identity, rule), /audit offline/); assert.equal(f.gateway.alerts.rules('demo').length, 0);
  f.store.append = append; f.gateway.alerts.configure(identity, { ...rule, threshold: 1 });
  f.store.append = e => { if (e.type === 'alert.opened') throw new Error('alert audit offline'); return append(e); };
  const result = await f.run('unknown.tool', {}, 'one'); assert.notEqual(result.code, 'OK'); assert.equal(f.store.request(f.sessionId, 'one'), null); assert.equal(f.gateway.alerts.list('demo').items.length, 0);
});

test('workspace reports contain only metadata, have a reproducible hash and are audited without including custom content', async t => {
  const f = fixture(t); await f.run('text.encode', { text: 'private-argument-2711' }, 'one');
  f.gateway.alerts.configure(identity, { ...rule, title: 'private-rule-title-5722' });
  const pending = await f.run('report.publish', report, 'approval'); assert.equal(pending.status, 'approval_required');
  const output = buildWorkspaceReport(f.gateway, 'demo'), { reportHash, hashAlgorithm, ...content } = output; assert.equal(digest(content), reportHash); assert.ok(hashAlgorithm.includes('sha256'));
  const text = JSON.stringify(output); for (const value of ['private-argument-2711', 'private-rule-title-5722', report.body, 'arguments":{', 'output":']) assert.ok(!text.includes(value));
  assert.equal(output.requests.completed, 1); assert.equal(output.requests.pending, 1); assert.equal(output.alerts.rules, 1); assert.equal(f.store.events('demo')[0].type, 'workspace.report_generated');
  assert.equal(buildWorkspaceReport(f.gateway, 'other').statistics.sessions, 0);
});
