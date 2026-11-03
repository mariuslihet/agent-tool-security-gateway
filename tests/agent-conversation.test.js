import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { OllamaProvider } from '../src/ollama.js';

const reply = (content, usage) => ({ role: 'assistant', content, ...(usage ? { usage } : {}) });
const runtime = (f, complete) => new AgentRuntime({ gateway: f.gateway, provider: { model: 'conversation-test', complete } });
const follow = (agent, run, prompt = 'Remember the earlier answer', messageId = 'follow-1') => agent.followUp('demo', run.id, { messageId, prompt, expectedRevision: run.revision });

test('follow-up includes prior messages, preserves the session and budgets, and increments revision', async t => {
  const f = fixture(t); let calls = 0;
  const agent = runtime(f, async messages => { calls++; if (calls === 1) return reply('The answer is 42.'); assert.equal(messages.at(-1).content, 'Add eight to the previous answer'); assert.ok(messages.some(m => m.content === 'The answer is 42.')); return reply('That gives 50.'); });
  agent.start('demo', { id: 'conversation', prompt: 'Start with 42' }); const first = await agent.wait('demo', 'conversation'); const session = f.store.session(first.sessionId);
  follow(agent, first, 'Add eight to the previous answer'); const second = await agent.wait('demo', 'conversation');
  assert.equal(second.sessionId, first.sessionId); assert.equal(second.state, 'completed'); assert.equal(second.turns, 2); assert.equal(second.userMessages, 2); assert.ok(second.revision > first.revision); assert.deepEqual(second.conversation.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(f.store.session(second.sessionId).calls, session.calls); assert.equal(f.store.session(second.sessionId).limits.maxCalls, session.limits.maxCalls);
  assert.ok(f.store.events('demo').some(e => e.type === 'agent.follow_up')); assert.ok(!JSON.stringify(f.store.events('demo')).includes('Add eight to the previous answer'));
});

test('follow-up message IDs are idempotent and stale revisions or changed duplicate prompts cannot append text', async t => {
  const f = fixture(t); let calls = 0; const agent = runtime(f, async () => { calls++; return reply('Generated answer'); });
  agent.start('demo', { id: 'ids', prompt: 'Hello' }); const first = await agent.wait('demo', 'ids'); follow(agent, first, 'More detail'); await agent.wait('demo', 'ids');
  follow(agent, first, 'More detail'); assert.equal(calls, 2);
  assert.throws(() => follow(agent, first, 'Changed prompt'), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => follow(agent, first, 'Different message', 'follow-2'), /VERSION_CONFLICT/);
  assert.equal(agent.get('demo', 'ids').userMessages, 2); assert.throws(() => agent.followUp('other', 'ids', { messageId: 'other', prompt: 'Hi', expectedRevision: 1 }), /FORBIDDEN/);
});

test('chat-only mode has no gateway grants, and safe mode excludes sensitive and outbound tools', async t => {
  const f = fixture(t); const catalogs = [];
  const agent = runtime(f, async (messages, tools) => { catalogs.push(tools); return reply('Chat without executing anything'); });
  agent.start('demo', { id: 'chat', prompt: 'Hello', toolMode: 'chat_only' }); const chat = await agent.wait('demo', 'chat'); assert.equal(catalogs[0].length, 0); assert.equal(chat.allowedTools.length, 0); assert.equal(f.store.session(chat.sessionId).grants.length, 0);
  const attempt = await f.gateway.execute('demo-agent', chat.sessionId, { id: 'forged', tool: 'text.encode', arguments: { text: 'never allowed' } }); assert.equal(attempt.code, 'CAPABILITY_DENIED');
  assert.throws(() => f.gateway.createSession('demo-agent', { parentId: chat.sessionId, grants: f.profiles[0].grants }), /CAPABILITY_ESCALATION/);
  agent.start('demo', { id: 'safe', prompt: 'Hello' }); const safe = await agent.wait('demo', 'safe'); assert.deepEqual(safe.allowedTools, ['knowledge.read', 'compute.sum', 'text.encode']); assert.equal(safe.toolMode, 'safe');
  assert.equal(f.store.session(safe.sessionId).grants.length, 3); assert.throws(() => agent.start('demo', { id: 'safe', prompt: 'Hello', toolMode: 'all' }), /IDEMPOTENCY_CONFLICT/);
});

test('tool selection cannot expand on a follow-up and invalid modes cannot create sessions', async t => {
  const f = fixture(t); let seen = [];
  const agent = runtime(f, async (messages, tools) => { seen.push(tools.map(t => t.function.description)); return reply('Within selected capabilities'); });
  const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n; assert.throws(() => agent.start('demo', { id: 'invalid', prompt: 'Hi', toolMode: 'admin' }), /INVALID_RUN/); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, before);
  agent.start('demo', { id: 'fixed', prompt: 'Hi', toolMode: 'chat_only' }); const first = await agent.wait('demo', 'fixed'); follow(agent, first); const second = await agent.wait('demo', 'fixed'); assert.deepEqual(seen, [[], []]); assert.equal(second.toolMode, 'chat_only');
});

