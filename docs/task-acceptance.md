# Task acceptance checks

Version 0.15 adds **Check result** beside a selected task's organization controls. It evaluates your criteria against the final displayed assistant answer and successful tool trace entries, without running a model or tool.

## Configure and evaluate

1. Open a task and choose **Check result**.
2. Enter required phrases, forbidden phrases and required successful tool names, one per line.
3. Choose whether to require a completed task and reject traces containing denied tool calls. Both default to enabled.
4. Choose **Run acceptance checks**. Each check shows PASS or FAIL; the overall result requires every configured check to pass. A nonblank assistant answer is always required.

Phrase matching is a case-insensitive literal substring search in the **last displayed assistant message**. Earlier answers, user instructions, hidden model context and raw tool outputs are excluded. For example, `77` also matches `177`; choose phrases carefully. Numeric assertions, factual verification and semantic grading are outside these checks.

Required tools must have a trace entry with status `completed`. Model claims, approval waits, denials and indeterminate execution do not count as completion. The denied-call criterion checks any `denied` entry, including an earlier denial followed by recovery. Disabling that review criterion does not change gateway policy or erase the trace.

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
    requiredTools: ['compute.sum'], requireCompleted: true, rejectDenied: true
  }
});
```

The package root exports `TaskChecks`, `evaluateTaskChecks`, `TASK_CHECK_LIMITS` and `DEFAULT_TASK_CHECKS`. The pure evaluator checks bounded task data; the service adds ownership, revision, encryption and audit behavior.
