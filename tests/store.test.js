import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { Gateway } from '../src/gateway.js';
import { fixture, report, admin, testTool, allowTool } from './helpers.js';

test('encrypted pending requests and single-use approvals survive process restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex');
  let store;
  t.after(() => { store?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-')); rmSync(dir, { recursive: true, force: true }); });
  const f = fixture(null, { path, key });
  const args = { ...report, body: 'Unique confidential body 1209' };
  const pending = await f.run('report.publish', args, 'durable');
  const session = f.sessionId; f.store.close();
  assert.ok(!readFileSync(path).toString('utf8').includes(args.body));
  store = new Store(path, key);
  const gateway = new Gateway({ store, registry: f.registry, policy: f.policy, profiles: f.profiles, clock: () => 1700000000001 });
  gateway.decideApproval(admin, { sessionId: session, requestId: 'durable', binding: pending.binding, decision: 'approve' });
  const result = await gateway.execute('demo-agent', session, { id: 'durable', tool: 'report.publish', arguments: args });
  assert.equal(result.status, 'completed'); assert.equal(store.verifyAudit().valid, true);
});
test('audit detects modified records, broken links and wrong encryption keys', t => {
  const f = fixture(t); assert.equal(f.store.verifyAudit().valid, true);
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=1').run(JSON.stringify({ type: 'forged' }));
  assert.equal(f.store.verifyAudit().valid, false);
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=1').run('{');
  assert.equal(f.store.verifyAudit().valid, false);
  assert.throws(() => f.gateway.createSession('demo-agent'), /AUDIT_CORRUPTED/);
});
test('transactions roll back state when mandatory audit storage fails', async t => {
  const f = fixture(t), before = f.store.session(f.sessionId).calls;
  f.store.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'offline'); END;");
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).code, 'GATEWAY_UNAVAILABLE');
  assert.equal(f.store.session(f.sessionId).calls, before);
});
test('wrong master key is rejected on reopen', t => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex');
  t.after(() => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-')); rmSync(dir, { recursive: true, force: true }); });
  const first = new Store(path, key); first.close();
  assert.throws(() => new Store(path, randomBytes(32).toString('hex')), /WRONG_MASTER_KEY/);
});
test('persistent running records never auto-reexecute after interruption', async t => {
  const f = fixture(t);
  const request = { id: 'crash', tool: 'knowledge.read', arguments: { document: 'handbook' } };
  await f.gateway.execute('demo-agent', f.sessionId, request);
  const r = f.store.request(f.sessionId, 'crash'); r.status = 'running'; delete r.result; f.store.saveRequest(r);
  assert.equal((await f.gateway.execute('demo-agent', f.sessionId, request)).code, 'IN_FLIGHT_OR_INTERRUPTED');
});
test('output budgets block delivery after a tool executes and do not retry side effects', async t => {
  const f = fixture(t, { limits: { maxOutputBytes: 5 } });
  assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'large')).code, 'OUTPUT_BUDGET_EXCEEDED');
  assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'large')).code, 'OUTPUT_BUDGET_EXCEEDED');
  assert.equal(f.store.events('demo').filter(e => e.type === 'execution.started').length, 1);
});

test('encrypted state cannot be moved to another request or tenant index', async t => {
  const f = fixture(t);
  await f.run('knowledge.read', { document: 'handbook' }, 'one');
  await f.run('knowledge.read', { document: 'handbook' }, 'two');
  const ciphertext = f.store.db.prepare('SELECT data FROM requests WHERE session=? AND id=?').get(f.sessionId, 'one').data;
  f.store.db.prepare('UPDATE requests SET data=? WHERE session=? AND id=?').run(ciphertext, f.sessionId, 'two');
  assert.throws(() => f.store.request(f.sessionId, 'two'), /STORAGE_INTEGRITY_FAILURE/);
  f.store.db.prepare('UPDATE sessions SET tenant=? WHERE id=?').run('other', f.sessionId);
  assert.throws(() => f.store.session(f.sessionId), /STORAGE_INTEGRITY_FAILURE/);
  assert.throws(() => f.store.pending('other'), /STORAGE_INTEGRITY_FAILURE/);
});

test('audit failure after an external effect yields uncertainty and prevents redispatch', async t => {
  let calls = 0, f;
  f = fixture(t, { policy: allowTool('effect.tool'), register: registry => registry.register(testTool('effect.tool'), () => {
    calls++;
    f.store.db.exec("CREATE TRIGGER fail_after_effect BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'offline'); END;");
    return { text: 'effect happened' };
  }) });
  const first = await f.run('effect.tool', {}, 'effect');
  assert.equal(first.status, 'indeterminate'); assert.equal(first.code, 'PERSISTENCE_FAILURE');
  f.store.db.exec('DROP TRIGGER fail_after_effect');
  assert.equal((await f.run('effect.tool', {}, 'effect')).code, 'IN_FLIGHT_OR_INTERRUPTED');
  assert.equal(calls, 1); assert.equal(f.store.session(f.sessionId).active, 1);
});
