import { assert, digest, idPattern } from './util.js';
import { redact } from './scanners.js';
import { VERSION } from './version.js';

const isId = value => typeof value === 'string' && idPattern.test(value);
export class RequestExplorer {
  constructor(store, registry) { this.store = store; this.registry = registry; }
  #lookup(tenant, sessionId, requestId) {
    assert(isId(sessionId) && isId(requestId), 'INVALID_REQUEST');
    const session = this.store.session(sessionId); assert(session?.tenant === tenant, 'REQUEST_NOT_FOUND');
    const request = this.store.request(sessionId, requestId); assert(request, 'REQUEST_NOT_FOUND');
    return { request, session };
  }
  #metadata({ request: r, session: s }) {
    return { sessionId: s.id, requestId: r.id, principal: s.principal, tool: this.registry.get(r.tool) ? r.tool : 'unregistered',
      status: r.status, code: r.result?.code ?? (r.status === 'pending' ? 'HUMAN_APPROVAL_REQUIRED' : 'IN_FLIGHT_OR_INTERRUPTED'),
      created: r.created, transformed: Boolean(r.transformed), requestHash: r.hash, binding: r.binding ?? null,
      approval: r.approval ? { state: r.approval.state, expires: r.approval.expires, approver: r.approval.approver ?? null, decidedAt: r.approval.decidedAt ?? null } : null };
  }
  list(tenant, options) {
    const page = this.store.requestPage(tenant, options);
    return { items: page.items.map(item => this.#metadata(item)), nextCursor: page.nextCursor };
  }
  get(tenant, sessionId, requestId) {
    const item = this.#lookup(tenant, sessionId, requestId);
    const events = this.store.auditPage(tenant, { session: sessionId, search: requestId, limit: 100 }).items.filter(e => e.request === requestId);
    return { request: this.#metadata(item), events, timelineLimit: 100, outputsIncluded: false, argumentsIncluded: false };
  }
  inspect(identity, { sessionId, requestId, reason }) {
    assert(isId(identity.tenant) && isId(identity.actor) && typeof reason === 'string' && reason.trim().length >= 3 && reason.length <= 500 && !reason.includes('\0'), 'INVALID_INSPECTION');
    return this.store.transaction(() => {
      const { request } = this.#lookup(identity.tenant, sessionId, requestId);
      this.store.append({ type: 'request.inspected', tenant: identity.tenant, actor: identity.actor, session: sessionId, request: requestId, reasonHash: digest(reason) });
      return { arguments: redact(request.arguments), transformed: Boolean(request.transformed), outputsIncluded: false, redaction: 'pattern-based; unknown sensitive formats may remain' };
    });
  }
}

export function buildWorkspaceReport(gateway, tenant) {
  return gateway.store.transaction(() => {
    assert(gateway.store.readiness(), 'GATEWAY_UNAVAILABLE');
    const statistics = gateway.store.statistics(tenant), safety = gateway.safety.get(tenant), alertSummary = gateway.alerts.summary(tenant);
    const requestCounts = Object.fromEntries(gateway.store.db.prepare('SELECT status,COUNT(*) AS n FROM request_index WHERE tenant=? GROUP BY status').all(tenant).map(r => [r.status, r.n]));
    const report = { schemaVersion: 1, version: VERSION, tenant, generatedAt: Date.now(), kind: 'workspace-metadata-snapshot',
      policy: { version: gateway.policy.data.version, hash: gateway.policy.hash, ruleCount: gateway.policy.data.rules.length },
      registry: { hash: gateway.registry.hash, tools: gateway.registry.list().map(t => ({ name: t.name, egress: t.egress, labels: t.outputLabels })) },
      audit: { ...gateway.store.auditStatus(), verification: 'cached full-check state plus current tail check; not a new full-chain verification' },
      statistics, requests: requestCounts, incidents: gateway.incidents.counts(tenant), alerts: alertSummary,
      containment: { active: safety.active, scope: safety.scope, expires: safety.expires, revision: safety.revision, status: safety.status },
      scopedContainment: { active: gateway.containment.list(tenant).items.filter(h => h.active).length, totalTargets: gateway.containment.list(tenant).items.length },
      privacy: { arguments: false, outputs: false, notes: false, customRuleTitles: false, credentials: false },
      scope: 'operational snapshot; not a security certification or proof of complete history' };
    const reportHash = digest(report);
    gateway.store.append({ type: 'workspace.report_generated', tenant, reportHash });
    return { ...report, reportHash, hashAlgorithm: 'sha256 over canonical JSON excluding reportHash and hashAlgorithm' };
  });
}
