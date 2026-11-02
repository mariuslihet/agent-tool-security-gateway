# Version 0.3 verification

Verified locally on Windows with Node.js 24.22.0 on 2 November 2026. Earlier version records remain historical evidence, not current test counts.

## Completed checks

| Check | Result |
|---|---|
| Automated suite | 98 tests passed; zero failures or skipped tests |
| Attack simulations | 10/10 blocked with expected reason codes |
| Policy regression CLI | 8/8 hypothetical cases passed; no tools executed |
| Syntax / JSON validation | Passed across 44 JavaScript files and JSON artifacts |
| Persistence | Incident notes and pause reasons survived restart encrypted; original audit chain verified |
| Multi-process enforcement | A separate Node process read the shared pause before reserving a tool; calls remained unspent |
| Role isolation | Viewer/agent mutations rejected; cross-tenant incident and safety access isolated |
| Concurrency / rollback | Stale revisions return conflict; audit/projection failure rolls back containment/source state |
| Source continuity | Paused approved requests retain approval for a later exact retry; resume retains provenance, revocation and policy denials |

## Browser verification

Authenticated UI checks ran against `scripts/browser-qa-host.js`: an in-memory demonstration gateway with known disposable fixture credentials, no `.env` access, and no real external side effects. The live persistent gateway was not paused or resumed during these tests.

Observed outcomes:

- Incident center rendered grouped sample records and live disposable records.
- An incident could be opened, acknowledged, assigned an owner label and given an investigation note; the list and counts updated.
- The pause confirmation displayed the exact scope, duration and tenant before submission.
- The disposable tenant entered an all-tool pause and returned to normal authorization after a separately confirmed resume.
- Viewer mode disabled both pause and resume controls.
- The browser regression suite reported eight passes and no execution.
- Editing the suite invalidated the previous report and disabled download.
- No captured browser warnings or errors were reported during the regression workflow.

These are targeted browser checks, not a committed cross-browser E2E suite or accessibility certification.

## Boundaries retained

Incident severity is a fixed operational priority, not a determination of malicious intent. Incident resolution does not change authority. Pauses apply to new reservations in upgraded processes; they do not cancel already dispatched work or control old executables. Suites remain hypothetical and omit live capability/budget/containment checks. External incident delivery, automatic remediation, distributed coordination, Docker execution and GitHub/Linux CI have not been represented as verified here.

## Self-evaluation

Summary: **4.2/5** across the five axes; three connected operational features are implemented and tested.

| Axis | Score | Evidence / next improvement |
|---|---|---|
| Accuracy | 4/5 | 98 automated checks, CLI results and targeted browser outcomes support the stated behavior. Independent deployment/security validation remains outstanding. |
| Completeness | 4/5 | Incident workflows, cross-process temporary containment and policy suites include API, SDK, UI, sample data and docs. Incident delivery and remediation remain explicit non-features. |
| Clarity | 4/5 | The console separates incident disposition from containment; documentation states pause and suite limits. Operator usability research has not been performed. |
| Actionability | 5/5 | The sample workspace exposes the new features immediately; local credentials and executable CLI cases are available. |
| Conciseness | 4/5 | Operational logic and UI are separated from the core controller. The frontend still shares controller helpers through classic-script scope; an ESM split is a future maintainability improvement. |

Critical issues scoring 2 or below: none identified within the reference-implementation boundary. Next priorities: a committed browser E2E suite, container/Linux validation, and deployment review with real adapters.

Self-check: this assessment should match the delivered result because the workflows were exercised end to end, while unverified deployment claims are excluded. Verdict: deliver version 0.3 as a tested reference implementation.
