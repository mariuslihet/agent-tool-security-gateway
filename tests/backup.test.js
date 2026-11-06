import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, linkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { fixture, report } from './helpers.js';
import { createBackup, restoreBackup, BACKUP_LIMITS } from '../src/backup.js';

const passphrase = 'test backup recovery phrase 881429';
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gateway-backup-test-')), masterKey = randomBytes(32).toString('hex'), f = fixture(null, { path: join(directory, 'live.sqlite'), key: masterKey });
  t.after(() => { f.store.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('gateway-backup-test-')); rmSync(directory, { recursive: true, force: true }); });
  return { ...f, masterKey, directory, output: join(directory, 'encrypted.backup'), restored: join(directory, 'restored.sqlite') };
}

test('encrypted consistent backup restores all tenants and verifies SQLite, audit and encrypted records', async t => {
  const f = setup(t), sensitive = 'private-backup-payload-98821';
  const pending = await f.run('report.publish', { ...report, body: sensitive }, 'saved-pending'); assert.equal(pending.status, 'approval_required');
  f.gateway.createSession('other-agent');
  f.store.db.prepare('INSERT INTO agent_run_locks VALUES (?,?,?)').run('interrupted-task', 'old-owner', Date.now() + 100000);
  f.store.db.exec('CREATE TABLE IF NOT EXISTS evaluation_locks (id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL)');
  f.store.db.prepare('INSERT INTO evaluation_locks VALUES (?,?,?)').run('interrupted-evaluation', 'old-owner', Date.now() + 100000);
  const before = f.store.verifyAudit().count, result = await createBackup({ store: f.store, output: f.output, passphrase });
  assert.equal(result.encrypted, true); assert.equal(result.auditRecords, before); assert.ok(result.encryptedRecords >= 3);
  const archive = readFileSync(f.output, 'utf8'); assert.ok(!archive.includes(sensitive)); assert.ok(!archive.includes(f.masterKey)); assert.ok(!archive.includes(passphrase)); assert.ok(!archive.includes('demo-agent'));
  assert.equal(f.store.verifyAudit().count, before + 1); assert.equal(f.store.events('system')[0].type, 'backup.created'); assert.ok(!JSON.stringify(f.store.events('system')).includes(f.output));
  const verification = await restoreBackup({ input: f.output, passphrase, masterKey: f.masterKey, verifyOnly: true }); assert.equal(verification.valid, true); assert.equal(verification.leasesCleared, false); assert.equal(readFileSync(f.output, 'utf8'), archive);
  const restored = await restoreBackup({ input: f.output, output: f.restored, passphrase, masterKey: f.masterKey }); assert.equal(restored.leasesCleared, true);
  const copy = new Store(f.restored, f.masterKey);
  try {
    assert.equal(copy.verifyAudit().valid, true); assert.equal(copy.request(f.sessionId, 'saved-pending').arguments.body, sensitive);
    assert.equal(copy.db.prepare('SELECT COUNT(*) AS n FROM agent_run_locks').get().n, 0); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM agent_run_locks').get().n, 1);
    assert.equal(copy.db.prepare('SELECT COUNT(*) AS n FROM evaluation_locks').get().n, 0); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM evaluation_locks').get().n, 1);
    assert.equal(copy.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE tenant='other'").get().n, 1); assert.equal(copy.events('system')[0].type, 'backup.restored');
  } finally { copy.close(); }
});

test('backup and restore never overwrite existing files or SQLite sidecars', async t => {
  const f = setup(t); writeFileSync(f.output, 'existing');
  await assert.rejects(createBackup({ store: f.store, output: f.output, passphrase }), /BACKUP_TARGET_EXISTS/); assert.equal(readFileSync(f.output, 'utf8'), 'existing');
  rmSync(f.output); await createBackup({ store: f.store, output: f.output, passphrase }); writeFileSync(f.restored + '-wal', 'existing-sidecar');
  await assert.rejects(restoreBackup({ input: f.output, output: f.restored, passphrase, masterKey: f.masterKey }), /BACKUP_TARGET_EXISTS/); assert.equal(existsSync(f.restored), false);
  assert.equal(readFileSync(f.restored + '-wal', 'utf8'), 'existing-sidecar');
  await assert.rejects(restoreBackup({ input: f.output, output: f.output, passphrase, masterKey: f.masterKey }), /BACKUP_TARGET_EXISTS/);
});

test('wrong secrets, tampered ciphertext and attacker-selected KDF are rejected without a restore artifact', async t => {
  const f = setup(t); await createBackup({ store: f.store, output: f.output, passphrase });
  await assert.rejects(restoreBackup({ input: f.output, output: f.restored, passphrase: 'wrong recovery passphrase', masterKey: f.masterKey }), /BACKUP_AUTHENTICATION_FAILED/);
  await assert.rejects(restoreBackup({ input: f.output, output: f.restored, passphrase, masterKey: randomBytes(32).toString('hex') }), /WRONG_MASTER_KEY/);
  const original = JSON.parse(readFileSync(f.output, 'utf8')), tampered = { ...original, ciphertext: Buffer.from(original.ciphertext, 'base64').map((x, i) => i ? x : x ^ 1).toString('base64') };
  writeFileSync(f.output, JSON.stringify(tampered)); await assert.rejects(restoreBackup({ input: f.output, output: f.restored, passphrase, masterKey: f.masterKey }), /BACKUP_AUTHENTICATION_FAILED/);
  writeFileSync(f.output, JSON.stringify({ ...original, kdf: 'scrypt-N999999999-r8-p1' })); await assert.rejects(restoreBackup({ input: f.output, output: f.restored, passphrase, masterKey: f.masterKey }), /INVALID_BACKUP_ARCHIVE/);
  assert.equal(existsSync(f.restored), false);
});

test('mandatory backup audit failure removes the artifact and corruption fails before delivery', async t => {
  const f = setup(t), append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('audit unavailable'); };
  await assert.rejects(createBackup({ store: f.store, output: f.output, passphrase }), /audit unavailable/); assert.equal(existsSync(f.output), false); f.store.append = append;
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=1').run('{"type":"forged"}'); await assert.rejects(createBackup({ store: f.store, output: f.output, passphrase }), /AUDIT_CORRUPTED/); assert.equal(existsSync(f.output), false);
});

