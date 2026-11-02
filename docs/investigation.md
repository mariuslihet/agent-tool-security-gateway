# Investigation, alerts and workspace reports

Version 0.4 adds two console workspaces and a report download on Overview. Live access uses the same tenant-bound viewer/operator credentials as the rest of the control plane. No external notification destination is configured or contacted by these features.

## Request explorer

Search persisted requests by literal request ID, session ID or principal; filter by status and registered tool. Pages contain up to 100 records (the browser uses 25). Signed cursors bind the tenant, filters and insertion ceiling; later inserts are excluded. Request statuses remain current, so a status-filtered page can change as existing operations finish.

Ordinary list/detail responses contain explicit metadata, configuration binding hashes, approval disposition and a recent timeline capped at 100 matching audit records. They exclude arguments and cached tool results. Requests rejected before persistence and attempts blocked by containment may only appear in Audit Explorer. The request index is built automatically for existing encrypted requests at startup.

Operators can inspect **stored arguments** through a separate POST endpoint. A reason of 3–500 characters is required. The audit append and lookup occur transactionally before a response is returned; audit failure prevents disclosure. The reason is fingerprinted in audit, not stored as cleartext. Pattern redaction removes known secret/email formats but can miss unknown sensitive formats. Arguments may already have been transformed by policy; original pre-transformation payloads are not reconstructed. Tool outputs are never returned by this interface. Existing approval-review APIs retain their separate, redacted argument-review behavior.

The browser clears inspected arguments on dialog close or workspace switch, and never stores them in browser storage. The application cannot retract data already delivered to an authorized operator or retained by browser/developer tools.

## Local threshold alerts

Operators create or revise up to 20 rules per tenant. Viewers can read rules and alerts. Rules have a name, enabled flag, threshold from 1–1,000 events and rolling window from 1–1,440 minutes. Every mutation requires a reason; revisions and dispositions use optimistic version checks.

| Category | Gateway events counted |
|---|---|
| `denials` | `execution.denied`, `request.rejected` |
| `uncertain` | `execution.uncertain` |
| `reviews` | `approval.required` |
| `paused` | `execution.paused` |

Rules are evaluated when a **new matching gateway event** arrives. Existing events inside the window are included on that evaluation. Cached replay events are excluded; a new rejected evaluation can count. Rules do not run on a background timer and do not retroactively create alerts immediately upon configuration. Counts are capped at the most recent 1,000 matching events. Matched audit envelopes are authenticated before use.

Each rule revision has one alert record, updated while open or acknowledged. Resolution suppresses reopening for one full rule window starting at resolution. After that, a qualifying new event can reopen it. Editing a rule creates a new revision with its own alert record; disabling it stops new observations without deleting history. Acknowledgement does not suppress subsequent observations. New observations advance the version, so a concurrent disposition can return `VERSION_CONFLICT`; refresh and review before retrying.

Rules and alert records (including at most 20 recent notes) are encrypted with the existing storage key. Custom rule names and reasons are fingerprinted in audit. Alert projection and source evaluation share a database transaction: failures roll back instead of bypassing mandatory records. Source event clocks follow the gateway's host-supplied clock; keep host clocks synchronized across processes.

Live tenants start with **no rules**. The public sample and disposable browser QA host explicitly create demonstration rules in memory. Alerts remain in-app; no email, Slack or webhook delivery is part of this feature. Alert disposition does not approve tools, resume containment or change any policy.

## Workspace report

Overview downloads a JSON metadata snapshot containing tenant-scoped durable totals, request-state counts, incident/alert counts, registered tool metadata, policy/registry fingerprints and temporary containment status. Arguments, results, notes, custom rule names, credentials and full policy documents are excluded. Tenant IDs and registered tool names remain operational metadata; review a report before sharing it.

Generation runs inside a SQLite transaction and appends `workspace.report_generated` with its hash. The snapshot describes the state before that append. `reportHash` is SHA-256 over the project's canonical JSON representation of all fields except `reportHash` and `hashAlgorithm`. It is an unkeyed content checksum, not a digital signature or proof of authenticity. The public sample wraps this envelope in `{ "sample": true, "report": ... }`; the hash is verified against the nested report.

Audit status reports the last full-chain verification state plus a current tail check. Exporting does not perform a new full-chain verification. Use the separate verification control for that operation. Reports are operational snapshots, not security certifications or proof of complete history. Derived indexes/counts are not independently signed snapshots and cannot establish completeness after a privileged database modification.

Reports and argument inspections share the existing separate heavy-operation budget (default six per credential per minute), in addition to normal API limits. Both use POST; read-only viewer credentials can generate reports but cannot inspect arguments.

## JavaScript client

```js
const page = await control.requests({ status: 'denied', limit: 25 });
const item = page.items[0];
const detail = await control.requestDetail(item.sessionId, item.requestId);
// Requires an operator credential and records an audit event:
const inspected = await control.inspectArguments(item.sessionId, item.requestId, 'Investigate denied destination');
const rules = await control.alertRules();
const alerts = await control.alerts({ state: 'open' });
const snapshot = await control.workspaceReport();
```

Other client methods are `configureAlert(input)` and `updateAlert(id, input)`. API shapes are listed in [API reference](api.md).
