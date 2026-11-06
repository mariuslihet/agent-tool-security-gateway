import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { DEFAULT_TASK_CHECKS } from '../src/task-checks.js';
import { Policy } from '../src/policy.js';
import { open, seal } from '../src/util.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const scenario = (id = 'one', extra = {}) => ({ id, prompt: 'private-evaluation-marker-7751', toolMode: 'chat_only', criteria: { ...DEFAULT_TASK_CHECKS, structuredOutput: { required: true, numbers: [{ path: 'total', min: 80, max: 80 }] } }, ...extra });
const setup = (t, complete = async () => ({ role: 'assistant', content: '{"total":80}' })) => {
  const f = fixture(t), provider = { model: 'evaluation-model', origin: 'http://127.0.0.1:11434', complete }, runtime = new AgentRuntime({ gateway: f.gateway, provider });
  return { ...f, provider, runtime, service: runtime.evaluations };
};
const save = (f, cases = [scenario()], extra = {}) => f.service.save('demo', { expectedRevision: 0, title: 'Evaluation suite', cases, ...extra }, 'reviewer');
const start = (f, suite, id = 'evaluation-run') => f.service.start('demo', { id, suiteId: suite.id, expectedRevision: suite.revision }, 'reviewer');
const count = (f, table) => f.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('suite definitions are encrypted, revision checked, tenant owned, redacted and bounded to read-only modes', t => {
  const f = setup(t), cases = [scenario()], suite = save(f, cases);
  cases[0].prompt = 'changed after save'; assert.equal(f.service.suite('demo', suite.id).cases[0].prompt, 'private-evaluation-marker-7751');
  assert.equal(f.service.suites('demo')[0].caseCount, 1); assert.equal(f.service.suites('demo')[0].cases, undefined);
  assert.ok(!f.store.db.prepare('SELECT data FROM evaluation_suites').get().data.includes('private-evaluation-marker'));
  assert.ok(!JSON.stringify(f.store.events('demo')[0]).includes('private-evaluation-marker'));
  assert.throws(() => save(f, [scenario()], { id: suite.id }), /VERSION_CONFLICT/);
  assert.throws(() => f.service.suite('other', suite.id), /EVALUATION_NOT_FOUND/);
  assert.throws(() => f.service.save('other', { id: suite.id, expectedRevision: 1, title: 'Forged', cases: [scenario()] }, 'reviewer'), /EVALUATION_NOT_FOUND/);
  for (const toolMode of ['all', 'workspace', 'unknown']) assert.throws(() => save(f, [scenario('one', { toolMode })]), /INVALID_EVALUATION/);
  for (const toolMode of ['safe', 'readonly', 'workspace_readonly']) assert.equal(save(f, [scenario('one', { toolMode })]).cases[0].toolMode, toolMode);
  for (const invalid of [[], Array.from({ length: 9 }, (_, i) => scenario(`case${i}`)), [scenario(), scenario()], [scenario('one', { prompt: ' ' })], [scenario('one', { prompt: 'x'.repeat(8001) })], [scenario('one', { prompt: 'a\0b' })], [scenario('one', { extra: true })]]) assert.throws(() => save(f, invalid), /INVALID_EVALUATION/);
  assert.throws(() => save(f, [scenario('one', { criteria: { ...DEFAULT_TASK_CHECKS, extra: true } })]), /INVALID_TASK_CHECKS/);
  const redacted = save(f, [scenario('one', { prompt: 'password=synthetic-secret-8811' })]); assert.ok(!redacted.cases[0].prompt.includes('synthetic-secret'));
});

test('suite quota rejects new definitions but permits exact-revision edits', t => {
  const f = setup(t); let last;
  for (let i = 0; i < 25; i++) last = save(f, [scenario()], { id: `suite${i}` });
  assert.throws(() => save(f), /EVALUATION_SUITE_LIMIT/);
  assert.equal(save(f, [scenario()], { id: last.id, expectedRevision: 1 }).revision, 2);
});

