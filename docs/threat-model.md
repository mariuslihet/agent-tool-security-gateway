# Threat model

## Protected assets

Downstream tool authority, credentials, task budgets, sensitive tool output, tenant separation, approval integrity, execution history and operator access.

## Adversary capabilities

Assume the model can propose arbitrary JSON tool requests, copy hostile instructions from retrieved material, encode data, retry calls and attempt multi-step misuse. Assume tool output may contain hostile instructions or secrets. A tenant may submit adversarial requests against another tenant's identifiers.

The gateway host, operator credential issuance, trusted runtime identity mapping, policy files, tool handler code, deployment artifacts, master key and operating system are trusted. A compromised host or privileged operator can bypass this application.

## Controls and limits

| Risk | Control | Important limit |
|---|---|---|
| Unauthorized tool use | Default deny, tool fingerprint and typed capability checks | Host must remove direct access to protected tools |
| Indirect prompt injection | Untrusted provenance blocks egress; pattern signals can deny calls | Patterns do not reliably detect all natural-language injection |
| Multi-step exfiltration | Conservative session-tree labels, in-flight sequencing, secret/PII checks | No complete tracking through arbitrary model paraphrasing, outside channels or separate root sessions |
| Approval replay or mutation | Exact request/config binding, expiry and transactional consumption | Operator credentials and review device must be protected |
| Duplicate execution | Durable reservation and immutable idempotency binding | No exactly-once guarantee for an external service; uncertain calls require reconciliation |
| DNS rebinding / SSRF | Exact configured origin, all-answer IP validation, pinned address, no redirects | Public IPs may still host attacker-controlled services; operator origin allowlists matter |
| Filesystem traversal | Logical document IDs, realpath containment, no-follow final open | Root and parent directories must not be writable by attackers; OS-specific symlink races require deployment isolation |
| Database misuse | Read-only connection, named fixed queries, bound values, row limits | Trusted SQL must be bounded; synchronous query execution cannot be preempted by a JS timer |
| Secret leakage | Host-side scoped broker, output redaction, no arguments/results in audit | Pattern redaction is incomplete for arbitrary formats; source classification is essential |
| Resource exhaustion | Input/output limits, budgets, concurrency, HTTP rate limits, worker heap/time limits | In-process hostile handlers can block the event loop; isolate untrusted code outside this process |
| Audit tampering | HMAC chain and encrypted state | Deletion/truncation/rollback needs an external checkpoint; keys on the host cannot resist host compromise |
| Cross-tenant access | Server-issued identity, session ownership, tenant-scoped queues/events/metrics | Trusted library methods are privileged; expose only authenticated server routes to agents |

## Isolation is a deployment property

Only `compute.sum` executes in the supplied restricted child process. Its code is fixed and trusted; it accepts numbers, not programs. Node's permission model is defense in depth, **not a sandbox for arbitrary hostile JavaScript or shell code**. The Node 24 permissions used here restrict filesystem/process operations; they do not provide a network firewall. The fixed worker performs no network operations and starts with an empty environment. See the [official Node 24 permission-model limits](https://nodejs.org/download/release/latest-v24.x/docs/api/permissions.html). This project deliberately does not offer `eval`, arbitrary shell, arbitrary Python or arbitrary SQL execution.

The HTTPS adapter restricts destinations per connection. It does not configure the host's firewall. The container configuration reduces privileges for the demo but does not supply per-tool containers, microVMs, seccomp profiles, a managed secrets service, or external firewall automation. Configure those independently before adding powerful adapters.

## Operational guarantees

- Authorization storage failure prevents new dispatch.
- Telemetry or webhook failure cannot allow a denied call or approve a pending call.
- Handler failure and timeout return an indeterminate outcome without the raw exception.
- Timeout requests keep concurrency reserved because aborting a promise does not prove an external side effect stopped.
- Revocation stops new reservations. An operation already reserved may still complete.
- Session creation is a **trusted runtime operation**. Do not expose root-session creation as a model tool, or let a model discard a tainted task's session and reuse its memory in a fresh session.
- HTTP bearer tokens in this reference host are local service credentials, not a complete enterprise identity solution. Use TLS and an authenticated identity provider for remote deployment. No OAuth token passthrough is implemented.

## Deferred enterprise integrations

No native Slack application, OAuth authorization server, managed KMS rotation, Kubernetes operator, distributed Redis/Postgres state store, universal AST analyzer, semantic classifier, or certified framework-specific SDK is included. The webhook, tracing, typed adapter and HTTP boundaries provide integration points. These are explicit extension areas rather than simulated security guarantees.
