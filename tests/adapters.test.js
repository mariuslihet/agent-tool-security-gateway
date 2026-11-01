import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { fixture } from './helpers.js';
import { SecretBroker, httpsJsonAdapter, isPublicAddress } from '../src/adapters.js';
import { signedApprovalWebhook } from '../src/notifications.js';
import { openTelemetrySink } from '../src/telemetry.js';
import { attachMcp } from '../src/mcp.js';
import { mac } from '../src/util.js';

test('egress rejects private, mapped IPv6, documentation and special-use IP addresses', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.2.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('HTTPS adapter blocks mixed public/private DNS answers before any connection', async () => {
  const adapter = httpsJsonAdapter({ origin: 'https://reports.example.com', resolver: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] });
  await assert.rejects(adapter({ url: 'https://reports.example.com/daily', payload: {} }, { signal: new AbortController().signal }), /PRIVATE_DESTINATION_DENIED/);
  await assert.rejects(adapter({ url: 'https://evil.example/', payload: {} }, {}), /DESTINATION_DENIED/);
});
test('secret broker enforces per-tool scope and prevents header injection', () => {
  const broker = new SecretBroker({ 'report.publish': ['REPORT_KEY', 'BAD'] }, { REPORT_KEY: 'unit_test_value', OTHER: 'private', BAD: 'x\r\nInjected: true' });
  assert.equal(broker.get('report.publish', 'REPORT_KEY'), 'unit_test_value');
  assert.throws(() => broker.get('text.encode', 'REPORT_KEY'), /SECRET_SCOPE_DENIED/);
  assert.throws(() => broker.get('report.publish', 'OTHER'), /SECRET_SCOPE_DENIED/);
  assert.throws(() => broker.get('report.publish', 'BAD'), /SECRET_UNAVAILABLE/);
});
test('signed webhook notification cannot approve and retries are bounded', async () => {
  const signingKey = 'test-only-'.repeat(4), event = { type: 'approval.required', request: 'r', binding: 'fingerprint' };
  let captured, attempts = 0, failed;
  const notify = signedApprovalWebhook({ url: 'https://notify.example/approval', signingKey, clock: () => 123, adapter: async args => { captured = args.payload; } });
  await notify(event);
  assert.equal(captured.signature, mac(signingKey, { timestamp: 123, event }));
  const broken = signedApprovalWebhook({ url: 'https://notify.example/approval', signingKey, adapter: async () => { attempts++; throw new Error('offline'); }, onFailure: error => { failed = error; } });
  await broken(event); assert.equal(attempts, 3); assert.equal(failed.code, 'WEBHOOK_DELIVERY_FAILED');
});
test('OpenTelemetry sink exports no raw arguments or identity fields', () => {
  const attributes = {};
  const sink = openTelemetrySink({ startSpan: () => ({ setAttribute: (k, v) => { attributes[k] = v; }, end() {} }) });
  sink({ type: 'execution.started', tool: 'knowledge.read', arguments: { password: 'secret' }, principal: 'person', session: 'session' });
  assert.deepEqual(attributes, { 'gateway.type': 'execution.started', 'gateway.tool': 'knowledge.read' });
});
test('MCP initializes, lists tools, calls gateway and rejects invalid frames', async t => {
  const f = fixture(t), input = new PassThrough(), output = new PassThrough();
  let text = ''; output.on('data', chunk => { text += chunk; });
  const transport = attachMcp({ gateway: f.gateway, principal: 'demo-agent', input, output });
  input.write('not-json\nnull\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'knowledge.read', arguments: { document: 'handbook' } } }) + '\n');
  await transport.drained();
  const frames = text.trim().split('\n').map(JSON.parse);
  assert.equal(frames[0].error.code, -32700); assert.equal(frames[1].error.code, -32600);
  assert.equal(frames.find(r => r.id === 1).result.protocolVersion, '2025-06-18');
  assert.equal(frames.find(r => r.id === 2).result.tools.length, 7);
  assert.equal(frames.find(r => r.id === 3).result.structuredContent.status, 'completed');
  input.destroy(); output.destroy();
});
test('MCP oversized frames close input without executing tools', t => {
  const f = fixture(t), input = new PassThrough(), output = new PassThrough();
  attachMcp({ gateway: f.gateway, principal: 'demo-agent', input, output, maxFrameBytes: 100 });
  input.write('x'.repeat(101)); assert.equal(input.destroyed, true); output.destroy();
});
