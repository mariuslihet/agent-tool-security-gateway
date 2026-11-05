# Compare saved reports

Version 0.14 adds **Compare reports** under **Workspace files & reports** on the AI Agent page. Connect as an operator, refresh files, choose a baseline and newer report, then compare. Both files must already exist in the configured report folder under different names. No model connection is needed.

The dialog shows added, removed and unchanged lines with counts. `+` means added, `-` means removed, and unmarked lines are unchanged. Markup is displayed literally as plain text. Neither report is modified and no task, session, approval or tool call is created.

## Integrity and audit

The request includes each file's hash from the inventory. The server rereads both files through the existing protected-root, filename, link, size and content checks, and rejects stale hashes. Refresh files before comparing later changes. These are two verified file reads, not an atomic filesystem snapshot or a file lock.

The response includes original file names, byte counts and SHA-256 hashes; diff rows with source line numbers; summary counts; normalization rules; and a reproducible `comparisonHash` over the canonical JSON result excluding that hash field. The browser verifies the comparison checksum and selected file/hash bindings before displaying content. This checksum is not a signature or proof of report approval/authorship.

A mandatory `workspace.reports_compared` audit event is written before delivery. It includes authenticated tenant/operator, file-name hashes, original content hashes, comparison hash and counts. Raw file names and report text are omitted. Audit failure prevents delivery. Failed validation or stale reads do not produce a successful comparison event.

**Download comparison** saves the displayed snapshot as plain text, including source hashes and the comparison hash. It does not reread the current files or produce a separate download audit event; the server comparison read was already audited. The text is for review, not an executable or apply-ready patch.

## Bounds and line endings

Each report remains limited to 8,192 UTF-8 bytes. Comparison additionally accepts at most 400 normalized lines per report, bounding the alignment matrix and output to at most 800 rows. Larger comparisons return a structured limit error; ordinary report preview/download remains available within the file byte bound.

CRLF and standalone CR are compared as LF. Trailing empty lines are retained; an empty file has one empty logical line. Therefore `identicalText` can be true while `identicalBytes` is false for different line endings. The UI displays byte identity separately. Repeated lines use deterministic alignment, so equivalent alignments may look different from another diff program.

The existing inventory scan limit and skipped-entry behavior apply to the selectors. Missing or unreadable files can also fail a comparison. This adds no upload, delete, overwrite, model permission or automatic source promotion.

## API and SDK

`POST /v1/operator/workspace/reports/compare` requires operator access and the host-configured workspace tenant. It uses the existing heavy-operation rate budget and accepts no query parameters. Its exact body is:

```json
{
  "left": { "file": "baseline.md", "expectedHash": "<64 lowercase hex characters>" },
  "right": { "file": "revised.md", "expectedHash": "<64 lowercase hex characters>" }
}
```

```js
const files = await control.workspaceFiles();
const result = await control.compareWorkspaceReports({
  left: { file: files.reports[0].file, expectedHash: files.reports[0].sha256 },
  right: { file: files.reports[1].file, expectedHash: files.reports[1].sha256 }
});
```

The package root also exports the pure `compareReportText` helper and `REPORT_DIFF_LIMITS`. The helper only compares bounded strings; filesystem verification, ownership and audit belong to the service endpoint.
