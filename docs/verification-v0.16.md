# Version 0.16 verification

Verified locally on Windows with Node.js 24.22.0 on 5 November 2026.

| Check | Result |
|---|---|
| Automated suite | 229 passed; no failures, cancellations or skips |
| Syntax / JSON | Passed across 73 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regressions | 8/8 passed |
| Review isolation | No model/tool calls, task records or new sessions; fingerprint-only audit and redacted prompt |
| Receipt binding | Stable identical drafts; changed prompt, mode, budgets, model and policy rejected before session creation |
| Retry behavior | Completed task retries use the original stored receipt without repeating inference |
| Permission and limits | Safe/chat-only grants, outbound simulation/approval metadata, stricter host call ceiling |
| API boundaries | Operator-only, tenant isolation, strict fields/query, stale receipt HTTP 409 and audit-failure HTTP 503 |
| Capacity | Existing live leases reported without reserving or changing locks |

## Interactive browser check

Used a disposable in-memory gateway on port 8788 and the actual local Ollama `qwen3.5:4b` model. Test credentials were isolated from `.env` and the live database.

1. Entered “Use compute.sum to add 13, 21 and 34. Explain the result in one sentence.” and selected **Review task**.
2. Review displayed the three safe tools, selected/effective budgets, no blockers, no findings, a configuration receipt and **0/100 retained tasks**. No task had been started.
3. Selected **Start reviewed task**. Actual inference proposed `compute.sum`; the gateway execution trace recorded successful completion. The displayed model answer was “The sum of 13, 21, and 34 is 68.”
4. Changed the draft mode to all host-granted tools and reviewed again. The review showed both outbound simulation adapters and their potentially applicable approval rules. Retained count remained **1/100**; the second review created no task.
5. Warning/error console log was empty. Screenshot: [task review](images/task-review-v0.16.jpg).

These are targeted interactive checks, not a cross-browser automated suite. The disposable service was stopped and its browser tab closed. The live gateway was restarted only after checking zero active tasks; its console reload showed v0.16.0 and the Review task button. README remains image-free.

## Scope and self-evaluation

Reviews describe configuration and heuristic findings. They do not simulate future arguments, test model reachability, reserve capacity, approve execution or guarantee prompt safety. Receipt hashes are comparison values, not authorization credentials. See [task review semantics](task-review.md).

Self-evaluation: **4.0/5**, implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Automated drift/isolation checks and a real model tool trace support behavior; independent security review remains useful. |
| Completeness | 4/5 | Runtime, API, SDK, UI, tests and guide are implemented; argument-specific preview remains outside scope. |
| Clarity | 4/5 | Advisory capacity, potential approval rules and simulation labels are explicit; grant constraints remain enforced at execution rather than fully visualized. |
| Actionability | 4/5 | Operators can review then start the bound draft; capacity can change after review. |
| Conciseness | 4/5 | One review dialog consolidates metadata; an all-tools configuration still requires scrolling. |

Improvements by impact: add argument-specific policy previews to a future task planner; automate multi-browser review/start checks. Would the user agree? The feature is visible and functional, with an actual Ollama response as evidence. No scores at or below 3 require rework.
