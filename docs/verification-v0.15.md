# Version 0.15 verification

Verified locally on Windows with Node.js 24.22.0 on 5 November 2026.

| Check | Result |
|---|---|
| Automated suite | 224 passed; zero failures, cancellations or skips |
| Syntax / JSON | Passed across 72 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regression CLI | 8/8 passed |
| Evaluation | Final displayed answer only, literal/case-insensitive phrases, completed trace evidence, completion/denial criteria, mandatory answer presence |
| Bounds | Phrase/tool/message/step/answer limits and malformed/duplicate rules rejected |
| State and privacy | No task revision, session budget, capability or model-call changes; encrypted criteria; redacted output; fingerprint-only audit |
| Recovery and concurrency | Follow-up staleness, repeated-answer revision changes, lease interruption without a record revision change, encrypted reopen, ciphertext relocation and stale writes |
| Failure handling | Mandatory audit rollback and HTTP delivery suppression; role/tenant and strict request validation |

## Actual local model and browser

Used the disposable in-memory host on port 8788 with `GATEWAY_QA_REAL_LLM=1` and installed local `qwen3.5:4b`. It did not open `.env`, the live workspace or persistent gateway storage.

1. Asked the actual model to use `compute.sum` for 17 + 29 + 31. It returned “The total of 17, 29, and 31 is 77.” The trace showed one completed calculation across two model turns.
2. Opened **Check result** and configured required phrase `77`, forbidden phrase `failed`, required successful tool `compute.sum`, completed-task requirement and denial rejection.
3. Evaluation returned **6/6 passed**, review revision one bound to task revision five. Model/tool counters remained two/one. Screenshot: [acceptance checks](images/task-checks-v0.15.jpg).
4. Chose Download check snapshot. The application created the JSON snapshot download and identified its audited evaluation.
5. Closed the dialog and sent a follow-up asking the model to add one to the previous total. The prior review immediately became stale. The actual model used a second `compute.sum` call and replied “The new total is 78.”
6. Reopened checks. The saved review was explicitly stale, with the original required phrase retained. Rerunning against task revision ten created check revision two: **5/6 passed**, with the required `77` phrase failing against the final answer. Earlier answer text did not satisfy it.
7. Browser warning/error log was empty during these checks.

Checks are deterministic review operations. Only the explicitly submitted original task and follow-up invoked Ollama. These are targeted interactive browser checks, not a committed cross-browser suite. README remains image-free.

## Limits and review

Pass means the configured criteria held for the selected displayed-answer/trace snapshot. Substring matching does not provide numeric, factual or semantic validation. Reviews do not authorize tools or resolve approval. The console shows loaded snapshots; reopening fetches the latest review and concurrent writes require exact revisions. Local JSON download is a redacted snapshot with no separate server download audit event. See [acceptance semantics](task-acceptance.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Automated boundaries plus actual model/browser pass → stale → fail flow support the behavior; independent review remains useful. |
| Completeness | 4/5 | Evaluator, encrypted service, API, SDK, dialog, snapshots and recovery tests cover the feature; structured numeric assertions remain future work. |
| Clarity | 4/5 | Configured criteria and stale snapshots are explicit; users still need to choose precise substring requirements. |
| Actionability | 4/5 | Operators can evaluate and retain task-specific checks without spending additional model/tool budgets; large custom transcripts exceed reference bounds. |
| Conciseness | 4/5 | Delivery groups acceptance and review workflow; scope and privacy constraints recur across guides. |

Critical issues (scores at or below 2): none. Verdict: deliver with documented review scope and snapshot limits.
