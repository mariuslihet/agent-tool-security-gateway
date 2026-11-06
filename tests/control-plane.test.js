import { test } from 'node:test';
import assert from 'node:assert/strict';

test('structured checks API returns numeric evidence and rejects invalid bounds without modifying the saved review', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: '{"invoice":{"total":68}}' }));
  f.agentRuntime.start('demo', { id: 'json-check-api', prompt: 'Return JSON' }); const task = await f.agentRuntime.wait('demo', 'json-check-api'), path = `/v1/operator/agent/runs/${task.id}/checks`;
  const criteria = { requiredPhrases: [], forbiddenPhrases: [], requiredTools: [], requireCompleted: true, rejectDenied: true, structuredOutput: { required: true, numbers: [{ path: 'invoice.total', min: 68, max: 68 }] } }, input = { expectedRevision: 0, expectedTaskRevision: task.revision, criteria };
  assert.equal((await f.request(path, 'viewer', input)).status, 403);
  const response = await f.request(path, 'operator', input); assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.review.passed, true); assert.equal(result.review.checks.at(-1).value.actual, 68);
  for (const rule of [{ path: 'invoice.total', min: 69, max: 68 }, { path: 'invoice.total', min: '68', max: 68 }, { path: '__proto__', min: 0, max: 1 }]) {
    const bad = await f.request(path, 'operator', { ...input, expectedRevision: 1, criteria: { ...criteria, structuredOutput: { required: true, numbers: [rule] } } }); assert.equal(bad.status, 400); assert.equal((await bad.json()).code, 'INVALID_TASK_CHECKS');
  }
  const saved = await (await f.request(path, 'operator')).json(); assert.equal(saved.review.revision, 1); assert.deepEqual(saved.review.criteria.structuredOutput, criteria.structuredOutput);
});

test('task review API enforces operator access, exact input, stale receipts and mandatory audit', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'Generated answer' })), path = '/v1/operator/agent/plan', draft = { prompt: 'Hello', toolMode: 'safe' };
  for (const role of ['viewer', 'agent', 'other']) assert.equal((await f.request(path, role, draft)).status, 403);
  assert.equal((await f.request(path, 'operator', { ...draft, execute: true })).status, 400);
  assert.equal((await f.request(path + '?execute=true', 'operator', draft)).status, 400);
  const response = await f.request(path, 'operator', draft); assert.equal(response.status, 200); const plan = await response.json();
  assert.equal(f.agentRuntime.list('demo').total, 0);
  const stale = await f.request('/v1/operator/agent/runs', 'operator', { ...draft, id: 'stale-plan', prompt: 'Changed', expectedPlanHash: plan.planHash }); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'AGENT_PLAN_CHANGED');
  const started = await f.request('/v1/operator/agent/runs', 'operator', { ...draft, id: 'reviewed-plan', expectedPlanHash: plan.planHash }); assert.equal(started.status, 202); assert.equal((await started.json()).planHash, plan.planHash); await f.agentRuntime.wait('demo', 'reviewed-plan');
  const append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('audit unavailable'); };
  try { const failed = await f.request(path, 'operator', { prompt: 'private-review-7851' }); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private-review-7851')); } finally { f.store.append = append; }
});
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fixture, report, admin } from './helpers.js';
import { createGatewayServer } from '../src/server.js';
import { validatePolicyDocument, previewPolicy } from '../src/policy-lab.js';
import { Policy } from '../src/policy.js';
import { digest } from '../src/util.js';
import { AgentRuntime } from '../src/agent-runtime.js';

test('task acceptance API enforces operator role, strict criteria/revisions and audit-before-delivery', async t => {
  let calls = 0; const f = await host(t, async () => { calls++; return { role: 'assistant', content: 'The answer is 40.' }; }); f.agentRuntime.start('demo', { id: 'checks-api', prompt: 'Hello' }); const run = await f.agentRuntime.wait('demo', 'checks-api');
  const path = '/v1/operator/agent/runs/checks-api/checks', criteria = { requiredPhrases: ['40'], forbiddenPhrases: [], requiredTools: [], requireCompleted: true, rejectDenied: true }, input = { expectedRevision: 0, expectedTaskRevision: run.revision, criteria };
  for (const role of ['viewer', 'agent', 'other']) { assert.equal((await f.request(path, role)).status, 403); assert.equal((await f.request(path, role, input)).status, 403); }
  assert.equal((await (await f.request(path, 'operator')).json()).review, null);
  for (const bad of [{ ...input, actor: 'forged' }, { ...input, criteria: { ...criteria, approve: true } }]) assert.equal((await f.request(path, 'operator', bad)).status, 400);
  assert.equal((await f.request(path + '?execute=true', 'operator', input)).status, 400);
  const saved = await (await f.request(path, 'operator', input)).json(); assert.equal(saved.review.passed, true); assert.equal(saved.stale, false); assert.equal(calls, 1); assert.equal(f.agentRuntime.get('demo', run.id).revision, run.revision);
  assert.equal((await f.request(path, 'operator', input)).status, 409);
  const append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('Injected audit failure'); };
  try { const failed = await f.request(path, 'operator', { ...input, expectedRevision: 1, criteria: { ...criteria, requiredPhrases: ['private-check-4482'] } }); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private-check-4482')); } finally { f.store.append = append; }
  assert.equal((await (await f.request(path, 'operator')).json()).review.revision, 1);
});

