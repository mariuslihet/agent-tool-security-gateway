# Version 0.14 verification

Verified locally on Windows with Node.js 24.22.0 on 5 November 2026.

| Check | Result |
|---|---|
| Automated suite | 215 passed; zero failures, cancellations or skips |
| Syntax / JSON | Passed across 70 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regression CLI | 8/8 passed |
| Diff behavior | Replacement/addition alignment, reconstructible input lines, repeated-line determinism, Unicode and literal markup |
| Bounds | 8,192 bytes and 400 normalized lines per report; maximum 800 output rows |
| Verification | Both expected hashes checked; canonical comparison hash reproduced; original files/session count unchanged |
| Access and privacy | Operator/tenant scope, strict nested selections/queries, stale/duplicate/path rejection, hash-only file identification in audit |
| Failure handling | Audit failure suppresses content delivery; line-limit errors are structured |

## Browser and filesystem checks

Used the disposable host on port 8788 with `GATEWAY_QA_WORKSPACE=1` and `GATEWAY_QA_COMPARE=1`. It created two synthetic report files in its own temporary folder and used an in-memory database. No model provider was configured: comparison is deterministic file inspection, not inference. It did not open `.env`, the live workspace or persistent gateway storage.

1. Connected as the fixture operator. The selectors chose `baseline.md` and `revised.md`.
2. Compared them. The browser verified the comparison receipt and showed **3 added, 2 removed, 3 unchanged**, with different original bytes and an audited comparison.
3. Literal `<em>Literal markup</em>` appeared unchanged as plain text.
4. Chose Download comparison. The application created a plain-text snapshot download and confirmed that its comparison read was audited.
5. Selected the same file on both sides. The console rejected the choice before making a comparison request.
6. Restored the newer-file selection, then modified that temporary report after the inventory was loaded. Comparison was blocked with the refresh-files instruction; no new diff was displayed.
7. Browser warning/error log was empty. Screenshot: [report comparison](images/report-comparison-v0.14.jpg).

The comparison checksum observed in the successful browser run was `721a3803828b1cb17b6aa7c90c7125199f50d84282c10dd0787aa336cde1b0eb`. These are targeted interactive checks, not a committed cross-browser suite. README remains image-free.

## Limits and review

Line endings are normalized for text comparison; original hashes describe the actual bytes. A comparison is based on two verified reads, not a filesystem lock or atomic snapshot. The receipt checksum is not a signature or approval proof. Local snapshot download does not reread files or add another server audit event. Existing protected-root and report-inventory limitations apply. See [comparison semantics](report-comparison.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Filesystem/API tests and browser verification support the output; independent review remains useful. |
| Completeness | 4/5 | Helper, verified service, API, SDK, viewer/download and failure checks cover the function; character-level highlighting remains future work. |
| Clarity | 4/5 | Counts, byte identity and normalization are explicit; large diffs could benefit from navigation between changes. |
| Actionability | 4/5 | Operators can inspect report revisions directly in the console; larger line counts require an external comparison tool. |
| Conciseness | 4/5 | Delivery groups the comparison workflow; checksum and snapshot constraints recur across guides. |

Critical issues (scores at or below 2): none. Verdict: deliver with documented normalization and snapshot limits.
