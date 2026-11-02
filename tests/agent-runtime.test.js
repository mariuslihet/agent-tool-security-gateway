import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, report, admin } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { OllamaProvider, configuredOllama } from '../src/ollama.js';

const assistant = content => ({ role: 'assistant', content });
const call = (tools, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name: tools.find(t => t.function.description.startsWith(name + ':')).function.name, arguments: args } }] });
function runtime(f, complete) { return new AgentRuntime({ gateway: f.gateway, provider: { model: 'test-local-model', complete, check: async () => ({ ready: true }) } }); }

test('model requests tools through the real gateway, receives results, and produces its own final answer', async t => {
  const f = fixture(t); let turns = 0;
  const agent = runtime(f, async (messages, tools) => { turns++; if (turns === 1) return call(tools, 'text.encode', { text: 'dynamic user text' });
    assert.equal(messages.at(-1).role, 'tool'); assert.equal(JSON.parse(messages.at(-1).content).status, 'completed'); return assistant('A generated reply based on the actual encoded result.'); });
  agent.start('demo', { id: 'real-gateway-path', prompt: 'Encode this text' }); const result = await agent.wait('demo', 'real-gateway-path');
  assert.equal(result.state, 'completed'); assert.equal(turns, 2); assert.equal(result.steps[0].status, 'completed'); assert.equal(result.conversation.at(-1).text, 'A generated reply based on the actual encoded result.');
  assert.ok(f.store.events('demo').some(e => e.type === 'execution.started')); assert.ok(!JSON.stringify(f.store.events('demo')).includes('dynamic user text'));
  assert.ok(!f.store.db.prepare('SELECT data FROM agent_runs').get().data.includes('dynamic user text'));
});

test('LLM tool argument errors are denied mechanically and fed back for recovery without bypass', async t => {
  const f = fixture(t); let turns = 0;
  const agent = runtime(f, async (messages, tools) => { turns++; if (turns === 1) return call(tools, 'text.encode', { text: 'safe', bypass: true });
    if (turns === 2) { assert.equal(JSON.parse(messages.at(-1).content).status, 'denied'); return call(tools, 'text.encode', { text: 'safe' }); } return assistant('Recovered using a valid call.'); });
  agent.start('demo', { id: 'recover', prompt: 'Encode safely' }); const result = await agent.wait('demo', 'recover'); assert.equal(result.state, 'completed'); assert.equal(result.steps[0].status, 'denied'); assert.equal(result.steps[1].status, 'completed');
});

test('approval pauses the loop and resumes the persisted exact call after a separate operator decision', async t => {
  const f = fixture(t); let turns = 0;
  const agent = runtime(f, async (messages, tools) => ++turns === 1 ? call(tools, 'report.publish', report) : assistant('The publishing adapter returned simulation mode, not delivery.'));
  agent.start('demo', { id: 'approval', prompt: 'Prepare a simulated report' }); const waiting = await agent.wait('demo', 'approval'); assert.equal(waiting.state, 'waiting'); assert.equal(turns, 1);
  const pending = f.gateway.approvals('demo')[0]; f.gateway.decideApproval(admin, { sessionId: pending.sessionId, requestId: pending.requestId, binding: pending.binding, decision: 'approve' });
  agent.resume('demo', waiting.id); const finished = await agent.wait('demo', waiting.id); assert.equal(finished.state, 'completed'); assert.equal(finished.steps[0].requestId, waiting.steps[0].requestId); assert.equal(finished.toolCalls, 1);
  assert.equal(f.store.request(pending.sessionId, pending.requestId).approval.state, 'consumed');
});

test('scoped pauses preserve the original model call until explicit resume', async t => {
  const f = fixture(t); let turns = 0;
  f.gateway.containment.hold({ tenant: 'demo', actor: 'reviewer' }, { kind: 'tool', target: 'text.encode', expectedRevision: 0, durationMinutes: 15, reason: 'Maintenance test' });
  const agent = runtime(f, async (messages, tools) => ++turns === 1 ? call(tools, 'text.encode', { text: 'safe' }) : assistant('Encoding completed.'));
  agent.start('demo', { id: 'paused', prompt: 'Encode safely' }); const waiting = await agent.wait('demo', 'paused'); assert.equal(waiting.code, 'TOOL_PAUSED');
  f.gateway.containment.release({ tenant: 'demo', actor: 'reviewer' }, { kind: 'tool', target: 'text.encode', expectedRevision: 1, reason: 'Maintenance complete' });
  agent.resume('demo', waiting.id); const finished = await agent.wait('demo', waiting.id); assert.equal(finished.state, 'completed'); assert.equal(finished.steps[0].requestId, waiting.steps[0].requestId);
});

test('sensitive tool results never enter a subsequent model request or operator conversation', async t => {
  const f = fixture(t); let turns = 0; const agent = runtime(f, async (messages, tools) => { turns++; return call(tools, 'vault.read', { record: 'invoice' }); });
  agent.start('demo', { id: 'sensitive', prompt: 'Read invoice' }); const result = await agent.wait('demo', 'sensitive'); assert.equal(result.code, 'MODEL_DATA_WITHHELD'); assert.equal(turns, 1);
  assert.ok(!JSON.stringify(result).includes('4200')); assert.equal(result.steps[0].status, 'completed');
});