test('template render API requires operator ownership, exact fields and current enabled revision', async t => {
  const f = await host(t, async () => { throw new Error('Must not execute'); }), template = f.agentRuntime.library.saveTemplate('demo', { expectedRevision: 0, title: 'Summary', prompt: 'Summarize {{document}}.', parameterized: true, toolMode: 'safe', enabled: true }, 'reviewer');
  const path = `/v1/operator/agent/templates/${template.id}/render`, input = { expectedRevision: 1, values: { document: 'notes.md' } };
  for (const role of ['viewer', 'agent', 'other']) assert.equal((await f.request(path, role, input)).status, 403);
  const result = await (await f.request(path, 'operator', input)).json(); assert.equal(result.prompt, 'Summarize notes.md.'); assert.equal(result.reviewRequired, true); assert.equal(f.agentRuntime.list('demo').total, 0);
  for (const bad of [{ ...input, toolMode: 'all' }, { ...input, actor: 'forged' }, { ...input, values: {} }, { ...input, values: { document: 'notes.md', extra: 'no' } }]) assert.equal((await f.request(path, 'operator', bad)).status, 400);
  assert.equal((await f.request(path + '?execute=true', 'operator', input)).status, 400);
  f.agentRuntime.library.saveTemplate('demo', { id: template.id, expectedRevision: 1, title: 'Summary', prompt: 'Summarize {{document}}.', parameterized: true, toolMode: 'safe', enabled: false }, 'reviewer');
  assert.equal((await f.request(path, 'operator', input)).status, 409); assert.equal((await f.request(path, 'operator', { ...input, expectedRevision: 2 })).status, 400);
  f.agentRuntime.library.saveTemplate('demo', { id: template.id, expectedRevision: 2, title: 'Summary', prompt: 'Summarize {{document}}.', parameterized: true, toolMode: 'safe', enabled: true }, 'reviewer');
  const append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('Injected audit failure'); };
  try { const blocked = await f.request(path, 'operator', { expectedRevision: 3, values: { document: 'private-render-input-5571' } }); assert.equal(blocked.status, 503); assert.ok(!(await blocked.text()).includes('private-render-input-5571')); } finally { f.store.append = append; }
});

test('task budget API validates bounds, binds retries and forbids later limit changes', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'Generated answer' })), taskLimits = { maxTurns: 2, maxToolCalls: 2, maxRunMs: 60000 }, input = { id: 'budget-api', prompt: 'Hello', toolMode: 'safe', taskLimits };
  assert.equal((await f.request('/v1/operator/agent/runs', 'viewer', input)).status, 403);
  assert.equal((await f.request('/v1/operator/agent/runs', 'operator', { ...input, taskLimits: { ...taskLimits, maxTurns: 99 } })).status, 400);
  assert.equal((await f.request('/v1/operator/agent/runs', 'operator', input)).status, 202); const run = await f.agentRuntime.wait('demo', input.id); assert.equal(run.limits.maxTurns, 2); assert.equal(run.limits.maxToolCalls, 2); assert.equal(run.limits.maxRunMs, 60000);
  const retry = await f.request('/v1/operator/agent/runs', 'operator', { ...input, taskLimits: { ...taskLimits, maxTurns: 3 } }); assert.equal(retry.status, 400); assert.equal((await retry.json()).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.request(`/v1/operator/agent/runs/${run.id}/messages`, 'operator', { messageId: 'new-message', prompt: 'More', expectedRevision: run.revision, taskLimits })).status, 400);
  assert.equal(f.store.session(run.sessionId).limits.maxCalls, 2);
});

test('task health API is operator-only, rejects parameters and remains read-only', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'Answer' })); f.agentRuntime.start('demo', { id: 'health-api', prompt: 'Private prompt' }); await f.agentRuntime.wait('demo', 'health-api');
  const path = '/v1/operator/agent/runs/health-api/health', before = f.store.verifyAudit().count;
  for (const role of ['viewer', 'agent', 'other']) assert.equal((await f.request(path, role)).status, 403);
  const response = await f.request(path, 'operator'); assert.equal(response.status, 200); const h = await response.json(); assert.equal(h.id, 'health-api'); assert.equal(h.followUp.available, true); assert.equal(h.budgets.modelTurns.remaining, 5); assert.ok(!JSON.stringify(h).includes('Private prompt'));
  assert.equal((await f.request(path + '?execute=true', 'operator')).status, 400); assert.equal((await f.request(path, 'operator', {})).status, 400); assert.equal(f.store.verifyAudit().count, before);
});

