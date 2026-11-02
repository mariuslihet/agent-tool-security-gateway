# Version 0.5 verification

Verified locally on Windows with Node.js 24.22.0 on 2 November 2026. Earlier verification records remain historical evidence for their respective versions.

| Check | Result |
|---|---|
| Automated suite | 129 passed; zero failures, skips or cancellations |
| Existing behavior | All 111 previous tests remained passing |
| Attack simulations | 10/10 blocked with expected codes |
| Policy regression CLI | 8/8 cases passed; no tools executed |
| Syntax / JSON | Passed for 52 JavaScript files and JSON artifacts |
| Session quarantine | Parent, child and newly delegated descendants blocked; independent authorized tasks still work |
| Tool holds | Matching tool blocked across tenant tasks; other tools and tenants continue under normal authorization |
| Overlapping containment | Tenant pause, child/ancestor quarantine and tool hold must clear independently |
| Recovery | Expiry, exact-revision renewal/release, cached results, retained approvals and unchanged paused budgets tested |
| Already dispatched work | A reserved operation can finish during quarantine; health distinguishes outstanding reservations |
| Durable state | Private reasons and release notes survive restart encrypted; signed audit history is unchanged on reopen |
| Multiple processes | Another Node process enforces inherited quarantine and a tool hold from the same SQLite database |
| Role / tenant / validation | Viewer and agent writes denied, other tenant session targets hidden, malformed and unregistered targets rejected |
| Failure handling | Required audit failure rolls back placement/release; encrypted row relocation is rejected |
| Bounded behavior | 100-target register cap and renewing an existing target tested; health session sampling reports truncation |
| Health privacy | Pending/expired approvals, uncertainty, configuration changes and containment counted without arguments or outputs; no execution/audit mutation |

## Browser verification

Mutable browser workflows ran against `scripts/browser-qa-host.js`, a disposable in-memory gateway on port 8788 with known fixture tokens and simulated adapters. It never opens `.env` or the persistent database. That host was stopped after testing. The normal gateway was restarted on port 8787 with version 0.5. No live tenant holds or releases were created during browser verification.

Observed results:

- A tool hold review displayed the tenant, registered tool, duration and expected revision before confirmation.
- Confirming the hold created an active register record with expiry, actor and reason.
- A separately reasoned release removed it from the active filter and retained its recorded-target count.
- The session inspector shortcut prefilled the exact session ID and session target type in Safety Controls.
- Session quarantine review and confirmation created an active task record.
- Overview health displayed the pending review and active scoped hold, coverage counts, and investigation links.
- Viewer mode displayed existing records while disabling placement and release controls.
- Reload/source switching cleared the operator connection and form values and returned to isolated sample data.
- Final sample records rendered on port 8787 under version 0.5 with no captured browser warnings/errors.
- The responsive sample register screenshot is `docs/images/scoped-containment-v0.5.jpg`. README remains image-free.

These are targeted interactive browser checks, not a committed cross-browser E2E suite or accessibility certification. Enforcement, expiry, overlap and cross-process behavior were verified by automated tests through the gateway entry point.

## Known limits

Scoped holds require every sharing HTTP/MCP process to run version 0.5 or newer. They do not cancel in-flight operations, undo external effects, prohibit session creation or ban a principal's independent tasks. The reference register permits 100 distinct targets including released/expired records; no automatic deletion is implemented. Health samples at most 100 pending records and 100 sessions and explicitly reports truncation. It is operational diagnostics, not an independent security assessment or proof of complete history. See [semantics and trust boundaries](scoped-containment.md).

## Agent self-evaluation

Summary: **4.0/5** across five quality axes. This score reflects a local implementation review.

| Axis | Score | Evidence and next improvement |
|---|---|---|
| Accuracy | 4/5 | 129 tests, simulations and browser checks passed. Remote Linux CI and independent review were not run in this task. |
| Completeness | 4/5 | Both scoped controls and health work through runtime, API, SDK, sample and UI. Automated browser regression would make interactive checks repeatable. |
| Clarity | 4/5 | Docs distinguish target scope, overlap, expiry, cached results and sampled diagnostics. A compact operational runbook could shorten reference reading. |
| Actionability | 4/5 | Version 0.5 is running locally and inspectors prefill exact targets. Separate gateway/MCP processes still require operator-managed upgrades. |
| Conciseness | 4/5 | Delivery focuses on three additions and verification. Some privacy/recovery constraints repeat across related docs. |

Critical issues (scores ≤2): none.

Top improvements: commit a browser regression suite, run Linux CI, and obtain independent security review before production use.

Self-check: the user can inspect the added controls in the running console and review exact test evidence. Verdict: deliver with the documented operational limits.
