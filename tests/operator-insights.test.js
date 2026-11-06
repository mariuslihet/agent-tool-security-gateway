import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, report } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { compareRecordedPolicy, taskTimeline, operationalDiagnostics } from '../src/operator-insights.js';

const count = (store, table) => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const runtime = (f, provider = { model: 'test-model', complete: async () => ({ role: 'assistant', content: 'Private answer marker-8471' }), check: async () => ({ ready: true }) }) => new AgentRuntime({ gateway: f.gateway, provider });

test('recorded policy comparison previews both policies without dispatch or changing authority and strips payloads', async t => {
  const f = fixture(t); await f.run('knowledge.read', { document: 'handbook' }, 'read'); await f.run('report.publish', { ...report, body: 'private-body-marker-8471' }, 'publish');
  const other = f.gateway.createSession('other-agent').sessionId; await f.gateway.execute('other-agent', other, { id: 'other-private', tool: 'knowledge.read', arguments: { document: 'handbook' } });
  const before = f.store.session(f.sessionId), requests = count(f.store, 'requests'), sessions = count(f.store, 'sessions'), policy = structuredClone(f.policy.data), originalHash = f.gateway.policy.hash;
  policy.version = 'candidate'; policy.rules.push({ id: 'deny-read', tools: ['knowledge.read'], effect: 'deny', when: [] });
  const result = compareRecordedPolicy(f.gateway, 'demo', { policy }, 'reviewer');
  assert.equal(result.execution, false); assert.equal(result.sampled, 2); assert.equal(result.changed, 1); assert.equal(result.results.find(r => r.requestId === 'read').current.decision, 'allow'); assert.equal(result.results.find(r => r.requestId === 'read').proposed.decision, 'deny');
  assert.equal(result.results.find(r => r.requestId === 'publish').historical.status, 'pending');
  assert.equal(f.gateway.policy.hash, originalHash); assert.deepEqual(f.store.session(f.sessionId), before); assert.equal(count(f.store, 'requests'), requests); assert.equal(count(f.store, 'sessions'), sessions);
  const serialized = JSON.stringify(result); assert.ok(!serialized.includes('private-body-marker')); assert.ok(!serialized.includes('other-private')); assert.ok(!serialized.includes('deny-read'));
  assert.match(result.contextBasis, /effective arguments/); const event = f.store.events('demo')[0]; assert.equal(event.type, 'policy.recorded_compared'); assert.ok(!JSON.stringify(event).includes('private-body-marker'));
});

test('recorded comparisons enforce bounded input, authenticated indexes, audit delivery and explicit truncation', async t => {
  const f = fixture(t); await f.run('knowledge.read', { document: 'handbook' }, 'first'); await f.run('knowledge.read', { document: 'handbook' }, 'second');
  const limited = compareRecordedPolicy(f.gateway, 'demo', { policy: f.policy.data, limit: 1 }, 'reviewer'); assert.equal(limited.sampled, 1); assert.equal(limited.truncated, true); assert.equal(limited.results[0].requestId, 'second');
  for (const limit of [0, 51, '1', NaN]) assert.throws(() => compareRecordedPolicy(f.gateway, 'demo', { policy: f.policy.data, limit }, 'reviewer'), /INVALID_POLICY_COMPARISON/);
  assert.throws(() => compareRecordedPolicy(f.gateway, 'demo', { policy: null }, 'reviewer'), /INVALID_POLICY/);
  assert.throws(() => compareRecordedPolicy(f.gateway, 'demo', { policy: { ...f.policy.data, rules: [null] } }, 'reviewer'), /INVALID_POLICY/);
  const append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('audit unavailable'); };
  assert.throws(() => compareRecordedPolicy(f.gateway, 'demo', { policy: f.policy.data }, 'reviewer'), /audit unavailable/); f.store.append = append;
  f.store.db.prepare("UPDATE request_index SET tool_hash='forged' WHERE id='first'").run();
  assert.throws(() => compareRecordedPolicy(f.gateway, 'demo', { policy: f.policy.data }, 'reviewer'), /STORAGE_INTEGRITY_FAILURE/);
});

test('task timeline joins task and session evidence in authenticated sequence order without conversation content', async t => {
  const f = fixture(t); let calls = 0;
  const agent = runtime(f, { model: 'test-model', complete: async (messages, tools) => {
    calls++; return messages.some(m => m.role === 'tool') ? { role: 'assistant', content: 'Private answer marker-8471' } : { role: 'assistant', content: '', tool_calls: [{ function: { name: tools.find(t => t.function.description.startsWith('text.encode:')).function.name, arguments: { text: 'private-tool-marker-8471' } } }] };
  } });
  agent.start('demo', { id: 'timeline-run', prompt: 'private-prompt-marker-8471' }); const completed = await agent.wait('demo', 'timeline-run');
  f.store.transaction(() => f.store.append({ type: 'agent.review_note', tenant: 'demo', run: completed.id, reason: 'private-note-marker-8471' }));
  const auditBefore = count(f.store, 'audit'), result = taskTimeline(agent, 'demo', completed.id);
  assert.equal(result.modelTurns, 2); assert.equal(result.toolCalls, 1); assert.ok(result.events.some(e => e.type === 'agent.completed')); assert.ok(result.events.some(e => e.type === 'execution.finished')); assert.ok(result.events.some(e => e.type === 'agent.review_note'));
  assert.deepEqual(result.events.map(e => e.sequence), result.events.map(e => e.sequence).sort((a, b) => a - b));
  assert.equal(result.events.find(e => e.type === 'agent.review_note').reason, undefined); assert.ok(!JSON.stringify(result).includes('marker-8471')); assert.equal(result.steps[0].tool, 'text.encode');
  assert.equal(count(f.store, 'audit'), auditBefore); assert.equal(agent.get('demo', completed.id).revision, completed.revision); assert.equal(calls, 2);
  assert.throws(() => taskTimeline(agent, 'other', completed.id), /RUN_NOT_FOUND/);
});

