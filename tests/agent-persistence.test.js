import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fixture, report, admin } from './helpers.js';
import { Store } from '../src/store.js';
import { Gateway } from '../src/gateway.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { open, seal } from '../src/util.js';

test('task organization and disabled templates survive restart encrypted without changing task state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-ai-library-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'); let f, store;
  try {
    f = fixture(null, { path, key }); const agent = new AgentRuntime({ gateway: f.gateway, provider: { model: 'library-test', complete: async () => ({ role: 'assistant', content: 'Completed answer' }) } }); agent.start('demo', { id: 'persistent-library', prompt: 'Hello' }); const run = await agent.wait('demo', 'persistent-library');
    agent.library.organize('demo', run.id, { expectedRevision: 0, title: 'private-library-title-8841', tags: ['math'], pinned: true, archived: true }, 'reviewer');
    const saved = agent.library.saveTemplate('demo', { expectedRevision: 0, title: 'Reusable arithmetic', prompt: 'private-template-text-6632', toolMode: 'safe', enabled: false }, 'reviewer'); f.store.close(); f = { ...f, store: null };
    const text = readFileSync(path).toString(); assert.ok(!text.includes('private-library-title-8841')); assert.ok(!text.includes('private-template-text-6632'));
    store = new Store(path, key); const gateway = new Gateway({ store, registry: f.registry, policy: f.policy, profiles: f.profiles, clock: () => 1700000000000 }), restarted = new AgentRuntime({ gateway, provider: null }); const after = restarted.get('demo', run.id);
    assert.equal(after.revision, run.revision); assert.equal(after.state, 'completed'); assert.equal(after.organization.archived, true); assert.equal(after.organization.pinned, true); assert.equal(after.organization.revision, 1); assert.equal(restarted.library.template('demo', saved.id).enabled, false); assert.equal(restarted.library.template('demo', saved.id).prompt, 'private-template-text-6632'); assert.equal(store.verifyAudit().valid, true);
  } finally { f?.store?.close(); store?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-ai-library-')); rmSync(dir, { recursive: true, force: true }); }
});

test('legacy tasks can continue after restart without resetting permissions or inventing historical usage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-ai-follow-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'); let f, store;
  try {
    f = fixture(null, { path, key });
    const first = new AgentRuntime({ gateway: f.gateway, provider: { model: 'follow-test', complete: async () => ({ role: 'assistant', content: 'Remember this: 42.' }) } });
    first.start('demo', { id: 'legacy', prompt: 'private-follow-up-prompt-3184', toolMode: 'all' }); const completed = await first.wait('demo', 'legacy');
    const row = f.store.db.prepare('SELECT data FROM agent_runs WHERE id=?').get('legacy'), raw = open(f.store.encryptionKey, row.data);
    for (const field of ['toolMode', 'revision', 'usage', 'userMessages']) delete raw[field];
    f.store.db.prepare('UPDATE agent_runs SET data=? WHERE id=?').run(seal(f.store.encryptionKey, raw), 'legacy'); f.store.close(); f = { ...f, store: null };
    assert.ok(!readFileSync(path).toString().includes('private-follow-up-prompt-3184'));
    store = new Store(path, key); const gateway = new Gateway({ store, registry: f.registry, policy: f.policy, profiles: f.profiles, clock: () => 1700000000000 });
    const second = new AgentRuntime({ gateway, provider: { model: 'follow-test', complete: async messages => { assert.ok(messages.some(m => m.content === 'Remember this: 42.')); return { role: 'assistant', content: 'The remembered answer is 42.', usage: { inputTokens: 7, outputTokens: 4, modelDurationMs: 2 } }; } } });
    const legacy = second.get('demo', 'legacy'); assert.equal(legacy.toolMode, 'all'); assert.equal(legacy.revision, 0); assert.equal(legacy.usage.requests, 1); assert.equal(legacy.usage.reportedRequests, 0);
    second.followUp('demo', 'legacy', { messageId: 'continued', prompt: 'What was the answer?', expectedRevision: 0 }); const result = await second.wait('demo', 'legacy');
    assert.equal(result.sessionId, completed.sessionId); assert.equal(result.usage.requests, 2); assert.equal(result.usage.reportedRequests, 1); assert.equal(result.usage.inputTokens, 7); assert.equal(result.allowedTools.length, 7); assert.equal(result.userMessages, 2); assert.equal(store.verifyAudit().valid, true);
  } finally { f?.store?.close(); store?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-ai-follow-')); rmSync(dir, { recursive: true, force: true }); }
});

