# Changelog

## 0.16.0 — 2026-11-05

- Added operator-only task review with actual host-grant intersection, selected task/session budgets, advisory capacity blockers and heuristic prompt findings.
- Labeled outbound tools, simulated adapters and potentially applicable approval rules before task creation.
- Bound reviewed starts to prompt/model/policy/registry/profile/budget receipts; stale configurations return AGENT_PLAN_CHANGED (HTTP 409) before session creation.
- Added fingerprint-only review audit events, SDK support and a browser review/start dialog with source-change cleanup and duplicate-start protection.
- Added regression tests for drift, permissions, audit failure, capacity and zero-execution reviews.

## 0.15.0 — 2026-11-05

- Added saved task acceptance checks for final-answer phrases, completed tools, completion state and denied-call traces.
- Added independent review revisions, encrypted storage, mandatory fingerprint-only audit and stale review detection after task changes.
- Added operator check editor, per-rule outcomes, summary badges and JSON snapshot download.
- Added literal/bounded evaluation, tenant/revision/privacy, audit rollback and encrypted-restart tests.

## 0.14.0 — 2026-11-05

- Added operator-only saved-report comparison with added/removed/unchanged lines, source line numbers and byte/text identity indicators.
- Added verified comparison receipts and mandatory metadata-only audit before content delivery.
- Added a plain-text comparison viewer and local snapshot download.
- Added bounded alignment, stale selection, role/tenant isolation, normalization and audit-failure tests.

## 0.13.0 — 2026-11-04

- Added opt-in template fields with bounded literal interpolation and dynamically generated console forms.
- Added revision/enabled checks and mandatory fingerprint-only audit for template loads, including plain templates.
- Preserved legacy literal templates and existing task budgets during prompt preparation.
- Added field syntax, expansion, redaction, ownership, stale form, audit-failure and encrypted restart tests.

## 0.12.0 — 2026-11-04

- Added immutable per-task turn, tool and attempt-time budgets with Standard/Quick/custom controls.
- Added gateway session call attenuation for new tasks, preserving stricter host ceilings and ancestor enforcement.
- Added Workspace read-only mode and template support without report/write capabilities.
- Added budget-bound idempotency, restart compatibility and actual-budget health/inspection.
- Added boundary tests for validation, exhaustion, timeout, approval resume, direct/delegated bypass and read-only authority.

## 0.11.0 — 2026-11-04

- Added operator-only workspace source integrity and saved-report inventory.
- Added plain-text report preview and checksum-verified downloads with mandatory read audit.
- Added stale-hash rejection, bounded directory scans, unsafe-file skipping and byte-exact Unicode/BOM handling.
- Added filesystem and HTTP regression checks for roles, tenant binding, privacy, audit failure and scan limits.

## 0.10.0 — 2026-11-03

- Added real reviewed-document search/read tools with startup-pinned content hashes, byte bounds, literal search and strict flat-file paths.
- Added real local report creation through exact-request approval, exclusive no-overwrite creation and existing provenance/egress controls.
- Added explicit Workspace mode, retaining original Safe mode permissions.
- Added persisted activity phases for model generation, tool evaluation/execution and operator waiting, refreshed during active tasks.
- Added filesystem, junction, hard-link, content-change and approval/resume regression checks and disposable workspace browser QA.

## 0.9.0 — 2026-11-03

- Added operator-only task health diagnostics: budgets, session expiry, follow-up blockers, tool restrictions and pending approvals.
- Added a read-only console panel and client method with explicit snapshot semantics.
- Added original-prompt reuse into a fresh form with safe tools selected and explicit submission.
- Added privacy, authorization, expiry, revocation, archive, budget, quarantine, pause and approval-expiry regression coverage.

## 0.8.0 — 2026-11-03

- Added encrypted task titles, tags, pins and reversible archiving, with independent metadata revisions and hashed audit evidence.
- Added task-history search, state/archive/pin filters, pin-first recent ordering and bounded pagination across retained tasks.
- Added encrypted prompt templates with tool-mode selection, revision-checked editing and enable/disable controls; loading never submits a task automatically.
- Kept organization separate from conversation updates so model state cannot overwrite operator labels. Archived tasks must be restored before continuation; running/waiting work cannot be archived.
- Added operator-only library/template APIs, client methods, persistence coverage, validation, isolation and rollback tests.

## 0.7.0 — 2026-11-03

- Added follow-up messages in a completed AI task, retaining conversation context, the gateway session, capabilities, provenance and cumulative task budgets.
- Added revision-checked, idempotent follow-up requests, shared worker leases and authenticated operator attribution in follow-up/export audit records.
- Added per-task safe, chat-only and all-host-granted tool modes. New tasks default to safe tools; chat-only sessions are created with zero tool capabilities.
- Added Ollama token/duration statistics and measured local request time, with explicit coverage for missing and historical metrics.
- Added audited, redacted JSON/Markdown conversation exports with byte-verifiable SHA-256 hashes. Markdown conversation text is fenced as untrusted data.
- Extended the console, control-plane client, API authorization tests, legacy-task restart coverage and task permission tests.