test('task organization API enforces operator access, independent revisions and archive history filters', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'A real-runtime test answer' })); f.agentRuntime.start('demo', { id: 'library-api', prompt: 'Hello' }); const run = await f.agentRuntime.wait('demo', 'library-api');
  const url = '/v1/operator/agent/runs/library-api/organize', body = { expectedRevision: 0, title: 'Arithmetic review', tags: ['math'], pinned: true, archived: true };
  for (const role of ['viewer', 'agent']) assert.equal((await f.request(url, role, body)).status, 403);
  assert.equal((await f.request(url, 'operator', { ...body, toolMode: 'all' })).status, 400);
  assert.equal((await f.request(url, 'operator', body)).status, 200); assert.equal((await f.request(url, 'operator', body)).status, 409);
  const visible = await (await f.request('/v1/operator/agent/runs', 'operator')).json(); assert.equal(visible.total, 0);
  const archived = await (await f.request('/v1/operator/agent/runs?archive=archived&search=MATH&pinned=true&state=completed&limit=1&offset=0', 'operator')).json(); assert.equal(archived.total, 1); assert.equal(archived.items[0].organization.title, 'Arithmetic review'); assert.equal(archived.items[0].revision, run.revision);
  assert.equal((await f.request('/v1/operator/agent/runs?offset=-1', 'operator')).status, 400); assert.equal((await f.request('/v1/operator/agent/runs?archive=deleted', 'operator')).status, 400);
});

test('prompt template APIs protect private prompts and reject unknown fields without starting tasks', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'Must not be requested' })), input = { expectedRevision: 0, title: 'Test template', prompt: 'Use the arithmetic tool.', toolMode: 'safe', enabled: true };
  for (const role of ['viewer', 'agent']) { assert.equal((await f.request('/v1/operator/agent/templates', role)).status, 403); assert.equal((await f.request('/v1/operator/agent/templates', role, input)).status, 403); }
  assert.equal((await f.request('/v1/operator/agent/templates', 'operator', { ...input, principal: 'other-agent' })).status, 400);
  const response = await f.request('/v1/operator/agent/templates', 'operator', input); assert.equal(response.status, 200); const saved = await response.json(); assert.ok(saved.id);
  assert.equal((await (await f.request('/v1/operator/agent/templates?enabled=true', 'operator')).json()).items.length, 1);
  assert.equal((await f.request('/v1/operator/agent/templates/' + saved.id, 'viewer')).status, 403); assert.equal((await f.request('/v1/operator/agent/templates/' + saved.id, 'operator')).status, 200);
  assert.equal((await f.request('/v1/operator/agent/templates', 'operator', { ...input, id: saved.id })).status, 409);
  assert.equal(f.agentRuntime.list('demo').total, 0); assert.equal(f.store.events('demo')[0].type, 'agent.template_saved');
});

test('follow-up API checks operator role, revision and fixed tool mode before appending messages', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'A generated answer' }));
  const created = await f.request('/v1/operator/agent/runs', 'operator', { id: 'follow-api', prompt: 'Hello', toolMode: 'chat_only' }); assert.equal(created.status, 202);
  const first = await f.agentRuntime.wait('demo', 'follow-api'), input = { messageId: 'message-2', prompt: 'More detail', expectedRevision: first.revision }, url = '/v1/operator/agent/runs/follow-api/messages';
  assert.equal((await f.request(url, 'viewer', input)).status, 403); assert.equal((await f.request(url, 'agent', input)).status, 403);
  assert.equal((await f.request(url, 'operator', { ...input, toolMode: 'all' })).status, 400);
  assert.equal((await f.request(url, 'operator', input)).status, 202); const next = await f.agentRuntime.wait('demo', 'follow-api'); assert.equal(next.sessionId, first.sessionId); assert.equal(next.toolMode, 'chat_only'); assert.equal(next.userMessages, 2);
  assert.equal((await f.request(url, 'operator', { ...input, messageId: 'message-3' })).status, 409);
  assert.equal(f.store.events('demo').find(e => e.type === 'agent.follow_up').actor, 'reviewer');
});

test('conversation export API is operator-only, bounded to supported formats and never returns internal context', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'Generated export text' }));
  f.agentRuntime.start('demo', { id: 'export-api', prompt: 'Hello' }); await f.agentRuntime.wait('demo', 'export-api'); const url = '/v1/operator/agent/runs/export-api/export';
  assert.equal((await f.request(url, 'viewer', { format: 'json' })).status, 403); assert.equal((await f.request(url, 'agent', { format: 'json' })).status, 403);
  assert.equal((await f.request(url, 'operator', { format: 'html' })).status, 400); assert.equal((await f.request(url, 'operator', { format: 'json', includeSystem: true })).status, 400);
  const response = await f.request(url, 'operator', { format: 'json' }); assert.equal(response.status, 200); const result = await response.json(); const content = JSON.parse(result.content); assert.equal(content.run.conversation.at(-1).text, 'Generated export text'); assert.equal(content.run.toolMode, 'safe'); assert.ok(!result.content.includes('messages":'));
  assert.equal(f.store.events('demo')[0].actor, 'reviewer'); assert.equal((await f.request('/v1/operator/agent/runs?includeSystem=true', 'operator')).status, 400);
});

