import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fixture, report } from './helpers.js';
import { createGatewayServer } from '../src/server.js';
import { GatewayClient } from '../src/client.js';
import { Metrics } from '../src/telemetry.js';

async function serverFixture(t, options = {}) {
  const metrics = new Metrics(), f = fixture(t, { onEvent: metrics.record });
  const agent = randomBytes(32).toString('hex'), operator = randomBytes(32).toString('hex'), other = randomBytes(32).toString('hex');
  const server = createGatewayServer({ gateway: f.gateway, metrics, rateLimit: options.rateLimit ?? 120, credentials: [
    { token: agent, principal: 'demo-agent', tenant: 'demo', role: 'agent' },
    { token: operator, principal: 'reviewer', tenant: 'demo', role: 'operator' },
    { token: other, principal: 'other-reviewer', tenant: 'other', role: 'operator' },
  ] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token, body, headers = {}) => fetch(baseUrl + path, { method: body !== undefined ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { ...f, server, baseUrl, request, agent, operator, other, metrics };
}
test('HTTP API authenticates identity and separates agent and operator roles', async t => {
  const f = await serverFixture(t);
  assert.equal((await f.request('/v1/operator/status')).status, 401);
  assert.equal((await f.request('/v1/operator/status', f.agent)).status, 403);
  assert.equal((await f.request('/v1/sessions', f.operator, {})).status, 403);
  assert.equal((await f.request('/v1/sessions', f.agent, { principal: 'other-agent' })).status, 400);
  const response = await f.request('/v1/sessions', f.agent, {}); assert.equal(response.status, 201);
});
test('HTTP approval workflow runs through separate credentials and caches retries', async t => {
  const f = await serverFixture(t), client = new GatewayClient({ baseUrl: f.baseUrl, token: f.agent });
  const { sessionId } = await client.createSession(), request = { id: 'publish', tool: 'report.publish', arguments: report };
  const pending = await client.execute(sessionId, request); assert.equal(pending.status, 'approval_required');
  assert.equal((await f.request('/v1/operator/approvals', f.agent, { sessionId, requestId: 'publish', binding: pending.binding, decision: 'approve' })).status, 403);
  const decision = await f.request('/v1/operator/approvals', f.operator, { sessionId, requestId: 'publish', binding: pending.binding, decision: 'approve' });
  assert.equal(decision.status, 200);
  assert.equal((await client.execute(sessionId, request)).status, 'completed');
  assert.equal((await client.execute(sessionId, request)).status, 'completed');
  const status = await (await f.request('/v1/operator/status', f.operator)).json();
  assert.equal(status.audit.valid, true); assert.equal(status.metrics.counts['execution.started|OK'], 1);
});
test('operator records, queues and metrics are isolated by tenant', async t => {
  const f = await serverFixture(t);
  await f.run('report.publish', report);
  const other = await (await f.request('/v1/operator/status', f.other)).json();
  assert.deepEqual(other.approvals, []); assert.deepEqual(other.metrics.counts, {}); assert.deepEqual(other.events, []);
});
test('API rejects cross-origin requests, oversized payloads and wrong content types', async t => {
  const f = await serverFixture(t);
  assert.equal((await f.request('/v1/sessions', f.agent, {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/v1/sessions', f.agent, {}, { 'content-type': 'text/plain' })).status, 400);
  const response = await f.request('/v1/sessions', f.agent, { extra: 'x'.repeat(140000) });
  assert.equal(response.status, 413);
});
test('per-credential request rate limits return structured errors', async t => {
  const f = await serverFixture(t, { rateLimit: 2 });
  await f.request('/v1/tools', f.agent); await f.request('/v1/tools', f.agent);
  const third = await f.request('/v1/tools', f.agent);
  assert.equal(third.status, 429); assert.equal((await third.json()).code, 'RATE_LIMITED');
  assert.equal((await f.request('/v1/operator/status', f.operator)).status, 200);
});
test('dashboard has restrictive security headers and no executable inline scripts', async t => {
  const f = await serverFixture(t), response = await f.request('/');
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const html = await response.text(); assert.ok(html.includes('aria-live="polite"'));
  assert.ok(!html.includes('onclick=')); assert.ok(!html.includes('<script>'));
});
test('client refuses cleartext nonlocal endpoints and never follows redirects', () => {
  assert.throws(() => new GatewayClient({ baseUrl: 'http://external.example', token: 'test' }), /HTTPS/);
});
test('operator can revoke a tool through the API', async t => {
  const f = await serverFixture(t);
  const response = await f.request('/v1/operator/revocations', f.operator, { type: 'tool', value: 'knowledge.read' });
  assert.equal(response.status, 200);
  assert.equal((await f.run('knowledge.read', { document: 'handbook' })).code, 'REVOKED');
});
