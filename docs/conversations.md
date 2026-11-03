# Conversation follow-ups, tool modes, usage and exports

Version 0.7 builds on the real local Ollama runtime. The public sample remains non-interactive; model answers are generated only after an operator connects and submits a task or follow-up.

## Continue a task

After a task completes, use **Ask a follow-up** to send another user message with the prior conversation still in context. It retains the same gateway session, tool grants, classifications, approvals, revocations and accumulated usage. It does not create a fresh security boundary or reset budgets.

Follow-ups require a completed task, an unexpired/current session, the same configured model and remaining model turns. Resolve a waiting approval/hold using its separate workflow before continuing. A failed/stopped task cannot receive another message. The existing six-model-turn and twelve-tool-evaluation limits apply to the entire task, including all follow-ups; one question can consume multiple model turns while using tools. Start a new task when its budget or session expires.

Each message includes a client-generated `messageId` and `expectedRevision`. Repeating the same ID and prompt returns the existing state without generating again. Reusing it for a changed prompt fails. A new message with a stale revision returns `VERSION_CONFLICT`. The current record is checked again in the same SQLite transaction that claims the worker lease and appends the message. Existing cross-process leases still prevent concurrent workers from running one task.

The boundary is `authenticated operator → strict message schema → tenant/session/model/revision checks → encrypted task append + audited prompt hash + worker lease → ordinary gateway tool authorization`. The API does not accept a new model, actor, session, tool mode or tool grants in a follow-up. Actor attribution is taken from the authenticated credential. Browser retries retain the same message ID after a transport failure; editing the message or switching tasks starts a different pending submission.

New records have a monotonically increasing revision. Existing version 0.6 records retain their prior rights and are read with revision 0 until their first update; no conversation or audit rewrite is needed. Their initial prompt ID is also treated as already consumed. Expired old sessions still require a new task.

## Select tool access when starting

| Mode | Actual session capabilities |
|---|---|
| `safe` (default) | Intersection of host grants with `knowledge.read`, `compute.sum`, `text.encode`; tools must also have no egress or predeclared sensitive/untrusted output labels |
| `chat_only` | Zero tool grants and an empty model tool catalog |
| `all` | All capabilities already granted to the configured runtime principal, subject to normal gateway controls |

The runtime creates the session with the narrowed grant set from the start. It does not briefly create broad rights and hide them from the model. An empty capability set is valid for a session; delegated children cannot expand it. Even a direct gateway execution attempt against a chat-only session is denied. Host identity profiles still require their normal configured grants.

“Safe” names a small reference allowlist, not a claim that arbitrary internal tools are read-only or risk-free. The handbook remains a fixture, arithmetic and encoding are actual bounded operations, and selecting `all` does not make publishing/payments real integrations. All tool modes still enforce policy, approval, provenance, contracts, quotas, revocations and containment. The model cannot change its mode during the task. Existing 0.6 tasks without a recorded mode are displayed as `all`, reflecting their original behavior; they are not silently broadened or narrowed on upgrade.

Start idempotency binds both the original prompt and tool mode. Retrying an older all-tools task through the start API requires explicit `toolMode: 'all'` instead of the new safe default.

## Usage statistics

The [Ollama chat API](https://docs.ollama.com/api/chat) can report `prompt_eval_count`, `eval_count` and `total_duration`. The adapter validates nonnegative numeric statistics and converts provider duration from nanoseconds to milliseconds. The runtime aggregates completed model requests, reported input/output tokens, reported provider duration and measured local request time across follow-ups.

Input totals include repeated context, not unique conversation tokens. Provider duration and local request time are different measurements; neither includes time spent waiting for human review. Statistics are observational and never grant permissions, change quotas or estimate a monetary bill. The fixed model-turn/tool budgets remain independently enforced.

Coverage states how many responses reported statistics and how many requests were timed. Missing statistics display as unknown; older tasks do not receive invented historical token totals. After continuing an older task, only newly recorded statistics contribute to reported totals, while request coverage includes the earlier model turns. Completed requests whose result could not be committed because of mandatory storage/audit failure may be absent from the recorded totals.

## Export a conversation

An operator can download JSON (conversation, trace, limits, mode and usage) or Markdown (human-readable transcript and gateway trace). Export reads a redacted public task snapshot and does not include the internal system message, raw model context, pending arguments or cached tool outputs. Pattern redaction can miss unknown sensitive formats; downloaded text leaves encrypted application storage, so review before sharing.

Markdown conversation content is fenced with a delimiter longer than any embedded backtick run, preserving user/model text as data rather than active images, links or HTML. The file is never automatically opened or rendered by the console. JSON remains a data download.

Exports require operator role and tenant ownership, use the shared heavy-operation budget and append an `agent.exported` audit event before returning. Audit contains actor, task/session identifiers, format and content hash, not transcript text. Audit failure prevents export delivery. The returned `contentHash` is SHA-256 over the exact UTF-8 content bytes, verifiable against the downloaded file; it is an unkeyed checksum, not a digital signature. Exports can describe an in-progress task and reflect only the state observed at that time.

## Client example

```js
const started = await control.startAgent({
  id: crypto.randomUUID(), prompt: 'Add 7, 11 and 24 using the tool.', toolMode: 'safe'
});
// Poll until completed before appending a follow-up.
const completed = await control.agentRun(started.id);
const continued = await control.followUpAgent(completed.id, {
  messageId: crypto.randomUUID(), expectedRevision: completed.revision,
  prompt: 'Add eight to that result.'
});
const exported = await control.exportAgent(continued.id, 'json');
```

The example omits the polling loop for brevity; follow-up fails if the selected task is still running. API shapes are in [the API reference](api.md).
