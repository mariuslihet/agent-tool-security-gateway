# Policy comparison, task timeline and diagnostics

These operator services provide evidence and recovery guidance. They never execute or resume a recorded tool request, approve anything, or change a live policy.

## Recorded-request policy comparison

`compareRecordedPolicy(gateway, tenant, {policy,limit:25}, actor)` validates a candidate policy and previews the current and candidate policies against up to 50 recent authenticated tenant request records. Results show each current/proposed decision, code and transformation flag, a changed count, separate historical outcome, and explicit sampling/truncation metadata.

The context is **stored effective arguments**, which may already have been sanitized, the current accumulated session labels and recorded principal/tenant. Preview session counters remain calls=1 and cost=0. Original arguments, exact historical labels/counters and prior registry versions are not reconstructed. Capability, destination, revocation, containment, approval, budget and sequence controls are not replayed. A different preview decision is not proof that the candidate would execute differently in a real session.

No raw arguments, proposed policy body, reviewer identities or tool outputs are returned. The service writes `policy.recorded_compared` before delivery with current/proposed policy hashes, sample/change counts and a report fingerprint. Mandatory audit failure prevents delivery. The comparison never applies the candidate policy.

## Task investigation timeline

`taskTimeline(agentRuntime, tenant, id)` first resolves the tenant-owned task, then joins its authenticated task/session audit events. The latest 100 events are returned in ascending sequence order; `truncated` makes missing earlier history explicit. Event fields are restricted to sequence/event ID, time, type, tool, request ID, status/code, timing and model-turn number when present.

The snapshot includes task revision/state, model-turn/tool totals, usage and gateway trace metadata. Prompts, model answers, arguments, tool outputs, reviewer notes and credentials are omitted. It neither creates an audit event nor invokes inference. Old tasks have aggregate model statistics; individual turn details exist only for events actually recorded by the runtime version used. Timeline timestamps are service audit timestamps; sequence numbers define ordering.

## Operational diagnostics

`operationalDiagnostics({gateway,agentRuntime,workspaceFiles,tenant,actor})` performs a fresh full audit-chain verification, SQLite quick check, configured local model availability check (no chat generation), workspace integrity inventory, and tenant-specific expired/pending approvals, reservations, drift, containment and task lease counts. Each finding has a recovery hint. It does not change leases, clear restrictions, retry operations or repin source files.

The model check has a six-second reporting deadline. The provider's underlying read-only availability request can finish later; this does not invoke tools or inference. Source filenames, raw errors and source contents are not returned. A foreign tenant's workspace adapter is not inspected. Audit and database checks describe the shared service, while approval/request/lease and workspace figures are tenant-scoped. Existing queue/session sampling limits remain explicit in coverage metadata.

`operator.diagnostics` records only the report hash and aggregate health before delivery. Audit corruption and mandatory audit write failure prevent report delivery. Diagnostic results are operational snapshots, not a security assessment or guarantee of future reachability. Reconcile external effects before submitting a new request after an uncertain execution; a diagnostic warning never authorizes automatic retry.
