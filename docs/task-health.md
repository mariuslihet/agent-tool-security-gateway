# Task health and prompt reuse

Version 0.9 adds read-only diagnostics beside the selected conversation. **Refresh task health** fetches a server snapshot without invoking the LLM, executing a tool, changing budgets, resuming work or approving anything.

The panel shows remaining model turns, tool evaluations, session calls, tool cost units and output bytes. Cost units are configured accounting units, not currency or LLM billing. Task counters differ from session counters; pending approvals may not yet count as finished task evaluations.

Follow-up diagnostics explain archive state, unfinished work, turn exhaustion, missing/changed provider configuration, session expiry, configuration changes, revocation and withheld data. Tool restrictions separately show holds, tenant pauses, missing registrations and revoked grants. Session quarantine is displayed even for chat-only tasks.

Pending metadata includes the request ID, tool, dispatch status and approval state/expiry. Arguments, output, prompt text, hidden context, approval bindings and credentials are omitted.

## Snapshot limits

This is advisory information, not authorization or a promise that a request will succeed. Execution rechecks policy, approval, schemas, capacity, lineage and per-tool costs. A follow-up can generate prose despite tool restrictions; those restrictions are separate from task/session blockers. Diagnostics do not probe Ollama reachability, predict decisions for future arguments or reserve capacity. Use **Test model connection** for a provider probe.

The endpoint checks task ownership and session integrity in a read transaction. It is operator-only, accepts no query parameters and uses the existing API rate limit. It produces no audit write because it changes no state.

## Reuse an original prompt

**Reuse original prompt** fills the new-task form with the first displayed user message, already redacted by the detail API. It resets the selector to **Safe tools**, including for an original all-granted task. Review it, then explicitly choose **Start new AI task**.

Reuse creates no task/session or model call. History, approvals, grants, metadata and budgets are not copied. Later submission creates an independent task under normal retention/capacity controls; the original is unchanged. Archived prompts can be reused without restoring the task.

## API and client

`GET /v1/operator/agent/runs/:id/health` returns `schemaVersion`, task/organization revisions, `checkedAt`, state/code, session status/expiry/labels/containment, five budget counters (`used`, `limit`, `remaining`), follow-up blockers, tool restrictions, pending metadata or null, and an advisory notice.

```js
const snapshot = await control.agentHealth(taskId);
console.log(snapshot.budgets.modelTurns.remaining);
console.log(snapshot.followUp.blockers);
```

Prompt reuse is a browser form action with no new write endpoint.
