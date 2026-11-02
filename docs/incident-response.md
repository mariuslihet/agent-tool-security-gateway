# Incident response, containment and regression

Version 0.3 adds operational workflows around the existing enforcement boundary. It does not claim to identify every attack, cancel every external operation, or provide a production security certification.

Version 0.5 also supports [session quarantine, individual tool holds and workspace health](scoped-containment.md). Upgrade all HTTP/MCP processes to 0.5 or newer before relying on those scoped controls.

## Incident lifecycle

The runtime creates incidents for selected source events:

| Signal | Severity label |
|---|---|
| Sensitive data or detected credentials blocked from egress | High |
| Personal data or an untrusted-source sequence blocked from egress | Medium |
| Tool timeout or uncertain external effect | High |
| Existing request ID reused with different tool arguments | High |

These labels are fixed operational priorities, not proof of malicious intent. Other policy denials remain in audit history without automatically becoming incidents.

Grouping uses tenant, session, tool and reason code. Repeated **new evaluations** increment occurrences; cached retries do not inflate them. A new matching signal reopens a resolved incident. Source events and incident changes are committed in the same transaction. Failure to persist a required incident rolls back that evaluation; it does not authorize a denied tool.

Incident states are `open`, `acknowledged` and `resolved`. Operators can change disposition, record an owner label and add a note. Owner labels are organizational metadata, not identity grants or notifications. Viewers can inspect records but cannot modify them. Notes are encrypted and redacted for display; audit records contain note fingerprints. The record retains the newest 20 notes and signals when older note text has rolled off; their audit fingerprints remain.

Every update requires `expectedVersion`. Concurrent observations or another operator's update advance the version; stale changes return HTTP 409 `VERSION_CONFLICT`. The console asks the operator to reopen the latest record rather than silently overwriting it.

Incidents begin with signals observed after the upgrade. Existing audit history is retained, but historical events are not automatically reclassified into incident records.

## Temporary containment

Operators can pause **all tools** or **outbound tools** for 1–1,440 minutes. The console offers 15, 30, 60 and 240 minutes. Activation and resume require an operator reason and the exact current revision.

The encrypted pause lives in the same SQLite database as reservations. Every new matching reservation, including an approved request retry, checks it inside the reservation transaction. Processes sharing that database observe the same pause. Independent databases and tools reachable outside the gateway are outside this mechanism.

Upgrade and restart **all** HTTP and MCP gateway processes to version 0.3 or newer before relying on containment. Older running processes do not implement this new check; sharing a database does not retrofit enforcement into an older executable.

Agents receive:

```json
{"status":"paused","code":"TENANT_PAUSED","retryable":true,"scope":"outbound","expires":1790000000000}
```

Paused attempts do not reserve execution, spend call/cost budgets, or consume approval tokens. Pause events are still audited and HTTP request limits still apply. A pause does not create an execution/idempotency record for a previously unseen request. The trusted runtime should keep the original request ID and arguments for a later retry; already-persisted requests still reject argument changes.

Expiry is evaluated when the gateway checks the pause; no background job is required. Resume removes only this temporary restriction. It does not clear revocations, provenance, expired sessions, policy denials, budgets or uncertain-execution records. Cached results remain subject to normal ownership/session checks.

**Already reserved operations may still complete.** A pause is containment for new reservations, not cancellation or rollback of in-flight side effects. Resolving an incident does not resume tools automatically. Conversely, resuming does not resolve incidents automatically.

## API

All endpoints are tenant-scoped through authenticated credentials.

| Method | Path | Access |
|---|---|---|
| GET | `/v1/operator/incidents?state=all&limit=25&before=...` | Viewer/operator |
| GET | `/v1/operator/incidents/:id` | Viewer/operator |
| POST | `/v1/operator/incidents/:id` | Operator |
| GET | `/v1/operator/safety` | Viewer/operator |
| POST | `/v1/operator/safety/pause` | Operator |
| POST | `/v1/operator/safety/resume` | Operator |
| POST | `/v1/operator/policy/suite` | Viewer/operator |

Incident list limits are 1–100. `before` is a bounded row anchor for newest-first **first-seen** records, not a signed audit cursor. Changing disposition does not move an incident to another page. Search in the console filters the current page. Counts and full records remain tenant-isolated.

Update example:

```json
{"expectedVersion":1,"state":"acknowledged","owner":"security-team","reason":"Reviewing the source event and data-flow context."}
```

Pause example:

```json
{"expectedRevision":0,"scope":"outbound","durationMinutes":30,"reason":"Investigating unexpected outbound requests."}
```

Resume example:

```json
{"expectedRevision":1,"reason":"Containment review complete; retain all other controls."}
```

Do not automatically retry administrative changes after a timeout or 409; fetch the latest state and review it first.

## Policy regression suites

The policy studio accepts a JSON array of 1–50 cases, bounded to 64 KiB in total. Each case has a unique ID, tool, arguments, optional hypothetical labels/principal and an expected decision with optional reason code:

```json
[
  {
    "id":"sensitive-export",
    "tool":"report.publish",
    "arguments":{"url":"https://reports.example.com/daily","body":"Synthetic summary"},
    "labels":["sensitive"],
    "expected":{"decision":"deny","code":"SENSITIVE_EGRESS_DENIED"}
  }
]
```

Results contain pass/fail counts, observed decision/reason codes, transformation flags, inspection codes, `policyHash`, `suiteHash` and generation time. Reports omit the original raw arguments. Editing a suite or candidate invalidates the console's previous downloadable report.

Like single-call preview, suites do **not** evaluate actual task capabilities, budgets, revocations, live containment or concurrency, and do not execute tools. Passing cases are not execution authority or a complete security assessment. No task, approval, incident or audit mutation is performed by the suite itself.

The offline regression command runs the committed eight-case suite against the baseline policy, or an explicitly supplied candidate file:

```sh
npm run policy:test
npm run policy:test -- path/to/candidate-policy.json
```

The command exits nonzero when a case fails or input is invalid. The GitHub workflow runs it alongside the regular tests and attack simulations.

## Client library

`ControlPlaneClient` adds `incidents`, `incident`, `updateIncident`, `safety`, `pause`, `resume` and `runPolicySuite`. Roles are enforced by the server. Source-observation hooks and service objects are privileged host APIs; do not expose them directly as model tools.

## Persistence and limitations

The upgrade creates separate incident and containment tables without rewriting existing signed audit events or encrypted request records. Operator notes/reasons use the existing AES-GCM storage key; dispositions and revisions are transactionally audited. Existing backup, master-key and external-checkpoint requirements still apply.

This release does not add an alert-delivery service, automatic incident remediation, identity-directory assignment, distributed cross-host coordination or retention automation. The existing approval webhook is still for approvals; incident notifications are not silently sent to outside services.
