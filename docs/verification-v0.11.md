# Version 0.11 verification

Verified on Windows with Node.js 24.22.0 on 4 November 2026.

| Check | Result |
|---|---|
| Automated suite | 191 passed; zero failures, cancellations or skips |
| Syntax / JSON | Passed across 65 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regression CLI | 8/8 passed |
| Inventory | Actual source integrity, bounded scans, explicit partial results, unsafe-file skipping, no content disclosure or audit writes |
| Read boundary | Role/tenant isolation, strict request fields/queries, stale hashes, traversal, hard links, oversize and malformed/unsafe content |
| Delivery | Byte-exact Unicode/BOM, mandatory audit before content return, audit-failure suppression, no new sessions/model calls |

The six library tests also passed again after tightening read-endpoint query rejection.

## Browser checks

Used the disposable in-memory host on port 8788 with `GATEWAY_QA_WORKSPACE=1` and `GATEWAY_QA_LIBRARY=1`. Its source and report files were synthetic local fixtures in a private temporary directory. No Ollama provider was configured: listing, preview and download do not require inference or start tasks. The host did not open `.env`, the live workspace or persistent gateway storage.

1. Connected as the fixture operator. The panel showed `review-notes.md` as verified and `preview-report.md` as a 91-byte report.
2. Opened Preview report. Literal `<em>Plain text, not HTML.</em>` appeared unchanged as plain text. The dialog showed a verified SHA-256 and audited read.
3. Chose Download report. The application confirmed checksum verification and audited download after creating the browser download action. HTTP tests independently verify exact returned bytes and audit fields.
4. Modified the disposable source after startup, then refreshed. Its status became **changed**, with the host-review instruction.
5. Restored the exact source bytes, then refreshed. Its status returned to **verified**.
6. Browser warning/error log was empty. Screenshots: [file library](images/workspace-library-v0.11.jpg), [plain-text preview](images/report-preview-v0.11.jpg).

The observed report SHA-256 was `e8a5e13811d91d2251284ef0ea8fd88b8b49420568837e4237e45cf6c87c7106`. These are targeted interactive checks, not a committed cross-browser suite. README remains image-free.

## Limits and review

The inventory examines at most 100 report-directory entries and marks partial results explicitly. It cannot prove approval/authorship of host-added files. Downloads are plaintext copies and browser verification does not turn them into signed artifacts. Existing protected-directory assumptions apply. See [library semantics](workspace-library.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Filesystem/API tests and browser checks support the behavior; independent review remains useful. |
| Completeness | 4/5 | Storage boundary, API, SDK, console and guide cover the workflow; pagination and signed artifact provenance remain future work. |
| Clarity | 4/5 | Integrity, plain-text preview and refresh behavior are explicit; some console wording could be shorter. |
| Actionability | 4/5 | Reports can be inspected/downloaded without filesystem navigation or a model connection; large folders require separate host management. |
| Conciseness | 4/5 | Delivery groups related file workflow additions; detailed limits recur across guides. |

Critical issues (scores at or below 2): none. Verdict: deliver with documented scan and provenance limits.
