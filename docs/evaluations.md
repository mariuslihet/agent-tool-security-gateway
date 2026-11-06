# Reusable model evaluations

Open **AI agent → Evaluation suites**. Create a suite, give each case a prompt and read-only tool mode, then configure acceptance criteria. The advanced criteria editor supports the same phrases, completed-tool evidence, JSON and number checks as **Check result**. Saving never invokes the model.

Choose **Run suite** explicitly. Each case creates a new gateway task/session and uses the real configured Ollama model. Cases run sequentially with the normal six-turn, twelve-evaluation and six-minute attempt ceilings; existing host limits remain stricter. A suite contains at most eight cases. Retained tasks still count toward the existing 100-task tenant limit.

Modes are limited to safe, chat-only, workspace-read-only and read-only tools. Database connectors require the read-only mode and explicit host configuration. Write/report/publishing/payment tools cannot be granted by a suite. Confidential or untrusted tool results still stop model forwarding.

## Review and comparison

The selected run shows each case's pass/fail result, actual check evidence, task link, model and provider-reported usage. Select two retained runs to compare changed pass results and token totals. Missing statistics count as zero and are explicitly disclosed. Case IDs align comparisons; changed suite snapshots are flagged and do not constitute controlled model comparisons.

Criteria are assertions you configure, not semantic or factual grading. A passing number check proves only that the answer's chosen field met the range; require successful tool evidence separately. Policy and model changes can legitimately change results.

## Execution and recovery

- Suite revisions and full case snapshots are encrypted. Running evaluations retain their original snapshot, model/configuration receipts and results even if a suite is edited.
- Configuration drift rejects later case dispatches. Each new case must match its receipt; policies and approvals are still checked at execution.
- At most two evaluation leases and two agent task leases can be live globally. Suites do not reserve all future agent capacity. A busy gateway or changed configuration stops the evaluation with an explicit code; no automatic retry occurs.
- Approval waits or interrupted cases stop the suite as blocked. Open the linked task for investigation. Evaluations never approve or resume a tool call.
- **Stop evaluation** records a stop before requesting cancellation of its current task. It prevents future case dispatches. Already-dispatched work may finish. A failed child-stop request can be retried against a stopped evaluation; inspect its linked task.
- Process interruption or restoring a backup marks incomplete evaluation leases interrupted. There is no automatic execution on restart. Start a fresh evaluation after reviewing incomplete case tasks and external effects.
- Up to 25 suites and 100 evaluation runs are retained per tenant. There is no destructive purge command in this release.

## API and privacy

Operator-only routes under `/v1/operator/evaluations`:

| Route | Operation |
|---|---|
| `GET /suites`, `GET /suites/:id` | Metadata list and full saved suite |
| `POST /suites` | Save `{id?,expectedRevision,title,cases}` |
| `GET /runs`, `GET /runs/:id` | Retained results and progress |
| `POST /runs` | Start `{id,suiteId,expectedRevision}`; reuse the same ID for a lost-response retry |
| `POST /runs/:id/cancel` | Stop; empty body |
| `POST /compare` | Compare `{left,right}` without model calls |

Cases use `{id,prompt,toolMode,criteria}`. Unknown fields/query parameters are rejected. Mutations and comparisons use the heavy-operation budget. Review records contain checks and selected numeric values, but not duplicated full answers; linked tasks retain the encrypted conversation. Pattern redaction is applied to saved suites and public results. Evaluation audit records contain hashes, IDs and metadata, never raw prompts or criteria. Mandatory audit failure prevents new evaluation dispatch or result delivery.

The SDK exposes suite save/list, evaluation start/get, and comparison helpers. Existing task APIs expose each case's full execution trace and health separately.

## Visual criteria and result exports

Version 0.19 provides visual fields for required/forbidden phrases, successful tools, completion and denied-call rules. Expand **JSON and number checks** to require an object answer and add up to eight fields with inclusive minimum/maximum bounds. Equal bounds mean an exact match. Saved rules reopen in these controls; no JSON editing is needed for the supported criteria. The optional advanced JSON editor stays synchronized and retains unknown fields for server validation rather than silently discarding them. Its incomplete/invalid drafts show an error.

Choose **Download evaluation results** beside the selected run. JSON contains the public run metadata, usage and complete check evidence, including selected numeric values. CSV is a UTF-8 case summary with run state, task links by ID, metrics, case hashes and export time; if there are no results yet it includes a metadata-only row with blank case fields. CSV text cells are quoted and potentially executable spreadsheet formulas are prefixed with an apostrophe.

Both formats are snapshots, including when exported during execution. They exclude prompts, full answers, hidden suite snapshots and execution receipts. Pattern redaction has limits; selected check values may still be private. Review before sharing. The browser verifies the UTF-8 SHA-256 returned by the server before downloading. Auditing must succeed before content is delivered. Exporting never invokes the model, starts a case or changes task state.

Operator-only POST /v1/operator/evaluations/runs/:id/export accepts exactly {format:'json'|'csv'}, rejects query parameters, uses the heavy-operation budget and returns {format,content,contentHash,exportedAt,scope,mediaType}. The SDK exposes exportEvaluation(id,format). evaluation.exported audit events retain actor, run, format, hash and snapshot state/counts, never raw exported content.
