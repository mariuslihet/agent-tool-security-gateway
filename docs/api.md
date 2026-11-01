# HTTP API and recovery

Base URL for local development: `http://127.0.0.1:8787`. All `/v1/` endpoints require `Authorization: Bearer <token>`. Agent and operator tokens are separate. All POST bodies require `application/json`; cross-origin requests are rejected. There is no CORS wildcard.

| Method | Route | Role | Purpose |
|---|---|---|---|
| GET | `/healthz` | Public | Process liveness only, not policy/storage readiness |
| GET | `/readyz` | Public | Storage and audit-health readiness; no tenant details |
| GET | `/` | Public | Static operator application; no private data until authenticated |
| GET | `/v1/tools` | Agent | Registered tool contracts |
| POST | `/v1/sessions` | Agent runtime | Create `{}` or narrow a parent with `{parentId, grants?, limits?}` |
| POST | `/v1/sessions/:id/execute` | Agent runtime | Evaluate and possibly execute `{id, tool, arguments}` |
| GET | `/v1/operator/status` | Viewer/operator | Tenant queue, recent events, durable statistics, process-local metrics, cached audit validity and verification time |
| GET | `/v1/operator/sessions` | Viewer/operator | Cursor-paginated tenant session summaries |
| GET | `/v1/operator/sessions/:id` | Viewer/operator | Capabilities, budgets, data labels and timeline |
| GET | `/v1/operator/audit` | Viewer/operator | Filtered, searchable audit snapshot with signed cursors |
| GET | `/v1/operator/audit/export` | Viewer/operator | At most 1,000 JSONL records plus continuation manifest |
| POST | `/v1/operator/audit/verify` | Viewer/operator | Full chain verification with body `{}` |
| GET | `/v1/operator/policy` | Viewer/operator | Active policy and tenant-specific tool-revocation flags |
| POST | `/v1/operator/policy/validate` | Viewer/operator | Validate `{policy}` and return diagnostics |
| POST | `/v1/operator/policy/preview` | Viewer/operator | Compare hypothetical rules/inspection without issuing authority |
| POST | `/v1/operator/approvals` | Operator | Decide `{sessionId, requestId, binding, decision}` |
| POST | `/v1/operator/revocations` | Operator | Revoke `{type, value}` in the operator's tenant |
| POST | `/v1/operator/simulate` | Operator | Compare `{principal, sessionId, calls, policy}` without execution |

Identity and tenant are derived from configured credentials, not headers or body fields supplied by the model. Tokens are hashed once for comparison and compared in constant time per candidate. The reference host does not issue OAuth tokens or act as an OAuth proxy. It accepts a bounded, configured token set.

## Execution outcomes

Tool outcomes return HTTP 200 so an agent can handle them as data:

```json
{"status":"denied","code":"CAPABILITY_DENIED","retryable":false}
```

```json
{"status":"approval_required","code":"HUMAN_APPROVAL_REQUIRED","approvalId":"...","binding":"...","expires":1790000000000,"retryable":true}
```

```json
{"status":"completed","code":"OK","output":{"sum":42},"labels":[],"transformed":false}
```

```json
{"status":"indeterminate","code":"EXECUTION_TIMEOUT","retryable":false}
```

`retryable: true` on an approval request means the **identical** request may be resumed after operator review. It is not permission to poll rapidly or alter arguments. An expired or rejected request is terminal for its request ID.

## HTTP errors

Unauthenticated requests return 401. Role/origin failures return 403. Rate limits return 429, oversized bodies 413, invalid bodies/configurations 400, unknown routes 404, and unexpected gateway failures 503. The body contains a stable `code`, never a raw exception, stack trace or secret.

The reference limit is 120 authenticated requests per credential per minute per server process. It resets after restart and is not a distributed limiter. Budgets and execution idempotency are durable. Use edge connection limits and an identity-provider-aware limiter for an Internet-facing deployment.

Full-chain verification and exports also share a six-request-per-minute budget per credential. Responses include `X-Request-Id` and rate-limit headers; 429 responses include `Retry-After`. See [control-plane query, cursor and role details](control-plane.md).

## Idempotency and recovery

The runtime must persist session ID and request ID **before** dispatch. A request ID is 1–128 ASCII letters, digits, underscores or hyphens. Reusing it with different original tool arguments returns `IDEMPOTENCY_CONFLICT`.

On a network timeout, retry with the same ID. The gateway will return a cached outcome or `IN_FLIGHT_OR_INTERRUPTED`; it will not dispatch the operation twice. An indeterminate result requires an operator to inspect the downstream service. Do not automatically use a new ID. Revoke the uncertain session or task tree, reconcile effects, and create a new task only after the runtime receives authorization to continue.

## Approval and revocation

Approval decisions are `approve`, `reject` or `cancel`. The operator copies the `binding` from the preview. It commits the tenant, principal, session, request, transformed arguments, tool fingerprint and policy hash. All normal checks run again on resume. Deny rules and hard data-flow controls cannot be overridden.

Revocation types: `session`, `principal`, `tenant`, `tool`, `destination`. They are scoped to the operator's tenant. Destination values are exact origin strings, such as `https://reports.example.com`. Revocations persist across restarts and have no un-revoke endpoint in this reference service.
