import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fixture, report, admin } from './helpers.js';
import { AgentRuntime, DEFAULT_TASK_BUDGET } from '../src/agent-runtime.js';
import { GatewayError, open, seal } from '../src/util.js';
import { createDemo } from '../src/demo.js';

const answer = () => ({ role: 'assistant', content: 'Generated answer' });
const create = (f, complete = async () => answer()) => new AgentRuntime({ gateway: f.gateway, provider: { model: 'budget-test', complete } });
const limits = { maxTurns: 2, maxToolCalls: 2, maxRunMs: 60000 };
const call = (tools, name, args) => ({ function: { name: tools.find(t => t.function.description.startsWith(name + ':')).function.name, arguments: args } });
const subset = r => Object.fromEntries(Object.keys(DEFAULT_TASK_BUDGET).map(k => [k, r.limits[k]]));

test('invalid budgets fail before session creation and idempotency binds effective task limits', async t => {
  const f = fixture(t), agent = create(f), sessions = f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  for (const taskLimits of [null, [], {}, { ...limits, maxTurns: 0 }, { ...limits, maxTurns: 7 }, { ...limits, maxToolCalls: 13 }, { ...limits, maxRunMs: 999 }, { ...limits, maxRunMs: 360001 }, { ...limits, maxTurns: true }, { ...limits, maxTurns: 1.5 }, { ...limits, maxCost: 1000 }]) assert.throws(() => agent.start('demo', { id: 'invalid', prompt: 'Hello', taskLimits }), /INVALID_TASK_BUDGET/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, sessions);
  agent.start('demo', { id: 'bound-budget', prompt: 'Hello', taskLimits: limits }); const run = await agent.wait('demo', 'bound-budget'); assert.deepEqual(subset(run), limits);
  assert.equal(agent.start('demo', { id: run.id, prompt: 'Hello', taskLimits: limits }).revision, run.revision);
  assert.throws(() => agent.start('demo', { id: run.id, prompt: 'Hello', taskLimits: { ...limits, maxTurns: 3 } }), /IDEMPOTENCY_CONFLICT/);
});

test('follow-ups share chosen turn limits and health shows the actual remaining budget', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'cumulative-budget', prompt: 'Hello', taskLimits: limits }); const first = await agent.wait('demo', 'cumulative-budget');
  assert.equal(agent.health('demo', first.id).budgets.modelTurns.remaining, 1); assert.equal(agent.health('demo', first.id).attemptTimeLimitMs, 60000);
  agent.followUp('demo', first.id, { messageId: 'second-message', prompt: 'More detail', expectedRevision: first.revision }); const second = await agent.wait('demo', first.id);
  assert.deepEqual(subset(second), limits); assert.equal(second.sessionId, first.sessionId); assert.equal(second.turns, 2); assert.equal(agent.health('demo', first.id).followUp.available, false);
  assert.throws(() => agent.followUp('demo', first.id, { messageId: 'third-message', prompt: 'Again', expectedRevision: second.revision }), /RUN_NOT_CONTINUABLE/);
});

test('tool budget stops a second proposed tool and gateway/child sessions cannot bypass its call ceiling', async t => {
  const f = fixture(t), agent = create(f, async (_, tools) => ({ role: 'assistant', content: '', tool_calls: [call(tools, 'knowledge.read', { document: 'handbook' }), call(tools, 'text.encode', { text: 'Safe' })] }));
  agent.start('demo', { id: 'one-tool', prompt: 'Read and encode', taskLimits: { ...limits, maxToolCalls: 1 } }); const run = await agent.wait('demo', 'one-tool'); assert.equal(run.code, 'AGENT_TOOL_LIMIT'); assert.equal(run.toolCalls, 1); assert.equal(run.steps.length, 1); assert.equal(f.store.session(run.sessionId).limits.maxCalls, 1); assert.equal(f.store.request(run.sessionId, 'one-tool_1_1'), null);
  const denied = await f.gateway.execute('demo-agent', run.sessionId, { id: 'direct-bypass', tool: 'text.encode', arguments: { text: 'Safe' } }); assert.equal(denied.code, 'CALL_BUDGET_EXCEEDED');
  const child = f.gateway.createSession('demo-agent', { parentId: run.sessionId }).sessionId; assert.equal((await f.gateway.execute('demo-agent', child, { id: 'child-bypass', tool: 'text.encode', arguments: { text: 'Safe' } })).code, 'CALL_BUDGET_EXCEEDED');
  assert.throws(() => f.gateway.createSession('demo-agent', { parentId: run.sessionId, limits: { ...f.store.session(run.sessionId).limits, maxCalls: 2 } }), /CAPABILITY_ESCALATION/);
});

test('selected attempt timeout aborts model generation without tool dispatch', async t => {
  const f = fixture(t), agent = create(f, async (_, __, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new GatewayError('RUN_CANCELLED')), { once: true })));
  agent.start('demo', { id: 'short-attempt', prompt: 'Hello', taskLimits: { ...limits, maxRunMs: 1000 } }); const run = await agent.wait('demo', 'short-attempt'); assert.equal(run.state, 'failed'); assert.equal(run.code, 'AGENT_TIME_LIMIT'); assert.equal(run.turns, 0); assert.equal(f.store.session(run.sessionId).calls, 0);
});

