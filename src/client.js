export class GatewayApiError extends Error {
  constructor(code, { status, requestId, retryAfterSeconds } = {}) {
    super(code); this.name = 'GatewayApiError'; this.code = code; this.status = status;
    this.requestId = requestId; this.retryAfterSeconds = retryAfterSeconds;
  }
}
export class GatewayClient {
  #token;
  constructor({ baseUrl = 'http://127.0.0.1:8787', token, fetchImpl = fetch }) {
    const url = new URL(baseUrl);
    if (url.username || url.password) throw new Error('Credentials must be supplied as a token, not in the URL');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('HTTPS required outside loopback');
    this.baseUrl = url.origin; this.#token = token; this.fetch = fetchImpl;
  }
  async request(path, body, method = 'POST', format = 'json') {
    const response = await this.fetch(`${this.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${this.#token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(65000), redirect: 'error' });
    const metadata = { status: response.status, requestId: response.headers.get('x-request-id'), retryAfterSeconds: response.headers.has('retry-after') ? Number(response.headers.get('retry-after')) : undefined };
    if (response.ok && format === 'text') return response.text();
    let result;
    try { result = await response.json(); } catch { throw new GatewayApiError('INVALID_RESPONSE', metadata); }
    if (!response.ok) throw new GatewayApiError(result.code ?? 'GATEWAY_REQUEST_FAILED', metadata);
    return result;
  }
  createSession(options = {}) { return this.request('/v1/sessions', options); }
  execute(sessionId, request) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/execute`, request); }
  tool(sessionId, name) {
    // Works in standard function-calling loops and framework function-tool wrappers.
    // Persist requestId in runtime state before a retry; never generate a new ID for a retry.
    return (args, requestId) => this.execute(sessionId, { id: requestId, tool: name, arguments: args });
  }
}

function query(path, options = {}) {
  const params = new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined && value !== null));
  return `${path}${params.size ? '?' + params : ''}`;
}
export class ControlPlaneClient extends GatewayClient {
  agentConfiguration() { return this.request('/v1/operator/agent/config', undefined, 'GET'); }
  checkAgent() { return this.request('/v1/operator/agent/check', {}); }
  startAgent(input) { return this.request('/v1/operator/agent/runs', input); }
  agentRuns(options) { return this.request(query('/v1/operator/agent/runs', options), undefined, 'GET'); }
  agentRun(id) { return this.request(`/v1/operator/agent/runs/${encodeURIComponent(id)}`, undefined, 'GET'); }
  agentHealth(id) { return this.request(`/v1/operator/agent/runs/${encodeURIComponent(id)}/health`, undefined, 'GET'); }
  resumeAgent(id) { return this.request(`/v1/operator/agent/runs/${encodeURIComponent(id)}/resume`, {}); }
  cancelAgent(id) { return this.request(`/v1/operator/agent/runs/${encodeURIComponent(id)}/cancel`, {}); }
  followUpAgent(id, input) { return this.request(`/v1/operator/agent/runs/${encodeURIComponent(id)}/messages`, input); }
  exportAgent(id, format = 'json') { return this.request(`/v1/operator/agent/runs/${encodeURIComponent(id)}/export`, { format }); }
  organizeAgent(id, input) { return this.request(`/v1/operator/agent/runs/${encodeURIComponent(id)}/organize`, input); }
  taskTemplates(options) { return this.request(query('/v1/operator/agent/templates', options), undefined, 'GET'); }
  taskTemplate(id) { return this.request(`/v1/operator/agent/templates/${encodeURIComponent(id)}`, undefined, 'GET'); }
  saveTaskTemplate(input) { return this.request('/v1/operator/agent/templates', input); }
  requests(options) { return this.request(query('/v1/operator/requests', options), undefined, 'GET'); }
  requestDetail(sessionId, requestId) { return this.request(`/v1/operator/requests/${encodeURIComponent(sessionId)}/${encodeURIComponent(requestId)}`, undefined, 'GET'); }
  inspectArguments(sessionId, requestId, reason) { return this.request(`/v1/operator/requests/${encodeURIComponent(sessionId)}/${encodeURIComponent(requestId)}/inspect`, { reason }); }
  alertRules() { return this.request('/v1/operator/alert-rules', undefined, 'GET'); }
  configureAlert(input) { return this.request('/v1/operator/alert-rules', input); }
  alerts(options) { return this.request(query('/v1/operator/alerts', options), undefined, 'GET'); }
  updateAlert(id, input) { return this.request(`/v1/operator/alerts/${encodeURIComponent(id)}`, input); }
  workspaceReport() { return this.request('/v1/operator/report', {}); }
  incidents(options) { return this.request(query('/v1/operator/incidents', options), undefined, 'GET'); }
  incident(id) { return this.request(`/v1/operator/incidents/${encodeURIComponent(id)}`, undefined, 'GET'); }
  updateIncident(id, input) { return this.request(`/v1/operator/incidents/${encodeURIComponent(id)}`, input); }
  safety() { return this.request('/v1/operator/safety', undefined, 'GET'); }
  containment() { return this.request('/v1/operator/containment', undefined, 'GET'); }
  containmentTarget(kind, target) { return this.request(query('/v1/operator/containment/target', { kind, target }), undefined, 'GET'); }
  holdTarget(input) { return this.request('/v1/operator/containment/hold', input); }
  releaseTarget(input) { return this.request('/v1/operator/containment/release', input); }
  workspaceHealth() { return this.request('/v1/operator/workspace-health', undefined, 'GET'); }
  pause(input) { return this.request('/v1/operator/safety/pause', input); }
  resume(input) { return this.request('/v1/operator/safety/resume', input); }
  runPolicySuite(input) { return this.request('/v1/operator/policy/suite', input); }
  status() { return this.request('/v1/operator/status', undefined, 'GET'); }
  sessions(options) { return this.request(query('/v1/operator/sessions', options), undefined, 'GET'); }
  session(id) { return this.request(`/v1/operator/sessions/${encodeURIComponent(id)}`, undefined, 'GET'); }
  audit(options) { return this.request(query('/v1/operator/audit', options), undefined, 'GET'); }
  exportAudit(options) { return this.request(query('/v1/operator/audit/export', options), undefined, 'GET', 'text'); }
  policy() { return this.request('/v1/operator/policy', undefined, 'GET'); }
  validatePolicy(policy) { return this.request('/v1/operator/policy/validate', { policy }); }
  previewPolicy(input) { return this.request('/v1/operator/policy/preview', input); }
  decideApproval(input) { return this.request('/v1/operator/approvals', input); }
  revoke(input) { return this.request('/v1/operator/revocations', input); }
  verifyAudit() { return this.request('/v1/operator/audit/verify', {}); }
}
