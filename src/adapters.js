import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
import { realpath, open as openFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { assert, bounded } from './util.js';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(address === '168.63.129.16' || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 2, 168].includes(b))
      || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  // Conservative IPv6 policy: global unicast only, excluding special-use / documentation ranges.
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    return /^[23][0-9a-f]{3}:/.test(a) && !a.startsWith('2001:') && !a.startsWith('2002:') && !a.startsWith('3fff:');
  }
  return false;
}

export class SecretBroker {
  #grants;
  #environment;
  constructor(grants, environment = process.env) { this.#grants = structuredClone(grants); this.#environment = { ...environment }; }
  get(tool, name) {
    assert(this.#grants[tool]?.includes(name), 'SECRET_SCOPE_DENIED');
    const value = this.#environment[name];
    assert(typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value), 'SECRET_UNAVAILABLE');
    return value;
  }
}

// The origin is fixed in host configuration, not chosen by the model.
export function httpsJsonAdapter({ origin, toolName, secretBroker, secretName, resolver = lookup, maxBytes = 65536 }) {
  const configured = new URL(origin);
  assert(configured.protocol === 'https:' && configured.origin === origin && !configured.port && !configured.username && !configured.password, 'INVALID_DESTINATION');
  return async ({ url, payload }, { signal }) => {
    const target = new URL(url);
    assert(target.origin === origin && !target.username && !target.password && !target.hash, 'DESTINATION_DENIED');
    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true, verbatim: true });
    assert(addresses.length > 0 && addresses.every(a => isPublicAddress(a.address)), 'PRIVATE_DESTINATION_DENIED');
    const pinned = addresses[0], body = JSON.stringify(bounded(payload, maxBytes));
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    if (secretName) headers.authorization = `Bearer ${secretBroker.get(toolName, secretName)}`;
    return await new Promise((resolve, reject) => {
      const req = https.request(target, {
        method: 'POST', headers, signal, agent: false,
        // Resolve once, check all answers, and pin the validated address to avoid DNS rebinding.
        lookup: (_host, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
        timeout: 10000,
      }, res => {
        // Redirects are never followed and redirect bodies are never returned to the agent.
        if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error('Upstream rejected request')); return; }
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > maxBytes) req.destroy(new Error('Response too large')); else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => { try { resolve(bounded(JSON.parse(Buffer.concat(chunks).toString('utf8')), maxBytes)); } catch (e) { reject(e); } });
      });
      req.on('timeout', () => req.destroy(new Error('Upstream timed out')));
      req.on('error', reject); req.end(body);
    });
  };
}

export function isolatedSum({ numbers }, { signal }) {
  const worker = fileURLToPath(new URL('./workers/sum.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${worker}`, '--max-old-space-size=32', worker], {
      shell: false, windowsHide: true, env: {}, stdio: ['pipe', 'pipe', 'pipe'], signal,
    });
    let data = '', size = 0;
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 4096) child.kill(); else data += chunk; });
    child.stderr.resume(); child.on('error', reject);
    child.on('close', code => { try { assert(code === 0 && size <= 4096, 'ISOLATED_EXECUTION_FAILED'); resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ numbers }));
  });
}

// Fixed logical document identifiers, not arbitrary model-supplied filesystem paths.
// The root and its parent directories must be immutable to untrusted processes.
export function readOnlyFilesAdapter({ root, documents, maxBytes = 32768 }) {
  const configured = structuredClone(documents);
  return async ({ document }, { signal }) => {
    assert(Object.hasOwn(configured, document), 'DOCUMENT_DENIED');
    const base = await realpath(root), target = await realpath(resolve(base, configured[document]));
    const rel = relative(base, target);
    assert(rel && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(rel), 'INVALID_PATH');
    signal?.throwIfAborted();
    const handle = await openFile(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat(); assert(stat.isFile() && stat.size <= maxBytes, 'DOCUMENT_TOO_LARGE');
      const buffer = Buffer.alloc(maxBytes + 1); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      assert(bytesRead <= maxBytes, 'DOCUMENT_TOO_LARGE'); signal?.throwIfAborted();
      return { text: buffer.subarray(0, bytesRead).toString('utf8') };
    } finally { await handle.close(); }
  };
}

// Statements are supplied by the operator; the model supplies a query ID and bound parameters.
export function readOnlySqliteAdapter({ path, queries, maxRows = 100 }) {
  const configured = structuredClone(queries);
  return async ({ query, parameters }, { signal }) => {
    assert(Object.hasOwn(configured, query) && Array.isArray(parameters) && parameters.length <= 100
      && parameters.every(p => p === null || typeof p === 'string' || (typeof p === 'number' && Number.isFinite(p))), 'QUERY_DENIED');
    signal?.throwIfAborted();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      const rows = [];
      for (const row of db.prepare(configured[query]).iterate(...parameters)) {
        assert(rows.length < maxRows, 'ROW_LIMIT_EXCEEDED'); rows.push({ ...row });
      }
      return { rows: bounded(rows) };
    } finally { db.close(); }
  };
}
