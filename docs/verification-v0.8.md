# Version 0.8 verification

Verified locally on Windows with Node.js 24.22.0 on 3 November 2026.

| Check | Result |
|---|---|
| Automated suite | 167 passed; zero failures or skips |
| Syntax and JSON | Passed across 61 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 blocked with expected codes |
| Policy regression CLI | 8/8 passed |
| Organization | Independent encrypted revisions, tenant ownership, validation, concurrent model updates and audit rollback tested |
| Archive | Active tasks rejected; terminal tasks hidden, restored with original session, grants and budgets |
| Discovery | Literal search, pin ordering, bounded pagination and tenant isolation tested |
| Templates | Encryption, redaction, revision conflicts, disabled state, 25-record cap, strict API roles and no automatic execution tested |
| Persistence | Task organization and disabled templates survive encrypted database reopen |

## Actual local model and browser

The disposable in-memory host on port 8788 ran with `GATEWAY_QA_REAL_LLM=1` using the installed local `qwen3.5:4b` model. It did not read `.env` or persistent gateway storage.

1. Saved an enabled **Arithmetic review** template in safe mode. The console confirmed that no task was started; the task library remained empty.
2. Loaded the template into the new-task form. Loading did not start generation.
3. Explicitly started the prompt: “Use compute.sum to add 12, 18 and 20. Give the result in one sentence.”
4. The actual model returned “The sum of 12, 18, and 20 is 50.” The gateway trace recorded one completed `compute.sum` call across two model turns.
5. Renamed the task **Arithmetic review**, added `math, review`, and pinned it. The conversation retained its original session and safe grants.
6. Archived it. The active library showed zero matches, and the selected conversation disabled follow-ups with a restore instruction.
7. Switched to archived tasks and found the retained task. Restored it, then searched the active library for `math`; the pinned completed task appeared and follow-ups were enabled again.
8. The browser reported no warning/error console entries during these checks.

Screenshot: [task library and templates](images/task-library-v0.8.jpg). README remains image-free. These are targeted interactive checks, not a committed cross-browser E2E suite.

## Limits and review

Archives preserve data and count toward the existing 100-task allowance. Templates retain at most 25 records, including disabled records; deletion is not provided. Search covers metadata, not private conversation bodies. Offset pagination can shift as records change. Pattern redaction is not a complete secret detector. Templates are starting points and cannot change an existing task's grants. See [task library semantics](task-library.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Automated tests and actual local generation support the behavior; independent security review remains useful. |
| Completeness | 4/5 | Storage, runtime, API, SDK, UI and documentation cover the additions; automated browser regression would improve repeatability. |
| Clarity | 4/5 | Archive and template execution semantics appear in the console and guide; a short onboarding walkthrough could help. |
| Actionability | 4/5 | Real local model workflow exercised end to end; retention remains intentionally bounded. |
| Conciseness | 4/5 | Delivery groups related workflow features; some operational constraints recur in documentation. |

Critical issues (scores at or below 2): none. Verdict: deliver with the documented limits.
