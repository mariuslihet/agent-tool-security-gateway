# Verification record

Verified locally on Windows with Node.js **v24.22.0**, 1 November 2026. This records completed checks, not a security certification.

| Check | Result |
|---|---|
| `npm ci --ignore-scripts --offline` | Passed; no third-party packages required |
| `npm run check` | JavaScript syntax and JSON parsing passed |
| `npm test` | 59 tests passed, no failures or skipped tests |
| `npm run simulate` | 10/10 attack scenarios blocked with expected reason codes |
| `npm run demo` | Isolated computation, denial, redaction, human review, cached replay and exfiltration prevention passed |
| `node examples/custom-gateway.js` | Custom registered tool executed under a scoped profile |
| HTTP server smoke test | Started on loopback; authenticated remote demo created a real pending approval |
| Audit CLI | Persistent development database chain verified |
| Browser check | Dashboard rendered in the in-app browser at its current responsive width; no captured browser errors or warnings |
| Secret exclusion | `.env` and SQLite state confirmed ignored by Git |

## Security coverage

Tests cover denied tools and unknown fields; strict numeric contracts; forged context; tenant isolation; deny precedence; direct/base64 injection signals; canonical destinations and SSRF preflight; transformed exact-request approvals; replay, expiry, rejection, cancellation and self-approval; source labels and encoding chains; dynamic output scanning; call/cost/output/concurrency limits; capability narrowing; shared ancestor state; expiry and revocation; configuration changes; interruption and timeout recovery; two independent processes sharing SQLite; parameterized read-only SQL; bounded named-file access; webhook signing; OpenTelemetry field selection; MCP frames; encrypted record/index binding; and audit failure before and after an external effect.

The deterministic adversarial argument test sends 100 distinct unknown-field payloads and verifies the handler is never invoked.

## Local performance sample

`npm run benchmark`, 200 complete gateway executions against an in-memory SQLite database and a fixed read handler:

| Percentile | Latency |
|---|---|
| p50 | 1.052 ms |
| p95 | 1.807 ms |
| p99 | 2.323 ms |

This is a local sample, not a production SLA or a disk/network benchmark. Source validation and control flow run; network, distributed storage and external services are not part of this measurement.

## Checks not represented as completed

Docker/Compose execution was not tested because Docker was unavailable locally. Windows CI behavior was exercised locally; the supplied GitHub Actions workflow has not been run on GitHub or Linux in this workspace. No live payment, publication, Slack, external webhook delivery, OpenTelemetry collector, or external MCP client interoperability test was performed. Default tests and simulations remain offline. The HTTPS adapter's destination/DNS rejection paths are tested with injected resolution, without contacting a live server.

## Self-evaluation

Summary: **4.0/5** across five axes; usable local reference implementation with documented production boundaries.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Tests exercise enforcement and failure paths; external framework/MCP interoperability remains unverified. Validate with actual target runtimes before claiming compatibility. |
| Completeness | 4/5 | Core, API, dashboard, typed adapters, approvals, telemetry hooks, simulations and deployment files exist. Enterprise identity, managed isolation, key rotation and native Slack integration remain documented extension areas. |
| Clarity | 4/5 | README, API contract, architecture, policy reference and threat model distinguish real controls from simulations. Add deployment-specific diagrams when a target infrastructure is chosen. |
| Actionability | 4/5 | Local credentials are initialized, the server starts, and the approval demo can be resumed with one command. Container execution still needs validation in a Docker-equipped environment. |
| Conciseness | 4/5 | Modules separate enforcement, state and adapters. Trust-boundary limitations repeat in several documents to keep each independently usable; documentation can be consolidated as the public interface stabilizes. |

Critical issues scoring 2 or below: none identified within the stated reference-implementation boundary.

Highest-impact next validation: run the container and Linux CI; verify integration with the intended MCP/framework client; independently assess the deployment with its real adapters and privileges.

Self-check: the assessment should match the delivered result because it reports executable evidence and explicitly identifies deployment work that has not been verified. Verdict: deliver as a runnable reference implementation, with no production-certification claim.