test('backup verifies encrypted records and bounds passphrases and archives', async t => {
  const f = setup(t);
  for (const password of ['', 'short', ' '.repeat(20), 'x'.repeat(1025)]) await assert.rejects(createBackup({ store: f.store, output: f.output, passphrase: password }), /BACKUP_PASSPHRASE_REQUIRED/);
  f.store.db.prepare('UPDATE sessions SET data=? WHERE id=?').run('invalid-ciphertext', f.sessionId); await assert.rejects(createBackup({ store: f.store, output: f.output, passphrase })); assert.equal(existsSync(f.output), false);
  assert.equal(BACKUP_LIMITS.maxDatabaseBytes, 64 * 1024 * 1024);
  writeFileSync(f.output, '{}'); await assert.rejects(restoreBackup({ input: f.output, passphrase, masterKey: f.masterKey, verifyOnly: true }), /INVALID_BACKUP_ARCHIVE/);
  truncateSync(f.output, BACKUP_LIMITS.maxArchiveBytes + 1); await assert.rejects(restoreBackup({ input: f.output, passphrase, masterKey: f.masterKey, verifyOnly: true }), /INVALID_BACKUP_ARCHIVE/);
});

test('hard-linked archives are rejected and successful backup includes current WAL changes', async t => {
  const f = setup(t); await f.run('text.encode', { text: 'WAL only input' }, 'wal-current');
  await createBackup({ store: f.store, output: f.output, passphrase });
  const linked = join(f.directory, 'linked.backup'); linkSync(f.output, linked);
  await assert.rejects(restoreBackup({ input: linked, passphrase, masterKey: f.masterKey, verifyOnly: true }), /INVALID_BACKUP_ARCHIVE/); rmSync(linked);
  await restoreBackup({ input: f.output, output: f.restored, passphrase, masterKey: f.masterKey });
  const copy = new Store(f.restored, f.masterKey); try { assert.equal(copy.request(f.sessionId, 'wal-current').result.status, 'completed'); } finally { copy.close(); }
});
