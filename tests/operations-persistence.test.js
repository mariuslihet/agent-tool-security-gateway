import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Store } from '../src/store.js';
import { Gateway } from '../src/gateway.js';
import { fixture, report } from './helpers.js';

test('scoped containment revisions and private reasons survive restart encrypted without rewriting audit history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-scoped-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex');
  let store, f;
  try {
    f = fixture(null, { path, key });
    const hold = f.gateway.containment.hold({ tenant: 'demo', actor: 'reviewer' }, { kind: 'session', target: f.sessionId, expectedRevision: 0, durationMinutes: 30, reason: 'private-containment-note-5172' });
    f.gateway.containment.release({ tenant: 'demo', actor: 'reviewer' }, { kind: 'session', target: f.sessionId, expectedRevision: hold.revision, reason: 'private-release-note-4712' });
    const signature = f.store.db.prepare('SELECT signature FROM audit ORDER BY seq DESC LIMIT 1').get().signature;
    f.store.close(); f = { ...f, store: null };
    const bytes = readFileSync(path).toString(); assert.ok(!bytes.includes('private-containment-note-5172')); assert.ok(!bytes.includes('private-release-note-4712'));
    store = new Store(path, key); const gateway = new Gateway({ store, registry: f.registry, policy: f.policy, profiles: f.profiles, clock: () => 1700000000000 });
    const record = gateway.containment.get('demo', 'session', f.sessionId); assert.equal(record.revision, 2); assert.equal(record.state, 'released'); assert.equal(record.reason, 'private-containment-note-5172'); assert.equal(record.releaseReason, 'private-release-note-4712');
    assert.equal(store.db.prepare('SELECT signature FROM audit ORDER BY seq DESC LIMIT 1').get().signature, signature); assert.equal(store.verifyAudit().valid, true);
  } finally {
    f?.store?.close(); store?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-scoped-')); rmSync(dir, { recursive: true, force: true });
  }
});

test('another process enforces inherited session quarantine and tenant tool holds from shared SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-scoped-process-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'), f = fixture(null, { path, key });
  try {
    const childSession = f.gateway.createSession('demo-agent', { parentId: f.sessionId }).sessionId;
    const independent = f.gateway.createSession('demo-agent').sessionId;
    for (const [kind, target] of [['session', f.sessionId], ['tool', 'knowledge.read']]) f.gateway.containment.hold({ tenant: 'demo', actor: 'reviewer' }, { kind, target, expectedRevision: 0, durationMinutes: 15, reason: 'Shared-process containment verification' });
    const source = `import {createDemo} from './src/demo.js';
      const f=createDemo({path:process.env.QA_DB,masterKey:process.env.QA_KEY,clock:()=>1700000000000});
      try{const results=[];for(const session of [process.env.QA_CHILD,process.env.QA_INDEPENDENT])results.push(await f.gateway.execute('demo-agent',session,{id:'cross-process',tool:'knowledge.read',arguments:{document:'handbook'}}));console.log(JSON.stringify(results));}finally{f.store.close();}`;
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('..', import.meta.url), env: { ...process.env, QA_DB: path, QA_KEY: key, QA_CHILD: childSession, QA_INDEPENDENT: independent }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '', errors = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { errors += b; }); child.on('error', reject);
      child.on('close', code => { try { assert.equal(code, 0, errors); resolveResult(JSON.parse(output)); } catch (error) { reject(error); } });
    });
    assert.equal(result[0].code, 'SESSION_QUARANTINED'); assert.equal(result[1].code, 'TOOL_PAUSED');
    assert.equal(f.store.session(childSession).calls, 0); assert.equal(f.store.session(independent).calls, 0); assert.equal(f.store.verifyAudit().valid, true);
  } finally {
    f.store.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-scoped-process-')); rmSync(dir, { recursive: true, force: true });
  }
});

