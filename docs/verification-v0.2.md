# Version 0.2 verification

Verified on Windows with Node.js 24.22.0 on 1 November 2026. The earlier [0.1 verification record](verification.md) is retained as historical evidence.

## Completed checks

| Check | Result |
|---|---|
| Full automated suite | **80 passed**, zero failures, zero skipped tests |
| Attack simulations | **10/10** blocked with expected reason codes |
| Syntax and JSON checks | Passed across the JavaScript source and JSON artifacts |
| Offline demo | Passed: isolated computation, policy denial, sanitization, approval, replay and sensitive-egress prevention |
| Existing database upgrade | The running development database opened with the new audit index; automated migration test retained ciphertext state and signed checkpoint |
| Tenant boundaries | Viewer/agent/operator separation, cross-tenant session denial, filter-bound signed cursors, export scoping and note handling covered by automated tests |
| Operational failures | Audit corruption while browsing latches readiness and blocks dispatch; expensive-operation limits return retry guidance |
| SDK | Private credential field, literal query encoding, JSONL response handling, correlation/retry error metadata and invalid-response handling tested |

## Browser checks

The main gateway was inspected through the in-app browser. Authenticated UI tests used `scripts/browser-qa-host.js`, which creates an isolated in-memory gateway and known test-only tokens on loopback port 8788. It does not load `.env`, open the persistent database, or register real external side effects. That disposable host was stopped after testing.

Verified in the browser:

- Sample-mode startup clearly labels isolated data and keeps live mutations disabled.
- Session navigation exposes budgets and provenance; detail dialogs open and close correctly.
- Filtering the audit explorer to denied executions returns only matching events.
- Tool catalog cards render contracts, classification and inspection actions.
- Disposable operator sign-in loads the authenticated workspace.
- Policy validation returns a valid-contract result; sensitive-context preview returns a hard denial with rule explanations.
- An edited hypothetical tool argument survives refresh and navigation.
- A rejected QA request records its note and clears the pending queue.
- Disposable viewer sign-in succeeds; the session-revocation button is disabled.
- The 390px responsive viewport showed no page-wide horizontal overflow. The normal viewport was restored after checking.

No captured browser warnings/errors were observed during the initial console inspection. Browser checks are recorded manual automation, not a claim of a committed cross-browser E2E suite or WCAG certification.

## Interface review

| Principle | Before | After |
|---|---|---|
| Information hierarchy | One long page with a large introductory headline | Six task-specific workspaces with compact headings and contextual actions |
| Investigation | Most recent unfiltered records only | Search, event/time filters, stable pagination, related session details and export |
| Updating numbers | Counters had no explicit alignment behavior | Tabular numerals for metrics, time, quotas and table values |
| Review confirmation | Native generic confirm prompt | Named modal with exact arguments, binding and a required decision note |
| Interaction states | Limited connection/error feedback | Explicit sample/live/viewer modes, loading, empty, error and disabled states |
| Technical density | Full capability JSON dominated session details | Compact grant summary with optional disclosure of full contracts |
| Hit areas and motion | Inconsistent compact targets | Key controls use 40px targets, scoped transitions and reduced-motion support |

## Limits still applicable

Docker/Compose and GitHub/Linux CI were not run locally. No real payment/publication, external notification delivery, enterprise identity, external MCP client compatibility or independent penetration test is represented as completed. The policy studio is hypothetical; it does not authorize execution or publish active policies. See the threat model and control-plane guide.

## Self-evaluation

Summary: **4.2/5** across the five axes. The delivered scope includes working operational features and a complete browser-checked UI upgrade.

| Axis | Score | Evidence / next improvement |
|---|---|---|
| Accuracy | 4/5 | 80 tests and targeted browser checks verify the new boundaries. Container and independent external-client behavior remain unverified. |
| Completeness | 4/5 | All six workspaces, viewer role, investigation APIs, policy studio, durable statistics and SDK are implemented. Active policy rollout remains deliberately host-controlled and documented. |
| Clarity | 4/5 | Sample/live states and preview boundaries are explicit. A user study would further validate terminology for nontechnical operators. |
| Actionability | 5/5 | The local server, generated credentials, sample workspace and documented demo are available immediately; a separate disposable QA host supports repeatable manual checks. |
| Conciseness | 4/5 | Backend features are modular and documented. The dependency-free frontend is still one controller file and could be split as its public interface stabilizes. |

Critical issues scoring 2 or below: none identified within the reference-implementation boundary. Next validation priorities: container/Linux execution, a committed browser E2E suite, and independent assessment with the intended real adapters.

Self-check: the assessment should match the user's experience because the console is immediately explorable and the remaining deployment checks are stated concretely. Verdict: deliver the tested 0.2 reference release.
