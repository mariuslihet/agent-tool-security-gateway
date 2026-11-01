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
