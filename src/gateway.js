import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { assert, bounded, digest, freeze, idPattern, toolPattern, jsonClone, GatewayError } from './util.js';
import { validate } from './schema.js';
import { inspect, redact } from './scanners.js';
import { IncidentService, SafetyService } from './operations.js';
import { AlertService } from './alerts.js';
import { RequestExplorer } from './investigation.js';
import { ScopedContainment } from './containment.js';

const fail = (code, extra = {}) => ({ status: 'denied', code, retryable: false, ...extra });
const secretFinding = f => /PRIVATE_KEY|API_KEY|CREDENTIAL/.test(f);
const sensitiveFinding = f => secretFinding(f) || f.includes('EMAIL');

export class Gateway {
  #profiles;
  constructor({ store, registry, policy, profiles, clock = Date.now, onEvent = () => {} }) {
    this.store = store; this.registry = registry.lock(); this.policy = policy; this.clock = clock; this.onEvent = onEvent;
    this.incidents = new IncidentService(store, clock); this.safety = new SafetyService(store, clock);
    this.alerts = new AlertService(store, clock); this.requests = new RequestExplorer(store, this.registry);
    this.containment = new ScopedContainment(store, this.registry, clock);
    this.#profiles = new Map();
    for (const raw of profiles) {
      const p = bounded(raw);
      assert(typeof p.id === 'string' && typeof p.tenant === 'string' && idPattern.test(p.id) && idPattern.test(p.tenant) && !this.#profiles.has(p.id), 'INVALID_PROFILE');
      assert(Array.isArray(p.grants) && p.grants.length && p.grants.every(g => {
        const tool = registry.get(g.tool);
        return tool && g.fingerprint === tool.fingerprint && g.values && typeof g.values === 'object' && !Array.isArray(g.values)
          && Object.entries(g.values).every(([k, v]) => Object.hasOwn(tool.definition.inputSchema.properties, k) && Array.isArray(v) && v.length)
          && Array.isArray(g.origins) && g.origins.every(origin => { try { const u = new URL(origin); return u.protocol === 'https:' && u.origin === origin && !u.username && !u.password && !u.port; } catch { return false; } });
      }), 'INVALID_PROFILE');
      assert(p.limits && Object.keys(p.limits).sort().join(',') === 'maxCalls,maxConcurrent,maxCost,maxOutputBytes,ttlMs', 'INVALID_PROFILE');
      assert(Object.values(p.limits).every(v => Number.isSafeInteger(v) && v > 0 && v <= 86400000), 'INVALID_PROFILE');
      this.#profiles.set(p.id, freeze(p));
    }
  }
  #event(event) {
    event = { eventId: randomUUID(), at: this.clock(), ...event };
    this.store.append(event);
    this.incidents.observe(event);
    this.alerts.observe(event);
    // Observability is best effort; durable audit above is mandatory.
    queueMicrotask(() => { try { Promise.resolve(this.onEvent(freeze(jsonClone(event)))).catch(() => {}); } catch { /* telemetry cannot authorize or change execution */ } });
  }
  #profile(id) { const p = this.#profiles.get(id); assert(p, 'UNKNOWN_PRINCIPAL'); return p; }
  identity(principal) { const p = this.#profile(principal); return { principal: p.id, tenant: p.tenant }; }
  inspectSession(tenant, id) {
    const s = this.store.session(id); assert(s?.tenant === tenant, 'SESSION_NOT_FOUND');
    const chain = this.#lineageForCompletion(s);
    assert(chain.every(x => x && x.tenant === tenant && x.principal === s.principal), 'STORAGE_INTEGRITY_FAILURE');
    let status = 'active';
    if (chain.some(x => x.expires <= this.clock())) status = 'expired';
    if (chain.some(x => x.policyHash !== this.policy.hash || x.registryHash !== this.registry.hash || !this.#profiles.has(x.principal) || x.profileHash !== digest(this.#profile(x.principal)))) status = 'configuration_changed';
    if (chain.some(x => x.revoked || ['session', 'principal', 'tenant'].some(type => this.store.db.prepare('SELECT value FROM meta WHERE key=?').get(`revoked:${tenant}:${type}:${type === 'session' ? x.id : type === 'principal' ? x.principal : tenant}`)))) status = 'revoked';
    return {
      id: s.id, principal: s.principal, tenant, parentId: s.parentId, created: s.created, expires: s.expires,
      status, labels: [...new Set(chain.flatMap(x => x.labels))],
      usage: { calls: s.calls, cost: s.cost, outputBytes: s.outputBytes, active: s.active }, limits: s.limits,
      policyHash: s.policyHash,
      containment: this.containment.check(tenant, chain, '') ?? null,
      grants: s.grants.map(g => ({ ...g, values: redact(g.values), revoked: Boolean(this.store.db.prepare('SELECT value FROM meta WHERE key=?').get(`revoked:${tenant}:tool:${g.tool}`)) })),
    };
  }
  sessions(tenant, options) {
    const page = this.store.sessionPage(tenant, options);
    return { items: page.items.map(s => { const { grants, ...summary } = this.inspectSession(tenant, s.id); return { ...summary, toolCount: grants.length }; }), nextCursor: page.nextCursor };
  }
  #session(id, principal) {
    const s = this.store.session(id), p = this.#profile(principal);
    assert(s && s.principal === p.id && s.tenant === p.tenant, 'SESSION_NOT_FOUND');
    assert(!s.revoked && s.expires > this.clock(), 'SESSION_INACTIVE');
    assert(s.policyHash === this.policy.hash && s.registryHash === this.registry.hash && s.profileHash === digest(p), 'CONFIGURATION_CHANGED');
    for (const [type, value] of [['principal', principal], ['session', id], ['tenant', s.tenant]]) this.#checkRevocation(s.tenant, type, value);
    return s;
  }
  #checkRevocation(tenant, type, value) {
    assert(!this.store.db.prepare('SELECT value FROM meta WHERE key=?').get(`revoked:${tenant}:${type}:${value}`), 'REVOKED');
  }
  restrictedSessionOptions(principal, toolNames, { maxCalls } = {}) {
    assert(Array.isArray(toolNames) && toolNames.every(name => typeof name === 'string' && this.registry.get(name)), 'INVALID_TOOL_SELECTION');
    assert(maxCalls === undefined || Number.isSafeInteger(maxCalls) && maxCalls > 0, 'INVALID_TASK_BUDGET');
    const profile = this.#profile(principal);
    return { grants: jsonClone(profile.grants).filter(g => toolNames.includes(g.tool)), limits: { ...profile.limits, maxCalls: Math.min(maxCalls ?? profile.limits.maxCalls, profile.limits.maxCalls) }, profileHash: digest(profile) };
  }
  createRestrictedSession(principal, toolNames, options = {}) {
    const { grants, limits } = this.restrictedSessionOptions(principal, toolNames, options);
    return this.createSession(principal, { grants, limits });
  }
  createSession(principal, { parentId, grants, limits } = {}) {
    const p = this.#profile(principal);
    return this.store.transaction(() => {
      let parent;
      if (parentId) { parent = this.#session(parentId, principal); assert(this.#lineage(parent).length < 16, 'DELEGATION_DEPTH'); }
      const selected = grants ? bounded(grants) : jsonClone(parent?.grants ?? p.grants);
      const ceiling = parent?.grants ?? p.grants;
      // An empty capability set is a valid attenuation for chat-only sessions.
      assert(Array.isArray(selected), 'CAPABILITY_ESCALATION');
      for (const g of selected) assert(ceiling.some(c => {
        if (c.tool !== g.tool || c.fingerprint !== g.fingerprint || !Array.isArray(g.origins) || !g.values || typeof g.values !== 'object' || Array.isArray(g.values)) return false;
        if (!g.origins.every(o => c.origins.includes(o))) return false;
        return Object.keys(c.values).every(k => Array.isArray(g.values[k]) && g.values[k].length && g.values[k].every(v => c.values[k].some(x => digest(x) === digest(v))))
          && Object.entries(g.values).every(([k, v]) => Object.hasOwn(this.registry.get(g.tool).definition.inputSchema.properties, k) && Array.isArray(v) && v.length);
      }), 'CAPABILITY_ESCALATION');
      const max = parent?.limits ?? p.limits, budget = limits ? bounded(limits) : jsonClone(max);
      assert(Object.keys(budget).sort().join(',') === Object.keys(max).sort().join(',') && Object.entries(budget).every(([k, v]) => Number.isSafeInteger(v) && v > 0 && v <= max[k]), 'CAPABILITY_ESCALATION');
      const now = this.clock(), s = {
        id: randomUUID(), principal: p.id, tenant: p.tenant, grants: selected, limits: budget,
        parentId: parent?.id ?? null, created: now, expires: Math.min(now + budget.ttlMs, parent?.expires ?? Infinity),
        policyHash: this.policy.hash, registryHash: this.registry.hash, profileHash: digest(p),
        calls: 0, cost: 0, outputBytes: 0, active: 0, labels: parent?.labels ?? [], revoked: false,
      };
      this.store.saveSession(s); this.#event({ type: 'session.created', tenant: s.tenant, principal, session: s.id, parent: s.parentId });
      return { sessionId: s.id, expires: s.expires, policyHash: s.policyHash };
    });
  }
  #lineage(s) {
    const chain = [s], seen = new Set([s.id]);
    while (chain.at(-1).parentId) {
      assert(chain.length < 16, 'DELEGATION_DEPTH');
      const p = this.#session(chain.at(-1).parentId, s.principal);
      assert(!seen.has(p.id), 'DELEGATION_CYCLE'); seen.add(p.id); chain.push(p);
    }
    return chain;
  }
  #authorize(s, tool, args) {
    this.#checkRevocation(s.tenant, 'tool', tool.definition.name);
    const grant = s.grants.find(g => g.tool === tool.definition.name && g.fingerprint === tool.fingerprint
      && Object.entries(g.values).every(([k, values]) => values.some(v => digest(v) === digest(args[k] ?? null))));
    assert(grant, 'CAPABILITY_DENIED');
    if (tool.definition.destinationField) {
      const origin = new URL(args[tool.definition.destinationField]).origin;
      assert(grant.origins.includes(origin), 'DESTINATION_DENIED'); this.#checkRevocation(s.tenant, 'destination', origin);
    }
  }
  async execute(principal, sessionId, input) {
    const started = performance.now();
    let reserved;
    try {
      const request = bounded(input, this.policy.data.limits.maxArgumentBytes);
      assert(Object.keys(request).every(k => ['id', 'tool', 'arguments'].includes(k)) && typeof request.id === 'string' && idPattern.test(request.id) && typeof request.tool === 'string' && toolPattern.test(request.tool) && request.arguments && typeof request.arguments === 'object', 'INVALID_REQUEST');
      reserved = this.store.transaction(() => this.#reserve(principal, sessionId, request));
      if (reserved.response) return reserved.response;
    } catch (error) {
      const code = error instanceof GatewayError ? error.code : 'GATEWAY_UNAVAILABLE';
      const p = this.#profiles.get(principal);
      if (p) {
        try { this.store.transaction(() => {
          const owned = typeof sessionId === 'string' && idPattern.test(sessionId) ? this.store.session(sessionId) : null;
          this.#event({ type: 'request.rejected', tenant: p.tenant, principal, code, ...(owned?.principal === principal && owned.tenant === p.tenant ? { session: owned.id } : {}) });
        }); }
        catch { return fail('GATEWAY_UNAVAILABLE'); }
      }
      return fail(code);
    }
    const { record, tool } = reserved, controller = new AbortController();
    let timeout;
    try {
      const output = await Promise.race([
        Promise.resolve().then(() => tool.handler(jsonClone(record.arguments), { signal: controller.signal, sessionId, requestId: record.id })),
        new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new GatewayError('EXECUTION_TIMEOUT')); }, tool.definition.timeoutMs); }),
      ]);
      const clean = bounded(output, this.policy.data.limits.maxOutputBytes);
      validate(tool.definition.outputSchema, clean);
      const findings = inspect(clean), sanitized = redact(clean), bytes = Buffer.byteLength(JSON.stringify(sanitized));
      return this.store.transaction(() => {
        const s = this.store.session(sessionId), chain = this.#lineageForCompletion(s);
        for (const item of chain) {
          item.active--;
          item.outputBytes += bytes;
          item.labels = [...new Set([...item.labels, ...tool.definition.outputLabels, ...(findings.some(sensitiveFinding) ? ['sensitive'] : []), ...(findings.some(f => f.includes('INJECTION')) ? ['untrusted'] : [])])];
          this.store.saveSession(item);
        }
        const exceeded = chain.some(x => x.outputBytes > x.limits.maxOutputBytes);
        record.status = exceeded ? 'output_blocked' : 'completed';
        record.result = exceeded ? fail('OUTPUT_BUDGET_EXCEEDED') : { status: 'completed', code: 'OK', output: sanitized, labels: s.labels, transformed: record.transformed };
        this.store.saveRequest(record);
        this.#event({ type: 'execution.finished', tenant: s.tenant, session: s.id, request: record.id, tool: record.tool, status: record.status, findings, outputBytes: bytes, durationMs: Math.round(performance.now() - started) });
        return record.result;
      });
    } catch (error) {
      try {
        return this.store.transaction(() => {
          const s = this.store.session(sessionId);
          const timedOut = error instanceof GatewayError && error.code === 'EXECUTION_TIMEOUT';
          // A timeout cannot establish that an external side effect stopped. Keep its slot reserved.
          if (!timedOut) for (const item of this.#lineageForCompletion(s)) { item.active--; this.store.saveSession(item); }
          record.status = 'indeterminate';
          record.result = { status: 'indeterminate', code: timedOut ? 'EXECUTION_TIMEOUT' : 'EXECUTION_UNCERTAIN', retryable: false };
          this.store.saveRequest(record);
          this.#event({ type: 'execution.uncertain', tenant: s.tenant, session: s.id, request: record.id, tool: record.tool, code: record.result.code });
          return record.result;
        });
      } catch { return { status: 'indeterminate', code: 'PERSISTENCE_FAILURE', retryable: false }; }
    } finally { clearTimeout(timeout); }
  }
  #lineageForCompletion(s) {
    // Revocation/expiry does not prevent recording an already running execution's outcome.
    const chain = [s];
    while (chain.at(-1).parentId && chain.length < 16) chain.push(this.store.session(chain.at(-1).parentId));
    return chain;
  }
  #reserve(principal, sessionId, request) {
    const s = this.#session(sessionId, principal), chain = this.#lineage(s), hash = digest(request);
    let record = this.store.request(sessionId, request.id);
    if (record) {
      assert(record.hash === hash, 'IDEMPOTENCY_CONFLICT');
      if (record.status === 'running') {
        this.#event({ type: 'request.duplicate', tenant: s.tenant, principal, session: sessionId, request: record.id, code: 'IN_FLIGHT_OR_INTERRUPTED' });
        return { response: { status: 'indeterminate', code: 'IN_FLIGHT_OR_INTERRUPTED', retryable: false } };
      }
      if (record.status !== 'pending') {
        this.#event({ type: 'request.replayed', tenant: s.tenant, principal, session: sessionId, request: record.id, status: record.status });
        return { response: record.result };
      }
    } else {
      const tenantHold = this.safety.check(s.tenant, this.registry.get(request.tool)?.definition);
      const hold = tenantHold ? { ...tenantHold, code: 'TENANT_PAUSED' } : this.containment.check(s.tenant, chain, request.tool);
      if (hold) {
        this.#event({ type: 'execution.paused', tenant: s.tenant, session: s.id, request: request.id, code: hold.code, ...(hold.scope ? { scope: hold.scope } : { targetKind: hold.kind, target: hold.target, revision: hold.revision }) });
        return { response: { status: 'paused', ...hold, retryable: true } };
      }
      assert(chain.every(x => x.calls < x.limits.maxCalls), 'CALL_BUDGET_EXCEEDED');
      for (const x of chain) { x.calls++; this.store.saveSession(x); }
      record = { session: sessionId, id: request.id, tool: request.tool, hash, arguments: request.arguments, status: 'evaluating', created: this.clock(), approval: null, transformed: false };
    }
    if (record.status === 'pending') {
      const tenantHold = this.safety.check(s.tenant, this.registry.get(request.tool)?.definition);
      const hold = tenantHold ? { ...tenantHold, code: 'TENANT_PAUSED' } : this.containment.check(s.tenant, chain, request.tool);
      if (hold) {
        this.#event({ type: 'execution.paused', tenant: s.tenant, session: s.id, request: request.id, code: hold.code, ...(hold.scope ? { scope: hold.scope } : { targetKind: hold.kind, target: hold.target, revision: hold.revision }) });
        return { response: { status: 'paused', ...hold, retryable: true } };
      }
    }
    try {
      const tool = this.registry.get(request.tool); assert(tool, 'UNKNOWN_TOOL');
      validate(tool.definition.inputSchema, request.arguments);
      this.#authorize(s, tool, request.arguments);
      const labels = [...new Set(chain.flatMap(x => x.labels))];
      if (tool.definition.egress) {
        assert(!labels.includes('sensitive'), 'SENSITIVE_EGRESS_DENIED');
        assert(!labels.includes('untrusted'), 'UNTRUSTED_EGRESS_DENIED');
        assert(chain.every(x => x.active === 0), 'SEQUENCE_IN_FLIGHT');
      }
      const context = args => ({ arguments: args, session: { labels, calls: s.calls, cost: s.cost }, identity: { principal, tenant: s.tenant }, findings: inspect(args) });
      let args = jsonClone(request.arguments), evaluation = this.policy.evaluate(request.tool, context(args));
      assert(evaluation.effect !== 'deny', 'POLICY_DENIED');
      if (evaluation.redactFields.length) {
        for (const k of evaluation.redactFields) if (Object.hasOwn(args, k)) args[k] = redact(args[k]);
        record.transformed = digest(args) !== digest(request.arguments);
        validate(tool.definition.inputSchema, args); this.#authorize(s, tool, args);
        evaluation = this.policy.evaluate(request.tool, context(args)); assert(evaluation.effect !== 'deny', 'POLICY_DENIED');
      }
      // Secret findings cannot be overridden by a policy allow or human approval.
      if (tool.definition.egress) {
        const findings = inspect(args);
        assert(!findings.some(secretFinding), 'SECRET_EGRESS_DENIED');
        assert(!findings.some(f => f.includes('EMAIL')), 'PII_EGRESS_DENIED');
      }
      const binding = digest({ session: sessionId, principal, tenant: s.tenant, arguments: args, tool: tool.fingerprint, policy: this.policy.hash, request: request.id });
      if (evaluation.effect === 'approval') {
        if (!record.approval) {
          record.arguments = args; record.binding = binding; record.status = 'pending'; record.ruleIds = evaluation.ruleIds;
          record.approval = { id: randomUUID(), state: 'pending', expires: this.clock() + this.policy.data.limits.approvalTtlMs };
          this.store.saveRequest(record);
          this.#event({ type: 'approval.required', tenant: s.tenant, session: sessionId, request: request.id, tool: request.tool, binding, ruleIds: evaluation.ruleIds });
        }
        assert(record.binding === binding, 'APPROVAL_BINDING_CHANGED');
        assert(record.approval.expires > this.clock(), 'APPROVAL_EXPIRED');
        assert(!['rejected', 'cancelled'].includes(record.approval.state), 'APPROVAL_REJECTED');
        if (record.approval.state !== 'approved') return { response: { status: 'approval_required', code: 'HUMAN_APPROVAL_REQUIRED', approvalId: record.approval.id, binding, expires: record.approval.expires, retryable: true } };
        record.approval.state = 'consumed';
      }
      assert(chain.every(x => x.cost + tool.definition.cost <= x.limits.maxCost), 'COST_BUDGET_EXCEEDED');
      assert(chain.every(x => x.active < x.limits.maxConcurrent), 'CONCURRENCY_EXCEEDED');
      for (const x of chain) {
        x.cost += tool.definition.cost; x.active++;
        x.labels = [...new Set([...x.labels, ...tool.definition.outputLabels])];
        this.store.saveSession(x);
      }
      record.arguments = args; record.status = 'running'; record.binding = binding;
      this.store.saveRequest(record);
      this.#event({ type: 'execution.started', tenant: s.tenant, principal, session: sessionId, request: request.id, tool: request.tool, binding, ruleIds: evaluation.ruleIds, transformed: record.transformed });
      return { record, tool };
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      record.status = 'denied'; record.result = fail(error.code);
      this.store.saveRequest(record);
      this.#event({ type: 'execution.denied', tenant: s.tenant, principal, session: sessionId, request: request.id, tool: this.registry.get(request.tool) ? request.tool : 'unregistered', code: error.code });
      return { response: record.result };
    }
  }
  approvals(tenant) {
    return this.store.pending(tenant).map(r => ({ sessionId: r.session, requestId: r.id, principal: this.store.session(r.session).principal, tool: r.tool, arguments: redact(r.arguments), binding: r.binding, created: r.created, ruleIds: r.ruleIds ?? [], ...r.approval, reason: redact(r.approval.reason ?? ''), expired: r.approval.expires <= this.clock() }));
  }
  decideApproval({ tenant, approver }, { sessionId, requestId, binding, decision, reason = '' }) {
    assert(idPattern.test(tenant) && idPattern.test(approver) && ['approve', 'reject', 'cancel'].includes(decision), 'INVALID_APPROVAL');
    assert(typeof reason === 'string' && reason.length <= 500 && !reason.includes('\0'), 'INVALID_REASON');
    return this.store.transaction(() => {
      const s = this.store.session(sessionId), r = this.store.request(sessionId, requestId);
      assert(s?.tenant === tenant && r?.status === 'pending' && r.approval?.state === 'pending', 'APPROVAL_NOT_FOUND');
      this.#session(sessionId, s.principal); this.#lineage(s);
      assert(binding === r.binding && r.approval.expires > this.clock(), 'APPROVAL_INVALID');
      assert(approver !== s.principal, 'SELF_APPROVAL_DENIED');
      r.approval.state = { approve: 'approved', reject: 'rejected', cancel: 'cancelled' }[decision];
      r.approval.approver = approver; r.approval.reason = reason; r.approval.decidedAt = this.clock(); this.store.saveRequest(r);
      this.#event({ type: `approval.${r.approval.state}`, tenant, approver, session: sessionId, request: requestId, binding, reasonHash: digest(reason) });
      return { status: r.approval.state };
    });
  }
  revoke({ tenant, approver }, { type, value }) {
    assert(idPattern.test(tenant) && idPattern.test(approver) && ['session', 'principal', 'tenant', 'tool', 'destination'].includes(type) && typeof value === 'string' && value.length <= 256, 'INVALID_REVOCATION');
    return this.store.transaction(() => {
      this.store.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(`revoked:${tenant}:${type}:${value}`, '1');
      this.#event({ type: 'capability.revoked', tenant, approver, targetType: type, target: value });
      return { status: 'revoked' };
    });
  }
  simulate(principal, sessionId, calls, candidatePolicy = this.policy) {
    const s = this.#session(sessionId, principal);
    assert(Array.isArray(calls) && calls.length <= 100, 'INVALID_SIMULATION');
    return calls.map(call => {
      const context = { arguments: bounded(call.arguments), session: { labels: s.labels, calls: s.calls, cost: s.cost }, identity: { principal, tenant: s.tenant }, findings: inspect(call.arguments) };
      const current = this.policy.evaluate(call.tool, context), candidate = candidatePolicy.evaluate(call.tool, context);
      return { tool: call.tool, current, candidate, changed: digest(current) !== digest(candidate) };
    });
  }
}
