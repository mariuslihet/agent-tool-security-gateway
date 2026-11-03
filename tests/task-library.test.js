import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
const create = f => new AgentRuntime({ gateway: f.gateway, provider: { model: 'library-test', complete: async () => ({ role: 'assistant', content: 'Generated answer' }) } });
const organize = (agent, run, extra = {}) => agent.library.organize('demo', run.id, { expectedRevision: run.organization.revision, title: 'Research task', tags: ['research'], pinned: false, archived: false, ...extra }, 'reviewer');
const template = { expectedRevision: 0, title: 'Arithmetic helper', prompt: 'Use compute.sum for 12 and 18.', toolMode: 'safe', enabled: true };

test('organization is encrypted, audited and independent of conversation revisions and permissions', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'organize', prompt: 'Hello' }); const original = await agent.wait('demo', 'organize'); const session = f.store.session(original.sessionId);
  const saved = organize(agent, original, { title: 'private-title-7341', tags: ['private-tag'], pinned: true }); const after = agent.get('demo', original.id);
  assert.equal(after.revision, original.revision); assert.equal(saved.revision, 1); assert.equal(after.organization.title, 'private-title-7341'); assert.deepEqual(f.store.session(after.sessionId), session); assert.deepEqual(after.allowedTools, original.allowedTools);
  assert.ok(!f.store.db.prepare('SELECT data FROM task_organization').get().data.includes('private-title-7341')); const audit = f.store.events('demo')[0]; assert.equal(audit.type, 'agent.organized'); assert.equal(audit.actor, 'reviewer'); assert.ok(!JSON.stringify(audit).includes('private-title-7341')); assert.ok(!JSON.stringify(audit).includes('private-tag'));
});

test('archive hides a terminal task without deleting it, blocks follow-ups and restores without resetting its budget', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'archive', prompt: 'Hello' }); let run = await agent.wait('demo', 'archive'); organize(agent, run, { archived: true }); run = agent.get('demo', run.id);
  assert.equal(agent.list('demo').total, 0); assert.equal(agent.list('demo', { archive: 'archived' }).total, 1); assert.equal(agent.list('demo', { archive: 'all' }).total, 1);
  assert.throws(() => agent.followUp('demo', run.id, { messageId: 'more', prompt: 'More', expectedRevision: run.revision }), /TASK_ARCHIVED/);
  const originalTurns = run.turns; organize(agent, run, { archived: false }); run = agent.get('demo', run.id); agent.followUp('demo', run.id, { messageId: 'more', prompt: 'More', expectedRevision: run.revision }); const done = await agent.wait('demo', run.id);
  assert.equal(done.turns, originalTurns + 1); assert.equal(done.sessionId, run.sessionId); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n, 1);
});

test('running tasks cannot be archived and concurrent metadata edits are retained when model state commits', async t => {
  const f = fixture(t); let finish; const agent = new AgentRuntime({ gateway: f.gateway, provider: { model: 'library-test', complete: async () => new Promise(resolve => { finish = resolve; }) } });
  agent.start('demo', { id: 'running', prompt: 'Hello' }); await new Promise(resolve => setImmediate(resolve)); const run = agent.get('demo', 'running');
  assert.throws(() => organize(agent, run, { archived: true }), /TASK_NOT_ARCHIVABLE/); organize(agent, run, { pinned: true });
  finish({ role: 'assistant', content: 'Completed' }); const done = await agent.wait('demo', run.id); assert.equal(done.organization.pinned, true); assert.equal(done.state, 'completed');
});

test('task searches are literal, bounded, tenant-scoped and ordered with pins first', async t => {
  const f = fixture(t), agent = create(f);
  for (const id of ['alpha', 'beta', 'gamma']) { agent.start('demo', { id, prompt: 'Hello' }); await agent.wait('demo', id); }
  organize(agent, agent.get('demo', 'alpha'), { title: 'Quarterly arithmetic', tags: ['math'], pinned: true });
  assert.equal(agent.list('demo').items[0].id, 'alpha'); assert.equal(agent.list('demo', { search: 'MATH' }).items[0].id, 'alpha'); assert.equal(agent.list('demo', { search: '%' }).total, 0);
  assert.equal(agent.list('demo', { pinned: 'true' }).total, 1); assert.equal(agent.list('other').total, 0);
  const page = agent.list('demo', { limit: 1 }); assert.equal(page.nextOffset, 1); assert.equal(agent.list('demo', { limit: 1, offset: page.nextOffset }).items.length, 1);
  for (const bad of [{ limit: 101 }, { offset: -1 }, { offset: 101 }, { archive: 'deleted' }, { pinned: true }, { state: 'admin' }]) assert.throws(() => agent.list('demo', bad), /INVALID_QUERY/);
});