test('request metadata backfills on reopen and encrypted alert rules and notes retain their versions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-insights-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex');
  let store, f;
  try {
    f = fixture(null, { path, key }); const identity = { tenant: 'demo', actor: 'reviewer' };
    const rule = f.gateway.alerts.configure(identity, { expectedVersion: 0, title: 'private-rule-title-1191', category: 'denials', threshold: 1, windowMinutes: 15, enabled: true, reason: 'Persistence verification' });
    await f.run('unknown.tool', {}, 'stored-request'); const alert = f.gateway.alerts.list('demo').items[0];
    f.gateway.alerts.update(identity, alert.id, { expectedVersion: alert.version, state: 'acknowledged', reason: 'private-alert-note-7312' });
    const originalAudit = f.store.db.prepare('SELECT signature FROM audit ORDER BY seq DESC LIMIT 1').get().signature;
    f.store.db.exec('DROP TABLE request_index'); f.store.close(); f = { ...f, store: null };
    assert.ok(!readFileSync(path).toString().includes('private-rule-title-1191')); assert.ok(!readFileSync(path).toString().includes('private-alert-note-7312'));
    store = new Store(path, key); const gateway = new Gateway({ store, registry: f.registry, policy: f.policy, profiles: f.profiles });
    assert.equal(gateway.requests.list('demo').items[0].requestId, 'stored-request'); assert.equal(gateway.requests.list('demo').items[0].status, 'denied');
    assert.equal(gateway.alerts.rules('demo')[0].id, rule.id); assert.equal(gateway.alerts.rules('demo')[0].version, 1);
    const reopened = gateway.alerts.list('demo').items[0]; assert.equal(reopened.state, 'acknowledged'); assert.equal(reopened.notes[0].text, 'private-alert-note-7312');
    assert.equal(store.db.prepare('SELECT signature FROM audit ORDER BY seq DESC LIMIT 1').get().signature, originalAudit); assert.equal(store.verifyAudit().valid, true);
    store.db.prepare('UPDATE console_alerts SET state=? WHERE id=?').run('resolved', alert.id);
    assert.throws(() => gateway.alerts.list('demo'), /STORAGE_INTEGRITY_FAILURE/);
  } finally {
    f?.store?.close(); store?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-insights-')); rmSync(dir, { recursive: true, force: true });
  }
});

test('incident notes and safety reasons survive restart in encrypted state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-ops-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex');
  let store;
  try {
    const f = fixture(null, { path, key });
    await f.run('vault.read', { record: 'invoice' }); await f.run('report.publish', report);
    const [incident] = f.gateway.incidents.list('demo').items;
    const reason = 'unique-private-investigation-note-1821';
    f.gateway.incidents.update({ tenant: 'demo', actor: 'reviewer' }, incident.id, { expectedVersion: incident.version, state: 'acknowledged', reason });
    f.gateway.safety.pause({ tenant: 'demo', actor: 'reviewer' }, { expectedRevision: 0, scope: 'all', durationMinutes: 30, reason });
    f.store.close(); assert.ok(!readFileSync(path).toString().includes(reason));
    store = new Store(path, key);
    const gateway = new Gateway({ store, registry: f.registry, policy: f.policy, profiles: f.profiles, clock: () => 1700000000001 });
    assert.equal(gateway.incidents.get('demo', incident.id).state, 'acknowledged'); assert.equal(gateway.incidents.get('demo', incident.id).notes[0].text, reason);
    assert.equal(gateway.safety.get('demo').active, true); assert.equal(store.verifyAudit().valid, true);
    const encrypted = store.db.prepare('SELECT data FROM incidents WHERE id=?').get(incident.id).data;
    store.db.prepare('UPDATE incidents SET state=? WHERE id=?').run('resolved', incident.id);
    assert.throws(() => gateway.incidents.get('demo', incident.id), /STORAGE_INTEGRITY_FAILURE/);
    assert.ok(!encrypted.includes(reason));
  } finally {
    store?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-ops-')); rmSync(dir, { recursive: true, force: true });
  }
});

test('a second process observes the same tenant pause before reserving a tool', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-pause-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex');
  const f = fixture(null, { path, key });
  try {
    f.gateway.safety.pause({ tenant: 'demo', actor: 'reviewer' }, { expectedRevision: 0, scope: 'all', durationMinutes: 30, reason: 'Shared-process containment test.' });
    const source = `import {createDemo} from './src/demo.js';
      const f=createDemo({path:process.env.QA_DB,masterKey:process.env.QA_KEY,clock:()=>1700000000000});
      try{console.log(JSON.stringify(await f.gateway.execute('demo-agent',process.env.QA_SESSION,{id:'child',tool:'knowledge.read',arguments:{document:'handbook'}})));}finally{f.store.close();}`;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('..', import.meta.url), env: { ...process.env, QA_DB: path, QA_KEY: key, QA_SESSION: f.sessionId }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let data = '', error = ''; child.stdout.on('data', b => { data += b; }); child.stderr.on('data', b => { error += b; });
      child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0, error); resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    assert.equal(result.code, 'TENANT_PAUSED'); assert.equal(f.store.session(f.sessionId).calls, 0); assert.equal(f.store.verifyAudit().valid, true);
  } finally {
    f.store.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-pause-')); rmSync(dir, { recursive: true, force: true });
  }
});
