# agent-tool-security-gateway

**An external authorization boundary for tool-using AI agents.** Validate each tool request, enforce task capabilities, require exact-request human approval, and execute through a registered adapter. Decisions and outcomes are durably audited.

Built with Node.js 24 and its standard library. No runtime dependencies, hosted model, API key, or paid service is required for the demo.

> **Release status: security-focused reference implementation, v0.6.0.** The gateway and its controls are functional; the default publishing and payment tools are simulations. An independent security assessment and deployment-specific isolation are still required before entrusting it with production privileges. See [the threat model](docs/threat-model.md).

## The operator console

Eleven workspaces turn security decisions into an inspectable workflow: **AI Agent**, **Overview**, **Approvals**, **Incidents**, **Security Alerts**, **Safety Controls**, **Sessions**, **Request Explorer**, **Tool Catalog**, **Policy Studio**, and **Audit Explorer**. The console opens with a clearly labeled, isolated sample workspace; it never automatically connects to private data. The AI Agent workspace requires a real model connection and never substitutes sample replies.

Version 0.2 adds persistent activity totals, a 24-hour activity chart, tenant-bound cursor pagination, audit filters and JSONL exports, capability and budget inspection, encrypted reviewer notes, read-only viewer access, policy diagnostics and rule explanations, readiness checks, correlation IDs, and a control-plane SDK. See [the console guide](docs/control-plane.md) and [release notes](CHANGELOG.md).

Version 0.3 adds grouped incident records with investigation notes and optimistic concurrency, temporary tenant-wide pauses enforced across processes, and a batch policy regression runner for the browser and CI. See [incident response and containment](docs/incident-response.md).

Version 0.4 adds searchable request outcomes and timelines, operator-only audited argument inspection, configurable local threshold alerts, and metadata-only workspace reports with reproducible content hashes. See [investigation and alerts](docs/investigation.md).

Version 0.5 adds expiring session-tree quarantine, tenant-scoped tool maintenance holds, exact-revision release and read-only workspace health diagnostics. Session and tool inspectors link directly to the scoped containment form. See [scoped containment and health](docs/scoped-containment.md).

Version 0.6 adds a real Ollama agent loop: generated text, model-proposed tools enforced by the gateway, exact-call approval/hold resume, encrypted task history, cancellation and bounded execution. See [local AI setup](docs/local-ai.md).

## Use a real local LLM

Install Ollama and a tool-capable local model, then add these non-secret settings to `.env` and restart `npm start`:

```dotenv
LLM_PROVIDER=ollama
LLM_MODEL=qwen3.5:4b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Open **AI Agent**, connect with the operator token, test the model connection and submit a task. No external API key is needed. `npm run ai:smoke` performs a real local-model arithmetic task against the running gateway; it is separate from offline tests and requires configured Ollama.

Model answers are generated at runtime. The sample dashboard remains pre-generated, the handbook/invoice/page tools remain fixtures, and publishing/payment adapters remain simulations. Generated text does not prove an external action occurred: inspect the gateway trace. A new task gets a new session and ID; retrying the same ID deliberately reuses stored state.

## Run locally

Requires **Node.js 24.13 or newer in the 24.x release line**. The project uses `node:sqlite` and the Node permission model.

```powershell
cd D:\PROIECTE\agent-tool-security-gateway
npm ci
npm run init
npm start
```

Open **http://127.0.0.1:8787** and choose **Connect gateway**. Copy `GATEWAY_OPERATOR_TOKEN` from the generated `.env`, or use `GATEWAY_VIEWER_TOKEN` for read-only access. Access tokens and workspace data stay in tab memory and are cleared when switching sources. Only the color-theme preference is saved in browser storage.

In another terminal, populate the running gateway with a safe read and a publishing approval:

```powershell
node --env-file=.env examples/demo.js --remote
```

Review the request in the dashboard, then resume it:

```powershell
node --env-file=.env examples/demo.js --resume
```

The demo saves its task in `var/demo-task.json`. Approval permits the agent runtime to retry **the same session, request ID, tool, and original arguments**. It does not execute the operation from the dashboard. Default publishing always returns `{ "delivered": false, "mode": "simulation" }`.

For a complete offline walkthrough, including automatic approval by a **simulated operator**:

```sh
npm run demo
npm run simulate
npm run policy:test
npm test
npm run check
npm run benchmark
```

`demo` and `simulate` use ephemeral databases and disposable keys; they do not change the running server. `init` refuses to overwrite an existing `.env`. Protect `.env` with your operating system's file permissions; it is ignored by Git. No secrets are printed by setup.

## What is implemented

| Area | Behavior |
|---|---|
| Enforcement | Frozen tool registry, strict contracts, default deny, explicit deny precedence, execution only after durable authorization |
| Identity and capabilities | Host-supplied identity; tool fingerprints; argument value and HTTPS-origin allowlists; session expiry; profile/policy/registry binding |
| Stateful defense | Conservative sensitive/untrusted session labels; ancestor propagation; encoding does not clear labels; in-flight reads block outbound calls |
| Inspection | Bounded pattern checks, base64 inspection, secret/email redaction, input and output validation |
| Human review | Durable pending requests; exact argument/configuration binding; expiry, rejection, cancellation, no self-approval, single consumption; encrypted decision notes |
| Runtime control | Shared ancestor budgets, concurrency limits, request idempotency, persisted indeterminate execution, emergency revocation |
| Storage | SQLite transactions, AES-256-GCM request/session storage, separately derived HMAC audit key, chained audit verification |
| Adapters | Fixed computation in a restricted child process; named read-only files; named parameterized read-only SQLite queries; pinned-DNS HTTPS JSON POST |
| Credentials | Per-tool host-side secret broker; downstream credentials stay outside model context |
| Integrations | HTTP API, JavaScript client, function-calling dispatcher, minimal version-pinned MCP stdio transport |
| Operations | Eleven-page console, viewer role, durable tenant totals and hourly chart, searchable/paginated audit and exports, session inspector, tool catalog, policy studio, readiness and correlation IDs |
| Local AI runtime | Real Ollama generation and function calling; guarded dispatch, encrypted tasks, approval/pause resume, cancellation, shared task leases, finite loops and classified-result withholding |
| Request investigation | Tenant/filter-bound request pagination, status/tool/search filters, bounded exact-request timelines and audited operator argument inspection; cached outputs never exposed |
| Local alerts | Encrypted threshold rules, rolling event windows, deduplication, version-checked acknowledgement/resolution, reopening cooldown and encrypted notes |
| Workspace reports | Tenant metadata snapshot, configuration fingerprints, counts, containment status, cached integrity status, SHA-256 content hash and audited generation |
| Incident response | Grouped high-risk signals, owner labels, encrypted investigation notes, version-checked dispositions, recurrence reopening and source-event links |
| Containment | Audited temporary all-tool/outbound pauses, automatic expiry, exact-revision resume, cross-process enforcement; existing reservations may finish |
| Scoped response | Quarantine a session and descendants; pause one registered tool across a tenant; encrypted reasons, expiry, exact revisions and shared transactional enforcement |
| Workspace health | Read-only diagnostics for pending/expired approvals, uncertain execution, outstanding reservations, sampled configuration changes and active holds; explicit sampling limits |
| Policy regression | Bounded 50-case hypothetical suites, expected decisions/codes, policy/suite fingerprints, downloadable reports and an offline CI command |
| Observability | OpenTelemetry and signed webhook sinks, process-local latency samples, durable average latency, explicit full-chain verification |
| Verification | Attack simulations, adversarial unit/integration tests, restart and concurrent-process tests, syntax checks, local benchmark, Windows/Linux CI |

## Agent integration

```js
import { GatewayClient } from './src/client.js';

