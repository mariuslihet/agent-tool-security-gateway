# Changelog

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