test('evaluation snapshots stay immutable across suite edits and execute cases sequentially with fixed read-only grants', async t => {
  let inFlight = 0, peak = 0; const prompts = [];
  const f = setup(t, async (messages, tools) => { inFlight++; peak = Math.max(peak, inFlight); prompts.push(messages.find(m => m.role === 'user').content); assert.equal(tools.length, 0); await tick(); inFlight--; return { role: 'assistant', content: '{"total":80}', usage: { inputTokens: 10, outputTokens: 5, modelDurationMs: 1 } }; });
  const suite = save(f, [scenario('one'), scenario('two', { prompt: 'Second original prompt' })]); start(f, suite);
  const updated = save(f, [scenario('changed', { prompt: 'New suite prompt' })], { id: suite.id, expectedRevision: 1 });
  const result = await f.service.wait('demo', 'evaluation-run'); assert.equal(result.state, 'completed'); assert.equal(result.code, 'ALL_CHECKS_PASSED'); assert.equal(peak, 1); assert.equal(result.results.length, 2); assert.equal(result.suiteRevision, 1); assert.equal(updated.revision, 2);
  assert.deepEqual(prompts, ['private-evaluation-marker-7751', 'Second original prompt']); assert.equal(result.snapshot, undefined); assert.equal(result.plans, undefined);
  assert.ok(!JSON.stringify(result).includes('Second original prompt')); assert.equal(result.results[0].usage.inputTokens, 10);
  for (const resultCase of result.results) assert.deepEqual(f.runtime.get('demo', resultCase.taskId).allowedTools, []);
  assert.throws(() => f.service.get('other', result.id), /EVALUATION_NOT_FOUND/); assert.deepEqual(f.service.list('other'), []);
});

test('pass/fail runs use cached IDs without additional inference and support audited comparisons', async t => {
  let calls = 0; const f = setup(t, async () => ({ role: 'assistant', content: JSON.stringify({ total: ++calls === 1 ? 80 : 79 }), usage: { inputTokens: 10, outputTokens: 5, modelDurationMs: 1 } })), suite = save(f), input = { id: 'first', suiteId: suite.id, expectedRevision: 1 };
  f.service.start('demo', input, 'reviewer'); const first = await f.service.wait('demo', 'first'); assert.equal(first.results[0].passed, true);
  assert.equal(f.service.start('demo', input, 'reviewer').id, 'first'); assert.equal(calls, 1);
  assert.throws(() => f.service.start('demo', { ...input, expectedRevision: 2 }, 'reviewer'), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => f.service.start('other', input, 'reviewer'), /EVALUATION_NOT_FOUND/);
  start(f, suite, 'second'); const second = await f.service.wait('demo', 'second'); assert.equal(second.code, 'CHECKS_FAILED');
  const compared = f.service.compare('demo', { left: 'first', right: 'second' }, 'reviewer'); assert.equal(compared.sameSuiteSnapshot, true); assert.equal(compared.results[0].change, 'regressed'); assert.equal(calls, 2);
  assert.equal(compared.results[0].beforeTokens, 15); assert.equal(compared.results[0].afterTokens, 15);
  assert.equal(f.store.events('demo')[0].type, 'evaluation.compared'); assert.throws(() => f.service.compare('other', { left: 'first', right: 'second' }, 'reviewer'), /EVALUATION_NOT_FOUND/);
});

test('suite and start audit failures roll back state and never generate or dispatch', async t => {
  let calls = 0; const f = setup(t, async () => { calls++; return { role: 'assistant', content: '{"total":80}' }; }), suite = save(f), append = f.store.append.bind(f.store);
  f.store.append = event => { if (['evaluation.suite_saved', 'evaluation.started'].includes(event.type)) throw Error('audit unavailable'); return append(event); };
  assert.throws(() => save(f, [scenario()], { id: suite.id, expectedRevision: 1, title: 'Replacement' }), /audit unavailable/); assert.equal(f.service.suite('demo', suite.id).revision, 1);
  assert.throws(() => start(f, suite), /audit unavailable/); await tick(); assert.equal(count(f, 'evaluation_runs'), 0); assert.equal(count(f, 'evaluation_locks'), 0); assert.equal(count(f, 'agent_runs'), 0); assert.equal(calls, 0);
  f.store.append = append;
});

test('cancellation between case planning and dispatch cannot start inference after stop', async t => {
  let calls = 0; const f = setup(t, async () => { calls++; return { role: 'assistant', content: '{"total":80}' }; }), suite = save(f), originalStart = f.runtime.start.bind(f.runtime);
  let canceled = false;
  f.runtime.start = (tenant, input, guard) => { if (!canceled) { canceled = true; f.service.cancel('demo', 'cancel-interleaving', 'reviewer'); } return originalStart(tenant, input, guard); };
  start(f, suite, 'cancel-interleaving'); const result = await f.service.wait('demo', 'cancel-interleaving');
  assert.equal(result.state, 'stopped'); assert.equal(calls, 0); assert.equal(count(f, 'agent_runs'), 0); assert.equal(count(f, 'agent_run_locks'), 0);
});

