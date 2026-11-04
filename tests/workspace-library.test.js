import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { createDemo } from '../src/demo.js';
import { createGatewayServer } from '../src/server.js';
import { ControlPlaneClient } from '../src/client.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gateway-library-')); mkdirSync(join(root, 'input')); mkdirSync(join(root, 'reports')); writeFileSync(join(root, 'input', 'notes.md'), 'Reviewed project notes.');
  const f = createDemo({ masterKey: randomBytes(32).toString('hex'), workspaceRoot: root });
  t.after(() => { f.store.close(); assert.ok(root.startsWith(join(tmpdir(), 'gateway-library-'))); rmSync(root, { recursive: true, force: true }); }); return { ...f, root };
}
async function host(t) {
  const f = fixture(t), tokens = Object.fromEntries(['operator', 'viewer', 'agent', 'other'].map(role => [role, randomBytes(32).toString('hex')]));
  const server = createGatewayServer({ gateway: f.gateway, workspaceFiles: f.workspace, heavyRateLimit: 100, credentials: Object.entries(tokens).map(([role, token]) => ({ token, principal: role === 'agent' ? 'demo-agent' : role, tenant: role === 'other' ? 'other' : 'demo', role: role === 'other' ? 'operator' : role })) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { ...f, client: new ControlPlaneClient({ baseUrl, token: tokens.operator }), request: (path, role = 'operator', body) => fetch(baseUrl + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${tokens[role]}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) };
}
const checksum = value => createHash('sha256').update(value).digest('hex');

test('file inventory shows source integrity and bounded report metadata without private contents or audit writes', async t => {
  const f = fixture(t), privateText = 'private-report-body-9834'; writeFileSync(join(f.root, 'reports', 'summary.md'), privateText); writeFileSync(join(f.root, 'reports', '.gitkeep'), '');
  const before = f.store.verifyAudit().count, result = await f.workspace.inventory(); assert.equal(result.inputs[0].status, 'verified'); assert.equal(result.reports[0].sha256, checksum(privateText)); assert.equal(result.reports[0].bytes, Buffer.byteLength(privateText)); assert.ok(!JSON.stringify(result).includes(privateText)); assert.ok(!JSON.stringify(result).includes(f.root)); assert.equal(f.store.verifyAudit().count, before);
  writeFileSync(join(f.root, 'input', 'notes.md'), 'Edited after startup'); assert.equal((await f.workspace.inventory()).inputs[0].status, 'changed');
});

test('inventory skips unsafe report entries and explicitly marks bounded scans as partial', async t => {
  const f = fixture(t); writeFileSync(join(f.root, 'reports', 'bad.json'), '{}'); writeFileSync(join(f.root, 'reports', 'secret.md'), 'password=synthetic-secret'); mkdirSync(join(f.root, 'reports', 'directory.md'));
  writeFileSync(join(f.root, 'reports', 'linked.md'), 'Safe'); linkSync(join(f.root, 'reports', 'linked.md'), join(f.root, 'reports', 'second.md'));
  const skipped = await f.workspace.inventory(); assert.equal(skipped.reports.length, 0); assert.equal(skipped.skipped, 5);
  for (let i = 0; i < 102; i++) writeFileSync(join(f.root, 'reports', `report-${i}.md`), 'Safe report');
  const bounded = await f.workspace.inventory(); assert.equal(bounded.truncated, true); assert.ok(bounded.reports.length <= 100);
});

test('report reads preserve exact Unicode/BOM bytes and reject stale hashes, unsafe paths and hard links', async t => {
  const f = fixture(t), content = '\ufeff# Résumé\nReviewed ✓\n', path = join(f.root, 'reports', 'unicode.md'); writeFileSync(path, content);
  const read = await f.workspace.inspectReport({ file: 'unicode.md', expectedHash: checksum(content) }); assert.equal(read.content, content); assert.equal(read.bytes, Buffer.byteLength(content)); assert.equal(checksum(read.content), read.sha256);
  writeFileSync(path, 'Changed'); await assert.rejects(f.workspace.inspectReport({ file: 'unicode.md', expectedHash: checksum(content) }), /REPORT_CHANGED/);
  for (const file of ['../notes.md', 'C:\\notes.md', 'CON.md', 'notes.md:stream']) await assert.rejects(f.workspace.inspectReport({ file, expectedHash: checksum('Safe') }), /WORKSPACE_PATH_REJECTED/);
  linkSync(path, join(f.root, 'reports', 'hard.md')); await assert.rejects(f.workspace.inspectReport({ file: 'unicode.md', expectedHash: checksum('Changed') }), /WORKSPACE_PATH_REJECTED/);
});

test('library API protects filenames and contents by role and tenant and never starts a session', async t => {
  const f = await host(t); writeFileSync(join(f.root, 'reports', 'private.md'), 'Private body'); const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  for (const role of ['viewer', 'agent']) { assert.equal((await f.request('/v1/operator/workspace', role)).status, 403); assert.equal((await f.request('/v1/operator/workspace/reports/read', role, { file: 'private.md', expectedHash: checksum('Private body'), purpose: 'preview' })).status, 403); }
  const other = await (await f.request('/v1/operator/workspace', 'other')).json(); assert.equal(other.configured, false); assert.deepEqual(other.reports, []);
  assert.equal((await f.request('/v1/operator/workspace/reports/read', 'other', { file: 'private.md', expectedHash: checksum('Private body'), purpose: 'download' })).status, 400);
  const result = await f.client.workspaceFiles(); assert.equal(result.configured, true); assert.equal(result.reports[0].file, 'private.md'); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, before);
});

test('report API audits the verified read without raw text/filenames and rejects stale or forged bodies', async t => {
  const f = await host(t), content = '<img src=x onerror=alert(1)>\nPlain report text'; writeFileSync(join(f.root, 'reports', 'private-filename.md'), content);
  const input = { file: 'private-filename.md', expectedHash: checksum(content), purpose: 'preview' }, result = await f.client.readWorkspaceReport(input); assert.equal(result.content, content); assert.equal(result.sha256, checksum(content));
  const event = f.store.events('demo')[0]; assert.equal(event.type, 'workspace.report_read'); assert.equal(event.purpose, 'preview'); assert.equal(event.actor, 'operator'); assert.equal(event.contentHash, checksum(content)); assert.ok(!JSON.stringify(event).includes(input.file)); assert.ok(!JSON.stringify(event).includes('Plain report text'));
  const url = '/v1/operator/workspace/reports/read', before = f.store.verifyAudit().count;
  for (const bad of [{ ...input, expectedHash: '0'.repeat(64) }, { ...input, purpose: 'execute' }, { ...input, principal: 'forged' }, { ...input, expectedHash: '../hash' }]) assert.equal((await f.request(url, 'operator', bad)).status, 400);
  assert.equal((await f.request('/v1/operator/workspace?root=elsewhere')).status, 400); assert.equal(f.store.verifyAudit().count, before);
  assert.equal((await f.request(url + '?root=elsewhere', 'operator', input)).status, 400); assert.equal(f.store.verifyAudit().count, before);
  const downloaded = await f.client.readWorkspaceReport({ ...input, purpose: 'download' }); assert.equal(downloaded.content, content); assert.equal(f.store.events('demo')[0].purpose, 'download');
});

test('audit failure prevents report delivery; oversized/unsafe files expose no report body', async t => {
  const f = await host(t), content = 'private-failure-body-7341'; writeFileSync(join(f.root, 'reports', 'report.md'), content);
  const append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('Injected audit failure'); };
  const failed = await f.request('/v1/operator/workspace/reports/read', 'operator', { file: 'report.md', expectedHash: checksum(content), purpose: 'download' }); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes(content)); f.store.append = append;
  writeFileSync(join(f.root, 'reports', 'big.md'), 'x'.repeat(8193)); const bad = await f.request('/v1/operator/workspace/reports/read', 'operator', { file: 'big.md', expectedHash: checksum('x'.repeat(8193)), purpose: 'preview' }); assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('xxxx'));
});
