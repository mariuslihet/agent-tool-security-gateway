import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayClient, ControlPlaneClient, GatewayApiError } from '../src/client.js';

test('control-plane client exposes investigation and policy endpoints without serializing its credential', async () => {
  const calls = [], token = 'test-only-client-token';
  const client = new ControlPlaneClient({ token, fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }); } });
  await client.sessions({ limit: 10, cursor: 'signed.cursor' }); await client.audit({ search: 'request & tool' });
  await client.previewPolicy({ tool: 'compute.sum', arguments: { numbers: [1] } }); await client.verifyAudit();
  assert.ok(calls[0].url.includes('limit=10&cursor=signed.cursor'));
  assert.ok(calls[1].url.includes('search=request+%26+tool'));
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);
  assert.equal(calls[2].options.redirect, 'error'); assert.ok(!JSON.stringify(client).includes(token));
});
test('SDK exports JSONL and carries retry guidance and correlation IDs on API errors', async () => {
  const exporter = new ControlPlaneClient({ token: 'test-only', fetchImpl: async () => new Response('{"kind":"manifest"}\n', { headers: { 'content-type': 'application/x-ndjson' } }) });
  assert.equal(await exporter.exportAudit(), '{"kind":"manifest"}\n');
  const limited = new GatewayClient({ token: 'test-only', fetchImpl: async () => new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429, headers: { 'retry-after': '30', 'x-request-id': 'trace-123' } }) });
  await assert.rejects(limited.createSession(), error => error instanceof GatewayApiError && error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 30 && error.requestId === 'trace-123');
});
test('SDK reports invalid upstream JSON without exposing the upstream error body', async () => {
  const client = new GatewayClient({ token: 'test-only', fetchImpl: async () => new Response('private-proxy-exception', { status: 503 }) });
  await assert.rejects(client.createSession(), error => error.code === 'INVALID_RESPONSE' && !error.message.includes('private-proxy'));
  assert.throws(() => new GatewayClient({ baseUrl: 'https://user:pass@example.com', token: 'test-only' }), /Credentials/);
});
