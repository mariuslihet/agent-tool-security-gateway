# Version 0.13 verification

Verified on Windows with Node.js 24.22.0 on 4 November 2026.

| Check | Result |
|---|---|
| Automated suite | 208 passed; zero failures, cancellations or skips |
| Syntax / JSON | Passed across 68 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regression CLI | 8/8 passed |
| Template syntax | Unique bounded names; expression/prototype-style syntax rejection; literal, non-recursive field insertion |
| Input bounds | Missing/extra/non-text/blank/NUL/oversized values rejected; expanded prompts capped at 8,000 characters |
| Redaction | Literal source segments protected before insertion, sensitive field names/values redacted, completed output checked again; editable placeholders preserved |
| Control boundary | Operator/tenant checks, exact bodies/queries, enabled/revision binding, no sessions/model calls, mandatory audit before delivery |
| Compatibility | Plain literal braces preserved; omitted type flags retain existing parameterized state; encrypted reopen retains metadata and disabled state |

## Actual browser and local model

The disposable in-memory host on port 8788 used `GATEWAY_QA_REAL_LLM=1` and installed local `qwen3.5:4b`. It did not read `.env`, the live workspace or persistent gateway storage.

1. Created **Arithmetic with reusable fields**, selected Prompt with fields, and saved `Use compute.sum to add {{numbers}}. Reply in {{style}}.` in Safe mode.
2. Saving left the task library empty. The row showed two fields.
3. Opened Fill template fields; entered `6, 14 and 20` and `one sentence`. Screenshot: [field form](images/template-fields-v0.13.jpg).
4. Filled the new-task form. It contained exactly `Use compute.sum to add 6, 14 and 20. Reply in one sentence.` The console confirmed no task started, and the library remained empty.
5. Explicitly started the task. The actual model used `compute.sum` and returned “The sum of 6, 14, and 20 is 40.” The trace showed a completed calculation across two model turns.
6. Reopened the revision-one field form. Disabled the disposable template through its API, producing revision two, then submitted the old form. The console showed the revision-change error, refreshed the template list and left the original prepared prompt unchanged. The library still contained exactly one task.
7. No browser warning/error log entries appeared during these checks.

After reviewing literal-secret handling, the full automated suite was rerun successfully with the additional segment-redaction checks. Browser checks are targeted interactive verification, not a committed cross-browser suite. README remains image-free.

## Limits and review

Field values are prompt text, not authorization or trusted instructions. Redaction remains pattern-based. A disabled template cannot revoke an already-loaded prompt or an existing task. Rendering has an audit record but no separately persisted value/result record; explicitly started tasks use the normal encrypted conversation storage. See [template field semantics](template-fields.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Automated boundaries plus actual model/browser flow support the behavior; independent review remains useful. |
| Completeness | 4/5 | Parser, service, API, SDK, editor/form, compatibility and audit cover the feature; reusable field descriptions/defaults remain future work. |
| Clarity | 4/5 | Opt-in type, field syntax and explicit start are visible; large templates could benefit from a side-by-side preview. |
| Actionability | 4/5 | Operators can reuse one template with different inputs immediately; no expressions or dynamic external lookup is supported. |
| Conciseness | 4/5 | Delivery groups the template workflow; revision/privacy constraints recur across guides. |

Critical issues (scores at or below 2): none. Verdict: deliver with documented redaction and loading limits.