test('real-agent API isolates operator conversations and rejects forged runtime context', async t => {
  const f = await host(t, async () => ({ role: 'assistant', content: 'Provider-generated unit test reply' }));
  const config = await (await f.request('/v1/operator/agent/config')).json(); assert.equal(config.configured, true); assert.ok(!JSON.stringify(config).includes('token'));
  for (const role of ['viewer', 'agent']) { assert.equal((await f.request('/v1/operator/agent/runs', role, { id: 'test', prompt: 'Hello' })).status, 403); assert.equal((await f.request('/v1/operator/agent/runs', role)).status, 403); }
  assert.equal((await f.request('/v1/operator/agent/runs', 'operator', { id: 'test', prompt: 'Hello', principal: 'other-agent' })).status, 400);
  assert.equal((await f.request('/v1/operator/agent/runs', 'operator', { id: 'test', prompt: 'Hello' })).status, 202);
  await f.agentRuntime.wait('demo', 'test'); const result = await (await f.request('/v1/operator/agent/runs/test', 'operator')).json(); assert.equal(result.state, 'completed'); assert.equal(result.conversation.at(-1).text, 'Provider-generated unit test reply');
  assert.equal((await f.request('/v1/operator/agent/runs/test', 'viewer')).status, 403);
  assert.equal((await f.request('/v1/operator/agent/runs', 'operator', { id: 'test', prompt: 'Changed' })).status, 400);
});

test('scoped containment API enforces roles, tenant ownership and exact revision release before execution resumes', async t => {
  const f = await host(t), input = { kind: 'session', target: f.sessionId, expectedRevision: 0, durationMinutes: 15, reason: 'Investigate test task only' };
  for (const role of ['viewer', 'agent']) assert.equal((await f.request('/v1/operator/containment/hold', role, input)).status, 403);
  assert.equal((await f.request('/v1/operator/containment/hold', 'operator', { ...input, bypass: true })).status, 400);
  const response = await f.request('/v1/operator/containment/hold', 'operator', input); assert.equal(response.status, 200); const held = await response.json(); assert.equal(held.active, true);
  assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'held')).code, 'SESSION_QUARANTINED');
  assert.equal((await (await f.request('/v1/operator/containment')).json()).items.length, 1);
  assert.equal((await (await f.request('/v1/operator/containment', 'other')).json()).items.length, 0);
  assert.equal((await f.request('/v1/operator/containment/target?kind=session&target=' + f.sessionId, 'other')).status, 400);
  assert.equal((await f.request('/v1/operator/containment/target?kind=session&target=' + f.sessionId)).status, 200);
  const body = { kind: 'session', target: f.sessionId, expectedRevision: held.revision, reason: 'Review complete in test' };
  assert.equal((await f.request('/v1/operator/containment/release', 'viewer', body)).status, 403);
  assert.equal((await f.request('/v1/operator/containment/release', 'operator', { ...body, expectedRevision: 0 })).status, 400);
  assert.equal((await f.request('/v1/operator/containment/release', 'operator', body)).status, 200);
  assert.equal((await f.request('/v1/operator/containment/release', 'operator', body)).status, 409);
  assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'held')).code, 'OK');
});

test('tool hold API rejects unregistered targets, isolates other tenants and preserves other tools', async t => {
  const f = await host(t), input = { kind: 'tool', target: 'knowledge.read', expectedRevision: 0, durationMinutes: 1, reason: 'Tool maintenance test' };
  assert.equal((await f.request('/v1/operator/containment/hold', 'operator', { ...input, target: 'unknown.tool' })).status, 400);
  assert.equal((await f.request('/v1/operator/containment/hold', 'operator', input)).status, 200);
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).code, 'TOOL_PAUSED'); assert.equal((await f.run('text.encode', { text: 'safe' })).code, 'OK');
  assert.equal((await (await f.request('/v1/operator/containment/target?kind=tool&target=knowledge.read', 'other')).json()).revision, 0);
  assert.equal((await f.request('/v1/operator/containment/target?kind=tool&target=knowledge.read&extra=1')).status, 400);
});

test('workspace health is read-only, tenant-scoped, payload-free and uses the heavy operation budget', async t => {
  const f = await host(t); await f.run('report.publish', { ...report, body: 'private-health-api-5312' });
  const count = f.store.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
  assert.equal((await f.request('/v1/operator/workspace-health', 'agent')).status, 403);
  const response = await f.request('/v1/operator/workspace-health'); assert.equal(response.status, 200); const health = await response.json(); assert.equal(health.checks.find(c => c.id === 'pending').count, 1); assert.ok(!JSON.stringify(health).includes('private-health-api-5312'));
  assert.equal((await (await f.request('/v1/operator/workspace-health', 'other')).json()).coverage.sessionSample, 0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, count);
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/v1/operator/workspace-health')).status, 200);
  assert.equal((await f.request('/v1/operator/workspace-health')).status, 429);
});

