# Version 0.9 verification

Verified locally on Windows with Node.js 24.22.0 on 3 November 2026.

| Check | Result |
|---|---|
| Automated tests | 175 passed; zero failures, skips or cancellations |
| Syntax and JSON | Passed across 62 JavaScript files and JSON artifacts |
| Attack simulation | 10/10 expected blocks |
| Policy regression CLI | 8/8 passed |
| Health privacy and effects | No prompt, arguments, model call, audit write, revision change or restart |
| Access control | Operator-only; tenant ownership; strict query/method checks |
| Diagnostic cases | Archive, turn exhaustion, model change, expiry, revocation, classified labels, interrupted work, pending approval expiry, tool holds, tenant pause and session quarantine |

## Actual local model and browser

Used the disposable in-memory host on port 8788 with `GATEWAY_QA_REAL_LLM=1` and the installed local `qwen3.5:4b` model. The host did not open `.env` or persistent gateway storage.

1. Created an all-granted task asking `compute.sum` to add 15, 25 and 35.
2. The actual model returned “The sum of 15, 25, and 35 is 75.” The trace showed a completed calculation across two model turns.
3. Task health showed 4/6 model turns remaining, 11/12 tool evaluations, 49/50 session calls, 99/100 tool cost units, and 262,134/262,144 output bytes remaining. The session was active with no classification labels.
4. Clicked **Reuse original prompt**. The form retained the original text and reset to safe tools. The selected task's fixed mode stayed all-granted; the library still contained exactly one task. No generation started.
5. Clicked **Refresh task health**. Its timestamp changed while all counters remained unchanged.
6. Browser warning/error log was empty. Screenshot: [task health panel](images/task-health-v0.9.jpg).

README remains image-free. Browser checks were interactive, not a committed cross-browser suite. The existing retained task was preserved when updating the local service.

## Review and limits

Diagnostics are advisory snapshots. They do not test provider reachability, reserve capacity, simulate future tool arguments, authorize a call or grant approval. Tool restrictions are separate from follow-up task/session blockers. Existing action-boundary enforcement remains authoritative. See [task health semantics](task-health.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Automated cases and real model/browser checks support behavior; independent review remains useful. |
| Completeness | 4/5 | Runtime, API, SDK, UI, documentation and regression checks cover the additions; browser automation would improve repeatability. |
| Clarity | 4/5 | Snapshot and accounting semantics are explicit; diagnostic codes could gain inline plain-language explanations. |
| Actionability | 4/5 | The running console exposes current budgets and existing review links; it deliberately cannot resolve approvals itself. |
| Conciseness | 4/5 | Delivery groups the diagnostic improvements; some operational constraints recur across guides. |

Critical issues (scores at or below 2): none. Verdict: deliver with documented snapshot limits.
