# HTTP API and recovery

Task acceptance: operator-only `GET /v1/operator/agent/runs/:id/checks` reads the latest review and stale flag. `POST` accepts exactly `{expectedRevision,expectedTaskRevision,criteria}` and evaluates/saves a snapshot with mandatory audit, using the heavy-operation budget. Neither invokes a model/tool. SDK: `taskChecks(id)` and `checkTask(id,input)`. See [criteria, bounds and review semantics](task-acceptance.md).

Report comparison: operator-only `POST /v1/operator/workspace/reports/compare` accepts exactly `{left:{file,expectedHash},right:{file,expectedHash}}` with no query parameters. Both files are verified before bounded comparison and mandatory audit. SDK: `compareWorkspaceReports(input)`. See [line limits, normalization and snapshot semantics](report-comparison.md).

Template fields: saves accept optional `parameterized`; reads expose `variables`. Operator-only `POST /v1/operator/agent/templates/:id/render` accepts exactly `{expectedRevision,values}` with no query parameters. It validates the current enabled revision, renders/redacts within bounds, audits fingerprints and returns a prompt for review without starting work. SDK: `renderTaskTemplate(id,input)`. See [syntax and limits](template-fields.md).

Task budget additions: task start accepts `taskLimits: {maxTurns,maxToolCalls,maxRunMs}` and `toolMode: "workspace_readonly"`. Limits can only narrow runtime ceilings and are immutable across follow-up/resume; start idempotency binds their effective values. New task session call budgets are attenuated too. Configuration exposes `defaultTaskBudget`; health includes `attemptTimeLimitMs`. See [bounds and recovery semantics](task-budgets.md).

File library: operator-only `GET /v1/operator/workspace` returns source/report metadata; `POST /v1/operator/workspace/reports/read` accepts exactly `{file,expectedHash,purpose}` (`preview` or `download`) and returns verified content after mandatory read audit. Both use the heavy-operation rate budget. SDK: `workspaceFiles()` and `readWorkspaceReport(input)`. See [file library semantics](workspace-library.md).

Workspace additions: task start and prompt templates accept `toolMode: "workspace"`. It grants only the safe reference tools plus `workspace.search`, `workspace.read` and `workspace.report.save` when configured. `activity.phase`/`activity.tool` in task responses describe persisted progress without arguments or model reasoning. Configuration includes `workspace.configured`. Existing execution/approval/resume endpoints handle all workspace calls; see [workspace semantics](workspace-tools.md).

Task health: `GET /v1/operator/agent/runs/:id/health` is operator-only and accepts no query parameters. It returns a read-only snapshot of budgets, expiry, follow-up blockers, tool restrictions and pending approval metadata without prompts or arguments. It never authorizes execution. SDK: `control.agentHealth(id)`. See [semantics and limits](task-health.md).

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
| POST | `/v1/operator/policy/suite` | Viewer/operator | Run up to 50 expected-outcome hypothetical cases |
| GET | `/v1/operator/incidents` | Viewer/operator | List tenant incident records with state and page filters |
| GET/POST | `/v1/operator/incidents/:id` | Viewer/operator read; operator write | Inspect or update the exact expected version |
| GET | `/v1/operator/safety` | Viewer/operator | Inspect current temporary containment |
| POST | `/v1/operator/safety/pause` | Operator | Pause all or outbound reservations with an expiry |
| POST | `/v1/operator/safety/resume` | Operator | Resume the exact expected pause revision |
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

Incident and containment changes return 409 `VERSION_CONFLICT` when the supplied version/revision is stale. See [response workflows and request shapes](incident-response.md).

Unauthenticated requests return 401. Role/origin failures return 403. Rate limits return 429, oversized bodies 413, invalid bodies/configurations 400, unknown routes 404, and unexpected gateway failures 503. The body contains a stable `code`, never a raw exception, stack trace or secret.

The reference limit is 120 authenticated requests per credential per minute per server process. It resets after restart and is not a distributed limiter. Budgets and execution idempotency are durable. Use edge connection limits and an identity-provider-aware limiter for an Internet-facing deployment.

Full-chain verification and exports also share a six-request-per-minute budget per credential. Responses include `X-Request-Id` and rate-limit headers; 429 responses include `Retry-After`. See [control-plane query, cursor and role details](control-plane.md).

## Idempotency and recovery

