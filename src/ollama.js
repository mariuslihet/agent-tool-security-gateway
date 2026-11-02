import { assert, bounded, GatewayError } from './util.js';

export class OllamaProvider {
  constructor({ model, baseUrl = 'http://127.0.0.1:11434', fetchImpl = fetch, timeoutMs = 120000 }) {
    const url = new URL(baseUrl);
    assert(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'INVALID_LLM_ENDPOINT');
    assert(typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/.test(model) && !model.includes('..') && !model.toLowerCase().includes('cloud'), 'INVALID_LLM_MODEL');
    assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000, 'INVALID_LLM_TIMEOUT');
    this.model = model; this.origin = url.origin; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async #json(path, body, signal) {
    let response;
    try { response = await this.fetch(this.origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(bounded(body, 131072)) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs) }); }
    catch { throw new GatewayError(signal?.aborted ? 'RUN_CANCELLED' : 'OLLAMA_UNREACHABLE'); }
    if (!response.ok) { await response.body?.cancel(); throw new GatewayError(response.status === 404 ? 'OLLAMA_MODEL_NOT_FOUND' : 'OLLAMA_REQUEST_FAILED'); }
    const reader = response.body?.getReader(); assert(reader, 'INVALID_LLM_RESPONSE'); const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; assert(size <= 262144, 'LLM_RESPONSE_TOO_LARGE'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    try { return bounded(JSON.parse(Buffer.concat(chunks).toString('utf8')), 262144); } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('INVALID_LLM_RESPONSE'); }
  }
  async check() {
    const data = await this.#json('/api/show', { model: this.model });
    assert(Array.isArray(data.capabilities) && data.capabilities.includes('tools'), 'LLM_TOOLS_UNSUPPORTED');
    return { provider: 'ollama', model: this.model, ready: true, local: true };
  }
  async complete(messages, tools, signal) {
    const data = await this.#json('/api/chat', { model: this.model, messages, tools, stream: false, think: false, options: { num_ctx: 8192, num_predict: 1024, temperature: 0.7 }, keep_alive: '5m' }, signal);
    assert(data.done === true && data.message?.role === 'assistant' && (data.message.content === undefined || typeof data.message.content === 'string') && (data.message.tool_calls === undefined || Array.isArray(data.message.tool_calls)), 'INVALID_LLM_RESPONSE');
    assert(data.done_reason !== 'length', 'LLM_OUTPUT_LIMIT');
    const content = data.message.content ?? '', calls = data.message.tool_calls ?? [];
    assert(content.length <= 32768 && calls.length <= 4 && (content.trim() || calls.length), 'INVALID_LLM_RESPONSE');
    const normalized = calls.map(call => {
      assert(call?.function && typeof call.function.name === 'string' && /^gateway_\d{1,3}$/.test(call.function.name), 'INVALID_LLM_TOOL_CALL');
      let args = call.function.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { throw new GatewayError('INVALID_LLM_TOOL_CALL'); } }
      assert(args && typeof args === 'object' && !Array.isArray(args), 'INVALID_LLM_TOOL_CALL');
      return { function: { name: call.function.name, arguments: bounded(args, 32768) } };
    });
    return { role: 'assistant', content, ...(normalized.length ? { tool_calls: normalized } : {}) };
  }
}

export function configuredOllama(env = process.env) {
  if (!env.LLM_PROVIDER) return null;
  assert(env.LLM_PROVIDER === 'ollama', 'INVALID_LLM_PROVIDER');
  return new OllamaProvider({ model: env.LLM_MODEL, baseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434' });
}
