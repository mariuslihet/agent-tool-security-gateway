# Per-task budgets and read-only research

Version 0.12 adds **Task budgets** in the new-task form and a **Workspace read only** access mode.

## Choose a budget

| Preset | Model turns | Tool evaluations | Time per execution attempt |
|---|---:|---:|---:|
| Standard | 6 | 12 | 6 minutes |
| Quick | 2 | 2 | 1 minute |
| Custom | 1–6 | 1–12 | 1–6 whole minutes in the console |

The API accepts an optional `taskLimits` object with all three keys: `maxTurns`, `maxToolCalls`, `maxRunMs`. Millisecond runtime bounds are 1,000–360,000. Values must be integers and cannot exceed the reference ceilings. Invalid, unknown or incomplete limit objects fail before session creation. Omitting the object selects Standard.

The selected limits are stored encrypted with the task, displayed beside the conversation and reflected in task health. Start retries bind the effective limits as well as prompt/mode: changing them with the same task ID is rejected. Follow-up/resume requests cannot edit limits. Changing the new-task form never changes the selected existing task.

Follow-ups share the original completed-model-turn and tool-evaluation counters. Approval waits do not count as completed tool evaluations; the same pending request resumes with its stable ID. A budget can stop a task before it generates a final answer, especially when a prompt needs multiple model/tool rounds.

New task sessions also receive a gateway `maxCalls` ceiling no greater than the task's chosen tool count or the host's existing call allowance. Direct calls, denied attempts and delegated sessions remain subject to that session/ancestor budget. A stricter host allowance wins. Legacy sessions retain their original limits; old task records without a budget use the original runtime ceilings.

## Runtime semantics

Time is bounded **per active execution attempt**, including a resumed attempt. Each attempt uses the same immutable time allowance. Waiting for human approval does not keep the execution timer running; approval expiry and the original session expiry still apply. There is no total wall-clock lifetime budget added here.

The runtime checks its deadline before dispatch and cooperatively aborts model generation at timeout. An operation already dispatched may finish under its own adapter timeout; a deadline cannot undo a report save or other side effect. Completed model turns are counted after a provider response; interrupted generation can repeat during recovery. These controls do not provide a token quota or predict model output cost.

## Read-only workspace mode

`workspace_readonly` grants the safe handbook/arithmetic/encoding tools plus `workspace.search` and `workspace.read`. It excludes `workspace.report.save`, publishing, payment and vault tools. The underlying session capability set enforces this, including direct calls and delegation; the model cannot obtain write authority by asking for it.

The full Workspace mode still offers report saving after exact-request approval. Safe mode remains the default. Read-only workspace mode requires a configured reviewed workspace and preserves its existing content/secret checks.

Prompt templates can store the read-only mode. Templates continue to store prompt/mode only; loading one or reusing an original prompt keeps the current new-task budget selection. Review all fields before starting. Session grants and budgets of existing tasks are never copied or changed by those form actions.

## SDK example

```js
const run = await control.startAgent({
  id: crypto.randomUUID(),
  prompt: 'Read project-brief.md and summarize the milestones.',
  toolMode: 'workspace_readonly',
  taskLimits: { maxTurns: 2, maxToolCalls: 2, maxRunMs: 60000 }
});
```

Configuration exposes `defaultTaskBudget` and existing `limits` ceilings. Task details return effective `limits`, and task health adds `attemptTimeLimitMs`. The SDK also exports `DEFAULT_TASK_BUDGET` for trusted hosts.