test('cancel stops the current case and no later case starts; repeated stops remain safe', async t => {
  let finish, calls = 0; const f = setup(t, async () => { calls++; return new Promise(resolve => { finish = resolve; }); }), suite = save(f, [scenario('one'), scenario('two')]);
  start(f, suite, 'stop-active'); await tick(); const active = f.service.get('demo', 'stop-active').activeTask; assert.ok(active);
  const result = f.service.cancel('demo', 'stop-active', 'reviewer'); assert.equal(result.state, 'stopped'); assert.equal(f.runtime.get('demo', active).state, 'stopped');
  assert.equal(f.service.cancel('demo', 'stop-active', 'reviewer').state, 'stopped'); finish({ role: 'assistant', content: '{"total":80}' }); await f.service.wait('demo', 'stop-active'); assert.equal(calls, 1); assert.equal(count(f, 'agent_runs'), 1);
});

test('stopped evaluations can retry child cancellation after its audit failed', async t => {
  let finish; const f = setup(t, async () => new Promise(resolve => { finish = resolve; })), suite = save(f), append = f.store.append.bind(f.store);
  start(f, suite, 'stop-retry'); await tick(); const active = f.service.get('demo', 'stop-retry').activeTask;
  f.store.append = event => { if (event.type === 'agent.stopped') throw Error('child audit unavailable'); return append(event); };
  assert.throws(() => f.service.cancel('demo', 'stop-retry', 'reviewer'), /child audit unavailable/); assert.equal(f.service.get('demo', 'stop-retry').state, 'stopped');
  f.store.append = append; assert.equal(f.service.cancel('demo', 'stop-retry', 'reviewer').state, 'stopped'); assert.equal(f.runtime.get('demo', active).state, 'stopped');
  finish({ role: 'assistant', content: '{"total":80}' }); await f.service.wait('demo', 'stop-retry');
});

test('cancel uses the latest case pointer captured inside its stop transaction', async t => {
  const finishes = []; const f = setup(t, async () => new Promise(resolve => { finishes.push(resolve); })), suite = save(f);
  start(f, suite, 'latest-case'); await tick(); const firstTask = f.service.get('demo', 'latest-case').activeTask;
  f.runtime.start('demo', { id: 'concurrent-next-case', prompt: 'Next case', toolMode: 'chat_only' }); await tick();
  const transaction = f.store.transaction.bind(f.store); let interleaved = false;
  f.store.transaction = fn => {
    if (!interleaved) { interleaved = true; const row = f.store.db.prepare('SELECT data FROM evaluation_runs WHERE id=?').get('latest-case'), changed = open(f.store.encryptionKey, row.data); changed.activeTask = 'concurrent-next-case'; f.store.db.prepare('UPDATE evaluation_runs SET data=? WHERE id=?').run(seal(f.store.encryptionKey, changed), changed.id); }
    return transaction(fn);
  };
  const stopped = f.service.cancel('demo', 'latest-case', 'reviewer'); f.store.transaction = transaction;
  assert.equal(stopped.activeTask, 'concurrent-next-case'); assert.equal(f.runtime.get('demo', 'concurrent-next-case').state, 'stopped');
  f.runtime.cancel('demo', firstTask); for (const finish of finishes) finish({ role: 'assistant', content: '{"total":80}' });
  await f.service.wait('demo', 'latest-case'); await f.runtime.wait('demo', 'concurrent-next-case');
});

test('later cases reject changed model or policy receipts instead of silently running new configuration', async t => {
  for (const kind of ['model', 'policy']) {
    let calls = 0; const f = setup(t, async () => { calls++; if (kind === 'model') f.provider.model = 'changed-model'; else { const policy = structuredClone(f.policy.data); policy.version = 'changed-policy'; f.gateway.policy = new Policy(policy); } return { role: 'assistant', content: '{"total":80}' }; }), suite = save(f, [scenario('one'), scenario('two')]);
    start(f, suite, `drift-${kind}`); const result = await f.service.wait('demo', `drift-${kind}`); assert.equal(result.state, 'failed'); assert.equal(result.code, 'AGENT_PLAN_CHANGED'); assert.equal(calls, 1); assert.equal(count(f, 'agent_runs'), 1);
  }
});

