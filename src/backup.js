import { backup, DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, open as openFile, readFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { Store } from './store.js';
import { assert, canonical, open, mac, equal, GatewayError } from './util.js';

export const BACKUP_LIMITS = Object.freeze({ maxDatabaseBytes: 64 * 1024 * 1024, maxArchiveBytes: 90 * 1024 * 1024, minPassphraseChars: 16, maxPassphraseChars: 1024 });
const derive = promisify(scrypt), kdf = 'scrypt-N32768-r8-p1', algorithm = 'aes-256-gcm';
const sha = value => createHash('sha256').update(value).digest('hex');
function password(value) { assert(typeof value === 'string' && value.length >= BACKUP_LIMITS.minPassphraseChars && value.length <= BACKUP_LIMITS.maxPassphraseChars && value.trim().length >= BACKUP_LIMITS.minPassphraseChars && !value.includes('\0'), 'BACKUP_PASSPHRASE_REQUIRED'); }
async function key(passphrase, salt) { return derive(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
async function absent(path) { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
async function freshTarget(path) {
  assert(typeof path === 'string' && path.trim() && !path.includes('\0'), 'INVALID_BACKUP_PATH');
  const target = resolve(path), parent = await realpath(dirname(target));
  const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
  assert(normalized(resolve(parent, basename(target))) === normalized(target), 'UNSAFE_BACKUP_PATH');
  for (const suffix of ['', '-wal', '-shm', '-journal']) assert(await absent(target + suffix), 'BACKUP_TARGET_EXISTS');
  return target;
}
async function temporary() {
  const parent = await realpath(tmpdir()), directory = await mkdtemp(join(parent, 'gateway-backup-'));
  assert(dirname(directory) === parent && basename(directory).startsWith('gateway-backup-'), 'UNSAFE_BACKUP_PATH');
  return { file: join(directory, 'snapshot.sqlite'), cleanup: () => rm(directory, { recursive: true, force: true }) };
}
function inspectDatabase(db, { encryptionKey, auditKey }) {
  db.exec('PRAGMA trusted_schema=OFF;');
  const checks = db.prepare('PRAGMA integrity_check').all(); assert(checks.length === 1 && Object.values(checks[0])[0] === 'ok', 'BACKUP_DATABASE_INVALID');
  let previous = 'genesis', auditRecords = 0, encryptedRecords = 0;
  for (const row of db.prepare('SELECT event,previous,signature FROM audit ORDER BY seq').iterate()) {
    assert(row.previous === previous && equal(row.signature, mac(auditKey, { previous, event: JSON.parse(row.event) })), 'AUDIT_CORRUPTED'); previous = row.signature; auditRecords++;
  }
  // Fixed trusted SQL identifiers only. Future encrypted tables are checked as well.
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all();
  for (const { name } of tables) {
    assert(/^[a-z_]+$/.test(name), 'BACKUP_DATABASE_INVALID');
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all();
    if (!columns.some(column => column.name === 'data')) continue;
    for (const row of db.prepare(`SELECT * FROM "${name}"`).iterate()) {
      const record = open(encryptionKey, row.data); assert(record && typeof record === 'object', 'STORAGE_INTEGRITY_FAILURE');
      if (Object.hasOwn(row, 'tenant')) assert(record.tenant === row.tenant, 'STORAGE_INTEGRITY_FAILURE');
      if (Object.hasOwn(row, 'id') && Object.hasOwn(record, 'id')) assert(record.id === row.id, 'STORAGE_INTEGRITY_FAILURE');
      if (name === 'task_checks') assert(record.run === row.id, 'STORAGE_INTEGRITY_FAILURE');
      if (name === 'sessions') assert(record.id === row.id && record.principal === row.principal, 'STORAGE_INTEGRITY_FAILURE');
      if (name === 'requests') assert(record.id === row.id && record.session === row.session, 'STORAGE_INTEGRITY_FAILURE');
      if (name === 'agent_runs') assert(record.id === row.id && record.principal === row.principal, 'STORAGE_INTEGRITY_FAILURE');
      encryptedRecords++;
    }
  }
  return { auditRecords, encryptedRecords, auditCheckpoint: previous };
}
async function publish(target, bytes) {
  const handle = await openFile(target, 'wx', 0o600), identity = await handle.stat(); let completed = false;
  try { await handle.writeFile(bytes); await handle.sync(); completed = true; return identity; }
  finally { await handle.close(); if (!completed) await removeOwned(target, identity); }
}
async function removeOwned(path, identity) {
  try { const stat = await lstat(path); if (stat.dev === identity.dev && stat.ino === identity.ino && stat.isFile() && !stat.isSymbolicLink()) await rm(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function decode(value, bytes) {
  assert(typeof value === 'string' && value.length % 4 === 0 && (bytes === undefined || value.length === Math.ceil(bytes / 3) * 4), 'INVALID_BACKUP_ARCHIVE');
  const result = Buffer.from(value, 'base64'); assert(result.toString('base64') === value && (bytes === undefined || result.length === bytes), 'INVALID_BACKUP_ARCHIVE'); return result;
}

export async function createBackup({ store, output, passphrase }) {
  password(passphrase); const target = await freshTarget(output), temp = await temporary(); let published;
  try {
    assert(store.verifyAudit().valid, 'AUDIT_CORRUPTED');
    const pageSize = store.db.prepare('PRAGMA page_size').get().page_size, pages = store.db.prepare('PRAGMA page_count').get().page_count;
    assert(pageSize * pages <= BACKUP_LIMITS.maxDatabaseBytes, 'BACKUP_SIZE_LIMIT');
    await backup(store.db, temp.file, { rate: 100, progress: ({ totalPages }) => assert(totalPages * pageSize <= BACKUP_LIMITS.maxDatabaseBytes, 'BACKUP_SIZE_LIMIT') });
    const size = (await lstat(temp.file)).size; assert(size > 0 && size <= BACKUP_LIMITS.maxDatabaseBytes, 'BACKUP_SIZE_LIMIT');
    const db = new DatabaseSync(temp.file, { readOnly: true }); let stats;
    try { stats = inspectDatabase(db, store); } finally { db.close(); }
    const bytes = await readFile(temp.file), salt = randomBytes(16), iv = randomBytes(12), secret = await key(passphrase, salt);
    const header = { version: 1, algorithm, kdf, salt: salt.toString('base64'), iv: iv.toString('base64') };
    const cipher = createCipheriv(algorithm, secret, iv); cipher.setAAD(Buffer.from(canonical(header)));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]); secret.fill(0); bytes.fill(0);
    const archive = Buffer.from(canonical({ ...header, tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
    assert(archive.length <= BACKUP_LIMITS.maxArchiveBytes, 'BACKUP_SIZE_LIMIT'); published = await publish(target, archive);
    const contentHash = sha(archive);
    store.transaction(() => store.append({ type: 'backup.created', tenant: 'system', actor: 'host-cli', contentHash, bytes: archive.length, auditCheckpoint: stats.auditCheckpoint }));
    return { version: 1, encrypted: true, bytes: archive.length, contentHash, ...stats };
  } catch (error) { if (published) await removeOwned(target, published); throw error; }
  finally { await temp.cleanup(); }
}

export async function restoreBackup({ input, output, passphrase, masterKey, verifyOnly = false }) {
  password(passphrase); assert(typeof verifyOnly === 'boolean' && typeof input === 'string' && input.trim() && !input.includes('\0'), 'INVALID_BACKUP_PATH');
  assert(typeof masterKey === 'string' && masterKey.length >= 32, 'MASTER_KEY_REQUIRED');
  const target = verifyOnly ? null : await freshTarget(output), temp = await temporary(); let store;
  try {
    const source = resolve(input), stat = await lstat(source); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= BACKUP_LIMITS.maxArchiveBytes, 'INVALID_BACKUP_ARCHIVE');
    const handle = await openFile(source, 'r'); let archive;
    try {
      const opened = await handle.stat(); assert(opened.dev === stat.dev && opened.ino === stat.ino && opened.size === stat.size, 'INVALID_BACKUP_ARCHIVE');
      const buffer = Buffer.alloc(stat.size + 1); let offset = 0;
      while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
      assert(offset === stat.size, 'INVALID_BACKUP_ARCHIVE'); archive = buffer.subarray(0, offset);
    }
    finally { await handle.close(); }
    assert(archive.length <= BACKUP_LIMITS.maxArchiveBytes, 'BACKUP_SIZE_LIMIT');
    let document; try { document = JSON.parse(archive.toString('utf8')); } catch { throw new GatewayError('INVALID_BACKUP_ARCHIVE'); }
    assert(document && typeof document === 'object' && Object.keys(document).sort().join(',') === 'algorithm,ciphertext,iv,kdf,salt,tag,version' && document.version === 1 && document.algorithm === algorithm && document.kdf === kdf, 'INVALID_BACKUP_ARCHIVE');
    const { tag, ciphertext, ...header } = document, salt = decode(header.salt, 16), iv = decode(header.iv, 12), authTag = decode(tag, 16), encrypted = decode(ciphertext);
    assert(encrypted.length > 0 && encrypted.length <= BACKUP_LIMITS.maxDatabaseBytes, 'BACKUP_SIZE_LIMIT');
    const secret = await key(passphrase, salt), decipher = createDecipheriv(algorithm, secret, iv); let bytes;
    try { decipher.setAAD(Buffer.from(canonical(header))); decipher.setAuthTag(authTag); bytes = Buffer.concat([decipher.update(encrypted), decipher.final()]); }
    catch { throw new GatewayError('BACKUP_AUTHENTICATION_FAILED'); }
    finally { secret.fill(0); }
    assert(bytes.subarray(0, 16).toString('binary') === 'SQLite format 3\0', 'BACKUP_DATABASE_INVALID');
    await publish(temp.file, bytes); bytes.fill(0);
    store = new Store(temp.file, masterKey); const stats = inspectDatabase(store.db, store), contentHash = sha(archive);
    if (!verifyOnly) {
      store.transaction(() => {
        store.db.prepare('DELETE FROM agent_run_locks').run();
        if (store.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='evaluation_locks'").get()) store.db.prepare('DELETE FROM evaluation_locks').run();
        store.append({ type: 'backup.restored', tenant: 'system', actor: 'host-cli', contentHash, restoredCheckpoint: stats.auditCheckpoint });
      });
      store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); store.close(); store = null;
      await publish(target, await readFile(temp.file));
    }
    return { version: 1, valid: true, verifiedOnly: verifyOnly, leasesCleared: !verifyOnly, contentHash, ...stats };
  } finally { store?.close(); await temp.cleanup(); }
}
