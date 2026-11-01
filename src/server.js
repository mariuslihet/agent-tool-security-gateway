import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { assert, bounded, equal, GatewayError, idPattern } from './util.js';
import { Policy } from './policy.js';
import { validatePolicyDocument, previewPolicy } from './policy-lab.js';
import { VERSION } from './version.js';

const assets = new Map([
  ['/', ['text/html; charset=utf-8', readFileSync(new URL('../web/index.html', import.meta.url))]],
  ['/app.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../web/app.js', import.meta.url))]],
  ['/style.css', ['text/css; charset=utf-8', readFileSync(new URL('../web/style.css', import.meta.url))]],
  ['/preview.json', ['application/json; charset=utf-8', readFileSync(new URL('../web/preview.json', import.meta.url))]],
]);
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const securityHeaders = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
async function readBody(req, limit) {
  assert(req.headers['content-type']?.split(';')[0] === 'application/json', 'CONTENT_TYPE_REQUIRED');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new GatewayError('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return bounded(JSON.parse(Buffer.concat(chunks).toString('utf8')), limit); }
  catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('INVALID_JSON'); }
}
function shape(value, allowed, required = []) {
  assert(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)), 'INVALID_REQUEST');
}
function queryOptions(params, allowed) {
  const values = {};
  for (const [key, value] of params) {
    assert(allowed.includes(key) && !Object.hasOwn(values, key), 'INVALID_QUERY');
    if (['limit', 'from', 'to'].includes(key)) { assert(/^\d{1,16}$/.test(value), 'INVALID_QUERY'); values[key] = Number(value); }
    else values[key] = value;
  }
  return values;
}
const auditFilters = ['limit', 'cursor', 'type', 'tool', 'code', 'session', 'search', 'from', 'to'];

