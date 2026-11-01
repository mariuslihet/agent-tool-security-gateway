# Changelog

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
