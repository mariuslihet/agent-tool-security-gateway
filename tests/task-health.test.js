import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, report, admin } from './helpers.js';
import { AgentRuntime, AGENT_LIMITS } from '../src/agent-runtime.js';
import { open, seal } from '../src/util.js';

const create = (f, complete = async () => ({ role: 'assistant', content: 'Generated answer' })) => new AgentRuntime({ gateway: f.gateway, provider: { model: 'health-test', complete } });
const update = (f, id, fn) => { const row = f.store.db.prepare('SELECT * FROM agent_runs WHERE id=?').get(id), r = open(f.store.encryptionKey, row.data); fn(r); f.store.db.prepare('UPDATE agent_runs SET data=? WHERE id=?').run(seal(f.store.encryptionKey, r), id); };

test('health is a private read-only snapshot with actual remaining budgets and no model calls', async t => {
  const f = fixture(t); let calls = 0; const agent = create(f, async () => { calls++; return { role: 'assistant', content: 'Answer' }; });
  agent.start('demo', { id: 'health', prompt: 'private-health-prompt' }); const run = await agent.wait('demo', 'health');
  const before = f.store.verifyAudit().count, session = f.store.session(run.sessionId), revision = run.revision;
  session.calls = 3; session.cost = 2; session.outputBytes = 10; f.store.saveSession(session);
  const h = agent.health('demo', 'health');
  assert.equal(h.budgets.modelTurns.remaining, AGENT_LIMITS.maxTurns - run.turns); assert.equal(h.budgets.sessionCalls.used, 3); assert.equal(h.budgets.costUnits.remaining, session.limits.maxCost - 2); assert.equal(h.budgets.outputBytes.used, 10);
  assert.equal(h.session.remainingMs, session.expires - h.checkedAt); assert.equal(h.followUp.available, true); assert.deepEqual(h.followUp.blockers, []); assert.equal(h.pending, null);
  assert.equal(calls, 1); assert.equal(agent.get('demo', 'health').revision, revision); assert.equal(f.store.verifyAudit().count, before); assert.ok(!JSON.stringify(h).includes('private-health-prompt'));
  assert.throws(() => agent.health('other', 'health'), /RUN_NOT_FOUND/); assert.throws(() => agent.health('demo', '../health'), /INVALID_RUN/);
});

test('health explains archive, turn exhaustion and model changes without changing task permissions', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'blocked', prompt: 'Hello' }); const run = await agent.wait('demo', 'blocked');
  agent.library.organize('demo', run.id, { expectedRevision: 0, title: 'Archived', tags: [], pinned: false, archived: true }, 'reviewer');
  update(f, run.id, r => { r.turns = AGENT_LIMITS.maxTurns; }); agent.provider.model = 'different';
  const h = agent.health('demo', run.id); assert.equal(h.followUp.available, false); assert.deepEqual(h.followUp.blockers, ['MODEL_CHANGED', 'TASK_ARCHIVED', 'MODEL_TURN_BUDGET_EXHAUSTED']); assert.equal(h.budgets.modelTurns.remaining, 0); assert.equal(h.organizationRevision, 1);
  assert.deepEqual(agent.get('demo', run.id).allowedTools, run.allowedTools);
});

test('health reports expiry, revocation and classified session labels using the gateway clock', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'session-health', prompt: 'Hello' }); const run = await agent.wait('demo', 'session-health');
  const session = f.store.session(run.sessionId); session.labels = ['untrusted']; f.store.saveSession(session);
  assert.ok(agent.health('demo', run.id).followUp.blockers.includes('MODEL_DATA_WITHHELD'));
  f.advance(session.limits.ttlMs + 1); const expired = agent.health('demo', run.id); assert.equal(expired.session.remainingMs, 0); assert.ok(expired.followUp.blockers.includes('SESSION_EXPIRED'));
  f.gateway.revoke(admin, { type: 'session', value: run.sessionId }); assert.ok(agent.health('demo', run.id).followUp.blockers.includes('SESSION_REVOKED'));
});

test('health shows exact pending request and approval expiry without exposing arguments or approving', async t => {
  const f = fixture(t), agent = create(f, async (_, tools) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name: tools.find(t => t.function.description.startsWith('report.publish:')).function.name, arguments: report } }] }));
  agent.start('demo', { id: 'approval-health', prompt: 'Simulate a report', toolMode: 'all' }); const run = await agent.wait('demo', 'approval-health'); assert.equal(run.state, 'waiting');
  const before = f.store.verifyAudit().count, h = agent.health('demo', run.id); assert.equal(h.pending.requestId, run.steps[0].requestId); assert.equal(h.pending.tool, 'report.publish'); assert.equal(h.pending.approval.state, 'pending'); assert.equal(h.pending.approval.expired, false); assert.ok(!JSON.stringify(h).includes(report.body));
  f.advance(300001); assert.equal(agent.health('demo', run.id).pending.approval.expired, true); assert.equal(f.store.verifyAudit().count, before); assert.equal(f.gateway.approvals('demo')[0].state, 'pending');
});

test('health surfaces scoped tool holds and revocations without granting access or altering holds', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'tool-health', prompt: 'Hello' }); const run = await agent.wait('demo', 'tool-health');
  f.gateway.containment.hold({ tenant: 'demo', actor: 'reviewer' }, { kind: 'tool', target: 'text.encode', expectedRevision: 0, durationMinutes: 15, reason: 'Investigate test tool' });
  f.gateway.revoke(admin, { type: 'tool', value: 'knowledge.read' }); const h = agent.health('demo', run.id);
  assert.equal(h.tools.find(t => t.name === 'text.encode').restriction, 'TOOL_PAUSED'); assert.equal(h.tools.find(t => t.name === 'knowledge.read').restriction, 'TOOL_REVOKED'); assert.equal(h.followUp.available, true);
  assert.match(h.advisory, /not execution authorization/); assert.equal(h.tools.length, run.allowedTools.length);
});

test('health reports interrupted work and missing provider without attempting a restart', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'interrupted-health', prompt: 'Hello' }); const run = await agent.wait('demo', 'interrupted-health');
  update(f, run.id, r => { r.state = 'running'; }); agent.provider = null;
  const h = agent.health('demo', run.id); assert.equal(h.state, 'interrupted'); assert.deepEqual(h.followUp.blockers, ['LLM_NOT_CONFIGURED', 'TASK_NOT_COMPLETED']); assert.equal(agent.get('demo', run.id).state, 'interrupted');
});

test('health reflects tenant pauses and session quarantine without changing their revisions', async t => {
  const f = fixture(t), agent = create(f); agent.start('demo', { id: 'holds-health', prompt: 'Hello' }); const run = await agent.wait('demo', 'holds-health');
  f.gateway.safety.pause({ tenant: 'demo', actor: 'reviewer' }, { expectedRevision: 0, scope: 'all', durationMinutes: 15, reason: 'Investigate synthetic activity' });
  assert.ok(agent.health('demo', run.id).tools.every(tool => tool.restriction === 'TENANT_PAUSED'));
  f.gateway.containment.hold({ tenant: 'demo', actor: 'reviewer' }, { kind: 'session', target: run.sessionId, expectedRevision: 0, durationMinutes: 15, reason: 'Quarantine synthetic session' });
  const h = agent.health('demo', run.id); assert.equal(h.session.containment.code, 'SESSION_QUARANTINED'); assert.ok(h.tools.every(tool => tool.restriction === 'SESSION_QUARANTINED')); assert.equal(h.session.containment.revision, 1);
});
