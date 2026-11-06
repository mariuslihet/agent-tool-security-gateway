# Version 0.18 verification

Verified locally on Windows with Node.js 24.22.0 on 6 November 2026.

| Check | Result |
|---|---|
| Automated suite | 274 passed, zero failures, cancellations or skips |
| Syntax / JSON | Passed across 86 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regression | 8/8 passed |
| Read-only connectors | Actual SQLite reads, bound injection strings, public opt-in, default sensitive classification, fixed SQL, process deadlines, output/row limits, file identity checks and denied gateway DB |
| Evaluations | Sequential real tasks, immutable suite snapshots, revisions, limits, idempotence, pass/fail comparison and numeric usage metrics |
| Cancellation / recovery | Interleaved cancellation before dispatch, latest child pointer, child-stop retry, stale configuration receipts, expired leases, no auto-resume and atomic model audit failures |
| Backup / CLI | Actual create → verify → new-file restore; WAL snapshot, encryption, tampering, wrong recovery secrets, no overwrites/sidecars, missing source and audit-failure cleanup |
| Operator APIs | Strict body/query validation, role and tenant checks, metadata-only inspection and audit-before-delivery |

## Actual model and browser evidence

Used a disposable in-memory gateway on port 8788 and the actual local Ollama `qwen3.5:4b` model. A newly generated SQLite database contained explicitly labeled example inventory data; no external business service or private database was connected. The QA service never read `.env` or the live gateway database. Its heavy-operation allowance was raised for the interactive verification workflow; production defaults were unchanged.

1. Saved a two-case suite through the visual editor. Saving did not generate a response. Case one used `database.inventory` for SKU A1 and required numeric `stock=24`. Case two used `compute.sum` for 10+20 and required numeric `total=30`.
2. Started the suite twice. All four actual model tasks completed and both runs passed **2/2** cases. Traces showed successful database/calculation calls; these were real worker executions over example data.
3. Compared the two runs. The same-suite snapshot was recognized, both cases stayed pass → pass, and numeric provider usage was shown (1618 → 1618 and 1323 → 1323 tokens for this run). [Evaluation screenshot](images/evaluations-v0.18.jpg).
4. Opened a database case task and inspected its timeline. Two authenticated model-turn events bracketed the actual database execution, with recorded durations and navigation links. [Timeline screenshot](images/task-timeline-v0.18.jpg).
5. Ran operational diagnostics. Fresh audit verification, SQLite health and model availability reported `AUDIT_VERIFIED`, `DATABASE_OK` and `MODEL_READY`; approval/lease checks and recovery guidance were displayed.
6. Drafted a candidate policy denying the two read tools. The recorded comparison sampled seven requests and reported **four changed** allow → deny decisions, while historical outcomes stayed separately labeled. The active policy was not applied and no tool was replayed. [Policy comparison screenshot](images/policy-comparison-v0.18.jpg).
7. Browser warning/error logs were empty. Temporary fixture credentials, QA state and the fixture database were isolated from live state. The QA tab/service were closed after verification; the local main service was restarted only after verifying zero active tasks.

The interactive checks are targeted browser verification, not an automated cross-browser suite. README remains image-free. The main service does not silently enable the example connector: host configuration is required to connect an actual chosen database.

## Review and practical limits

Feature implementation and security review were divided across isolated file owners. Review found and fixed a cross-process cancellation race, a stale child-task pointer, model-event audit atomicity and numeric token counters incorrectly caught by broad credential-key redaction. Regression tests reproduce those paths. A canceled dispatch can still leave an unused session from the runtime's existing session-before-schedule flow; it creates no task or inference.

Backups contain the whole service database across tenants and remain host-only. Restore writes a new database, clears execution leases, retains old approvals/reservations and never auto-runs them. Reconcile recovered state before manually enabling execution. Read-only SQLite connectors require host-reviewed queries and protected parent directories; they are not a general SQL shell. Recorded policy comparisons use effective stored arguments and current accumulated labels, not a reconstruction of all historical authorization inputs.

Self-evaluation summary: **4.0/5** across five axes; implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Automated boundary/recovery tests and actual browser/model evidence support all six features; independent assessment remains useful. |
| Completeness | 4/5 | Backend, console, SDK/CLI, guides and regression tests cover the approved scope; the real connector currently targets SQLite rather than every service type. |
| Clarity | 4/5 | Explicit simulation/example labels, read-only modes, recovery guidance and expected/actual checks explain scope; advanced suite criteria still use JSON for complex rules. |
| Actionability | 4/5 | Operators can run/compare suites and inspect diagnostics immediately; a chosen business database still requires host configuration. |
| Conciseness | 4/5 | Related features share existing workflows and guides; large suites and event histories still require scrolling. |

Improvements by impact: automate the full browser workflow; add carefully scoped read-only HTTP connectors; add a simpler visual editor for complex suite criteria. Would the user agree? All six requested capabilities are implemented and the main workflow was verified with real local inference. Critical issues: none outstanding. Verdict: deliver with the documented host setup and recovery limits.