test('request investigation API reserves argument inspection for operators and hides other tenants', async t => {
  const f = await host(t); await f.run('text.encode', { text: 'private-payload-7317' }, 'inspect-api');
  const root = `/v1/operator/requests/${f.sessionId}/inspect-api`;
  for (const endpoint of ['/v1/operator/requests', root]) {
    const r = await f.request(endpoint); assert.equal(r.status, 200); assert.ok(!(await r.text()).includes('private-payload-7317'));
    assert.equal((await f.request(endpoint, 'agent')).status, 403);
  }
  assert.equal((await f.request(root, 'other')).status, 400);
  assert.equal((await f.request(root + '/inspect', 'viewer', { reason: 'Investigate this call' })).status, 403);
  assert.equal((await f.request(root + '/inspect', 'agent', { reason: 'Investigate this call' })).status, 403);
  assert.equal((await f.request(root + '/inspect', 'operator', { reason: 'x' })).status, 400);
  assert.equal((await f.request(root + '/inspect', 'operator', { reason: 'Investigate this call', output: true })).status, 400);
  const inspection = await f.request(root + '/inspect', 'operator', { reason: 'Investigate this call' }); assert.equal(inspection.status, 200); assert.equal((await inspection.json()).arguments.text, 'private-payload-7317');
  assert.equal((await f.request('/v1/operator/requests?limit=101')).status, 400);
});

test('alert APIs enforce reader/operator roles, strict bodies, tenant isolation and optimistic conflicts', async t => {
  const f = await host(t), input = { expectedVersion: 0, title: 'HTTP denial alert', category: 'denials', threshold: 1, windowMinutes: 10, enabled: true, reason: 'Monitor this local test' };
  assert.equal((await f.request('/v1/operator/alert-rules', 'viewer', input)).status, 403);
  assert.equal((await f.request('/v1/operator/alert-rules', 'agent', input)).status, 403);
  assert.equal((await f.request('/v1/operator/alert-rules', 'operator', { ...input, webhook: 'https://example.com' })).status, 400);
  const created = await (await f.request('/v1/operator/alert-rules', 'operator', input)).json(); assert.ok(created.id);
  assert.equal((await f.request('/v1/operator/alert-rules', 'operator', { ...input, id: created.id })).status, 409);
  await f.run('unknown.tool', {}, 'denial');
  const page = await (await f.request('/v1/operator/alerts')).json(); assert.equal(page.items.length, 1); const alert = page.items[0];
  assert.equal((await (await f.request('/v1/operator/alerts', 'other')).json()).items.length, 0);
  assert.equal((await (await f.request('/v1/operator/alert-rules', 'other')).json()).items.length, 0);
  const body = { expectedVersion: alert.version, state: 'resolved', reason: 'Investigated fixture only' }, url = '/v1/operator/alerts/' + alert.id;
  assert.equal((await f.request(url, 'viewer', body)).status, 403); assert.equal((await f.request(url, 'operator', body)).status, 200); assert.equal((await f.request(url, 'operator', body)).status, 409);
  assert.equal((await f.request('/v1/operator/alerts?state=arbitrary')).status, 400);
});

test('workspace report API is read-only by role, metadata-only, audited and separately rate-limited', async t => {
  const f = await host(t); await f.run('text.encode', { text: 'private-report-body-5627' }, 'report');
  assert.equal((await f.request('/v1/operator/report', 'agent', {})).status, 403);
  assert.equal((await f.request('/v1/operator/report', 'viewer', { includeOutputs: true })).status, 400);
  const response = await f.request('/v1/operator/report', 'viewer', {}); assert.equal(response.status, 200); const body = await response.json(); assert.ok(!JSON.stringify(body).includes('private-report-body-5627')); assert.equal(body.privacy.arguments, false);
  for (let i = 0; i < 4; i++) assert.equal((await f.request('/v1/operator/report', 'viewer', {})).status, 200);
  assert.equal((await f.request('/v1/operator/report', 'viewer', {})).status, 429);
  assert.ok(f.store.events('demo').some(e => e.type === 'workspace.report_generated'));
});

