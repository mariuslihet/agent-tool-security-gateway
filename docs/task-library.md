# Task library and prompt templates

Version 0.8 adds organization around real AI tasks. Library changes do not call a model, execute tools, alter capabilities, reset budgets or change conversation content. Prompt templates are reusable starting text, not executable workflows or approval grants.

## Titles, tags and pins

Use **Organize** on a task-library row or **Organize selected task** in its detail view. A task can have an 80-character title, up to eight unique tags, a pin flag and an archive flag. Tags use 1–32 lowercase letters, digits, underscores or hyphens. Unnamed existing tasks receive a display title based on their ID without any data migration or model inference.

Organization is encrypted in its own table. Its `revision` advances independently of the task's conversation revision, so a model response cannot overwrite an operator's title and editing a title does not invalidate an otherwise current follow-up revision. Both updates are serialized through SQLite, and stale organization revisions return HTTP 409 `VERSION_CONFLICT`. A failed required audit append rolls back the metadata update.

Audit records include actor, task/session IDs, pin/archive flags, metadata revision and a title/tag hash. Raw titles and tags are excluded. Display values use the same pattern redaction as other private control-plane records. Renaming replaces the latest encrypted organization record; audit fingerprints do not reconstruct prior title text.

## Archive and restore

Only completed, failed or stopped tasks can be archived. Queued, running, waiting and interrupted executions must be resolved through their normal workflow. Archiving hides a task from the default active-library view but preserves the task, session, permissions, transcript, usage and audit evidence. It does not revoke permissions, cancel effects or free a slot in the existing 100-task retention allowance.

An archived task cannot accept a new follow-up or be resumed. Restore it through **Organize** before continuing; its original session expiry, model binding, provenance and cumulative budgets still apply. Existing idempotent requests can read their prior state without generating new work. Archive checks are repeated inside the worker-claim transaction so a concurrent organization change cannot silently restart hidden work.

Archive is a reversible workflow flag, not a confidentiality boundary. Operators can still inspect/export a task by ID or through the archived view. No delete/purge API is added.

## Find retained conversations

The library supports literal, case-insensitive search across title, tags, task/session IDs and model name, plus state, archive and pin filters. It does not search raw conversation bodies. Pins sort first, followed by the newest task/organization update, then ID for deterministic ties.

The server examines at most the retained 100 tenant tasks inside one read transaction. Pages contain up to 100 summaries; the browser uses 25. Responses include `total`, `offset`, `limit` and `nextOffset`. Offset pagination reflects current state rather than a signed insertion snapshot: pinning or updating records between page requests can move them between pages. Tenant authorization applies independently to every request.

These list responses still omit conversation text and tool results. Full conversations remain on the existing operator-only task detail endpoint. Viewer and agent credentials cannot access task-library or template endpoints.

## Prompt templates

**Save current prompt as template** opens an editor with a title, prompt, tool mode and enabled flag. It can also start from an empty form. The explicit reference limits are 25 retained templates per tenant, 80-character titles and 8,000-character prompts. Disabled templates still count toward that bound and can be edited/re-enabled. There is no delete operation.

Templates are encrypted, tenant-scoped, revision checked and audited by actor, template ID, mode, enabled state and content hash. Raw prompt/title text is excluded from audit. Read responses redact known secret patterns; only that displayed text is loaded. Editing and saving replaces the displayed values, so use placeholders rather than storing secrets in a reusable prompt.

**Load prompt** fills the new-task prompt and tool-mode selector. It never starts a model, creates a session, changes the selected existing task, grants approval, or modifies that task's fixed tool mode. Review the prompt and selected access mode, then choose **Start new AI task**. Template edits do not retroactively alter existing tasks.

Disabling a template hides it from the default enabled-template view and disables its quick-load action. It is not a security revocation: an authorized operator can read/edit the text and submit their own new prompt. Normal gateway controls apply to every task created from template text, including all-granted mode.

## Trust boundaries

- Organization: authenticated operator → strict body/tenant ownership/revision checks → encrypted metadata write plus audit in one transaction. The execution record is not modified.
- Templates: authenticated operator → strict size/mode/revision/tenant checks → encrypted prompt record plus audit. There is no execution step.
- Loading: private template response → redacted text placed in the new-task form → explicit operator submission → existing session attenuation and model/tool enforcement.

All user/model text is rendered with text DOM helpers. Task names are never used as filesystem paths or commands. Library state is cleared from the browser on source changes; no prompt/template data is saved to browser storage by the application.

## Client and API

```js
const page = await control.agentRuns({ search: 'math', archive: 'active', pinned: 'true', limit: 25 });
const task = await control.agentRun(page.items[0].id);
await control.organizeAgent(task.id, {
  expectedRevision: task.organization.revision,
  title: 'Arithmetic review', tags: ['math'], pinned: true, archived: false
});
const saved = await control.saveTaskTemplate({
  expectedRevision: 0, title: 'Arithmetic helper', prompt: 'Add 12, 18 and 20 using the tool.',
  toolMode: 'safe', enabled: true
});
const templates = await control.taskTemplates({ enabled: 'true' });
const template = await control.taskTemplate(saved.id);
// Reading a template has no execution effect. Submit a separately reviewed task to use it.
```

See [the API reference](api.md) for endpoint shapes. Existing limits and runtime behavior remain documented in [local AI](local-ai.md) and [conversation features](conversations.md).