test('follow-ups cannot reset a task turn limit or continue failed, waiting or expired sessions', async t => {
  const f = fixture(t), agent = runtime(f, async () => reply('Another answer'));
  agent.start('demo', { id: 'bounded-chat', prompt: 'Hi' }); let run = await agent.wait('demo', 'bounded-chat');
  for (let i = 1; i < 6; i++) { follow(agent, run, 'Continue', 'message-' + i); run = await agent.wait('demo', run.id); }
  assert.equal(run.turns, 6); assert.throws(() => follow(agent, run, 'One more', 'over-budget'), /RUN_NOT_CONTINUABLE/);
  agent.start('demo', { id: 'expired', prompt: 'Hello' }); const expired = await agent.wait('demo', 'expired'); f.advance(3600001); assert.throws(() => follow(agent, expired), /CONFIGURATION_CHANGED/);
  const broken = runtime(f, async () => { throw new Error('Provider unavailable'); }); broken.start('demo', { id: 'failed-follow', prompt: 'Hello' }); const failed = await broken.wait('demo', 'failed-follow'); assert.throws(() => follow(broken, failed), /RUN_NOT_CONTINUABLE/);
  f.gateway.containment.hold({ tenant: 'demo', actor: 'reviewer' }, { kind: 'tool', target: 'text.encode', expectedRevision: 0, durationMinutes: 15, reason: 'Pause a test call' });
  const paused = runtime(f, async (messages, tools) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name: tools.find(t => t.function.description.startsWith('text.encode:')).function.name, arguments: { text: 'test' } } }] }));
  paused.start('demo', { id: 'waiting-follow', prompt: 'Encode text' }); const waiting = await paused.wait('demo', 'waiting-follow'); assert.equal(waiting.state, 'waiting'); assert.throws(() => follow(paused, waiting), /RUN_NOT_CONTINUABLE/);
});

test('usage aggregates reported counts without inserting statistics into provider message history', async t => {
  const f = fixture(t), usage = { inputTokens: 18, outputTokens: 9, modelDurationMs: 100.5 };
  const agent = runtime(f, async messages => { assert.ok(messages.every(m => !Object.hasOwn(m, 'usage'))); return reply('Measured answer', usage); });
  agent.start('demo', { id: 'usage', prompt: 'Hello' }); const first = await agent.wait('demo', 'usage'); follow(agent, first); const second = await agent.wait('demo', 'usage');
  assert.equal(second.usage.requests, 2); assert.equal(second.usage.reportedRequests, 2); assert.equal(second.usage.timedRequests, 2); assert.equal(second.usage.inputTokens, 36); assert.equal(second.usage.outputTokens, 18); assert.equal(second.usage.modelDurationMs, 201);
});

test('missing usage remains unknown and malformed usage fails before any tool dispatch', async t => {
  const f = fixture(t), missing = runtime(f, async () => reply('No provider statistics'));
  missing.start('demo', { id: 'unknown-usage', prompt: 'Hello' }); assert.equal((await missing.wait('demo', 'unknown-usage')).usage.reportedRequests, 0);
  const malformed = runtime(f, async () => reply('Invalid statistics', { inputTokens: -1, outputTokens: 1, modelDurationMs: 0 })); malformed.start('demo', { id: 'bad-usage', prompt: 'Hi' }); assert.equal((await malformed.wait('demo', 'bad-usage')).code, 'INVALID_LLM_USAGE');
  const provider = new OllamaProvider({ model: 'local-model', fetchImpl: async () => Response.json({ done: true, message: { role: 'assistant', content: 'Real frame' }, prompt_eval_count: 3, eval_count: 5, total_duration: 2000000 }) });
  assert.deepEqual((await provider.complete([], [])).usage, { inputTokens: 3, outputTokens: 5, modelDurationMs: 2 });
});

test('conversation exports redact secrets, contain no internal messages, reproduce the hash and audit only metadata', async t => {
  const f = fixture(t), agent = runtime(f, async () => reply('Contact private@example.com; password=abcdef1234'));
  agent.start('demo', { id: 'export', prompt: 'Say hello' }); await agent.wait('demo', 'export'); const json = agent.export('demo', 'export', { format: 'json' }); const parsed = JSON.parse(json.content);
  assert.ok(!json.content.includes('private@example.com')); assert.ok(!json.content.includes('abcdef1234')); assert.ok(!json.content.includes('messages":')); assert.ok(!json.content.includes('pending":'));
  assert.equal(parsed.run.id, 'export'); assert.equal(createHash('sha256').update(json.content).digest('hex'), json.contentHash); const event = f.store.events('demo')[0]; assert.equal(event.type, 'agent.exported'); assert.equal(event.contentHash, json.contentHash); assert.ok(!JSON.stringify(event).includes('Say hello'));
  assert.throws(() => agent.export('other', 'export', { format: 'json' }), /RUN_NOT_FOUND/); assert.throws(() => agent.export('demo', 'export', { format: 'html' }), /INVALID_EXPORT/);
});

test('Markdown export fences untrusted text including embedded code fences and remote images', async t => {
  const f = fixture(t), text = '```\n![tracking](https://example.com/pixel)\n```';
  const agent = runtime(f, async () => reply(text)); agent.start('demo', { id: 'markdown', prompt: 'Show data' }); await agent.wait('demo', 'markdown'); const result = agent.export('demo', 'markdown', { format: 'markdown' });
  assert.ok(result.content.includes('````text\n' + text + '\n````')); assert.ok(result.content.includes('## Gateway trace'));
  f.store.append = () => { throw new Error('audit unavailable'); }; assert.throws(() => agent.export('demo', 'markdown', { format: 'json' }), /audit unavailable/);
});
