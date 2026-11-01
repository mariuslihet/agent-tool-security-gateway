import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { readOnlyFilesAdapter, readOnlySqliteAdapter } from '../src/adapters.js';

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-resource-'));
  t.after(() => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-resource-')); rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
test('named file adapter bounds reads and denies traversal and unknown logical names', async t => {
  const dir = temporary(t), root = join(dir, 'documents'); mkdirSync(root);
  writeFileSync(join(root, 'guide.txt'), 'Approved text'); writeFileSync(join(dir, 'outside.txt'), 'Private text');
  const adapter = readOnlyFilesAdapter({ root, documents: { guide: 'guide.txt', escape: '../outside.txt' }, maxBytes: 100 });
  const context = { signal: new AbortController().signal };
  assert.deepEqual(await adapter({ document: 'guide' }, context), { text: 'Approved text' });
  await assert.rejects(adapter({ document: 'escape' }, context), /INVALID_PATH/);
  await assert.rejects(adapter({ document: '../../outside.txt' }, context), /DOCUMENT_DENIED/);
  const small = readOnlyFilesAdapter({ root, documents: { guide: 'guide.txt' }, maxBytes: 2 });
  await assert.rejects(small({ document: 'guide' }, context), /DOCUMENT_TOO_LARGE/);
});
test('named SQLite queries bind injection strings as data and prohibit writes', async t => {
  const dir = temporary(t), path = join(dir, 'records.sqlite');
  const db = new DatabaseSync(path); db.exec("CREATE TABLE records (name TEXT); INSERT INTO records VALUES ('public'),('private');"); db.close();
  const adapter = readOnlySqliteAdapter({ path, queries: { find: 'SELECT name FROM records WHERE name = ?', bad: 'DELETE FROM records', all: 'SELECT name FROM records' }, maxRows: 1 });
  const context = { signal: new AbortController().signal };
  assert.deepEqual(await adapter({ query: 'find', parameters: ['public'] }, context), { rows: [{ name: 'public' }] });
  assert.deepEqual(await adapter({ query: 'find', parameters: ["' OR 1=1 --"] }, context), { rows: [] });
  await assert.rejects(adapter({ query: 'bad', parameters: [] }, context), /readonly/);
  await assert.rejects(adapter({ query: 'all', parameters: [] }, context), /ROW_LIMIT_EXCEEDED/);
  await assert.rejects(adapter({ query: 'SELECT * FROM records', parameters: [] }, context), /QUERY_DENIED/);
});