test('task IDs prevent duplicate generation and reject changed prompts or cross-tenant access', async t => {
  const f = fixture(t); let turns = 0; const agent = runtime(f, async () => { turns++; return assistant('An answer.'); });
  agent.start('demo', { id: 'same', prompt: 'Hello' }); await agent.wait('demo', 'same'); agent.start('demo', { id: 'same', prompt: 'Hello' }); assert.equal(turns, 1);
  assert.throws(() => agent.start('demo', { id: 'same', prompt: 'Different' }), /IDEMPOTENCY_CONFLICT/); assert.throws(() => agent.get('other', 'same'), /RUN_NOT_FOUND/);
  assert.throws(() => agent.start('other', { id: 'different', prompt: 'Hi' }), /FORBIDDEN/); assert.equal(agent.list('other').items.length, 0);
});

test('a second runtime cannot claim an actively leased task or overwrite its state', async t => {
  const f = fixture(t); let finish; const first = runtime(f, async () => new Promise(resolve => { finish = resolve; }));
  first.start('demo', { id: 'leased', prompt: 'Hello' }); await new Promise(resolve => setImmediate(resolve));
  const second = runtime(f, async () => assistant('Must not run')); assert.equal(second.get('demo', 'leased').state, 'running'); assert.throws(() => second.resume('demo', 'leased'), /AGENT_BUSY/);
  assert.equal(first.get('demo', 'leased').state, 'running'); finish(assistant('Single owner completed')); assert.equal((await first.wait('demo', 'leased')).state, 'completed');
});

test('cancellation prevents a late model response from executing a tool', async t => {
  const f = fixture(t); let finish, toolsSeen; const agent = runtime(f, async (messages, tools) => { toolsSeen = tools; return new Promise(resolve => { finish = resolve; }); });
  agent.start('demo', { id: 'cancel', prompt: 'Encode' }); await new Promise(resolve => setImmediate(resolve)); agent.cancel('demo', 'cancel'); finish(call(toolsSeen, 'text.encode', { text: 'never execute' }));
  const result = await agent.wait('demo', 'cancel'); assert.equal(result.code, 'RUN_CANCELLED'); assert.equal(f.store.session(result.sessionId).calls, 0);
});

test('runaway model tool loops are bounded and provider errors never become a fabricated answer', async t => {
  const f = fixture(t); const agent = runtime(f, async (messages, tools) => call(tools, 'text.encode', { text: 'loop' }));
  agent.start('demo', { id: 'bounded', prompt: 'Loop' }); const r = await agent.wait('demo', 'bounded'); assert.equal(r.state, 'failed'); assert.equal(r.code, 'AGENT_TURN_LIMIT'); assert.equal(r.turns, 6);
  const failing = runtime(f, async () => { throw new Error('private provider diagnostic'); }); failing.start('demo', { id: 'failed', prompt: 'Hello' }); const failed = await failing.wait('demo', 'failed'); assert.equal(failed.code, 'AGENT_UNAVAILABLE'); assert.equal(failed.conversation.length, 1); assert.ok(!JSON.stringify(failed).includes('private provider diagnostic'));
});

test('oversized task state fails using the last durable snapshot and mandatory start audit failures never launch inference', async t => {
  const f = fixture(t), oversized = runtime(f, async () => assistant('x'.repeat(300000)));
  oversized.start('demo', { id: 'oversized', prompt: 'Hello' }); const failed = await oversized.wait('demo', 'oversized'); assert.equal(failed.state, 'failed'); assert.equal(failed.code, 'PAYLOAD_TOO_LARGE'); assert.equal(failed.conversation.length, 1);
  let called = false; const audited = runtime(f, async () => { called = true; return assistant('Must not generate'); });
  const append = f.store.append.bind(f.store); f.store.append = event => { if (event.type === 'agent.started') throw new Error('audit unavailable'); return append(event); };
  assert.throws(() => audited.start('demo', { id: 'audit-failure', prompt: 'Hello' }), /audit unavailable/); await new Promise(resolve => setImmediate(resolve)); assert.equal(called, false);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM agent_run_locks').get().n, 0); assert.throws(() => audited.get('demo', 'audit-failure'), /RUN_NOT_FOUND/);
});

test('Ollama adapter validates local destinations and normalizes actual native function-call frames', async () => {
  for (const baseUrl of ['https://example.com', 'http://192.168.1.1', 'http://localhost', 'http://127.0.0.1/x', 'http://user:pass@127.0.0.1']) assert.throws(() => new OllamaProvider({ model: 'model', baseUrl }), /INVALID_LLM_ENDPOINT/);
  let body; const provider = new OllamaProvider({ model: 'local-model', fetchImpl: async (url, options) => { body = JSON.parse(options.body); assert.equal(options.redirect, 'error'); return Response.json({ done: true, message: { role: 'assistant', tool_calls: [{ function: { name: 'gateway_0', arguments: { numbers: [1, 2] }, index: 0 } }] } }); } });
  const result = await provider.complete([{ role: 'user', content: 'Sum' }], [], new AbortController().signal); assert.equal(result.tool_calls[0].function.arguments.numbers[1], 2); assert.equal(body.stream, false); assert.equal(body.think, false);
  assert.equal(configuredOllama({}), null); assert.throws(() => configuredOllama({ LLM_PROVIDER: 'unknown' }), /INVALID_LLM_PROVIDER/);
});

test('Ollama adapter rejects malformed, oversized and error responses without exposing raw upstream data', async () => {
  const invalid = [Response.json({ message: { role: 'assistant', content: 'incomplete' } }), Response.json({ done: true, message: { role: 'assistant', tool_calls: [{ function: { name: 'shell', arguments: {} } }] } }), new Response('private provider error', { status: 500 }), new Response('x'.repeat(262145)), Response.json({ done: true, done_reason: 'length', message: { role: 'assistant', content: 'truncated' } })];
  for (const response of invalid) { const provider = new OllamaProvider({ model: 'model', fetchImpl: async () => response }); await assert.rejects(provider.complete([], []), error => !error.message.includes('private provider error')); }
});