The runtime must persist session ID and request ID **before** dispatch. A request ID is 1–128 ASCII letters, digits, underscores or hyphens. Reusing it with different original tool arguments returns `IDEMPOTENCY_CONFLICT`.

On a network timeout, retry with the same ID. The gateway will return a cached outcome or `IN_FLIGHT_OR_INTERRUPTED`; it will not dispatch the operation twice. An indeterminate result requires an operator to inspect the downstream service. Do not automatically use a new ID. Revoke the uncertain session or task tree, reconcile effects, and create a new task only after the runtime receives authorization to continue.

## Approval and revocation

Approval decisions are `approve`, `reject` or `cancel`. The operator copies the `binding` from the preview. It commits the tenant, principal, session, request, transformed arguments, tool fingerprint and policy hash. All normal checks run again on resume. Deny rules and hard data-flow controls cannot be overridden.

Revocation types: `session`, `principal`, `tenant`, `tool`, `destination`. They are scoped to the operator's tenant. Destination values are exact origin strings, such as `https://reports.example.com`. Revocations persist across restarts and have no un-revoke endpoint in this reference service.
## Investigation and local alerts (0.4)

All paths below require tenant-scoped bearer credentials. Unknown body/query fields are rejected. `VERSION_CONFLICT` returns 409; role failures return 403. Viewer and operator are readers; agent credentials cannot use these endpoints.

| Method/path | Role | Input / result |
|---|---|---|
| `GET /v1/operator/requests` | Reader | `limit,cursor,status,tool,search`; metadata `items,nextCursor` |
| `GET /v1/operator/requests/:sessionId/:requestId` | Reader | Request metadata and bounded exact-request timeline |
| `POST /v1/operator/requests/:sessionId/:requestId/inspect` | Operator | `{reason}`; redacted stored arguments, never outputs; heavy budget |
| `GET /v1/operator/alert-rules` | Reader | Encrypted rule records, redacted names for display |
| `POST /v1/operator/alert-rules` | Operator | `{id?,expectedVersion,title,category,threshold,windowMinutes,enabled,reason}`; omit `id` and use version 0 to create |
| `GET /v1/operator/alerts` | Reader | `limit,state,before`; `items,nextBefore` |
| `POST /v1/operator/alerts/:id` | Operator | `{expectedVersion,state,reason}`; state `acknowledged` or `resolved` |
| `POST /v1/operator/report` | Reader | `{}`; metadata snapshot and SHA-256 content hash; heavy budget |

Request filters use status `pending,running,completed,denied,indeterminate,output_blocked`. Alert filters accept `all,open,acknowledged,resolved`. Alert `before` is a numeric row boundary, not an authenticated snapshot cursor; tenant authorization is applied independently on every page. See [semantics, privacy and limits](investigation.md).

## Scoped containment and health (0.5)

| Method/path | Role | Input / result |
|---|---|---|
| `GET /v1/operator/containment` | Viewer/operator | Latest records for up to 100 scoped targets and reference limits; no query fields |
| `GET /v1/operator/containment/target` | Viewer/operator | Required query `kind=session\|tool,target`; current record or clear revision 0 |
| `POST /v1/operator/containment/hold` | Operator | `{kind,target,expectedRevision,durationMinutes,reason}` |
| `POST /v1/operator/containment/release` | Operator | `{kind,target,expectedRevision,reason}` |
| `GET /v1/operator/workspace-health` | Viewer/operator | Checks, coverage, generation time and cached audit verification time; no query fields; heavy budget |

Agent credentials cannot use these endpoints. Session targets require tenant ownership; tools must be registered. Reasons are required, 3–500 characters. Durations are integers from 1–1,440 minutes. Revision conflicts return 409, role failures 403, invalid targets/limits 400 and unavailable storage 503. There is no delete operation. GETs do not mutate controls.

New runtime responses use `status: paused`, `retryable: true`, with code `SESSION_QUARANTINED` or `TOOL_PAUSED`, target kind/name, revision and expiry. Preserve the exact original request when retrying. See [overlap, expiry, privacy and diagnostics limits](scoped-containment.md).

## Local AI tasks (0.6)

