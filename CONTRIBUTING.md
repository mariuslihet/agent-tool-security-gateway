# Contributing

Use Node.js 24.x. Run `npm ci`, `npm run check`, `npm test`, `npm run simulate` and `npm run demo` before proposing changes. Add an adversarial regression for changed enforcement semantics.

Keep authorization deterministic. Do not place identities, trust labels, policy overrides or operator decisions in model-controlled fields. Preserve deny precedence, transactional reservation and request-bound approvals. Never log raw tool arguments/results or forward gateway access tokens to downstream services.

New adapters need strict input/output contracts, bounded work, explicit output provenance, cancellation semantics and a documented isolation boundary. Generic shell/eval helpers do not meet that bar. Update the threat model when guarantees or trust assumptions change.

Use synthetic secrets only in tests. External integrations should be opt-in and tested with local fakes; the default suite must remain offline and require no live credentials.
