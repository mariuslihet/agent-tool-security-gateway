# Version 0.7 verification

Verified locally on Windows with Node.js 24.22.0 on 3 November 2026.

| Check | Result |
|---|---|
| Automated suite | 156 passed; zero failures, skips or cancellations |
| Previous behavior | All 144 previous tests remain passing; sensitive/approval fixtures now explicitly request all-granted mode |
| Syntax / JSON | Passed across 59 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 blocked with expected codes |
| Policy regression CLI | 8/8 hypothetical cases passed |
| Follow-up context | Earlier model messages retained; same session and fixed grants; cumulative turns/cost/call budgets not reset |
| Concurrency / retry | Stable message IDs prevent repeated generation; changed duplicates and stale revisions rejected |
| Tool access | Safe default narrowed to the reference allowlist; chat-only sessions have no grants; direct execution and child escalation denied |
| Conversation limits | Failed, waiting, expired and budget-exhausted tasks cannot accept follow-ups |
| Usage | Provider counts/durations aggregate across messages; metrics excluded from model context; missing/malformed metrics handled explicitly |
| Exports | Operator-only, tenant-scoped, redacted, no internal context; Markdown injection fenced; content checksum reproduced; audit failure prevents delivery |
| Legacy restart | A 0.6-style encrypted record can continue without changing its original grants or inventing past token statistics |

## Actual local model and browser

UI checks used the disposable in-memory host on port 8788 with `GATEWAY_QA_REAL_LLM=1` and the already-installed local `qwen3.5:4b` model. It never reads `.env` or persistent gateway storage. These were real model calls, separate from controlled-provider unit tests.

Observed sequence:

1. The new task selector defaulted to **Safe tools: handbook, arithmetic and encoding**.
2. Submitted a task to calculate 7 + 11 + 24 using `compute.sum`. Model returned “The sum of 7, 11, and 24 is 42.”
3. Submitted a follow-up asking the calculation tool to add eight to the previous result, without restating that result. Model returned “The sum of 42 and 8 is 50.”
4. Both requests retained the same task/session. Two completed `compute.sum` calls had distinct stable request IDs, and the displayed permissions remained safe.
5. The conversation used four model turns and two tool evaluations, leaving two model turns in the original budget.
6. The usage panel displayed four reported/timed requests, 2,797 input tokens, 106 output tokens, 11.76 seconds reported provider duration and 11.79 seconds recorded local request time. These are observations for this machine/run, not performance guarantees.
7. JSON and Markdown download actions both completed with an audit confirmation and SHA-256 checksum. API tests separately verify export contents and checksum reproduction.

Screenshot: `docs/images/agent-usage-v0.7.jpg`. README remains image-free. Browser checks are targeted interactive verification, not a committed cross-browser E2E suite.

## Limits and review

Follow-ups stay within the existing six-turn/twelve-tool task budget and original session expiry. Existing full-mode tasks keep their original mode. New tasks use safe mode by default; selecting all host-granted tools does not override policy or approval. Missing historical usage stays unknown. Export redaction remains pattern-based and downloaded transcripts require review before sharing. See [detailed semantics](conversations.md).

Agent self-evaluation: **4.0/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | 156 passing tests and actual local follow-up generation support the behavior. Remote Linux CI and independent review were not run in this task. |
| Completeness | 4/5 | Runtime, API, client, UI, restart compatibility and privacy controls cover the four additions. A committed browser suite would improve repeatability. |
| Clarity | 4/5 | Mode, remaining turns and usage coverage are visible. The operator guide could use a shorter onboarding walkthrough. |
| Actionability | 4/5 | The local server can run the new flow; existing operator authentication is retained. Long conversations still require a fresh task after original budgets expire. |
| Conciseness | 4/5 | Final delivery focuses on four features and verification. Related documentation repeats some privacy and recovery constraints. |

Critical issues (scores ≤2): none. Top improvements: automated browser regression and independent security review. Self-check: the user can submit a follow-up and inspect fixed permissions and recorded usage in the running console. Verdict: deliver with documented limits.