| Method/path | Role | Behavior |
|---|---|---|
| `GET /v1/operator/agent/config` | Viewer/operator | Non-secret provider/model configuration and limits |
| `POST /v1/operator/agent/check` | Operator | `{}`; checks local model capabilities; heavy budget |
| `POST /v1/operator/agent/runs` | Operator | `{id,prompt}`; creates task and returns 202; heavy budget |
| `GET /v1/operator/agent/runs` | Operator | Up to 25 latest task summaries |
| `GET /v1/operator/agent/runs/:id` | Operator | Redacted conversation, execution metadata, task state and limits |
| `POST /v1/operator/agent/runs/:id/resume` | Operator | `{}`; explicitly resumes retained pending call; heavy budget |
| `POST /v1/operator/agent/runs/:id/cancel` | Operator | `{}`; stops future model/tool work; heavy budget |

Task IDs use existing safe identifier characters with a 96-character cap. Reusing an ID with a changed prompt returns `IDEMPOTENCY_CONFLICT`. The host chooses the runtime principal; the client cannot supply identities, tools, session IDs, provider URLs or model configuration in start requests. States are `queued,running,waiting,completed,stopped,failed`, or `interrupted` for stale active state without a live lease. Missing configuration, provider failures and model limits are explicit error codes. See [local AI setup, recovery and bounds](local-ai.md).

## Conversation features (0.7)

Start now accepts `{id,prompt,toolMode?}`. `toolMode` is `safe` (new default), `chat_only` or `all`; grants are narrowed when the session is created. Start idempotency also binds the mode. Task responses add `revision`, `toolMode`, `allowedTools`, `userMessages` and `usage` with reporting/timing coverage.

| Method/path | Role | Behavior |
|---|---|---|
| `POST /v1/operator/agent/runs/:id/messages` | Operator | `{messageId,prompt,expectedRevision}`; 202 with continued task; heavy budget |
| `POST /v1/operator/agent/runs/:id/export` | Operator | `{format: 'json'\|'markdown'}`; redacted `content`, `contentHash`, `hashAlgorithm`; heavy budget |

Follow-ups preserve the original session and all task budgets and permissions. Only completed, current tasks with remaining turns can continue. New messages with stale revisions return 409. Duplicate message IDs are idempotent only for the same prompt. Bodies cannot change identities, tools or model configuration. Export cannot include system context or raw tool arguments; unsupported formats and unknown fields are rejected. See [semantics and privacy limits](conversations.md).

## Task library and templates (0.8)

All endpoints require operator access. `GET /v1/operator/agent/runs` now accepts `search,state,archive,pinned,limit,offset` and returns `items,total,limit,offset,nextOffset`. Defaults are empty search, all states, active archive view, all pins, limit 25 and offset 0. Limit is 1–100 and offset 0–100. Archive values are `active,archived,all`; pin values are `all,true,false`. Summaries and details add `organization` with independent revision, title, tags, flags and update time.

| Method/path | Body/query | Result |
|---|---|---|
| `POST /v1/operator/agent/runs/:id/organize` | `{expectedRevision,title,tags,pinned,archived}` | Updated encrypted organization; does not update conversation revision |
| `GET /v1/operator/agent/templates` | Optional `enabled=all\|true\|false` | Private redacted templates and limits |
| `GET /v1/operator/agent/templates/:id` | No query fields | One private redacted template |
| `POST /v1/operator/agent/templates` | `{id?,expectedRevision,title,prompt,toolMode,enabled}` | Create/update template; version 0 and no ID create a new record |

These operations use the ordinary API rate budget and never start inference. Unknown fields are rejected. Revision conflicts return 409; invalid input, nonterminal archive attempts and template limits return 400; role failures return 403; corrupt/unavailable storage returns 503. Archived tasks must be restored before new follow-ups. See [search, archive and template semantics](task-library.md).

## Task review (v0.16)

Operator-only POST /v1/operator/agent/plan accepts prompt, optional toolMode and optional taskLimits (the same bounds as task creation). Unknown fields and query parameters are rejected. Returns planHash, redactedPrompt, findings, tools with egress/simulation/approvalRules metadata, taskLimits, effective sessionLimits and advisory capacity/blockers. Successful reviews append agent.planned with hashes, never raw prompts. No session or model call is created.

POST /v1/operator/agent/runs optionally accepts expectedPlanHash. A mismatch returns AGENT_PLAN_CHANGED (409) before session creation. New runs expose planHash. Exact idempotent retries bind to the original stored receipt; receipt-less starts remain supported. GatewayClient.planAgent(input) exposes the review endpoint. See [task review semantics](task-review.md).
