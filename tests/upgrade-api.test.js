import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fixture } from './helpers.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { createGatewayServer } from '../src/server.js';
import { DEFAULT_TASK_CHECKS } from '../src/task-checks.js';

async function host(t) {
  const f = fixture(t); let calls = 0;
  const runtime = new AgentRuntime({ gateway: f.gateway, provider: { model: 'api-test', check: async () => ({ ready: true }), complete: async () => { calls++; return { role: 'assistant', content: '{"total":80}' }; } } });
  const tokens = Object.fromEntries(['operator', 'viewer', 'agent', 'other'].map(role => [role, randomBytes(32).toString('hex')]));
  const server = createGatewayServer({ gateway: f.gateway, agentRuntime: runtime, heavyRateLimit: 100, credentials: Object.entries(tokens).map(([role, token]) => ({ token, role: role === 'other' ? 'operator' : role, tenant: role === 'other' ? 'other' : 'demo', principal: role === 'agent' ? 'demo-agent' : role })) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { runtime.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = (path, role = 'operator', body) => fetch(`http://127.0.0.1:${server.address().port}` + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + tokens[role], ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ...f, runtime, request, calls: () => calls };
}
const input = { expectedRevision: 0, title: 'Arithmetic', cases: [{ id: 'sum', prompt: 'Return total', toolMode: 'chat_only', criteria: { ...DEFAULT_TASK_CHECKS, structuredOutput: { required: true, numbers: [{ path: 'total', min: 80, max: 80 }] } } }] };

test('evaluation API protects suites, launches bounded cases and compares runs without extra inference', async t => {
  const f = await host(t), base = '/v1/operator/evaluations';
  for (const role of ['viewer', 'agent']) assert.equal((await f.request(base + '/suites', role)).status, 403);
  assert.equal((await f.request(base + '/suites?all=true')).status, 400);
  assert.equal((await f.request(base + '/suites', 'operator', { ...input, actor: 'forged' })).status, 400);
  const saved = await (await f.request(base + '/suites', 'operator', input)).json(); assert.equal(saved.revision, 1);
  assert.equal((await f.request(base + '/suites/' + saved.id, 'other')).status, 400);
  assert.equal((await f.request(base + '/suites', 'operator', { ...input, id: saved.id })).status, 409);
  for (const id of ['first', 'second']) {
    const response = await f.request(base + '/runs', 'operator', { id, suiteId: saved.id, expectedRevision: 1 }); assert.equal(response.status, 202);
    const run = await f.runtime.evaluations.wait('demo', id); assert.equal(run.code, 'ALL_CHECKS_PASSED'); assert.equal(run.results.length, 1);
  }
  const compared = await (await f.request(base + '/compare', 'operator', { left: 'first', right: 'second' })).json(); assert.equal(compared.sameSuiteSnapshot, true); assert.equal(compared.results[0].change, 'unchanged'); assert.equal(f.calls(), 2);
  const exportPath = base + '/runs/first/export';
  for (const role of ['viewer', 'agent']) assert.equal((await f.request(exportPath, role, { format: 'json' })).status, 403);
  assert.equal((await f.request(exportPath, 'other', { format: 'json' })).status, 400);
  assert.equal((await f.request(exportPath + '?all=true', 'operator', { format: 'json' })).status, 400);
  assert.equal((await f.request(exportPath, 'operator', { format: 'json', prompt: 'forged' })).status, 400);
  const exported = await f.request(exportPath, 'operator', { format: 'csv' }); assert.equal(exported.status, 200); assert.match((await exported.json()).content, /run_id/); assert.equal(f.calls(), 2);
  assert.equal((await f.request(base + '/runs/first', 'other')).status, 400);
  assert.equal((await f.request(base + '/runs', 'operator', { id: 'bad', suiteId: saved.id, expectedRevision: 1, prompt: 'forged' })).status, 400);
});

test('policy comparison and diagnostics are audited operator operations with strict inputs and no generation', async t => {
  const f = await host(t); await f.run('knowledge.read', { document: 'handbook' }, 'known');
  const policy = structuredClone(f.policy.data); policy.rules.push({ id: 'proposed-deny', tools: ['knowledge.read'], effect: 'deny', when: [] });
  for (const role of ['viewer', 'agent']) {
    assert.equal((await f.request('/v1/operator/policy/compare-recorded', role, { policy })).status, 403);
    assert.equal((await f.request('/v1/operator/diagnostics', role, {})).status, 403);
  }
  const comparison = await (await f.request('/v1/operator/policy/compare-recorded', 'operator', { policy })).json(); assert.equal(comparison.execution, false); assert.equal(comparison.changed, 1); assert.ok(!JSON.stringify(comparison).includes('Prepare a summary'));
  const isolated = await (await f.request('/v1/operator/policy/compare-recorded', 'other', { policy })).json(); assert.equal(isolated.sampled, 0);
  assert.equal((await f.request('/v1/operator/policy/compare-recorded?execute=true', 'operator', { policy })).status, 400);
  assert.equal((await f.request('/v1/operator/diagnostics', 'operator', { clear: true })).status, 400);
  const diagnostics = await (await f.request('/v1/operator/diagnostics', 'operator', {})).json(); assert.equal(diagnostics.execution, false); assert.ok(diagnostics.checks.some(check => check.code === 'MODEL_READY')); assert.equal(f.calls(), 0);
  const append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('Private audit error'); };
  try { assert.equal((await f.request('/v1/operator/diagnostics', 'operator', {})).status, 503); assert.equal((await f.request('/v1/operator/policy/compare-recorded', 'operator', { policy })).status, 503); } finally { f.store.append = append; }
});

test('task timeline API includes atomic model turn events but hides private conversation and other tenants', async t => {
  const f = await host(t); f.runtime.start('demo', { id: 'timeline', prompt: 'private-prompt-8855' }); await f.runtime.wait('demo', 'timeline'); const path = '/v1/operator/agent/runs/timeline/timeline';
  for (const role of ['viewer', 'agent']) assert.equal((await f.request(path, role)).status, 403);
  assert.equal((await f.request(path, 'other')).status, 400); assert.equal((await f.request(path + '?all=true')).status, 400);
  const result = await (await f.request(path)).json(); assert.equal(result.modelTurns, 1); assert.ok(result.events.some(event => event.type === 'agent.model_completed' && event.turn === 1)); assert.ok(!JSON.stringify(result).includes('private-prompt-8855')); assert.equal(f.calls(), 1);
});
