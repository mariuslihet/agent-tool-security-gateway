# Review a task before starting

In **AI agent**, enter a prompt, choose tool access and budgets, then select **Review task**. The review shows the configured model, effective host-granted tools, task and session budgets, outbound data/simulation labels, potential approval rules, heuristic prompt findings and a capacity snapshot. Select **Start reviewed task** to submit the inspected draft.

The review invokes no model or tool and creates no session or task. Each successful review writes an `agent.planned` audit event containing fingerprints and budget metadata. Mandatory audit failure withholds the response. Only operators can use this endpoint; draft prompt content is redacted for display using the existing pattern scanner. Pattern detection is incomplete. The original prompt is sent to the configured local model when started.

## Receipts and changes

`planHash` binds the original prompt hash, tenant and agent identity, model and local endpoint, tool mode, selected task budget, effective grants/limits, and policy, registry and profile hashes. `expectedPlanHash` on task creation rejects a changed draft or configuration with `AGENT_PLAN_CHANGED` (HTTP 409) before creating a session. The browser also checks that the draft still matches its reviewed copy.

A receipt is a configuration comparison value, not an approval token, signed attestation, capacity reservation or proof of prior review. API clients can compute an equivalent hash. Direct starts without a receipt remain available. The gateway still enforces every actual tool argument, approval, revocation, containment and budget at execution. Exact retries of an existing task return the stored result without inference and compare any supplied receipt to that task's original receipt.

## What the preview cannot decide

- Approval rule names are candidates based on tool name; conditions depend on future arguments and session context. Review does not approve a tool call.
- Grants describe capability, not an unconditional allow decision. Pauses, revocations, taint and policies can still deny execution.
- Capacity and retention counts are snapshots. Another task can take capacity before submission. Review neither reserves capacity nor changes locks.
- No reachability request is sent to Ollama. Use **Test model connection** separately.
- Prompt findings are heuristics. An empty findings list provides no assurance against prompt injection or sensitive data.
- Safe/chat/workspace modes remain subsets of host permissions. Publishing and payments stay explicitly labeled simulations.

The SDK exposes `client.planAgent({ prompt, toolMode, taskLimits })`. Submit the same draft through `startAgent` with a fresh task ID and `expectedPlanHash` from the review. Keep the same ID and receipt for a lost-response retry; review again after a configuration mismatch.