async function host(t, complete) {
  const f = fixture(t), tokens = Object.fromEntries(['operator', 'viewer', 'agent', 'other'].map(role => [role, randomBytes(32).toString('hex')]));
  const agentRuntime = complete ? new AgentRuntime({ gateway: f.gateway, provider: { model: 'test-model', complete, check: async () => ({ ready: true }) } }) : undefined;
  const server = createGatewayServer({ gateway: f.gateway, agentRuntime, credentials: [
    { token: tokens.operator, principal: 'reviewer', tenant: 'demo', role: 'operator' },
    { token: tokens.viewer, principal: 'observer', tenant: 'demo', role: 'viewer' },
    { token: tokens.agent, principal: 'demo-agent', tenant: 'demo', role: 'agent' },
    { token: tokens.other, principal: 'other-observer', tenant: 'other', role: 'viewer' },
  ] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, role = 'viewer', body) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${tokens[role]}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ...f, request, base, agentRuntime };
}
test('viewer can inspect the control plane but cannot approve, revoke or execute', async t => {
  const f = await host(t), p = await f.run('report.publish', report, 'review');
  for (const path of ['/v1/operator/status', '/v1/operator/policy', '/v1/operator/sessions', '/v1/operator/audit']) assert.equal((await f.request(path)).status, 200, path);
  const status = await (await f.request('/v1/operator/status')).json(); assert.equal(status.identity.role, 'viewer');
  assert.equal((await f.request('/v1/operator/approvals', 'viewer', { sessionId: f.sessionId, requestId: 'review', binding: p.binding, decision: 'approve' })).status, 403);
  assert.equal((await f.request('/v1/operator/revocations', 'viewer', { type: 'session', value: f.sessionId })).status, 403);
  assert.equal((await f.request('/v1/sessions', 'viewer', {})).status, 403);
});
test('audit cursors are tenant-bound, filter-bound, stable under new inserts and tamper-resistant', async t => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) await f.run('knowledge.read', { document: 'handbook' }, `r${i}`);
  const first = f.store.auditPage('demo', { limit: 3, type: 'execution.started' }); assert.equal(first.items.length, 3); assert.ok(first.nextCursor);
  await f.run('knowledge.read', { document: 'handbook' }, 'new');
  const second = f.store.auditPage('demo', { limit: 3, type: 'execution.started', cursor: first.nextCursor });
  assert.ok(second.items.every(x => x.sequence < first.items.at(-1).sequence)); assert.equal(second.snapshot, first.snapshot);
  assert.throws(() => f.store.auditPage('other', { cursor: first.nextCursor, type: 'execution.started' }), /INVALID_CURSOR/);
  assert.throws(() => f.store.auditPage('demo', { cursor: first.nextCursor, type: 'execution.finished' }), /INVALID_CURSOR/);
  assert.throws(() => f.store.auditPage('demo', { cursor: first.nextCursor + 'x', type: 'execution.started' }), /INVALID_CURSOR/);
});
test('audit search is literal and rejects invalid query shapes and unbounded limits', async t => {
  const f = await host(t); await f.run('knowledge.read', { document: 'handbook' }, 'find-this-request');
  const data = await (await f.request('/v1/operator/audit?search=find-this-request&limit=2')).json(); assert.equal(data.items.length, 2);
  assert.ok(data.items.every(e => e.request === 'find-this-request'));
  const injection = await (await f.request('/v1/operator/audit?search=' + encodeURIComponent("' OR 1=1 --"))).json(); assert.equal(injection.items.length, 0);
  for (const query of ['limit=0', 'limit=1000', 'limit=1&limit=2', 'sort=arbitrary', 'from=-1', 'from=20&to=10', 'type=%27']) assert.equal((await f.request('/v1/operator/audit?' + query)).status, 400, query);
});
test('audit export is tenant-scoped, bounded and includes a continuation manifest', async t => {
  const f = await host(t);
  f.store.transaction(() => { for (let i = 0; i < 1005; i++) f.store.append({ tenant: 'demo', type: 'test.event', request: `e${i}` }); f.store.append({ tenant: 'other', type: 'test.event', request: 'private-other' }); });
  const response = await f.request('/v1/operator/audit/export?type=test.event');
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8'); assert.ok(response.headers.get('content-disposition').includes('attachment'));
  const lines = (await response.text()).trim().split('\n').map(JSON.parse), manifest = lines[0];
  assert.equal(manifest.count, 1000); assert.equal(manifest.truncated, true); assert.ok(manifest.nextCursor);
  assert.equal(lines.length, 1001); assert.ok(lines.slice(1).every(e => e.tenant === 'demo' && e.previous && e.signature));
  const continuation = await f.request('/v1/operator/audit/export?type=test.event&cursor=' + encodeURIComponent(manifest.nextCursor));
  const tail = (await continuation.text()).trim().split('\n').map(JSON.parse); assert.equal(tail[0].count, 5); assert.equal(tail[0].truncated, false);
});
test('session inspection hides other tenants and never returns request payloads', async t => {
  const f = await host(t); await f.run('report.publish', report);
  const response = await f.request(`/v1/operator/sessions/${f.sessionId}`); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.session.principal, 'demo-agent'); assert.ok(data.session.grants.length);
  assert.ok(!JSON.stringify(data).includes(report.body));
  assert.equal((await f.request(`/v1/operator/sessions/${f.sessionId}`, 'other')).status, 400);
  assert.deepEqual((await (await f.request('/v1/operator/sessions', 'other')).json()).items, []);
});
test('session snapshots paginate with authenticated cursors', t => {
  const f = fixture(t); for (let i = 0; i < 5; i++) f.gateway.createSession('demo-agent');
  const first = f.gateway.sessions('demo', { limit: 2 }); assert.equal(first.items.length, 2);
  f.gateway.createSession('demo-agent');
  const second = f.gateway.sessions('demo', { limit: 2, cursor: first.nextCursor }); assert.equal(second.items.length, 2);
  assert.ok(second.items.every(s => !first.items.some(x => x.id === s.id)));
  assert.throws(() => f.gateway.sessions('other', { cursor: first.nextCursor }), /INVALID_CURSOR/);
});
test('session inspector reflects inherited classification, revocation and expiry', async t => {
  const f = fixture(t), child = f.gateway.createSession('demo-agent', { parentId: f.sessionId }).sessionId;
  await f.run('vault.read', { record: 'invoice' });
  assert.ok(f.gateway.inspectSession('demo', child).labels.includes('sensitive'));
  f.gateway.revoke(admin, { type: 'session', value: f.sessionId });
  assert.equal(f.gateway.inspectSession('demo', child).status, 'revoked');
  const other = fixture(t); other.advance(3600001); assert.equal(other.gateway.inspectSession('demo', other.sessionId).status, 'expired');
});
test('policy studio previews hard restrictions and rule explanations without mutating authority', async t => {
  const f = await host(t), before = digest(f.store.session(f.sessionId)), auditBefore = f.store.verifyAudit().count;
  const candidate = structuredClone(f.policy.data); candidate.rules = [{ id: 'broad', tools: ['*'], effect: 'allow', when: [] }];
  const body = { policy: candidate, tool: 'report.publish', arguments: report, labels: ['sensitive'] };
  const response = await f.request('/v1/operator/policy/preview', 'viewer', body); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.execution, false); assert.equal(data.candidate.code, 'SENSITIVE_EGRESS_DENIED'); assert.equal(data.candidate.capabilityChecks, false);
  assert.ok(data.candidate.explanation.rules.some(r => r.matched));
  assert.equal(digest(f.store.session(f.sessionId)), before); assert.equal(f.store.verifyAudit().count, auditBefore); assert.equal(f.gateway.policy.hash, f.policy.hash);
});
test('policy studio validation diagnoses broad grants and malformed contracts', t => {
  const f = fixture(t), candidate = structuredClone(f.policy.data); candidate.rules.push({ id: 'broad', tools: ['*'], effect: 'allow', when: [] });
  const result = validatePolicyDocument(candidate, f.registry); assert.equal(result.valid, true); assert.ok(result.diagnostics.some(d => d.code === 'BROAD_ALLOW'));
  assert.equal(validatePolicyDocument({ version: 'broken' }, f.registry).valid, false);
});
test('policy preview mirrors redaction and strict validation without exposing secret arguments', t => {
  const f = fixture(t), context = { registry: f.registry, policy: f.policy, tenant: 'demo', tool: 'report.publish', arguments: { ...report, body: 'Contact alice@example.com' } };
  const result = previewPolicy(context); assert.equal(result.decision, 'approval'); assert.equal(result.transformed, true); assert.ok(!JSON.stringify(result).includes('alice@example.com'));
  const bad = previewPolicy({ ...context, arguments: { ...report, extra: true } }); assert.equal(bad.code, 'UNKNOWN_ARGUMENT');
  const deny = new Policy({ ...structuredClone(f.policy.data), rules: [] }); assert.equal(previewPolicy({ ...context, policy: deny }).decision, 'deny');
});
test('approval notes are encrypted, redacted for display and only fingerprinted in audit', async t => {
  const f = fixture(t), p = await f.run('report.publish', report, 'note');
  f.gateway.decideApproval(admin, { sessionId: f.sessionId, requestId: 'note', binding: p.binding, decision: 'approve', reason: 'api_key=synthetic_private_note_value' });
  const note = f.gateway.approvals('demo')[0]; assert.equal(note.reason, '[REDACTED]'); assert.equal(note.approver, 'reviewer'); assert.ok(note.decidedAt);
  const event = f.store.events('demo').find(e => e.type === 'approval.approved'); assert.ok(event.reasonHash); assert.ok(!JSON.stringify(event).includes('synthetic_private'));
});
test('readiness fails on corrupted audit state and correlation/rate headers are provided', async t => {
  const f = await host(t); const response = await f.request('/v1/operator/status'); assert.ok(response.headers.get('x-request-id')); assert.equal(response.headers.get('x-ratelimit-limit'), '120');
  assert.equal((await fetch(f.base + '/readyz')).status, 200);
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=1').run('{'); f.store.verifyAudit();
  const ready = await fetch(f.base + '/readyz'); assert.equal(ready.status, 503); assert.deepEqual(await ready.json(), { status: 'unavailable' });
});
test('public sample workspace is isolated data and cannot grant control-plane access', async t => {
  const f = await host(t), preview = await (await fetch(f.base + '/preview.json')).json();
  assert.equal(preview.sample, true); assert.equal(preview.status.identity.role, 'viewer'); assert.equal(preview.status.audit.valid, null);
  assert.ok(preview.sessions.items.length > 0); assert.ok(!JSON.stringify(preview).includes('GATEWAY_MASTER_KEY'));
  const response = await fetch(f.base + '/v1/operator/status'); assert.equal(response.status, 401);
});

test('expensive control-plane operations have a separate rate budget with retry guidance', async t => {
  const f = await host(t);
  for (let i = 0; i < 6; i++) assert.equal((await f.request('/v1/operator/audit/verify', 'viewer', {})).status, 200);
  const limited = await f.request('/v1/operator/audit/export'); assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0); assert.equal((await limited.json()).code, 'RATE_LIMITED');
  assert.equal((await f.request('/v1/operator/status')).status, 200);
});
test('corruption detected while browsing audit records latches readiness and prevents new dispatch', async t => {
  const f = await host(t); await f.run('knowledge.read', { document: 'handbook' }, 'before-corruption');
  f.store.db.prepare('UPDATE audit SET event=? WHERE seq=1').run('{}');
  assert.equal((await f.request('/v1/operator/audit')).status, 503);
  assert.equal(f.store.readiness(), false);
  assert.equal((await f.run('knowledge.read', { document: 'handbook' }, 'after-corruption')).code, 'GATEWAY_UNAVAILABLE');
});
test('approval notes reject oversized or non-text input before changing the pending record', async t => {
  const f = fixture(t), p = await f.run('report.publish', report, 'bounded-note');
  for (const reason of ['x'.repeat(501), { approve: true }, 'invalid\0note']) assert.throws(() => f.gateway.decideApproval(admin, { sessionId: f.sessionId, requestId: 'bounded-note', binding: p.binding, decision: 'approve', reason }), /INVALID_REASON/);
  assert.equal(f.gateway.approvals('demo')[0].state, 'pending');
});

