import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTaskChecks, DEFAULT_TASK_CHECKS } from '../src/task-checks.js';
import { fixture } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';

const task = answer => ({ revision: 1, state: 'completed', code: 'OK', conversation: [{ role: 'assistant', text: answer }], steps: [] });
const rules = (numbers = [{ path: 'total', min: 68, max: 68 }], required = true) => ({ ...DEFAULT_TASK_CHECKS, structuredOutput: { required, numbers } });
const check = (answer, numbers, required) => evaluateTaskChecks(task(answer), rules(numbers, required));

test('structured checks compare exact numbers and inclusive ranges in plain and fenced JSON objects', () => {
  for (const answer of ['{"total":68}', '```json\n{"total":68}\n```', '```\r\n{"total":68}\r\n```']) assert.equal(check(answer).passed, true);
  for (const total of [-2.5, 0, 10.25]) assert.equal(check(JSON.stringify({ result: { total } }), [{ path: 'result.total', min: -2.5, max: 10.25 }]).passed, true);
  const result = check('{"total":69}'); assert.equal(result.passed, false); assert.deepEqual(result.checks.at(-1).value, { path: 'total', min: 68, max: 68, actual: 69 });
  assert.equal(check('{"total":0}', [{ path: 'total', min: 0, max: 0 }]).passed, true);
});

test('numeric checks fail on absent fields, strings, booleans, null, arrays and nonfinite or unsafe numbers', () => {
  for (const answer of ['{}', '{"total":"68"}', '{"total":true}', '{"total":null}', '{"total":[68]}', '{"total":{}}', '{"total":1e999}', '{"total":9007199254740992}']) {
    const result = check(answer); assert.equal(result.passed, false, answer); assert.equal(result.checks.at(-1).value.actual, null);
  }
  assert.equal(check('{"invoice":[{"total":68}]}', [{ path: 'invoice.total', min: 68, max: 68 }]).passed, false);
  assert.equal(check('{"Total":68}').passed, false);
});

test('JSON object requirement rejects prose, multiple blocks, duplicate decoded keys and excessive nesting', () => {
  const bad = ['68', 'null', '[]', 'Answer: {"total":68}', '{"total":68} extra', '```json\n{"total":68}\n```\n```json\n{}\n```', '{"total":67,"total":68}', '{"total":67,"\\u0074otal":68}', '{"total":68,"nested":[{"x":1,"x":2}]}', '{"total":68,}', '{"total":68,"x":' + '['.repeat(12) + '0' + ']'.repeat(12) + '}'];
  for (const answer of bad) { const result = check(answer); assert.equal(result.passed, false, answer); assert.equal(result.checks.find(c => c.kind === 'json_object_answer').passed, false); }
  assert.equal(check('{"total":68,"note":"escaped \\\" : { and }","a":{"x":1},"b":{"x":2}}').passed, true);
});

test('number checks imply JSON parsing and format-only checks are optional for legacy criteria', () => {
  assert.equal(check('Not JSON', [], false).passed, true);
  assert.equal(check('{}', []).passed, true); assert.equal(check('Not JSON', []).passed, false);
  assert.equal(check('The total is 68.', undefined, false).passed, false);
  assert.equal(evaluateTaskChecks(task('Ordinary text'), { ...DEFAULT_TASK_CHECKS }).passed, true);
  const earlier = { ...task('Final text'), conversation: [{ role: 'assistant', text: '{"total":68}' }, { role: 'assistant', text: 'Final text' }] };
  assert.equal(evaluateTaskChecks(earlier, rules()).passed, false);
});

test('structured criteria reject excessive, ambiguous, prototype and malformed rules', () => {
  for (const structuredOutput of [null, [], {}, { required: 'true', numbers: [] }, { required: true, numbers: [], extra: true }]) assert.throws(() => evaluateTaskChecks(task('{}'), { ...DEFAULT_TASK_CHECKS, structuredOutput }), /INVALID_TASK_CHECKS/);
  const bad = [{ path: '', min: 0, max: 1 }, { path: 'bad field', min: 0, max: 1 }, { path: 'items.0', min: 0, max: 1 }, { path: '__proto__.total', min: 0, max: 1 }, { path: 'a.constructor', min: 0, max: 1 }, { path: 'a.prototype', min: 0, max: 1 }, { path: 'x'.repeat(129), min: 0, max: 1 }, { path: Array(13).fill('x').join('.'), min: 0, max: 1 }, { path: 'total', min: 2, max: 1 }, { path: 'total', min: '0', max: 1 }, { path: 'total', min: null, max: 1 }, { path: 'total', min: 0, max: Infinity }, { path: 'total', min: 0, max: Number.MAX_SAFE_INTEGER + 1 }, { path: 'total', min: 0, max: 1, extra: true }, null];
  for (const rule of bad) assert.throws(() => check('{}', [rule]), /INVALID_TASK_CHECKS/);
  assert.throws(() => check('{}', Array.from({ length: 9 }, (_, i) => ({ path: `field${i}`, min: 0, max: 1 }))), /INVALID_TASK_CHECKS/);
  assert.throws(() => check('{}', [{ path: 'total', min: 0, max: 1 }, { path: 'total', min: 0, max: 2 }]), /INVALID_TASK_CHECKS/);
});

test('numeric reviews retain encrypted criteria, staleness and audit rollback without inference or budget changes', async t => {
  const f = fixture(t); let calls = 0;
  const agent = new AgentRuntime({ gateway: f.gateway, provider: { model: 'test-model', complete: async () => { calls++; return { role: 'assistant', content: '{"private_field":68}' }; } } });
  agent.start('demo', { id: 'structured', prompt: 'Return JSON', toolMode: 'chat_only' }); const run = await agent.wait('demo', 'structured'), session = f.store.session(run.sessionId), criteria = rules([{ path: 'private_field', min: 68, max: 68 }]);
  const input = { expectedRevision: 0, expectedTaskRevision: run.revision, criteria }, result = agent.checks.evaluate('demo', run.id, input, 'reviewer'); assert.equal(result.review.passed, true); assert.equal(result.review.checks.at(-1).value.actual, 68);
  assert.equal(agent.get('demo', run.id).revision, run.revision); assert.deepEqual(f.store.session(run.sessionId), session); assert.equal(calls, 1);
  assert.ok(!f.store.db.prepare('SELECT data FROM task_checks').get().data.includes('private_field')); assert.ok(!JSON.stringify(f.store.events('demo')[0]).includes('private_field'));
  const append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('audit unavailable'); };
  assert.throws(() => agent.checks.evaluate('demo', run.id, { ...input, expectedRevision: 1 }, 'reviewer'), /audit unavailable/); f.store.append = append;
  assert.equal(agent.checks.get('demo', run.id).review.revision, 1);
  agent.followUp('demo', run.id, { messageId: 'again', prompt: 'Again', expectedRevision: run.revision }); await agent.wait('demo', run.id); assert.equal(agent.checks.get('demo', run.id).stale, true);
});
