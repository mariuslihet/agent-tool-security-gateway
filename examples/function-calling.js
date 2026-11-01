import { GatewayClient } from '../src/client.js';

// The agent runtime holds this client; credentials must not enter model messages.
const client = new GatewayClient({ token: process.env.GATEWAY_AGENT_TOKEN });
export async function dispatchFunctionCalls(sessionId, calls) {
  const results = [];
  for (const call of calls) {
    // Persist call.id with sessionId before dispatch. Reuse both on recovery.
    results.push({ tool_call_id: call.id, role: 'tool', content: JSON.stringify(await client.execute(sessionId, {
      id: call.id, tool: call.function.name, arguments: JSON.parse(call.function.arguments),
    })) });
  }
  return results;
}
