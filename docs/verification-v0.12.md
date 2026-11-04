# Version 0.12 verification

Verified locally on Windows with Node.js 24.22.0 on 4 November 2026.

| Check | Result |
|---|---|
| Automated suite | 200 passed; zero failures, cancellations or skips |
| Syntax / JSON | Passed across 66 JavaScript files and JSON artifacts |
| Attack simulation | 10/10 expected blocks |
| Policy regression CLI | 8/8 passed |
| Budget validation | Invalid/incomplete/extra-field budgets rejected before session creation; effective limits bind start retries |
| Enforcement | Cumulative follow-up turns, tool exhaustion, gateway/ancestor call ceilings, stricter host ceilings and cooperative model timeout |
| Recovery | Selected limits survive encrypted restart and approval resume; legacy records retain defaults/session ceilings; invalid stored limits fail closed |
| Read-only mode | Actual source read succeeds; report save and write delegation are denied without an approval or file creation |

## Actual local model and browser

Used the disposable in-memory host on port 8788 with `GATEWAY_QA_REAL_LLM=1`, `GATEWAY_QA_WORKSPACE=1` and installed local `qwen3.5:4b`. It used its own temporary source directory, never the live workspace, `.env` or persistent gateway database.

1. Connected as the fixture operator and selected **Workspace read only**.
2. Expanded Task budgets and selected **Quick**. Fields changed to two model turns, two tool evaluations and one minute per attempt.
3. Asked the real model to read `review-notes.md` and summarize its milestones in one sentence.
4. The model used `workspace.read`, then returned: “The three milestones outlined in the review notes are review, test, and document, with the requirement that all reports must remain local.”
5. The task completed in two model turns and one tool evaluation. Its displayed grants were handbook/arithmetic/encoding plus workspace search/read, with no report tool. The task inspection showed the fixed 2/2/60s budget.
6. Health showed zero model turns remaining and one of two session calls used. Follow-up was disabled with the exhausted-budget explanation.
7. Changed the new-task preset to Standard. The selected completed task retained its 2/2/60s budget and follow-up remained disabled.
8. Browser warning/error log was empty. Screenshot: [bounded read-only task](images/task-budgets-v0.12.jpg).

These are targeted interactive browser checks, not a committed cross-browser suite. README remains image-free.

## Limits and review

Runtime deadlines cooperatively abort generation and prevent subsequent dispatch; already-dispatched operations may finish under adapter deadlines. Time allowance is per attempt, while turn/tool counters and gateway call usage remain cumulative. Interrupted generation can repeat on recovery before a completed turn is recorded. There is no token quota or total elapsed-lifetime budget added. See [task budget semantics](task-budgets.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Actual local generation and automated boundary cases support the claims; independent review remains useful. |
| Completeness | 4/5 | API, runtime, gateway attenuation, restart, UI and templates cover the selected controls; token quotas remain future work. |
| Clarity | 4/5 | Fixed limits and per-attempt time semantics are explicit; an estimated task-effort guide could help choose budgets. |
| Actionability | 4/5 | Operators can start bounded read-only research immediately; a small budget can require a fresh task to finish complex work. |
| Conciseness | 4/5 | Delivery groups budgets and read-only research; some operational constraints recur across guides. |

Critical issues (scores at or below 2): none. Verdict: deliver with documented deadline and recovery limits.
