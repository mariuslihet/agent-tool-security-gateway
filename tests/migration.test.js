import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { createDemo } from '../src/demo.js';

test('a v0.1-style database gains an indexed view without changing signed events or encrypted state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-migration-')), path = join(dir, 'gateway.sqlite'), key = randomBytes(32).toString('hex');
  let reopened;
  try {
    const f = createDemo({ path, masterKey: key }); const { sessionId } = f.gateway.createSession('demo-agent');
    await f.gateway.execute('demo-agent', sessionId, { id: 'retained', tool: 'knowledge.read', arguments: { document: 'handbook' } });
    const checkpoint = f.store.verifyAudit().checkpoint, original = f.store.session(sessionId);
    f.store.db.exec('DROP TABLE audit_index'); f.store.close();
    reopened = new Store(path, key);
    assert.equal(reopened.verifyAudit().checkpoint, checkpoint); assert.deepEqual(reopened.session(sessionId), original);
    assert.equal(reopened.statistics('demo').counts['execution.started|OK'], 1); assert.equal(reopened.auditPage('demo').items.length, 3);
    assert.equal(reopened.request(sessionId, 'retained').status, 'completed');
  } finally {
    reopened?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-migration-')); rmSync(dir, { recursive: true, force: true });
  }
});
