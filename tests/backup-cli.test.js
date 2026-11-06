import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fixture } from './helpers.js';
import { Store } from '../src/store.js';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gateway-backup-cli-')), masterKey = randomBytes(32).toString('hex'), passphrase = 'test-only-backup-cli-phrase-63312', database = join(directory, 'live.sqlite');
  const f = fixture(null, { path: database, key: masterKey }), sessionId = f.sessionId; f.store.close();
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('gateway-backup-cli-')); rmSync(directory, { recursive: true, force: true }); });
  return { directory, database, masterKey, passphrase, sessionId, archive: join(directory, 'archive.backup'), restored: join(directory, 'restored.sqlite') };
}
function run(f, args, overrides = {}) {
  return new Promise((resolveResult, reject) => {
    const env = { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), GATEWAY_DB: f.database, GATEWAY_MASTER_KEY: f.masterKey, GATEWAY_BACKUP_PASSPHRASE: f.passphrase, ...overrides };
    const child = spawn(process.execPath, ['src/cli.js', ...args], { cwd: new URL('..', import.meta.url), env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 65536) child.kill(); }); child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 65536) child.kill(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolveResult({ code, stdout, stderr }); });
  });
}
function privateOutput(f, result) {
  const text = result.stdout + result.stderr;
  for (const privateValue of [f.masterKey, f.passphrase, f.database, f.archive, f.restored]) assert.ok(!text.includes(privateValue), 'CLI output exposed private configuration');
}

test('host backup CLI creates, verifies and restores a new database without printing private values', async t => {
  const f = setup(t);
  const created = await run(f, ['backup', f.archive]); assert.equal(created.code, 0, created.stderr); privateOutput(f, created); assert.equal(JSON.parse(created.stdout).encrypted, true);
  const verified = await run(f, ['verify-backup', f.archive]); assert.equal(verified.code, 0, verified.stderr); privateOutput(f, verified); assert.equal(JSON.parse(verified.stdout).verifiedOnly, true); assert.equal(existsSync(f.restored), false);
  const restored = await run(f, ['restore-backup', f.archive, f.restored]); assert.equal(restored.code, 0, restored.stderr); privateOutput(f, restored); assert.equal(JSON.parse(restored.stdout).leasesCleared, true);
  const copy = new Store(f.restored, f.masterKey); try { assert.equal(copy.session(f.sessionId).tenant, 'demo'); assert.equal(copy.verifyAudit().valid, true); } finally { copy.close(); }
  const archiveBefore = readFileSync(f.archive), targetBefore = readFileSync(f.restored);
  const repeatBackup = await run(f, ['backup', f.archive]), repeatRestore = await run(f, ['restore-backup', f.archive, f.restored]);
  for (const failed of [repeatBackup, repeatRestore]) { assert.equal(failed.code, 1); assert.match(failed.stderr, /BACKUP_TARGET_EXISTS/); privateOutput(f, failed); }
  assert.deepEqual(readFileSync(f.archive), archiveBefore); assert.deepEqual(readFileSync(f.restored), targetBefore);
});

test('host backup CLI rejects missing arguments, credentials and wrong recovery secrets without disclosure', async t => {
  const f = setup(t);
  for (const args of [['backup'], ['verify-backup'], ['restore-backup', f.archive], ['backup', f.archive, 'unexpected']]) {
    const result = await run(f, args); assert.equal(result.code, 1); assert.match(result.stderr, /BACKUP_ARGUMENTS_REQUIRED/); privateOutput(f, result);
  }
  const noMaster = await run(f, ['backup', f.archive], { GATEWAY_MASTER_KEY: '' }); assert.equal(noMaster.code, 1); assert.match(noMaster.stderr, /MASTER_KEY_REQUIRED/); privateOutput(f, noMaster);
  const noPassword = await run(f, ['backup', f.archive], { GATEWAY_BACKUP_PASSPHRASE: '' }); assert.equal(noPassword.code, 1); assert.match(noPassword.stderr, /BACKUP_PASSPHRASE_REQUIRED/); privateOutput(f, noPassword); assert.equal(existsSync(f.archive), false);
  assert.equal((await run(f, ['backup', f.archive])).code, 0);
  const wrong = await run(f, ['restore-backup', f.archive, f.restored], { GATEWAY_BACKUP_PASSPHRASE: 'incorrect-test-recovery-phrase' }); assert.equal(wrong.code, 1); assert.match(wrong.stderr, /BACKUP_AUTHENTICATION_FAILED/); privateOutput(f, wrong); assert.equal(existsSync(f.restored), false);
  assert.ok(!(wrong.stdout + wrong.stderr).includes('incorrect-test-recovery-phrase'));
});

test('host backup CLI refuses a missing source instead of creating an empty gateway database', async t => {
  const f = setup(t), missing = join(f.directory, 'missing-source.sqlite');
  const result = await run(f, ['backup', f.archive], { GATEWAY_DB: missing });
  assert.equal(result.code, 1); assert.equal(existsSync(missing), false); assert.equal(existsSync(f.archive), false); assert.ok(!(result.stdout + result.stderr).includes(missing)); privateOutput(f, result);
});
