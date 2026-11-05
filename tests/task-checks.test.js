import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fixture } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { evaluateTaskChecks, DEFAULT_TASK_CHECKS } from '../src/task-checks.js';

const task = (extra = {}) => ({ revision: 3, state: 'completed', code: 'OK', conversation: [{ role: 'user', text: 'Calculate 40' }, { role: 'assistant', text: 'The TOTAL is 40.' }], steps: [{ tool: 'compute.sum', status: 'completed', code: 'OK' }], ...extra });
const criteria = (extra = {}) => ({ ...DEFAULT_TASK_CHECKS, requiredPhrases: ['40'], requiredTools: ['compute.sum'], ...extra });
const create = (f, complete = async () => ({ role: 'assistant', content: 'Approved and ready.' })) => new AgentRuntime({ gateway: f.gateway, provider: { model: 'checks-test', complete } });
const input = (run, revision = 0, rules = { ...DEFAULT_TASK_CHECKS }) => ({ expectedRevision: revision, expectedTaskRevision: run.revision, criteria: rules });

test('checks evaluate literal case-insensitive phrases in the final displayed assistant answer only', () => {
  const result = evaluateTaskChecks(task(), criteria({ requiredPhrases: ['total', '40'], forbiddenPhrases: ['declined'] })); assert.equal(result.passed, true); assert.equal(result.checks.length, 7);
  const earlier = task({ conversation: [{ role: 'user', text: 'private-marker' }, { role: 'assistant', text: 'Earlier private-marker' }, { role: 'assistant', text: 'Final answer is 40.' }] });
  assert.equal(evaluateTaskChecks(earlier, criteria({ requiredPhrases: ['private-marker'] })).passed, false);
  assert.equal(evaluateTaskChecks(task(), criteria({ forbiddenPhrases: ['total'] })).passed, false);
  assert.equal(evaluateTaskChecks(task(), criteria({ requiredPhrases: ['.*'] })).passed, false);
});

test('tool claims, approval waits and denied calls cannot substitute for completed trace evidence', () => {
  for (const status of ['denied', 'approval_required', 'indeterminate']) assert.equal(evaluateTaskChecks(task({ steps: [{ tool: 'compute.sum', status }] }), criteria()).passed, false);
  const recovered = task({ steps: [{ tool: 'compute.sum', status: 'denied' }, { tool: 'compute.sum', status: 'completed' }] });
  assert.equal(evaluateTaskChecks(recovered, criteria()).passed, false); assert.equal(evaluateTaskChecks(recovered, criteria({ rejectDenied: false })).passed, true);
  assert.equal(evaluateTaskChecks(task({ state: 'waiting' }), criteria()).passed, false);
  assert.equal(evaluateTaskChecks(task({ conversation: [] }), { ...DEFAULT_TASK_CHECKS, requireCompleted: false, rejectDenied: false }).passed, false);
});

test('criteria and evaluation input are bounded and reject ambiguous or malformed rules', () => {
  for (const bad of [{ extra: true }, { requiredPhrases: ['a', 'A'] }, { requiredPhrases: [''] }, { requiredPhrases: ['x'.repeat(129)] }, { forbiddenPhrases: ['a\nb'] }, { requiredPhrases: Array.from({ length: 9 }, (_, i) => String(i)) }, { requiredTools: ['bad tool'] }, { rejectDenied: 'yes' }]) assert.throws(() => evaluateTaskChecks(task(), criteria(bad)), /INVALID_TASK_CHECKS/);
  assert.throws(() => evaluateTaskChecks(task({ conversation: [{ role: 'assistant', text: 'x'.repeat(32769) }] }), criteria()), /TASK_CHECK_INPUT_LIMIT/);
  assert.throws(() => evaluateTaskChecks(task({ steps: Array(13).fill({ tool: 'x', status: 'completed' }) }), criteria()), /TASK_CHECK_INPUT_LIMIT/);
});