test('organization rejects stale edits, invalid tags, extra-long titles and other tenants', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'validation', prompt: 'Hello' }); const run = await agent.wait('demo', 'validation');
  for (const bad of [{ tags: ['UPPER'] }, { tags: ['same', 'same'] }, { tags: ['a'.repeat(33)] }, { tags: Array.from({ length: 9 }, (_, i) => 'tag' + i) }, { title: 'x'.repeat(81) }, { title: '' }, { pinned: 'true' }]) assert.throws(() => organize(agent, run, bad), /INVALID_TASK_ORGANIZATION/);
  organize(agent, run); assert.throws(() => organize(agent, run), /VERSION_CONFLICT/);
  assert.throws(() => agent.library.organize('other', run.id, { expectedRevision: 0, title: 'Other', tags: [], pinned: false, archived: false }, 'reviewer'), /RUN_NOT_FOUND/);
});

test('templates are encrypted, redacted and revision checked without generating a task or granting access', async t => {
  const f = fixture(t), agent = create(f), sessions = f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  const saved = agent.library.saveTemplate('demo', { ...template, prompt: 'private-template-7723 password=abc12345' }, 'reviewer'); assert.ok(!saved.prompt.includes('abc12345')); assert.equal(saved.revision, 1);
  assert.equal(agent.list('demo').total, 0); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, sessions); assert.ok(!f.store.db.prepare('SELECT data FROM task_templates').get().data.includes('private-template-7723')); assert.ok(!JSON.stringify(f.store.events('demo')).includes('private-template-7723'));
  assert.equal(agent.library.templates('other').items.length, 0); assert.throws(() => agent.library.template('other', saved.id), /TEMPLATE_NOT_FOUND/);
  assert.throws(() => agent.library.saveTemplate('demo', { ...template, id: saved.id }, 'reviewer'), /VERSION_CONFLICT/);
  const disabled = agent.library.saveTemplate('demo', { ...template, id: saved.id, expectedRevision: 1, enabled: false }, 'reviewer'); assert.equal(disabled.revision, 2); assert.equal(agent.library.templates('demo', { enabled: 'true' }).items.length, 0); assert.equal(agent.library.templates('demo', { enabled: 'false' }).items.length, 1);
});

test('template bounds reject invalid modes and unbounded input, then cap the durable register', t => {
  const f = fixture(t), agent = create(f);
  for (const bad of [{ title: '' }, { prompt: '' }, { prompt: 'x'.repeat(8001) }, { toolMode: 'admin' }, { expectedRevision: -1 }, { enabled: 'true' }]) assert.throws(() => agent.library.saveTemplate('demo', { ...template, ...bad }, 'reviewer'), /INVALID_TEMPLATE/);
  let first; for (let i = 0; i < 25; i++) { const saved = agent.library.saveTemplate('demo', template, 'reviewer'); first ??= saved; }
  assert.throws(() => agent.library.saveTemplate('demo', template, 'reviewer'), /TEMPLATE_LIMIT/); assert.equal(agent.library.saveTemplate('demo', { ...template, id: first.id, expectedRevision: 1 }, 'reviewer').revision, 2);
});

test('audit failures roll back library changes and encrypted metadata relocation is detected', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'first', prompt: 'Hello' }); await agent.wait('demo', 'first'); agent.start('demo', { id: 'second', prompt: 'Hello' }); await agent.wait('demo', 'second'); const before = agent.get('demo', 'first'), append = f.store.append.bind(f.store);
  f.store.append = () => { throw new Error('audit offline'); }; assert.throws(() => organize(agent, before), /audit offline/); assert.throws(() => agent.library.saveTemplate('demo', template, 'reviewer'), /audit offline/); assert.equal(agent.library.templates('demo').items.length, 0); assert.equal(agent.get('demo', 'first').organization.revision, 0);
  f.store.append = append; organize(agent, before); const row = f.store.db.prepare('SELECT data FROM task_organization WHERE id=?').get('first'); f.store.db.prepare('INSERT INTO task_organization VALUES (?,?,?)').run('second', 'demo', row.data); assert.throws(() => agent.get('demo', 'second'), /STORAGE_INTEGRITY_FAILURE/);
});
