import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';

test('two independent processes sharing SQLite reserve one dispatch for the same request ID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-process-')), path = join(dir, 'shared.sqlite'), key = randomBytes(32).toString('hex');
  const f = createDemo({ path, masterKey: key });
  try {
    const { sessionId } = f.gateway.createSession('demo-agent');
    const source = `import {createDemo} from './src/demo.js';
      const f=createDemo({path:process.env.TEST_GATEWAY_DB,masterKey:process.env.TEST_GATEWAY_KEY});
      try{console.log(JSON.stringify(await f.gateway.execute('demo-agent',process.env.TEST_GATEWAY_SESSION,{id:'same',tool:'knowledge.read',arguments:{document:'handbook'}})));}finally{f.store.close();}`;
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('..', import.meta.url), windowsHide: true, env: { ...process.env, TEST_GATEWAY_DB: path, TEST_GATEWAY_KEY: key, TEST_GATEWAY_SESSION: sessionId }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', errors = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0, errors); resolve(JSON.parse(output)); } catch (e) { reject(e); } });
    });
    const results = await Promise.all([run(), run()]);
    assert.ok(results.every(r => r.status === 'completed' || r.code === 'IN_FLIGHT_OR_INTERRUPTED'));
    assert.equal(f.store.events('demo').filter(e => e.type === 'execution.started').length, 1);
    assert.equal(f.store.session(sessionId).cost, 1); assert.equal(f.store.session(sessionId).calls, 1);
    assert.equal(f.store.verifyAudit().valid, true);
  } finally {
    f.store.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('gateway-process-')); rmSync(dir, { recursive: true, force: true });
  }
});
