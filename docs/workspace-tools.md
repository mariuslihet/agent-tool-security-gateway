# Real local workspace tools

Version 0.10 adds real file search/reading and approval-gated report creation. It uses no cloud API or new dependency. The included `workspace/input/project-brief.md` is clearly labeled sample material; the tools read actual filesystem bytes. Reports are real local files. Publishing and payment adapters remain simulations.

## Use it

1. Keep reviewed `.md` or `.txt` documents directly inside `workspace/input/`. The included example works immediately. Do not put unreviewed downloads, credentials or sensitive documents here.
2. Keep `workspace/reports/` as the separate output directory. The repository includes both directories; it ignores added input documents and generated reports in Git.
3. Restart the gateway after reviewing/adding/changing source files. Startup pins their content hashes into tool fingerprints. Editing a source afterward makes the tool fail closed until a deliberate review/restart. Changing the root or document manifest changes the registry/profile binding, so earlier sessions need a fresh task.
4. Connect as an operator. Select **Workspace: reviewed files and approval-gated reports**. Safe mode stays limited to the original handbook/arithmetic/encoding tools.
5. Ask the agent to search/read a document and prepare a local report. Review the exact filename and content in **Approvals**. Approve or reject it, then return to the selected task and choose **Resume exact pending call**.

Example prompt:

```text
Read project-brief.md using workspace.read. Summarize the goal and milestones.
Use workspace.report.save to create project-summary.md. Wait for approval.
```

The browser displays model-generation, tool-evaluation/execution and operator-waiting activity. Active tasks refresh every 2.5 seconds. This is polling of persisted state, not token streaming or access to private model reasoning.

## Tools and limits

| Tool | Behavior |
|---|---|
| `workspace.search` | Literal case-insensitive query; empty query lists pinned filenames. At most ten matches with 240-character snippets; `truncated` is explicit. |
| `workspace.read` | Reads an exact manifest filename, returns UTF-8 text and SHA-256 of the bytes. |
| `workspace.report.save` | Creates one new `.md`/`.txt` file after exact-request approval; returns filename, bytes and SHA-256. Never overwrites and does not publish anything. |

Reference bounds: 1–50 reviewed input files, 8,192 bytes per input/report, 128 query characters, 80 filename characters. Filenames use ASCII letters/numbers/underscores/hyphens plus one lowercase `.md`/`.txt` extension. No nested directories, absolute paths, traversal, device names, hidden files, alternate streams, links or arbitrary extensions. Startup rejects unsupported entries in the input directory. Input/report content rejects invalid encoding, control characters and detected secret/injection patterns. These patterns are not a complete detector.

An existing output filename causes a non-retryable uncertain result through the gateway's conservative adapter-error handling, leaving the original file unchanged. Inspect the folder and use a different filename in a new task if needed. A timeout or persistence failure can occur after a file was created; inspect the output before retrying anything. No automatic deletion or overwrite is provided. There is no aggregate report disk quota or retention scheduler in this release.

## Host configuration and trust

The CLI uses `./workspace` when it exists. Set `GATEWAY_WORKSPACE_ROOT` to an explicit host-owned directory containing `input/` and `reports/`, or set it to `off` to disable these tools. A malformed configured workspace prevents startup. The reference CLI uses one demo tenant; custom multi-tenant hosts must register distinct roots and scoped profiles themselves. `createDemo` rejects custom profiles combined with a workspace root.

Input and report files are ordinary plaintext files, separate from the encrypted conversation database. Workspace contents are excluded from Docker build contexts; explicitly mount reviewed input and a separate report directory when deploying in a container.

The source is **host-reviewed context**, not an untrusted upload inbox. Its clean content may enter the local model context. Classified or untrusted session labels still prevent forwarding data and prevent report egress; approval cannot override those restrictions. Search/read is read-only. Reports are marked egress conservatively so the existing secret, provenance, containment, approval and audit gates apply.

The root, its parents and both directories must be protected from modification by untrusted processes. The adapters pin directory identity, reject links, check file identity/content and create output exclusively with owner-only mode where supported. These checks are not an OS sandbox and do not remove all filesystem races against another process that can replace trusted parent directories. Protect Windows access permissions separately. The agent must not have independent filesystem access that bypasses the gateway.

## Embedding and testing

`registerWorkspaceTools(registry, { root })` registers adapters; an embedding host must separately configure capability profiles and an exact-request approval policy for `workspace.report.save` before constructing its gateway. The helper alone is not authorization. `createDemo({ workspaceRoot })` supplies that reference policy automatically.

The disposable browser host accepts `GATEWAY_QA_WORKSPACE=1` to create a temporary sample workspace, alongside `GATEWAY_QA_REAL_LLM=1` for actual local inference. It never opens the live workspace or persistent gateway database and removes its own temporary files at shutdown.
