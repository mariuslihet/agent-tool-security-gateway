# Workspace file and report library

Version 0.11 adds **Workspace files & reports** to the AI Agent page. Connect with operator access, then choose **Refresh files**. This works even if Ollama is not configured and never starts a task or tool call.

## Sources

The source panel lists the startup-pinned document names, SHA-256 hashes and current integrity state:

- **verified**: current bytes still match the reviewed startup manifest;
- **changed**: bytes differ; review the source on the host before restarting and creating a fresh task;
- **unavailable**: the source is missing, oversized, unsafe, linked or otherwise unreadable.

Only pinned sources appear. Files added after startup require the existing host review/restart workflow. The panel cannot approve changed source content or modify the manifest.

## Reports

The report panel lists readable `.md`/`.txt` files in the configured report directory, including their byte counts and current SHA-256 hashes. **Preview report** displays plain text in a dialog. Markup is not rendered as HTML. **Download report** downloads the verified UTF-8 content with the original safe filename.

Both actions send the listed hash. The server rereads the bounded file and rejects a changed hash. Refresh and review the latest file before retrying. The browser independently verifies the content checksum and byte count before preview/download. UTF-8 BOM and Unicode bytes round-trip exactly.

Reads are audited before content is returned. Audit includes tenant, authenticated operator, purpose, filename hash, content hash and bytes; it omits raw filename and report text. Audit failure prevents delivery. Listing metadata is read-only and does not add audit events.

The directory can contain host-added files; listing a report is not evidence of gateway approval or authorship. This release provides file integrity and read audit, not signed artifact provenance. Reports remain ordinary plaintext files after download.

## Bounds and access

The report scan examines at most **100 directory entries**, including skipped entries. A partial result explicitly sets `truncated`; it is not a complete directory listing or paginated inventory. The selected subset follows directory enumeration order, then readable results are sorted by filename. Unsupported names, directories, links, oversized files and detected unsafe content are skipped and counted. Existing 8,192-byte per-file bounds and protected-root assumptions apply. No delete, upload, overwrite or model grant is added.

All file endpoints require operator access and the host-configured tenant binding. Viewer/agent tokens cannot list names or read content. Both operations use the existing heavy-operation rate budget. UI content is cleared on connection/source changes, and stale responses cannot reopen a preview after disconnection.

## API and SDK

| Method | Route | Body / result |
|---|---|---|
| GET | `/v1/operator/workspace` | No query parameters. Returns `configured`, `inputs`, `reports`, `skipped`, `truncated`, `limits`; unconfigured/other tenant returns an empty unconfigured view. |
| POST | `/v1/operator/workspace/reports/read` | Exact body `{file, expectedHash, purpose}`; purpose `preview` or `download`. Returns `{file, content, bytes, sha256}` after verification and audit. |

```js
const files = await control.workspaceFiles();
const report = files.reports[0];
const copy = await control.readWorkspaceReport({
  file: report.file, expectedHash: report.sha256, purpose: 'download'
});
```

Embedding hosts pass the configured file service and tenant as `workspaceFiles` to `createGatewayServer`. `createDemo({ workspaceRoot })` returns this as `workspace`; the CLI wires it automatically. The raw adapter registration helper does not grant endpoint access without an explicit host tenant binding. See [workspace configuration and filesystem trust](workspace-tools.md).