## 0.6.0 — 2026-11-02

- Added real local Ollama generation with native function-tool calling and model capability checks. No canned model answers or cloud API keys.
- Added an AI Agent workspace with task submission, generated conversation, execution trace, history, model connectivity check, explicit resume and stop.
- Routed every model-proposed call through the existing gateway; persisted exact arguments and IDs before dispatch, with shared execution leases and bounded turns/calls.
- Added encrypted task state, operator-only conversation access, tenant isolation, metadata-only audit events and sensitive/untrusted result withholding from model context.
- Added an optional real local-model smoke command, provider boundary tests and agent-loop/API tests. Existing tool fixture/simulation behavior remains explicit.

## 0.5.0 — 2026-11-02

- Added expiring quarantine for a session and all descendants, and tenant-scoped temporary holds on individual registered tools.
- Enforced scoped holds inside the shared SQLite reservation transaction, preserving cached results, pending approvals and budgets; overlapping holds remain independently effective.
- Added encrypted containment reasons, audited revisions, exact-revision release, automatic expiry, target limits and operator-only mutation APIs.
- Added Safety Controls forms, confirmation dialogs, hold register filters and session/tool inspector shortcuts.
- Added read-only workspace health checks for approvals, uncertain execution, reservations, sampled configuration drift and scoped containment, with explicit coverage and no tool payload disclosure.
- Extended the client, metadata report, isolated sample and persistence/multi-process tests.

## 0.4.0 — 2026-11-02

- Added a request explorer with status, tool and literal identifier search, authenticated pagination and bounded request timelines.
- Added explicit operator-only argument inspection with a mandatory audited reason, pattern redaction and no cached output disclosure.
- Added encrypted local threshold rules for denials, uncertain execution, human review and paused attempts; deduplicated alerts, encrypted notes, version checks and reopening cooldowns.
- Added metadata-only workspace reports with configuration hashes, operational counts, containment and cached audit status; generation is audited and separately rate-limited.
- Extended the JavaScript client, isolated preview and ten-page console. Existing request records gain a metadata index on startup without rewriting encrypted records or signed audit history.
- Added authorization, tenant isolation, migration, encryption, cursor, cooldown, integrity and rollback coverage.

## 0.3.0 — 2026-11-02

- Added an incident center for selected high-risk denials, idempotency conflicts and uncertain executions, with occurrence grouping, source-event links and recurrence reopening.
- Added tenant-isolated, encrypted investigation notes, owner labels and version-checked open/acknowledged/resolved dispositions.
- Added operator-controlled temporary pauses for all or outbound tools, automatic expiry and exact-revision resume; execution reservations check the shared state transactionally.
- Preserved approvals and call/cost budgets during paused attempts; cached outcomes remain readable subject to normal session checks.
- Added bounded batch policy suites with expected decisions/reason codes, downloadable reports, policy/suite hashes and an offline regression command in CI.
- Extended the control-plane client, sample workspace and disposable browser QA fixtures.
- Added persistence, multi-process, API authorization and rollback tests for the new boundaries.

## 0.2.0 — 2026-11-01

- Replaced the single dashboard with six operator workspaces, a responsive navigation system, accessible detail/review dialogs, keyboard quick navigation, and dark/light themes.
- Added an isolated, clearly labeled sample workspace that does not read live configuration or state.
- Added durable tenant statistics and a 24-hour activity chart backed by an indexed audit projection.
- Added authenticated snapshot cursors for audit/session pagination, literal metadata search, event/time filters, and bounded JSONL export with continuation manifests.
- Added session capability/budget/provenance inspection and contextual session/tool revocation.
- Added read-only viewer credentials and server-enforced role separation.
- Added encrypted reviewer notes, note fingerprints in audit, and decision timestamps.
- Added policy contract diagnostics and rule-by-rule hypothetical comparison, without a policy activation or execution endpoint.
- Added readiness checks, correlation IDs, retry/rate-limit headers and separate heavy-operation limits.
- Added a control-plane client, private SDK credential storage and structured API errors.
- Added backwards-compatible audit-index migration and regression coverage for the new boundaries.

## 0.1.0 — 2026-11-01

Initial deterministic enforcement core, strict tool contracts, scoped capabilities, persistent exact-request approvals, session-tree provenance, budgets, encrypted SQLite state, authenticated audit chain, adapters, HTTP/MCP interfaces, telemetry hooks and attack simulations.
