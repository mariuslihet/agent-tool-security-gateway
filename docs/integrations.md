# Integration notes

## Agent runtimes

Expose only a gateway-backed tool wrapper to the model. Tool execution IDs must come from the runtime and be saved with the task session. Treat denials as structured outcomes; let the agent choose an allowed alternative without escalating its capabilities.

See `examples/function-calling.js` for OpenAI-style function-call objects. A LangChain JavaScript tool wrapper can call `client.tool(sessionId, name)(args, stableRuntimeCallId)`. Other frameworks use the same HTTP boundary. The gateway does not depend on framework-specific lifecycle hooks that the model could bypass.

Do not put bearer tokens, secret-broker values or operator identity into prompts. Do not expose `createSession`, `decideApproval`, registry configuration or arbitrary HTTP dispatch as model-callable tools.

## MCP

The stdio adapter is a deliberately small MCP `2025-06-18` implementation. It accepts bounded newline-delimited JSON-RPC messages, fixes the principal at launch, and opens one session during initialization. Tool results use text plus `structuredContent`; non-completed results set `isError`.

Use direct Node invocation in an MCP host configuration:

```json
{
  "mcpServers": {
    "security-gateway": {
      "command": "node",
      "args": ["--env-file=D:/PROIECTE/agent-tool-security-gateway/.env", "D:/PROIECTE/agent-tool-security-gateway/src/cli.js", "mcp"],
      "env": { "GATEWAY_DB": "D:/PROIECTE/agent-tool-security-gateway/var/gateway.sqlite" }
    }
  }
}
```

The runtime should use a stable `_meta: { "gateway/requestId": "saved-call-id" }` when a retried operation receives a different JSON-RPC ID. Without this metadata, the transport derives an idempotency ID from the JSON-RPC request ID. Do not restart the stdio process to resume an uncertain side effect; session resumption is not implemented.

The HTTP control plane can inspect pending approvals created by an MCP process if both use the same database and master key. Tracing counters are process-local; the persistent audit remains shared.

## Approval webhooks

```js
import { signedApprovalWebhook, Metrics } from '../src/index.js';
const metrics = new Metrics();
const notify = signedApprovalWebhook({
  url: 'https://operator.example.com/gateway-events',
  signingKey: process.env.GATEWAY_WEBHOOK_KEY,
  onFailure: event => console.error(event.code),
});
const onEvent = async event => { metrics.record(event); await notify(event); };
// Supply onEvent when constructing Gateway.
```

Only `approval.required` events are sent, with no raw tool arguments. The payload contains `timestamp`, `event` and `signature`. Verify HMAC-SHA-256 over the canonical sorted JSON of `{timestamp,event}` using the shared key; reject stale timestamps and deduplicate the binding/request. The sink makes at most three delivery attempts. It does not send Slack messages directly; a controlled relay can translate the webhook into Slack or another notification system.

Webhook responses cannot approve anything. The human must authenticate to the operator API/dashboard. Notification failures leave the request pending and cannot change enforcement. The default CLI does not enable external notifications.

## OpenTelemetry

`openTelemetrySink(tracer)` accepts an OpenTelemetry API-compatible tracer supplied by the host. Connect your SDK and exporter in the host application, then call this sink from `onEvent`. It creates event spans with tool, outcome, rule IDs and duration attributes. No mandatory SDK, collector or export destination is bundled. These event spans are not claimed to represent a propagated end-to-end execution trace.

The built-in `Metrics` object records tenant-scoped counters and a rolling 10,000-sample execution latency window. It does not use unbounded request/session identifiers as metric labels. For a security dashboard across processes, derive durable counts from audit exports or a telemetry collector.
