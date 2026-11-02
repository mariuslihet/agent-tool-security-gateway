# Scoped containment and workspace health

Version 0.5 adds session-tree quarantine, temporary holds on registered tools, and read-only operational diagnostics. These use existing tenant credentials, encrypted SQLite storage and mandatory audit records. No external service or notification destination is involved.

## Choose the smallest affected scope

| Control | Applies to | Agent outcome |
|---|---|---|
| Tenant pause | All tools or outbound tools in one tenant | `TENANT_PAUSED` |
| Session quarantine | One session and its current/future descendants | `SESSION_QUARANTINED` |
| Tool hold | One registered tool in every session of one tenant | `TOOL_PAUSED` |

Scoped holds are checked inside the same SQLite write transaction that reserves execution. Session lineage is validated by the gateway before the containment service receives it. A hold is never inferred from model-supplied labels or context. Other processes sharing the database enforce it when they reserve work, provided **all HTTP and MCP processes have been upgraded to 0.5 or newer**. Independent databases and tool paths outside this gateway are outside this mechanism.

For new or pending calls, a tenant pause takes precedence, followed by the closest quarantined session/ancestor, then a matching tool hold. Every applicable hold must clear before matching new work can proceed. Releasing a child hold cannot bypass a parent quarantine; releasing a tool hold cannot bypass a tenant pause. Policy, capabilities, revocation, data lineage and normal resource checks remain effective after release.

Paused attempts return a structured response:

```json
{
  "status": "paused",
  "code": "SESSION_QUARANTINED",
  "kind": "session",
  "target": "quarantined-session-id",
  "revision": 1,
  "expires": 1790000000000,
  "retryable": true
}
```

The trusted runtime should retain the original request ID, session and arguments and retry after operator release or expiry. Do not repeatedly generate new IDs or treat a pause as approval. A pause does not automatically run anything when it expires. Previously unseen paused requests do not gain execution/idempotency records; their pause attempts remain in audit. Pending approvals keep their existing binding and expiry and are not consumed during a hold. Already persisted requests still reject changed arguments.

Cached completed outcomes remain available after normal identity/session checks. A hold does not cancel dispatched operations, retract results, undo external effects, or prevent session creation. Descendants created during quarantine remain blocked through inherited lineage. An agent can still use an independent task if its existing credentials/profile authorize it: session quarantine is not a principal-wide ban. Use tenant containment or permanent revocation when that scope is required.

## Operator workflow and boundaries

Safety Controls provides the scoped form and hold register. Session details and tool contracts include shortcuts that prefill the exact target. Review displays the tenant, target, duration and expected revision before submission. Placement and release require a reason of 3–500 characters. A viewer can inspect holds and diagnostics but cannot mutate them; agent credentials cannot access these control-plane endpoints.

The boundary is `operator credential → strict body validation → tenant/target ownership and revision validation → encrypted write + audit in one transaction`. A session target must belong to the authenticated tenant; a tool must be registered. Unknown fields and malformed targets are rejected. `expectedRevision` starts at 0 for a new target and advances on each placement or release. Stale changes return HTTP 409 `VERSION_CONFLICT`; refresh and review again. A renewed hold replaces that target's latest record while its signed audit history remains.

Holds expire after 1–1,440 minutes; the console offers 15, 30, 60 and 240 minutes. Expiry is evaluated at reservation/read time without a background timer. The reference deployment permits **100 distinct recorded targets per tenant**, including expired/released targets; an existing target can always be renewed within that bound. These are explicit reference limits in `CONTAINMENT_LIMITS`, not guarantees of suitability for every workload. There is no automatic deletion or retention cleanup API. The register shows the latest encrypted state per target; older revisions remain as audit metadata.

Reasons are encrypted, redacted for display and fingerprinted in audit. Audit records include actor, target, revision, expiry and reason hash, with no raw reason text. Failure of the required audit append rolls back placement or release. Existing holds are not silently removed on read errors. Hosts must protect the storage key/database and keep clocks synchronized; privileged deletion of state or running an older gateway can bypass application-level holds.

## Operational health

Overview now shows eight checks:

- Audit availability: cached full-chain verification plus a current tail check. A corrupt/unavailable store returns an error instead of a healthy panel.
- Pending human review and expired approval records, sampled from the latest 100 pending request records.
- Uncertain executions and outstanding reservations, counted from the tenant's request index. Running records include valid work in progress and interrupted reservations; this is not a stuck-process detector.
- Changed configuration among the latest 100 session summaries. This checks current bindings and does not discover changes outside the gateway.
- Active scoped holds and the number of enabled local alert rules. Tenant-wide pauses retain their separate Safety Controls status.

Coverage explicitly reports sample sizes and truncation. A zero count in a sampled check does not prove that no older matching record exists. Counts from derived indexes do not independently establish completeness after privileged database modification. Diagnostics omit arguments, results, session IDs and operator reasons and do not mutate execution state or append audit records. They are not a security certification.

The browser refreshes health at most once a minute during ordinary overview refreshes, with a separate manual Check Health action and refresh on navigation. API health checks share the default six-per-minute heavy-operation budget with exports, inspections and full-chain verification. The panel clears old checks if a request fails. A rate-limit response does not mean the gateway is unhealthy; wait and retry.

Workspace reports include scoped active/total target counts, without targets or reasons. Session summaries expose inherited session quarantine as separate metadata; status, capabilities and revocation retain their existing meaning.

## JavaScript control-plane client

```js
const current = await control.containmentTarget('tool', 'knowledge.read');
const held = await control.holdTarget({
  kind: 'tool', target: 'knowledge.read', expectedRevision: current.revision,
  durationMinutes: 15, reason: 'Investigate a downstream adapter incident'
});
const register = await control.containment();
const health = await control.workspaceHealth();
await control.releaseTarget({
  kind: held.kind, target: held.target, expectedRevision: held.revision,
  reason: 'Adapter verified; normal authorization can resume'
});
```

For session quarantine, use `kind: 'session'` with the exact session ID. Client methods never automatically retry a conflicting mutation.