// Kept in the trusted runtime, never included in model messages.
const client = new GatewayClient({ token: process.env.GATEWAY_AGENT_TOKEN });
const { sessionId } = await client.createSession();
const result = await client.execute(sessionId, {
  id: 'runtime-persisted-call-001',
  tool: 'compute.sum',
  arguments: { numbers: [10, 20, 12] },
});
// result.output.sum === 42
```

Treat `denied`, `approval_required`, `paused`, and `indeterminate` as normal runtime outcomes. Preserve the original request ID and arguments while waiting for a pause to clear. Never invent a fresh request ID to retry an uncertain side effect. See [the API and recovery contract](docs/api.md) and [function-calling example](examples/function-calling.js).

LangChain, CrewAI, AutoGen, and custom runtimes can call this API through their tool interfaces. Framework-specific packages and compatibility certification are not included. The dispatcher shows the standard function-calling boundary without requiring an LLM SDK.

## MCP stdio

```sh
npm run mcp
```

For a host that expects stdout to contain **only protocol messages**, invoke Node directly rather than npm:

```sh
node --env-file=.env src/cli.js mcp
```

Supports MCP `2025-06-18`: initialization, ping, tool listing, tool calls and initialized notifications. No HTTP MCP transport, OAuth issuer, resources, prompts, sampling, or session resumption. Supply a stable `_meta["gateway/requestId"]` when retrying a call with a new JSON-RPC ID. Operator approvals use the HTTP control plane sharing the same database and master key. See [integration notes](docs/integrations.md).

## Extend the gateway

The CLI registers demonstration tools. For real resources, compose `Registry`, `Policy`, `Store`, and `Gateway` from [src/index.js](src/index.js) in a trusted host application. Register typed adapters before constructing the gateway and pin their returned fingerprints in capability profiles. An example is in [examples/custom-gateway.js](examples/custom-gateway.js).

Keep the agent process separate from the gateway. Give only the gateway access to downstream credentials, files and services. Protect its tool configuration and database. A decorator running beside an agent with unrestricted shell access cannot enforce complete mediation.

## Documentation

- [Architecture and execution state machine](docs/architecture.md)
- [Threat model and explicit limitations](docs/threat-model.md)
- [Policy and tool contract reference](docs/policies.md)
- [HTTP API and recovery](docs/api.md)
- [Integration, notifications and tracing](docs/integrations.md)
- [Deployment and operational runbook](docs/deployment.md)
- [Operator console, roles, investigation and policy testing](docs/control-plane.md)
- [Verification results and remaining validation](docs/verification.md)
- [Version 0.2 verification and interface review](docs/verification-v0.2.md)
- [Incident response, containment and policy regression](docs/incident-response.md)
- [Version 0.3 verification](docs/verification-v0.3.md)
- [Investigation, alerts and reporting](docs/investigation.md)
- [Version 0.4 verification](docs/verification-v0.4.md)
- [Scoped containment and workspace health](docs/scoped-containment.md)
- [Version 0.5 verification](docs/verification-v0.5.md)
- [Real local AI setup and recovery](docs/local-ai.md)
- [Version 0.6 verification](docs/verification-v0.6.md)
- [Security reporting](SECURITY.md)

## Guidance behind the design

The design applies least agency and tool-boundary authorization described by [OWASP's AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) and [Excessive Agency guidance](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/?lang=us). MCP deployments must also follow the protocol's [security best practices](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices), including avoiding token passthrough. The implementation uses the official [Node.js SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) and [permission model](https://nodejs.org/download/release/latest-v24.x/docs/api/permissions.html).

License: Apache-2.0. This project is not a claim of OWASP compliance or complete prompt-injection prevention.