test('malformed candidate policies are client errors rather than gateway failures', async t => {
  const f = await host(t);
  for (const policy of [null, [], { ...structuredClone(f.policy.data), rules: [null] }]) {
    const response = await f.request('/v1/operator/policy/preview', 'viewer', { policy, tool: 'knowledge.read', arguments: { document: 'handbook' } });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID_POLICY');
  }
});

test('incident APIs isolate tenants and reserve workflow mutations for operators', async t => {
  const f = await host(t); await f.run('vault.read', { record: 'invoice' }); await f.run('report.publish', report);
  const page = await (await f.request('/v1/operator/incidents')).json(); assert.equal(page.items.length, 1);
  const record = page.items[0], path = `/v1/operator/incidents/${record.id}`;
  assert.equal((await f.request(path)).status, 200); assert.equal((await f.request(path, 'other')).status, 400);
  const update = { expectedVersion: record.version, state: 'acknowledged', reason: 'Reviewing test incident.' };
  assert.equal((await f.request(path, 'viewer', update)).status, 403);
  assert.equal((await f.request(path, 'operator', update)).status, 200);
  const stale = await f.request(path, 'operator', update); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'VERSION_CONFLICT');
  assert.deepEqual((await (await f.request('/v1/operator/incidents', 'other')).json()).items, []);
});
test('safety API separates observer access from operator changes and rejects stale resume requests', async t => {
  const f = await host(t), input = { expectedRevision: 0, scope: 'all', durationMinutes: 15, reason: 'Investigating a synthetic signal.' };
  assert.equal((await f.request('/v1/operator/safety')).status, 200);
  assert.equal((await f.request('/v1/operator/safety/pause', 'viewer', input)).status, 403);
  assert.equal((await f.request('/v1/operator/safety/pause', 'agent', input)).status, 403);
  const paused = await (await f.request('/v1/operator/safety/pause', 'operator', input)).json(); assert.equal(paused.active, true);
  assert.equal((await (await f.request('/v1/operator/safety', 'other')).json()).active, false);
  const body = { id: 'paused-http', tool: 'knowledge.read', arguments: { document: 'handbook' } };
  assert.equal((await (await f.request(`/v1/sessions/${f.sessionId}/execute`, 'agent', body)).json()).code, 'TENANT_PAUSED');
  assert.equal((await f.request('/v1/operator/safety/resume', 'operator', { expectedRevision: 999, reason: 'Stale request.' })).status, 409);
  assert.equal((await f.request('/v1/operator/safety/resume', 'operator', { expectedRevision: paused.revision, reason: 'Investigation complete.' })).status, 200);
  assert.equal((await (await f.request(`/v1/sessions/${f.sessionId}/execute`, 'agent', body)).json()).status, 'completed');
});
test('policy suite API is read-only, bounded and accessible to viewer roles', async t => {
  const f = await host(t), before = f.store.verifyAudit().count;
  const cases = [{ id: 'read', tool: 'knowledge.read', arguments: { document: 'handbook' }, expected: { decision: 'allow' } }];
  const result = await (await f.request('/v1/operator/policy/suite', 'viewer', { cases })).json(); assert.equal(result.passed, 1); assert.equal(result.execution, false);
  assert.equal(f.store.verifyAudit().count, before);
  assert.equal((await f.request('/v1/operator/policy/suite', 'agent', { cases })).status, 403);
  assert.equal((await f.request('/v1/operator/policy/suite', 'viewer', { cases, execute: true })).status, 400);
  assert.equal((await f.request('/v1/operator/policy/suite', 'viewer', { cases: [] })).status, 400);
});
