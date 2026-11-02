# Version 0.6 verification

Verified locally on Windows with Node.js 24.22.0 on 2 November 2026.

## Automated checks

| Check | Result |
|---|---|
| Offline suite | 144 passed; zero failures, skips or cancellations |
| Prior behavior | All 129 previous tests remained passing |
| Syntax / JSON | Passed across 58 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 blocked with expected codes |
| Policy regression CLI | 8/8 hypothetical cases passed |
| Runtime integration | Model-proposed tools execute through the real gateway; malformed arguments produce a denial available for model recovery |
| Approval / containment | Loop stops, retains original arguments and request ID, and resumes only after separate operator action |
| Privacy | Classified outputs are withheld from subsequent model calls and conversation responses; transcript storage encrypted; audit uses metadata/hashes |
| Access control | Operator-only generation and conversation access; viewers/agents rejected; tenant isolation and forged-context validation tested |
| Recovery | Pending tasks survive restart and resume the same approved call; shared leases prevent an independent process from claiming active work |
| Limits / cancellation | Finite tool loops, provider response bounds, oversized task-state failure and cancellation before late tool dispatch tested |
| Fail closed | Mandatory start audit failure prevents inference and rolls back the task/lease; provider errors do not produce a substitute answer |

Offline tests deliberately use controlled provider responses for deterministic security outcomes. They do not claim to prove real inference.

## Actual local-model verification

The installed Ollama service was already reachable at `127.0.0.1:11434`. Its installed model `qwen3.5:4b` advertised `completion`, `vision`, `tools` and `thinking` capabilities. No model or software download was needed. Only non-secret local-model settings were added to the ignored `.env`; existing gateway credentials were preserved.

The separate real-model smoke command used the running gateway's operator API and an arithmetic prompt. Observed outcome:

- Provider `ollama`, model `qwen3.5:4b`.
- Model requested `compute.sum`.
- Gateway executed the fixed restricted computation and recorded `completed / OK`.
- Model generated: “The sum of 19, 23, and 58 is 100.”
- Task history remained completed and readable after restarting the gateway into version 0.6.

This verifies actual model generation and guarded dispatch, not just a prewritten test response. The smoke task and history are retained in local encrypted storage. It does not send a report or charge a payment.

## Browser verification

The disposable in-memory QA host was explicitly started with `GATEWAY_QA_REAL_LLM=1`, using known fixture credentials and the actual local Ollama service. It never reads `.env` or the main database. The sample workspace disables generation and contains no fake conversation replies.

Observed browser results:

- Connected as an operator and verified local model capability through **Test model connection**.
- Submitted an original prompt requesting `compute.sum` for 7, 11 and 24 plus a friendly-robot sentence.
- Saw a running state, followed by two model turns, one completed tool call and generated text.
- An initial fresh run generated: “The sum of 7, 11, and 24 is 42. That friendly little robot buzzes happily when you add those numbers up!”
- A separate fresh run after restarting the disposable host generated: “The friendly robot calculated the sum of 7, 11, and 24 to be 42.”
- Both runs showed a real completed `compute.sum` gateway trace. The final task-history list updated to completed.
- No captured browser warnings/errors were reported. Screenshot: `docs/images/local-ai-v0.6.jpg`.

Similar prompts can still produce identical wording or numeric results; there is no uniqueness guarantee. Existing task IDs intentionally reuse stored state.

These are targeted interactive browser checks. Automated provider-error and authorization cases are covered by the offline suite; no general model-quality or adversarial-model benchmark is claimed.

## Scope and self-evaluation

The AI loop is real. Handbook/page/invoice tools remain fixtures and publishing/payment tools remain simulations. Tool results with sensitive/untrusted lineage are withheld rather than passed back to the model. Prompts are separate tasks, not a shared multi-turn user chat. The current integration uses local Ollama only. See [setup, protocol references, trust boundaries and limits](local-ai.md).

Agent self-evaluation: **4.0/5**, implementation review rather than independent assurance.

| Axis | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | Actual model tool traces and 144 passing tests substantiate behavior. Independent security review and Linux CI were not run during this task. |
| Completeness | 4/5 | Installed local model configured, runtime/API/UI/SDK/recovery implemented and live inference verified. Continuous user-chat memory is outside this task-based interface. |
| Clarity | 4/5 | UI distinguishes generated text, gateway evidence and simulated adapters. A shorter setup walkthrough would improve onboarding. |
| Actionability | 4/5 | Server configured and running; the operator can submit their own prompt. Existing operator authentication remains required. |
| Conciseness | 4/5 | Final delivery emphasizes the working model and entry point. Technical bounds remain spread across reference documents. |

Critical issues (scores ≤2): none. Highest-value improvements: repeatable browser regression, adversarial model evals and independent security review. Self-check: the user can verify their own model-generated answer from the running AI Agent page. Verdict: deliver with the documented limits.