test('timeline keeps the latest bounded events and rejects altered signed records', async t => {
  const f = fixture(t), agent = runtime(f); agent.start('demo', { id: 'long-timeline', prompt: 'Hello' }); await agent.wait('demo', 'long-timeline');
  f.store.transaction(() => { for (let i = 0; i < 105; i++) f.store.append({ type: 'agent.model_completed', tenant: 'demo', run: 'long-timeline', turn: i }); });
  const result = taskTimeline(agent, 'demo', 'long-timeline'); assert.equal(result.events.length, 100); assert.equal(result.truncated, true); assert.equal(result.events.at(-1).turn, 104);
  const target = f.store.db.prepare('SELECT seq,event FROM audit WHERE seq=?').get(result.events[0].sequence), changed = JSON.parse(target.event); changed.turn = 999;
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=?').run(JSON.stringify(changed), target.seq);
  assert.throws(() => taskTimeline(agent, 'demo', 'long-timeline'), /AUDIT_CORRUPTED/);
});

test('diagnostics use model availability and source inventory without generation, leaking filenames or changing tasks', async t => {
  const f = fixture(t); let availability = 0, inference = 0, inventories = 0;
  const agent = runtime(f, { model: 'test-model', check: async () => { availability++; return { ready: true }; }, complete: async () => { inference++; throw Error('Must not generate'); } });
  await f.run('report.publish', report, 'expired'); f.advance(300001); const session = f.store.session(f.sessionId), beforeTasks = count(f.store, 'agent_runs');
  const result = await operationalDiagnostics({ gateway: f.gateway, agentRuntime: agent, tenant: 'demo', actor: 'reviewer', workspaceFiles: { tenant: 'demo', inventory: async () => { inventories++; return { inputs: [{ file: 'private-filename-marker-8471', status: 'changed' }], reports: [] }; } } });
  assert.equal(availability, 1); assert.equal(inference, 0); assert.equal(inventories, 1); assert.equal(result.execution, false); assert.equal(result.healthy, false);
  assert.equal(result.checks.find(c => c.id === 'model').code, 'MODEL_READY'); assert.equal(result.checks.find(c => c.id === 'workspace').code, 'WORKSPACE_SOURCE_CHANGED'); assert.equal(result.checks.find(c => c.id === 'expired').count, 1);
  assert.ok(!JSON.stringify(result).includes('private-filename')); assert.equal(count(f.store, 'agent_runs'), beforeTasks); assert.deepEqual(f.store.session(f.sessionId), session); assert.equal(f.store.events('demo')[0].type, 'operator.diagnostics');
  const other = await operationalDiagnostics({ gateway: f.gateway, agentRuntime: undefined, tenant: 'other', actor: 'reviewer', workspaceFiles: { tenant: 'demo', inventory: () => { throw Error('wrong tenant'); } } });
  assert.equal(other.checks.find(c => c.id === 'expired').count, 0); assert.equal(other.checks.find(c => c.id === 'workspace').code, 'WORKSPACE_NOT_CONFIGURED'); assert.equal(other.checks.find(c => c.id === 'model').code, 'LLM_NOT_CONFIGURED');
});

test('diagnostics normalize private provider errors and fail closed when the mandatory audit cannot be stored', async t => {
  const f = fixture(t), agent = runtime(f, { check: async () => { throw Error('private-provider-marker-8471'); } });
  const result = await operationalDiagnostics({ gateway: f.gateway, agentRuntime: agent, tenant: 'demo', actor: 'reviewer' });
  assert.equal(result.checks.find(c => c.id === 'model').code, 'MODEL_CHECK_FAILED'); assert.ok(!JSON.stringify(result).includes('private-provider'));
  const append = f.store.append.bind(f.store); f.store.append = () => { throw Error('audit unavailable'); };
  await assert.rejects(() => operationalDiagnostics({ gateway: f.gateway, agentRuntime: agent, tenant: 'demo', actor: 'reviewer' }), /audit unavailable/); f.store.append = append;
  const row = f.store.db.prepare('SELECT seq,event FROM audit ORDER BY seq LIMIT 1').get(); f.store.db.prepare('UPDATE audit SET event=? WHERE seq=?').run(row.event.replace('session.created', 'session.changed'), row.seq);
  await assert.rejects(() => operationalDiagnostics({ gateway: f.gateway, agentRuntime: agent, tenant: 'demo', actor: 'reviewer' }), /AUDIT_CORRUPTED/);
});
