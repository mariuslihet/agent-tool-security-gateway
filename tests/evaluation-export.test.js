import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { DEFAULT_TASK_CHECKS } from '../src/task-checks.js';

async function completed(t, title = 'Review') {
  const f = fixture(t); let calls = 0;
  const runtime = new AgentRuntime({ gateway: f.gateway, provider: { model: 'export-model', complete: async () => { calls++; return { role: 'assistant', content: '{"total":80}' }; } } }), service = runtime.evaluations;
  const suite = service.save('demo', { title, expectedRevision: 0, cases: [{ id: 'sum', prompt: 'private-prompt-8873', toolMode: 'chat_only', criteria: { ...DEFAULT_TASK_CHECKS, structuredOutput: { required: true, numbers: [{ path: 'total', min: 80, max: 80 }] } } }] }, 'reviewer');
  service.start('demo', { id: 'export-run', suiteId: suite.id, expectedRevision: 1 }, 'reviewer'); const run = await service.wait('demo', 'export-run');
  return { ...f, runtime, service, run, calls: () => calls };
}
test('evaluation JSON export is audited, hash verifiable and excludes prompts and hidden suite snapshots', async t => {
  const f = await completed(t), before = f.runtime.get('demo', f.run.results[0].taskId), result = f.service.export('demo', f.run.id, { format: 'json' }, 'reviewer'), parsed = JSON.parse(result.content);
  assert.equal(result.contentHash, createHash('sha256').update(result.content).digest('hex')); assert.equal(parsed.run.results[0].checks.at(-1).value.actual, 80);
  assert.ok(!result.content.includes('private-prompt-8873')); assert.ok(!Object.hasOwn(parsed.run, 'snapshot')); assert.ok(!Object.hasOwn(parsed.run, 'plans')); assert.equal(f.calls(), 1); assert.deepEqual(f.runtime.get('demo', before.id), before);
  const event = f.store.events('demo')[0]; assert.equal(event.type, 'evaluation.exported'); assert.equal(event.contentHash, result.contentHash); assert.ok(!JSON.stringify(event).includes('total'));
});
test('CSV summaries quote values and neutralize spreadsheet formulas including whitespace prefixes', async t => {
  const f = await completed(t, ' \t=SUM(1,2) "quoted"\nnext'), result = f.service.export('demo', f.run.id, { format: 'csv' }, 'reviewer');
  assert.match(result.content, /^"run_id","suite_title"/); assert.ok(result.content.includes('"\'=SUM(1,2) ""quoted""\nnext"')); assert.ok(result.content.includes('"sum"')); assert.ok(result.content.endsWith('\r\n')); assert.equal(result.mediaType, 'text/csv;charset=utf-8');
  assert.equal(result.contentHash, createHash('sha256').update(result.content).digest('hex'));
});
test('exports enforce ownership and format and fail before delivery if mandatory audit fails', async t => {
  const f = await completed(t);
  assert.throws(() => f.service.export('other', f.run.id, { format: 'json' }, 'reviewer'), /EVALUATION_NOT_FOUND/);
  for (const format of ['html', null, {}, 'JSON']) assert.throws(() => f.service.export('demo', f.run.id, { format }, 'reviewer'), /INVALID_EVALUATION_EXPORT/);
  const before = f.store.verifyAudit().count; f.store.append = () => { throw Error('audit unavailable'); };
  assert.throws(() => f.service.export('demo', f.run.id, { format: 'json' }, 'reviewer'), /audit unavailable/); assert.equal(f.store.verifyAudit().count, before); assert.equal(f.calls(), 1);
});
test('an in-progress CSV snapshot retains run identity and state even before the first case finishes', async t => {
  const f = await completed(t); f.service.start('demo', { id: 'running-export', suiteId: f.run.suiteId, expectedRevision: 1 }, 'reviewer');
  const result = f.service.export('demo', 'running-export', { format: 'csv' }, 'reviewer');
  assert.ok(result.content.includes('"running-export","Review","export-model","running"')); assert.ok(result.content.includes('Redacted evaluation snapshot')); assert.equal(result.content.split('\r\n').length, 3);
  await f.service.wait('demo', 'running-export');
});
test('CSV formula protection covers leading control characters that spreadsheets may ignore', async t => {
  const f = await completed(t, '\0\t=1+1'); const result = f.service.export('demo', f.run.id, { format: 'csv' }, 'reviewer');
  assert.ok(result.content.includes('"\'\0\t=1+1"'));
});