export function createGatewayServer({ gateway, credentials, metrics, maxBodyBytes = 131072, rateLimit = 120, heavyRateLimit = 6, clock = Date.now }) {
  assert(Array.isArray(credentials) && credentials.length > 0, 'CREDENTIALS_REQUIRED');
  assert([rateLimit, heavyRateLimit].every(value => Number.isSafeInteger(value) && value > 0), 'INVALID_SERVER_CONFIG');
  const identities = credentials.map(c => {
    assert(typeof c.token === 'string' && c.token.length >= 32 && typeof c.principal === 'string' && typeof c.tenant === 'string' && idPattern.test(c.principal) && idPattern.test(c.tenant) && ['agent', 'operator', 'viewer'].includes(c.role), 'INVALID_CREDENTIAL');
    if (c.role === 'agent') assert(gateway.identity(c.principal).tenant === c.tenant, 'IDENTITY_TENANT_MISMATCH');
    return { principal: c.principal, tenant: c.tenant, role: c.role, hash: tokenHash(c.token), used: 0, heavyUsed: 0, reset: clock() + 60000 };
  });
  assert(new Set(identities.map(c => c.hash)).size === identities.length, 'DUPLICATE_CREDENTIAL');
  const server = createServer(async (req, res) => {
    Object.entries(securityHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('x-request-id', randomUUID());
    const send = (status, body) => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); } };
    try {
      assert(req.url.length <= 4096, 'INVALID_REQUEST');
      const url = new URL(req.url, 'http://gateway.invalid'), path = url.pathname;
      if (req.method === 'GET' && assets.has(path)) {
        const [type, data] = assets.get(path); res.writeHead(200, { 'content-type': type }); res.end(data); return;
      }
      if (req.method === 'GET' && path === '/healthz') { send(200, { status: 'ok' }); return; }
      if (req.method === 'GET' && path === '/readyz') { const ready = gateway.store.readiness(); send(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' }); return; }
      assert(!req.headers.origin || req.headers.origin === `http://${req.headers.host}` || req.headers.origin === `https://${req.headers.host}`, 'ORIGIN_DENIED');
      const auth = req.headers.authorization;
      assert(typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length <= 4096, 'UNAUTHENTICATED');
      const hash = tokenHash(auth.slice(7));
      const identity = identities.find(c => equal(c.hash, hash)); assert(identity, 'UNAUTHENTICATED');
      if (clock() >= identity.reset) { identity.used = 0; identity.heavyUsed = 0; identity.reset = clock() + 60000; }
      identity.used++;
      res.setHeader('x-ratelimit-limit', rateLimit); res.setHeader('x-ratelimit-remaining', Math.max(0, rateLimit - identity.used));
      res.setHeader('x-ratelimit-reset', Math.ceil(identity.reset / 1000));
      if (identity.used > rateLimit) res.setHeader('retry-after', Math.max(1, Math.ceil((identity.reset - clock()) / 1000)));
      assert(identity.used <= rateLimit, 'RATE_LIMITED');
      const operator = () => assert(identity.role === 'operator', 'FORBIDDEN');
      const reader = () => assert(['operator', 'viewer'].includes(identity.role), 'FORBIDDEN');
      const heavy = () => {
        identity.heavyUsed++;
        if (identity.heavyUsed > heavyRateLimit) { res.setHeader('retry-after', Math.max(1, Math.ceil((identity.reset - clock()) / 1000))); assert(false, 'RATE_LIMITED'); }
      };
      const agent = () => assert(identity.role === 'agent', 'FORBIDDEN');
      if (req.method === 'GET' && path === '/v1/tools') { agent(); send(200, { tools: gateway.registry.list() }); return; }
      if (req.method === 'POST' && path === '/v1/sessions') {
        agent(); const body = await readBody(req, maxBodyBytes); shape(body, ['parentId', 'grants', 'limits']);
        if (body.parentId !== undefined) assert(typeof body.parentId === 'string', 'INVALID_REQUEST');
        send(201, gateway.createSession(identity.principal, body)); return;
      }
      const execution = /^\/v1\/sessions\/([a-zA-Z0-9_-]{1,128})\/execute$/.exec(path);
      if (req.method === 'POST' && execution) {
        agent(); send(200, await gateway.execute(identity.principal, execution[1], await readBody(req, maxBodyBytes))); return;
      }
      if (req.method === 'GET' && path === '/v1/operator/status') {
        reader(); send(200, { identity: { principal: identity.principal, tenant: identity.tenant, role: identity.role }, version: VERSION, policy: { version: gateway.policy.data.version, hash: gateway.policy.hash }, registryHash: gateway.registry.hash, audit: gateway.store.auditStatus(), statistics: gateway.store.statistics(identity.tenant), metrics: metrics?.snapshot(identity.tenant) ?? {}, approvals: gateway.approvals(identity.tenant), events: gateway.store.events(identity.tenant, 10) }); return;
      }
      if (req.method === 'GET' && path === '/v1/operator/sessions') {
        reader(); send(200, gateway.sessions(identity.tenant, queryOptions(url.searchParams, ['limit', 'cursor']))); return;
      }
      const sessionDetail = /^\/v1\/operator\/sessions\/([a-zA-Z0-9_-]{1,128})$/.exec(path);
      if (req.method === 'GET' && sessionDetail) {
        reader(); send(200, { session: gateway.inspectSession(identity.tenant, sessionDetail[1]), events: gateway.store.auditPage(identity.tenant, { session: sessionDetail[1], limit: 25 }).items }); return;
      }
      if (req.method === 'GET' && path === '/v1/operator/audit') {
        reader(); send(200, gateway.store.auditPage(identity.tenant, queryOptions(url.searchParams, auditFilters))); return;
      }
      if (req.method === 'GET' && path === '/v1/operator/audit/export') {
        reader(); heavy(); const filters = queryOptions(url.searchParams, auditFilters.filter(k => k !== 'limit'));
        const items = []; let cursor = filters.cursor, more = null;
        do {
          const page = gateway.store.auditPage(identity.tenant, { ...filters, cursor, limit: 100 });
          items.push(...page.items); more = page.nextCursor; cursor = more;
        } while (more && items.length < 1000);
        res.setHeader('content-disposition', 'attachment; filename="gateway-audit.jsonl"');
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
        res.end([JSON.stringify({ kind: 'manifest', tenant: identity.tenant, exportedAt: Date.now(), count: items.length, truncated: Boolean(more), nextCursor: more }), ...items.map(event => JSON.stringify({ kind: 'event', ...event }))].join('\n') + '\n'); return;
      }
      if (req.method === 'POST' && path === '/v1/operator/audit/verify') {
        reader(); heavy(); shape(await readBody(req, maxBodyBytes), []);
        const result = gateway.store.verifyAudit(); send(result.valid ? 200 : 503, { valid: result.valid, verifiedAt: Date.now() }); return;
      }
      if (req.method === 'GET' && path === '/v1/operator/policy') {
        reader(); send(200, { policy: gateway.policy.data, hash: gateway.policy.hash, tools: gateway.registry.list().map(tool => ({ ...tool, revoked: Boolean(gateway.store.db.prepare('SELECT value FROM meta WHERE key=?').get(`revoked:${identity.tenant}:tool:${tool.name}`)) })), writable: false }); return;
      }
      if (req.method === 'POST' && path === '/v1/operator/policy/validate') {
        reader(); const body = await readBody(req, maxBodyBytes); shape(body, ['policy'], ['policy']);
        send(200, validatePolicyDocument(body.policy, gateway.registry)); return;
      }
      if (req.method === 'POST' && path === '/v1/operator/policy/preview') {
        reader(); const body = await readBody(req, maxBodyBytes); shape(body, ['policy', 'tool', 'arguments', 'labels', 'principal'], ['tool', 'arguments']);
        if (Object.hasOwn(body, 'policy')) assert(validatePolicyDocument(body.policy, gateway.registry).valid, 'INVALID_POLICY');
        const candidate = Object.hasOwn(body, 'policy') ? new Policy(body.policy) : gateway.policy;
        const context = { registry: gateway.registry, tenant: identity.tenant, principal: body.principal ?? 'policy-preview', tool: body.tool, arguments: body.arguments, labels: body.labels ?? [] };
        send(200, { current: previewPolicy({ ...context, policy: gateway.policy }), candidate: previewPolicy({ ...context, policy: candidate }), execution: false }); return;
      }
      if (req.method === 'POST' && path === '/v1/operator/approvals') {
        operator(); const body = await readBody(req, maxBodyBytes); shape(body, ['sessionId', 'requestId', 'binding', 'decision', 'reason'], ['sessionId', 'requestId', 'binding', 'decision']);
        send(200, gateway.decideApproval({ tenant: identity.tenant, approver: identity.principal }, body)); return;
      }
      if (req.method === 'POST' && path === '/v1/operator/revocations') {
        operator(); const body = await readBody(req, maxBodyBytes); shape(body, ['type', 'value'], ['type', 'value']);
        send(200, gateway.revoke({ tenant: identity.tenant, approver: identity.principal }, body)); return;
      }
      if (req.method === 'POST' && path === '/v1/operator/simulate') {
        operator(); const body = await readBody(req, maxBodyBytes); shape(body, ['principal', 'sessionId', 'calls', 'policy'], ['principal', 'sessionId', 'calls', 'policy']);
        const s = gateway.store.session(body.sessionId); assert(s?.tenant === identity.tenant && s.principal === body.principal, 'SESSION_NOT_FOUND');
        assert(validatePolicyDocument(body.policy, gateway.registry).valid, 'INVALID_POLICY');
        send(200, { decisions: gateway.simulate(body.principal, body.sessionId, body.calls, new Policy(body.policy)), execution: false }); return;
      }
      send(404, { code: 'NOT_FOUND' });
    } catch (error) {
      const code = error instanceof GatewayError ? error.code : 'GATEWAY_UNAVAILABLE';
      const status = code === 'UNAUTHENTICATED' ? 401 : ['FORBIDDEN', 'ORIGIN_DENIED', 'SELF_APPROVAL_DENIED'].includes(code) ? 403 : code === 'RATE_LIMITED' ? 429 : code === 'PAYLOAD_TOO_LARGE' ? 413 : ['GATEWAY_UNAVAILABLE', 'AUDIT_CORRUPTED', 'STORAGE_INTEGRITY_FAILURE'].includes(code) ? 503 : 400;
      send(status, { code });
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 64;
  server.maxConnections = 256; server.maxRequestsPerSocket = 100;
  return server;
}
