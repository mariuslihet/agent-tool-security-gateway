# Reusable template fields

Version 0.13 adds named fields to prompt templates. Choose **Prompt with fields** in the template editor, then use placeholders such as:

```text
Read {{document}} and summarize it for {{audience}}.
```

Save the template with its intended tool mode. Choose **Fill template fields**, enter values and select **Fill new-task form**. Review the completed prompt, tool mode and current budget, then explicitly start a task. Saving, filling or loading a template never creates a session, calls a model, executes a tool or grants approval.

## Syntax and bounds

- Field names start with a lowercase letter, followed by lowercase letters, digits or underscores, at most 32 characters.
- Up to eight distinct fields per template. Repeated fields use the same value.
- Each value is nonblank text of at most 2,000 characters; the completed prompt must fit the existing 8,000-character bound.
- Names must match exactly. Missing/extra fields, non-text values, NULs and malformed placeholders fail before loading.
- Expressions, property access and scripts are unsupported. Values are inserted literally once; a value containing `{{other}}` is not recursively expanded.

Plain templates remain the default and preserve literal braces, including older templates without a type flag. Existing parameterized templates keep their type when an older client omits the new flag during an update. Changing type explicitly is supported.

## Review, privacy and revisions

Every console load now uses a server render step, including plain templates. The server checks tenant ownership, enabled state and the exact expected revision. An edit or disable after the field form opened prevents loading; close it and reopen the latest enabled template.

Rendering audits actor, template ID/revision, mode and input/output fingerprints, without raw field values or prompt text. Audit failure prevents delivery. Field values are not saved as a separate render record or in browser storage. Closing the dialog or changing connection clears the field controls. If you later start a task, its completed prompt becomes part of the existing encrypted conversation storage.

Known secret patterns are redacted from literal template segments, field values and the completed prompt. Placeholder syntax is preserved in editable templates. Redaction remains pattern-based; use placeholders rather than storing credentials in reusable prompts.

The currently selected new-task budget is preserved. Filling a template does not change an existing task's permissions, history, budget or pending approval. Disabling a template prevents new console loads, but cannot revoke text already loaded or replace gateway policy. Field text is prompt data, not authorization.

## API and SDK

Template saves accept optional `parameterized: true`; reads return `parameterized` and derived `variables`. Template lists also expose `variableLimits`.

`POST /v1/operator/agent/templates/:id/render` requires operator access and an exact body `{expectedRevision, values}` with no query parameters. Plain templates require `values: {}`. The response contains `{id, revision, prompt, toolMode, variables, reviewRequired}`. It uses the existing ordinary API rate limit and does not require an available model provider.

```js
const saved = await control.saveTaskTemplate({
  expectedRevision: 0, title: 'Document summary',
  prompt: 'Read {{document}} and summarize for {{audience}}.',
  parameterized: true, toolMode: 'workspace_readonly', enabled: true
});
const rendered = await control.renderTaskTemplate(saved.id, {
  expectedRevision: saved.revision,
  values: { document: 'project-brief.md', audience: 'project reviewers' }
});
// Present rendered.prompt, tool mode and chosen budget for review before starting.
```

The package root exports `templateVariables`, `renderPromptTemplate` and `TEMPLATE_VARIABLE_LIMITS` for trusted hosts. Those pure helpers format text; only the service endpoint adds ownership/revision/enabled checks and mandatory render audit.
