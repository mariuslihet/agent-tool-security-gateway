# Version 0.19 verification

Verified locally on Windows with Node.js 24.22.0 on 6 November 2026.

| Check | Result |
|---|---|
| Automated suite | 279 passed; no failures, cancellations or skips |
| Syntax / JSON | Passed across 87 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regression | 8/8 passed |
| Export privacy | Prompts and hidden suite snapshots/receipts excluded; full task state unchanged and no additional inference |
| Export integrity | UTF-8 SHA-256 content hash, mandatory audit-before-delivery, rollback on audit failure |
| CSV | Quoting, embedded quotes/newlines, formula-like text and leading control characters; empty-result snapshots retain run metadata |
| API | Operator role, tenant ownership, exact body/query and supported-format validation |

## Actual model and browser

Used the disposable in-memory service on port 8788 with actual local Ollama `qwen3.5:4b`, isolated test credentials and no live `.env` or gateway database access.

1. Built a suite entirely with visual controls: prompt to calculate 14+26, required successful `compute.sum`, forbidden phrase `unable`, required JSON, and numeric `total` minimum/maximum 40. No advanced JSON editing was used.
2. Saved and reopened the suite. Forbidden phrase, JSON checkbox and exact numeric bounds were restored correctly. Saving invoked no model.
3. Started the suite. The actual model used the calculator; the suite passed **1/1** recorded cases with the configured number check.
4. Downloaded JSON and CSV through the console. The browser verified each returned checksum before creating the download and reported that the export was audited. Console warning/error logs were empty.
5. Reloaded the QA service with the final checkbox styling, rebuilt the same visual case and ran it again. The final editor uses normal-sized checkbox controls and keeps technical case references in advanced details. [Editor screenshot](images/visual-evaluations-v0.19.jpg).

These are targeted interactive checks, not a committed cross-browser suite. Test-only state was discarded when the QA tab/service closed. The main local gateway was reloaded after checking zero active tasks. README remains image-free.

## Scope and review

The visual editor configures the existing deterministic checks; it does not grade factual truth or authorize tools. JSON exports include selected check values, and CSV is a case summary rather than a full transcript. Snapshots can be exported before all cases finish; state, timestamp and scope identify that limitation. Pattern redaction is incomplete. Spreadsheet text-cell protection is applied even to formula-like text with leading control characters.

Self-evaluation: **4.0/5**, implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Passing privacy/integrity tests and actual model/download checks support behavior; more spreadsheet-client interoperability checks would strengthen CSV coverage. |
| Completeness | 4/5 | All supported criteria have visual fields, and JSON/CSV exports include audited metadata; exports do not bundle full transcripts. |
| Clarity | 4/5 | Plain number bounds, normal checkbox controls and synchronized optional JSON editing reduce setup effort; many cases still require scrolling. |
| Actionability | 4/5 | Operators can configure, run and download without editing JSON; numeric answers must follow the requested object format. |
| Conciseness | 4/5 | Reuses suite controls and the existing evaluator; the two export formats require distinct scope explanations. |

Improvements by impact: automate editor round-trips across browsers; verify CSV imports in multiple spreadsheet clients. Would the user agree? The new controls and downloads were exercised with real inference. Critical issues: none outstanding. Verdict: deliver with documented snapshot/privacy scope.
