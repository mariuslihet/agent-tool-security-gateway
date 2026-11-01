import { digest, idPattern } from './util.js';
import { VERSION } from './version.js';

// Minimal MCP stdio transport. Host identity is fixed at startup, never supplied in tool arguments.
export function attachMcp({ gateway, principal, input = process.stdin, output = process.stdout, maxFrameBytes = 65536 }) {
  let buffer = '', initialized = false, session, queued = 0, chain = Promise.resolve();
  const send = value => output.write(JSON.stringify(value) + '\n');
  async function handle(message) {
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
    if (message.id === undefined) return;
    try {
      let result;
      if (message.method === 'initialize') {
        if (initialized) throw new Error('Already initialized');
        if (message.params?.protocolVersion !== '2025-06-18') throw new Error('Supported protocol version: 2025-06-18');
        session = gateway.createSession(principal).sessionId; initialized = true;
        result = { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'agent-tool-security-gateway', version: VERSION } };
      } else {
        if (!initialized) throw new Error('Initialize first');
        if (message.method === 'ping') result = {};
        else if (message.method === 'tools/list') result = { tools: gateway.registry.list().map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
        else if (message.method === 'tools/call') {
          const params = message.params ?? {}, keys = Object.keys(params);
          if (!keys.every(k => ['name', 'arguments', '_meta'].includes(k))) throw new Error('Invalid tool call');
          const requestId = params._meta?.['gateway/requestId'] ?? `mcp_${digest({ id: message.id })}`;
          if (typeof requestId !== 'string' || !idPattern.test(requestId)) throw new Error('Invalid request identifier');
          const response = await gateway.execute(principal, session, { id: requestId, tool: params.name, arguments: params.arguments ?? {} });
          result = { content: [{ type: 'text', text: JSON.stringify(response) }], structuredContent: response, isError: response.status !== 'completed' };
        } else { send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }
      }
      send({ jsonrpc: '2.0', id: message.id, result });
    } catch { send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid request or unavailable session' } }); }
  }
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > maxFrameBytes) { input.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      queued++;
      if (queued > 32) { input.destroy(); return; }
      chain = chain.then(() => handle(message)).catch(() => send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'Internal error' } })).finally(() => { queued--; });
    }
  });
  return { drained: () => chain };
}