test('expired evaluation leases display interruption and cached starts never resume or create a new case', async t => {
  let finish, calls = 0; const f = setup(t, async () => { calls++; return new Promise(resolve => { finish = resolve; }); }), suite = save(f, [scenario('one'), scenario('two')]);
  start(f, suite, 'lease-interruption'); await tick(); f.store.db.prepare('UPDATE evaluation_locks SET expires=0 WHERE id=?').run('lease-interruption');
  assert.equal(f.service.get('demo', 'lease-interruption').state, 'interrupted'); assert.equal(start(f, suite, 'lease-interruption').state, 'interrupted'); assert.equal(calls, 1);
  finish({ role: 'assistant', content: '{"total":80}' }); const result = await f.service.wait('demo', 'lease-interruption'); assert.equal(result.state, 'interrupted'); assert.equal(calls, 1); assert.equal(count(f, 'agent_runs'), 1);
});

test('run retention, case capacity and cross-process lease limits reject before inference', t => {
  const f = setup(t), suite = save(f, [scenario('one'), scenario('two')]);
  for (let i = 0; i < 99; i++) f.store.db.prepare('INSERT INTO agent_runs VALUES (?,?,?,?)').run(`retained-${i}`, 'demo', 'demo-agent', seal(f.store.encryptionKey, { id: `retained-${i}`, tenant: 'demo', principal: 'demo-agent' }));
  assert.throws(() => start(f, suite), /AGENT_RUN_LIMIT/); assert.equal(count(f, 'evaluation_runs'), 0);
  f.store.db.prepare('DELETE FROM agent_runs').run();
  for (const id of ['foreign-one', 'foreign-two']) f.store.db.prepare('INSERT INTO evaluation_locks VALUES (?,?,?)').run(id, 'other-owner', Date.now() + 60000);
  assert.throws(() => start(f, suite), /EVALUATION_BUSY/); assert.equal(count(f, 'agent_runs'), 0); f.store.db.prepare('DELETE FROM evaluation_locks').run();
  for (let i = 0; i < 100; i++) f.store.db.prepare('INSERT INTO evaluation_runs VALUES (?,?,?)').run(`completed-${i}`, 'demo', seal(f.store.encryptionKey, { id: `completed-${i}`, tenant: 'demo', state: 'completed' }));
  assert.throws(() => start(f, suite), /EVALUATION_RUN_LIMIT/); assert.equal(count(f, 'agent_runs'), 0);
});

test('model completion audit failure never persists a turn or pending call without its matching event', async t => {
  const f = setup(t), append = f.store.append.bind(f.store);
  f.store.append = event => { if (event.type === 'agent.model_completed') throw Error('model audit unavailable'); return append(event); };
  f.runtime.start('demo', { id: 'atomic-model-event', prompt: 'Hello', toolMode: 'chat_only' }); const task = await f.runtime.wait('demo', 'atomic-model-event');
  assert.equal(task.state, 'failed'); assert.equal(task.turns, 0); assert.equal(task.conversation.length, 1); assert.equal(task.usage.requests, 0);
  const row = f.store.db.prepare('SELECT data FROM agent_runs WHERE id=?').get(task.id), raw = open(f.store.encryptionKey, row.data); assert.deepEqual(raw.pending, []); assert.ok(!f.store.events('demo').some(e => e.type === 'agent.model_completed'));
  f.store.append = append;
});

test('model audit failure rolls back a tool proposal before the tool can dispatch', async t => {
  const f = setup(t, async (messages, tools) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name: tools.find(tool => tool.function.description.startsWith('text.encode:')).function.name, arguments: { text: 'Must not dispatch' } } }] })), append = f.store.append.bind(f.store);
  f.store.append = event => { if (event.type === 'agent.model_completed') throw Error('model audit unavailable'); return append(event); };
  f.runtime.start('demo', { id: 'atomic-tool-proposal', prompt: 'Encode text', toolMode: 'safe' }); const task = await f.runtime.wait('demo', 'atomic-tool-proposal');
  assert.equal(task.state, 'failed'); assert.equal(task.turns, 0); assert.equal(task.toolCalls, 0); assert.equal(f.store.session(task.sessionId).calls, 0); assert.equal(count(f, 'requests'), 0);
  const raw = open(f.store.encryptionKey, f.store.db.prepare('SELECT data FROM agent_runs WHERE id=?').get(task.id).data); assert.deepEqual(raw.pending, []); f.store.append = append;
});
