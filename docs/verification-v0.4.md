# Version 0.4 verification

Verified locally on Windows with Node.js 24.22.0 on 2 November 2026. Previous verification documents describe their respective versions.

| Check | Result |
|---|---|
| Automated suite | 111 passed, zero failed, skipped or cancelled |
| Attack simulations | 10/10 blocked with expected codes |
| Policy regression CLI | 8/8 cases passed; no tools executed |
| Syntax and JSON | Passed across 48 JavaScript files and JSON artifacts |
| Existing behavior | All 98 previous tests still passed |
| Request privacy | List/detail exclude arguments/results; inspection requires operator role and a valid reason |
| Request pagination | Tenant/filter-bound authenticated cursors; tampering rejected; insertion ceiling stable |
| Alert behavior | Threshold/window boundaries, replay exclusion, deduplication, version checks, cooldown and rule revisions tested |
| Restart/migration | Request index backfilled without rewriting original encrypted records or signed audit history; rules and encrypted notes survived reopen |
| Failure handling | Audit/projection failures roll back inspection disclosure, rule creation and source evaluation |
| Report privacy | Raw arguments, outputs and custom rule names excluded; canonical content hash reproduced; generation audited |
| API controls | Viewer/agent mutations denied, cross-tenant access hidden, unknown fields rejected, heavy-operation budget enforced |

## Browser checks

Mutating checks used `scripts/browser-qa-host.js`, a disposable in-memory gateway on port 8788 with known test-only tokens and simulated adapters. It never reads `.env` or the persistent database. That host was stopped after verification. The normal server was restarted on port 8787 with the updated code; no live alert rules, dispositions or containment changes were created by browser testing.

Observed outcomes:

- Request Explorer rendered sample records and live disposable records with outcomes and agent/session identifiers.
- Opening a denied request showed its bounded matching timeline without cached outputs or arguments.
- An operator supplied a reason and received stored arguments through the separate audited inspection action.
- A threshold alert appeared for the disposable denied export; acknowledgement updated the displayed state.
- The rule editor saved a new rule and refreshed the configured-rule list.
- Overview completed a workspace JSON download and displayed the audit-generation confirmation.
- Viewer mode displayed metadata but disabled argument inspection, rule creation/editing and alert disposition controls.
- The final version 0.4 sample workspace rendered on port 8787 with no captured browser warnings/errors.
- A screenshot of the responsive alert view was saved to `docs/images/security-alerts-v0.4.jpg`; no image was added to README.

These are targeted browser checks, not an automated cross-browser E2E suite. API tests verify report contents/hash; the browser check verifies the download workflow and confirmation message.

## Limits

Alerts are local, evaluated on new matching events, with counts capped at 1,000. No background timer, external delivery or automated containment is included. Argument redaction is pattern-based and may miss sensitive formats. Derived indexes and report hashes do not prove completeness or authenticity after privileged storage changes. Audit status in a report is cached full-verification state plus a current tail check, not a new full-chain audit. See [detailed semantics](investigation.md).

## Agent self-evaluation

Summary: **4.0/5** across five quality axes. This is an implementation self-review, not an independent security assessment.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | 111 tests and targeted browser checks passed. Add independent review and Linux execution evidence; remote CI was not run during this task. |
| Completeness | 4/5 | Request investigation, local alerts and report export work through backend, client and UI. A committed cross-browser E2E suite would improve repeatability. |
| Clarity | 4/5 | Role boundaries, timing, hash scope and privacy limits are documented. A shorter operator walkthrough could reduce the amount of reference reading. |
| Actionability | 4/5 | Updated server is running and the console exposes the features. Operators still need to choose alert thresholds for their workloads. |
| Conciseness | 4/5 | User-facing delivery focuses on three additions and verification. Existing documentation repeats some role/privacy constraints across guides. |

Critical issues (scores ≤2): none.

Top improvements: committed browser regression coverage, independent security review, and workload-specific alert tuning.

Self-check: the user should be able to verify the added features directly in the running console. Verdict: deliver with the documented limits.