test('encrypted AI tasks survive restart and resume the same approved tool request without regenerating it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-ai-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'); let f, store;
  try {
    f = fixture(null, { path, key }); const first = new AgentRuntime({ gateway: f.gateway, provider: { model: 'local-test', complete: async (messages, tools) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name: tools.find(t => t.function.description.startsWith('report.publish:')).function.name, arguments: report } }] }) } });
    first.start('demo', { id: 'restart', prompt: 'private-ai-prompt-4172', toolMode: 'all' }); const waiting = await first.wait('demo', 'restart'); assert.equal(waiting.state, 'waiting'); const requestId = waiting.steps[0].requestId;
    f.store.close(); f = { ...f, store: null }; assert.ok(!readFileSync(path).toString().includes('private-ai-prompt-4172'));
    store = new Store(path, key); const gateway = new Gateway({ store, registry: f.registry, policy: f.policy, profiles: f.profiles, clock: () => 1700000000000 });
    const second = new AgentRuntime({ gateway, provider: { model: 'local-test', complete: async messages => { assert.equal(messages.at(-1).role, 'tool'); return { role: 'assistant', content: 'The adapter simulated publishing.' }; } } });
    const pending = gateway.approvals('demo')[0]; gateway.decideApproval(admin, { sessionId: pending.sessionId, requestId: pending.requestId, binding: pending.binding, decision: 'approve' });
    second.resume('demo', 'restart'); const done = await second.wait('demo', 'restart'); assert.equal(done.state, 'completed'); assert.equal(done.steps[0].requestId, requestId); assert.equal(done.toolCalls, 1); assert.equal(store.verifyAudit().valid, true);
  } finally { f?.store?.close(); store?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-ai-')); rmSync(dir, { recursive: true, force: true }); }
});

test('an independent process cannot resume a task owned by a live worker lease', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-ai-lease-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'); const f = fixture(null, { path, key }); let finish;
  const runtime = new AgentRuntime({ gateway: f.gateway, provider: { model: 'lease-test', complete: async () => new Promise(resolve => { finish = resolve; }) } });
  try {
    runtime.start('demo', { id: 'leased', prompt: 'Hold a model turn' }); await new Promise(resolve => setImmediate(resolve));
    const source = `import {createDemo} from './src/demo.js'; import {AgentRuntime} from './src/agent-runtime.js';
      const f=createDemo({path:process.env.QA_DB,masterKey:process.env.QA_KEY,clock:()=>1700000000000});
      try{const agent=new AgentRuntime({gateway:f.gateway,provider:{model:'lease-test',complete:()=>{throw new Error('must not generate')}}});try{agent.resume('demo','leased');process.exitCode=1;}catch(e){console.log(e.code);}}finally{f.store.close();}`;
    const output = await new Promise((done, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('..', import.meta.url), env: { ...process.env, QA_DB: path, QA_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let data = '', errors = '';
      child.stdout.on('data', b => { data += b; }); child.stderr.on('data', b => { errors += b; }); child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0, errors); done(data.trim()); } catch (error) { reject(error); } });
    });
    assert.equal(output, 'AGENT_BUSY'); finish({ role: 'assistant', content: 'Only the original worker completed this turn.' }); assert.equal((await runtime.wait('demo', 'leased')).state, 'completed');
  } finally { if (finish) { finish({ role: 'assistant', content: 'Cleanup' }); await runtime.wait('demo', 'leased'); } runtime.close(); f.store.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-ai-lease-')); rmSync(dir, { recursive: true, force: true }); }
});
