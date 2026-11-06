# Task acceptance checks

Version 0.15 adds **Check result** beside a selected task's organization controls. It evaluates your criteria against the final displayed assistant answer and successful tool trace entries, without running a model or tool.

## Configure and evaluate

1. Open a task and choose **Check result**.
2. Enter required phrases, forbidden phrases and required successful tool names, one per line.
3. Choose whether to require a completed task and reject traces containing denied tool calls. Both default to enabled.
4. Choose **Run acceptance checks**. Each check shows PASS or FAIL; the overall result requires every configured check to pass. A nonblank assistant answer is always required.

Phrase matching is a case-insensitive literal substring search in the **last displayed assistant message**. Earlier answers, user instructions, hidden model context and raw tool outputs are excluded. For example, `77` also matches `177`; choose phrases carefully. Use the optional structured checks below for numeric assertions. Factual verification and semantic grading remain outside these checks.

Required tools must have a trace entry with status `completed`. Model claims, approval waits, denials and indeterminate execution do not count as completion. The denied-call criterion checks any `denied` entry, including an earlier denial followed by recovery. Disabling that review criterion does not change gateway policy or erase the trace.

## Structured answer and number checks

Version 0.17 adds **Structured answer and number checks** inside the check form. Ask the agent to return a JSON object such as {"total":80}. You can require just the object format, or choose **Add number check** and enter a field, minimum and maximum. Set both bounds to 80 for an exact match. Use invoice.total for a nested object. The results show the expected range and actual number; missing or invalid values are explicit failures.

Each numeric check also requires an object answer even if the format checkbox is off. Ranges include both endpoints. Plain JSON or one entire triple-backtick block (unlabeled or labeled json, case-insensitive) is accepted. Prose outside the object/block, top-level arrays/scalars, duplicate decoded keys anywhere, malformed JSON and nesting beyond 12 object/array levels fail the format check. Earlier assistant messages never satisfy it.

Up to eight distinct, case-sensitive paths are allowed, each at most 128 characters and 12 dot-separated parts. Parts start with a letter or underscore and continue with letters, digits, underscores or hyphens. Arrays, literal dotted keys and prototype-related path components are unsupported. Only own object properties are traversed. No expression, code or path is evaluated.

Numeric strings, booleans, null, absent values and nonfinite numbers fail numeric checks. Bounds and actual values must be within ±Number.MAX_SAFE_INTEGER. Numbers use JavaScript binary floating-point parsing/comparison, not arbitrary precision decimal arithmetic; use inclusive tolerances for approximate results. Very small numbers can underflow to zero. Checks confirm configured assertions, not arithmetic provenance or factual truth. Require the calculation tool separately when tool evidence matters.

The existing saved-review encryption, tenant ownership, audit, revision, staleness and rollback behavior applies. Existing criteria without structuredOutput behave as before. Results and downloads contain selected numeric values and paths, but no added full-answer copy. Review exports before sharing. Checks use the displayed, pattern-redacted answer; redaction can make an originally structured answer fail parsing.

## Saved snapshots and staleness

One latest review is retained per task, with encrypted criteria and results. Each evaluation increments its independent check revision; it does not change task revision, grants, budgets, approvals or archive state. Follow-ups retain the criteria but make the older review stale. Even a repeated final answer gets a new task revision and requires re-evaluation.

The server binds the review to task revision, public state/code, final displayed answer and trace. Reads compute staleness against the current snapshot. The console marks changes as newer task data loads. **Check result** fetches the latest saved review; an already displayed card is the last loaded snapshot, not a cross-operator live feed. Concurrent task/check changes reject stale writes rather than overwriting another review.

**Download check snapshot** saves redacted criteria, check results, metadata and hashes as JSON. It includes the current locally known stale flag and omits the full answer/transcript. Evaluation was audited; local download does not add a separate server event. Review the file before sharing.

## Access, bounds and scope

- Operator-only, tenant-scoped endpoints; no model provider is required for historical task review.
- Up to eight required phrases, eight forbidden phrases and eight tool names. Phrases are unique ignoring case, nonblank, single-line and at most 128 characters. Tools use the existing lowercase tool-name format.
- The reference evaluator accepts up to 12 transcript messages, 12 trace steps and a 32,768-character final answer, matching the current runtime bounds.
- Raw criteria/results are encrypted. `agent.checked` audit records include actor, task/check revisions, pass status and criteria/result fingerprints. No raw phrases or answer text enter audit.
- Mandatory audit failure rolls back the review and prevents delivery. Running checks never creates a task/session, calls a provider, executes a tool or authorizes an operation.

Pass means the configured criteria held for that snapshot. Gateway policies continue to authorize execution, and task health separately describes session/approval readiness. Pattern redaction applies to returned criteria/results; editing a redacted criterion replaces its stored value.

## API and SDK

`GET /v1/operator/agent/runs/:id/checks` returns `{review,currentTaskRevision,stale,limits}`; `review` is null before the first evaluation. `POST` to the same path uses the existing heavy-operation rate budget and accepts exactly `{expectedRevision,expectedTaskRevision,criteria}`. Both reject query parameters.

```js
const task = await control.agentRun(taskId);
const current = await control.taskChecks(taskId);
const checked = await control.checkTask(taskId, {
  expectedRevision: current.review?.revision ?? 0,
  expectedTaskRevision: task.revision,
  criteria: {
    requiredPhrases: ['total'], forbiddenPhrases: ['unable'],
    requiredTools: ['compute.sum'], requireCompleted: true, rejectDenied: true,
    structuredOutput: { required: true, numbers: [{ path: 'total', min: 80, max: 80 }] }
  }
});
```

The package root exports `TaskChecks`, `evaluateTaskChecks`, `TASK_CHECK_LIMITS` and `DEFAULT_TASK_CHECKS`. The pure evaluator checks bounded task data; the service adds ownership, revision, encryption and audit behavior.
