# Version 0.17 verification

Verified locally on Windows with Node.js 24.22.0 on 6 November 2026.

| Check | Result |
|---|---|
| Automated suite | 236 passed; no failures, cancellations or skips |
| Syntax / JSON | Passed across 74 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regressions | 8/8 passed |
| Numeric semantics | Exact/range checks, inclusive endpoints, zero/negatives/fractions, nested own properties and case-sensitive paths |
| Invalid answers | Numeric strings, null, booleans, arrays, absent fields, nonfinite and unsafe-magnitude numbers fail |
| JSON safety | Plain/fenced objects, escaped strings, duplicate decoded keys, multiple blocks, trailing prose and depth ceiling |
| Criteria validation | Eight-rule/path bounds, duplicates, unknown fields, prototype paths, nonfinite/reversed bounds and malformed types |
| Storage and authority | Encrypted criteria, hash-only audit, exact revisions, follow-up staleness, audit rollback; no inference, task/session or budget mutations from checking |
| API | Operator role required; invalid rules return 400 without overwriting the saved review |

## Actual local model and browser

Used the disposable in-memory QA gateway on port 8788, isolated credentials and real Ollama `qwen3.5:4b` inference. No live database or `.env` values were used by the QA service.

1. Submitted: “Use compute.sum to add 12, 23 and 45. Return only a JSON object with a numeric total field, and no prose.” The actual model returned `{"total":80}` after a successful `compute.sum` trace entry.
2. Opened **Check result → Structured answer and number checks**. Required JSON and successful `compute.sum`; added `total`, minimum 80, maximum 80.
3. The review passed **6/6** checks, including format and expected 80 / actual 80. [Screenshot](images/structured-checks-v0.17.jpg).
4. Changed both bounds to 81. Review revision two passed **5/6**, explicitly failing the numeric check with expected 81 / actual 80. Task revision stayed five; checks did not invoke the model.
5. Closed and reopened the form. Saved path `total`, bounds 81/81 and the failed result were restored. Browser warning/error logs were empty.

These are targeted interactive checks, not an automated cross-browser suite. The QA tab/service were closed after verification. The main localhost service was initially offline and started with the new code. README remains image-free.

## Scope and self-evaluation

Numeric checks assert configured bounds over the final displayed answer; they do not prove the answer is factually correct or that a tool produced a particular field. JSON numbers use binary floating-point semantics. See [acceptance semantics and precision limits](task-acceptance.md#structured-answer-and-number-checks).

Self-evaluation summary: **4.0/5** across five axes, implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Boundary tests and actual browser pass/fail results support the feature; exact decimal arithmetic would improve precision beyond current number semantics. |
| Completeness | 4/5 | Evaluator, editor, API compatibility, storage/rollback and docs are covered; array paths are deliberately unsupported. |
| Clarity | 4/5 | Expected/actual values and plain minimum/maximum fields explain failures; nested paths still require a brief convention. |
| Actionability | 4/5 | Operators can save/reopen checks without further inference; a model must first produce a structured answer. |
| Conciseness | 4/5 | Structured controls fit the existing dialog; many number rows require scrolling. |

Improvements by impact: exact decimal assertions for precision-sensitive workflows; automated multi-browser editor tests. Would the user agree? The feature is visible and verified against a real generated answer. Critical issues: none; no scores at or below three require rework. Verdict: deliver with documented numeric scope.