test('saved checks are encrypted and audited without changing task revision, budgets, permissions or model calls', async t => {
  const f = fixture(t); let calls = 0; const agent = create(f, async () => { calls++; return { role: 'assistant', content: 'Approved and ready.' }; }); agent.start('demo', { id: 'checked', prompt: 'Hello', toolMode: 'chat_only' }); const run = await agent.wait('demo', 'checked'), before = f.store.session(run.sessionId);
  agent.provider = null; const result = agent.checks.evaluate('demo', run.id, input(run, 0, { ...DEFAULT_TASK_CHECKS, requiredPhrases: ['private-check-8473'] }), 'reviewer'); assert.equal(result.review.passed, false); assert.equal(result.stale, false); assert.equal(result.review.revision, 1);
  assert.equal(agent.get('demo', run.id).revision, run.revision); assert.deepEqual(f.store.session(run.sessionId), before); assert.deepEqual(agent.get('demo', run.id).allowedTools, []); assert.equal(calls, 1);
  assert.ok(!f.store.db.prepare('SELECT data FROM task_checks').get().data.includes('private-check-8473')); const event = f.store.events('demo')[0]; assert.equal(event.type, 'agent.checked'); assert.equal(event.actor, 'reviewer'); assert.ok(!JSON.stringify(event).includes('private-check-8473')); assert.ok(!JSON.stringify(result).includes('Approved and ready.'));
  assert.throws(() => agent.checks.get('other', run.id), /RUN_NOT_FOUND/); assert.throws(() => agent.checks.evaluate('other', run.id, input(run), 'reviewer'), /RUN_NOT_FOUND/);
});

test('follow-ups make reviews stale even when the answer repeats, and revision checks reject stale writes', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'follow-check', prompt: 'Hello' }); const first = await agent.wait('demo', 'follow-check');
  agent.checks.evaluate('demo', first.id, input(first), 'reviewer'); assert.throws(() => agent.checks.evaluate('demo', first.id, input(first), 'reviewer'), /VERSION_CONFLICT/);
  agent.followUp('demo', first.id, { messageId: 'follow-up', prompt: 'Again', expectedRevision: first.revision }); const second = await agent.wait('demo', first.id); assert.equal(agent.checks.get('demo', first.id).stale, true);
  assert.throws(() => agent.checks.evaluate('demo', first.id, input(first, 1), 'reviewer'), /VERSION_CONFLICT/);
  const updated = agent.checks.evaluate('demo', first.id, input(second, 1), 'reviewer'); assert.equal(updated.review.revision, 2); assert.equal(updated.stale, false); assert.equal(updated.review.passed, true);
});

test('audit failures roll back review changes and redaction applies to returned criteria', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'audit-check', prompt: 'Hello' }); const run = await agent.wait('demo', 'audit-check'), append = f.store.append.bind(f.store);
  f.store.append = () => { throw new Error('Injected audit failure'); }; assert.throws(() => agent.checks.evaluate('demo', run.id, input(run), 'reviewer'), /Injected audit failure/); f.store.append = append; assert.equal(agent.checks.get('demo', run.id).review, null);
  const result = agent.checks.evaluate('demo', run.id, input(run, 0, { ...DEFAULT_TASK_CHECKS, requiredPhrases: ['password=synthetic-value-7741'] }), 'reviewer'); assert.ok(!JSON.stringify(result).includes('synthetic-value-7741'));
});

test('lease interruption makes a review stale even before the task record revision changes', async t => {
  const f = fixture(t); let finish; const agent = create(f, async () => new Promise(resolve => { finish = resolve; })); agent.start('demo', { id: 'lease-check', prompt: 'Hello' }); await new Promise(resolve => setTimeout(resolve, 0));
  const running = agent.get('demo', 'lease-check'); agent.checks.evaluate('demo', running.id, input(running), 'reviewer'); assert.equal(agent.checks.get('demo', running.id).stale, false);
  f.store.db.prepare('UPDATE agent_run_locks SET expires=0 WHERE id=?').run(running.id); assert.equal(agent.get('demo', running.id).revision, running.revision); assert.equal(agent.checks.get('demo', running.id).stale, true);
  finish({ role: 'assistant', content: 'Late answer' }); await agent.wait('demo', running.id);
});

test('checks survive encrypted reopen and ciphertext moved to another task fails integrity checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-checks-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'); let f;
  try {
    f = fixture(null, { path, key }); let agent = create(f); agent.start('demo', { id: 'first-check', prompt: 'Hello' }); const first = await agent.wait('demo', 'first-check'); agent.checks.evaluate('demo', first.id, input(first), 'reviewer'); agent.start('demo', { id: 'second-check', prompt: 'Hello' }); const second = await agent.wait('demo', 'second-check'); f.store.close();
    f = fixture(null, { path, key }); agent = create(f); const restored = agent.checks.get('demo', first.id); assert.equal(restored.review.passed, true); assert.equal(restored.stale, false); assert.equal(restored.review.revision, 1);
    const row = f.store.db.prepare('SELECT data FROM task_checks WHERE id=?').get(first.id); f.store.db.prepare('INSERT INTO task_checks VALUES (?,?,?)').run(second.id, 'demo', row.data); assert.throws(() => agent.checks.get('demo', second.id), /STORAGE_INTEGRITY_FAILURE/);
  } finally { f?.store.close(); assert.ok(dir.startsWith(join(tmpdir(), 'gateway-checks-'))); rmSync(dir, { recursive: true, force: true }); }
});
