# Version 0.10 verification

Verified locally on Windows with Node.js 24.22.0 on 3 November 2026.

| Check | Result |
|---|---|
| Automated suite | 185 passed; zero failures, cancellations or skips |
| Syntax / JSON | Passed across 64 JavaScript files and JSON artifacts |
| Attack simulations | 10/10 expected blocks |
| Policy regression CLI | 8/8 passed |
| Real file adapters | Actual bounded file reads/search and checksum reproduction; startup rejects invalid entries, unsafe content, malformed UTF-8 and oversized manifests |
| Filesystem boundary | Traversal, absolute/nested paths, Windows devices, alternate streams, trailing dots/spaces, hard links, directory junctions and replaced roots rejected without report creation |
| Approval | No report before approval; rejected/changed requests cannot write; approved request creates exact bytes; retry is cached; existing files remain unchanged |
| Provenance and modes | Sensitive sessions cannot write; Safe mode cannot access workspace; Workspace excludes vault/payment; unconfigured workspace rejected |
| Runtime workflow | Real filesystem read → persisted approval pause → exact call resume → completed report; activity metadata tested |

## Actual local model and browser

The disposable host on port 8788 ran with `GATEWAY_QA_REAL_LLM=1` and `GATEWAY_QA_WORKSPACE=1`, using installed local `qwen3.5:4b`. It opened an in-memory gateway database and its own temporary workspace, never the live database, `.env` or project workspace.

1. Connected with the isolated QA operator and selected Workspace mode.
2. Asked the actual model to read `review-notes.md` and prepare `milestone-summary.md` summarizing its three milestones.
3. The model used `workspace.read`, received actual file text, then proposed `workspace.report.save`.
4. The task paused with `HUMAN_APPROVAL_REQUIRED`. Inspected the temporary output directory: zero files.
5. Reviewed the exact generated filename/content in the approval dialog, approved the disposable test request, returned to the task and resumed its exact call.
6. The trace showed both workspace tools completed, across three model turns. The model then confirmed the local save.
7. Read the created file independently and compared it to the approved text: **exact match**, 302 UTF-8 bytes, SHA-256 `7bb4608d493c0322a971163987ab661709708dd1d085a298b9e1fe829734b587`.
8. The browser warning/error log was empty. Screenshot: [completed workspace trace](images/workspace-tools-v0.10.jpg).

Targeted browser checks are interactive, not a committed cross-browser E2E suite. Source input in the main workspace is explicitly labeled sample material. README remains image-free.

## Review and limits

Files are host-reviewed context; this is not an untrusted upload pipeline. Roots/parents must remain protected from untrusted OS writers. Directory checks do not constitute an OS sandbox or eliminate every filesystem race. Reports are plaintext local files with exclusive creation; uncertain executions require inspection rather than automatic retries. Aggregate disk quotas, token streaming, arbitrary folder traversal and multi-tenant workspace provisioning are outside this release. See [setup and trust boundaries](workspace-tools.md).

Agent self-evaluation: **4/5**, an implementation review rather than independent assurance.

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Actual filesystem tests and model/browser approval flow support the claims; independent security review remains useful. |
| Completeness | 4/5 | Adapters, reference host, capabilities, policy, runtime, UI, docs and regression coverage implement the selected features; quotas and automated browser regression remain future work. |
| Clarity | 4/5 | Real versus simulated tools, reviewed inputs and approval semantics are explicit; onboarding could become more guided. |
| Actionability | 4/5 | Dedicated input/output folders and a ready sample prompt are provided; changing reviewed inputs deliberately requires restart/new sessions. |
| Conciseness | 4/5 | Delivery focuses on real workspace work and verification; trust assumptions recur in several guides. |

Critical issues (scores at or below 2): none. Verdict: deliver with documented filesystem and review assumptions.
