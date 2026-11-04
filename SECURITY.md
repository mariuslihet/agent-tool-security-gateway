# Security policy

This repository is a reference implementation. Version 0.13.x receives fixes while it remains the current release. It has not undergone an independent penetration test or security certification.

Do not publish exploitable details, live tokens, keys, sensitive tool output or production database files in a public issue. If this repository is hosted on GitHub with private vulnerability reporting enabled, use **Security → Report a vulnerability**. Otherwise contact the repository maintainer through an independently verified private channel before disclosing details. No reporting email address is invented here.

Useful reports include affected version, minimal reproduction using synthetic data, expected enforcement decision, actual result and relevant redacted audit reason codes. Include whether the attacker controls model output, tool output, runtime identity, a handler, an operator token or the host.

See [the threat model](docs/threat-model.md) for the trust boundary. Bypassing heuristic injection patterns is not by itself an authorization bypass; demonstrate the protected operation that becomes possible.