test('approval resume retains chosen limits and executes the same call within its session budget', async t => {
  const f = fixture(t); let turns = 0; const agent = create(f, async (_, tools) => ++turns === 1 ? { role: 'assistant', content: '', tool_calls: [call(tools, 'report.publish', report)] } : answer());
  const selected = { ...limits, maxTurns: 3, maxToolCalls: 1 }; agent.start('demo', { id: 'budget-approval', prompt: 'Simulate report', toolMode: 'all', taskLimits: selected }); const waiting = await agent.wait('demo', 'budget-approval'); assert.equal(waiting.state, 'waiting');
  const pending = f.gateway.approvals('demo')[0]; f.gateway.decideApproval(admin, { sessionId: pending.sessionId, requestId: pending.requestId, binding: pending.binding, decision: 'approve' }); agent.resume('demo', waiting.id); const done = await agent.wait('demo', waiting.id);
  assert.equal(done.state, 'completed'); assert.deepEqual(subset(done), selected); assert.equal(done.steps[0].requestId, waiting.steps[0].requestId); assert.equal(f.store.session(done.sessionId).calls, 1); assert.equal(done.turns, 2); assert.equal(done.toolCalls, 1);
});

test('chosen limits survive encrypted restart; legacy records default without widening their sessions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-budget-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'); let f;
  t.after(() => { f?.store.close(); assert.ok(dir.startsWith(join(tmpdir(), 'gateway-budget-'))); rmSync(dir, { recursive: true, force: true }); });
  f = fixture(null, { path, key }); let agent = create(f); agent.start('demo', { id: 'persist-budget', prompt: 'Hello', taskLimits: limits }); const first = await agent.wait('demo', 'persist-budget'); f.store.close(); f = fixture(null, { path, key }); agent = create(f);
  assert.deepEqual(subset(agent.get('demo', first.id)), limits); agent.followUp('demo', first.id, { messageId: 'after-restart', prompt: 'More detail', expectedRevision: first.revision }); const done = await agent.wait('demo', first.id); assert.equal(done.turns, 2); assert.deepEqual(subset(done), limits);
  const row = f.store.db.prepare('SELECT data FROM agent_runs WHERE id=?').get(first.id), record = open(f.store.encryptionKey, row.data); delete record.taskLimits; f.store.db.prepare('UPDATE agent_runs SET data=? WHERE id=?').run(seal(f.store.encryptionKey, record), first.id);
  assert.deepEqual(subset(agent.get('demo', first.id)), DEFAULT_TASK_BUDGET); assert.equal(f.store.session(first.sessionId).limits.maxCalls, 2);
  record.taskLimits = { ...limits, maxTurns: 999 }; f.store.db.prepare('UPDATE agent_runs SET data=? WHERE id=?').run(seal(f.store.encryptionKey, record), first.id); assert.throws(() => agent.get('demo', first.id), /STORAGE_INTEGRITY_FAILURE/);
});

test('host call ceilings remain stricter than a selected task budget', async t => {
  const f = fixture(t, { limits: { maxCalls: 1 } }), agent = create(f); agent.start('demo', { id: 'host-ceiling', prompt: 'Hello', taskLimits: limits }); const run = await agent.wait('demo', 'host-ceiling'); assert.equal(f.store.session(run.sessionId).limits.maxCalls, 1); assert.equal(agent.health('demo', run.id).budgets.sessionCalls.limit, 1);
});

test('read-only workspace mode can read but cannot save reports or delegate write authority', async t => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-readonly-')); mkdirSync(join(root, 'input')); mkdirSync(join(root, 'reports')); writeFileSync(join(root, 'input', 'notes.md'), 'Reviewed notes');
  const f = createDemo({ masterKey: randomBytes(32).toString('hex'), workspaceRoot: root }); t.after(() => { f.store.close(); assert.ok(root.startsWith(join(tmpdir(), 'gateway-readonly-'))); rmSync(root, { recursive: true, force: true }); });
  const agent = create(f, async (_, tools) => { assert.ok(!tools.some(t => t.function.description.startsWith('workspace.report.save:'))); return answer(); });
  agent.start('demo', { id: 'read-only', prompt: 'Research notes', toolMode: 'workspace_readonly' }); const run = await agent.wait('demo', 'read-only'); assert.ok(run.allowedTools.includes('workspace.read')); assert.ok(run.allowedTools.includes('workspace.search')); assert.ok(!run.allowedTools.includes('workspace.report.save'));
  const read = await f.gateway.execute('demo-agent', run.sessionId, { id: 'read-notes', tool: 'workspace.read', arguments: { file: 'notes.md' } }); assert.equal(read.status, 'completed');
  assert.equal((await f.gateway.execute('demo-agent', run.sessionId, { id: 'write-bypass', tool: 'workspace.report.save', arguments: { file: 'no.md', content: 'Safe' } })).status, 'denied'); assert.deepEqual(readdirSync(join(root, 'reports')), []); assert.equal(f.gateway.approvals('demo').length, 0);
  const full = f.gateway.createSession('demo-agent').sessionId; assert.throws(() => f.gateway.createSession('demo-agent', { parentId: run.sessionId, grants: f.store.session(full).grants }), /CAPABILITY_ESCALATION/);
});
