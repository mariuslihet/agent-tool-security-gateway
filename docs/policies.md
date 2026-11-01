# Policies and contracts

Policies are strict JSON documents, checked when `Policy` is constructed. JSON is used directly; YAML parsing and arbitrary executable policy plugins are not included. Unknown fields, actions, operators and schema keywords are rejected.

## Policy shape

```json
{
  "version": "example-v1",
  "limits": { "maxArgumentBytes": 32768, "maxOutputBytes": 65536, "approvalTtlMs": 300000 },
  "rules": [
    { "id": "read-only", "tools": ["knowledge.read"], "effect": "allow", "when": [] },
    { "id": "review", "tools": ["report.publish"], "effect": "approval", "when": [] },
    { "id": "redact", "tools": ["report.publish"], "effect": "sanitize", "when": [], "redactFields": ["body"] }
  ]
}
```

Rules match exact tool names or `*`. All conditions in `when` must match. Matching deny takes precedence over approval, which takes precedence over allow. A sanitize rule does **not** grant permission. Rules with missing context fields do not match.

| Operator | Meaning |
|---|---|
| `equals` | Canonical JSON equality |
| `in` | Context value equals a member of the configured array |
| `contains` | Array membership, or literal substring for strings |
| `gte` | Numeric greater than or equal |

Available context paths: `arguments.<field>`, `identity.principal`, `identity.tenant`, `session.labels`, `session.calls`, `session.cost`, and `findings`. Calls include the current new request; cost reflects earlier reservations. All session and identity fields are infrastructure-supplied.

There are no user-supplied regular expressions, scripts, `eval` expressions or model-based authorization decisions. Scanner patterns are fixed, bounded by request size and intentionally heuristic.

## Sanitization

`redactFields` names top-level argument fields. Redaction recurses through their values and replaces recognized secrets/email addresses or sensitive object-key values. The transformed request is validated again against schema, capability constraints and policy. Arbitrary shell-command rewriting is not supported.

For outgoing tools, detected secrets, encoded secrets and residual PII are hard denials. Untrusted/sensitive session egress restrictions are also hard denials, including when a human approves an earlier request.

## Tool contracts

Every tool has an input object schema, an output schema, description, fixed cost, timeout, egress flag and output labels. Network tools also identify their URL argument through `destinationField`.

The contract language is a **subset** of JSON Schema: `type`, `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `maxItems`, and `format`. Supported types: object, array, string, number, integer, boolean and null. Supported formats: canonical `https-url` and constrained `relative-path`. Unsupported JSON Schema keywords fail registration. Validation never coerces types.

Input/output nesting is capped at 12; default string length is 16,384 and default array length is 100. Input and output byte limits apply in addition. Tool handlers must bound their work internally; validating a result after return cannot prevent a handler from allocating excessive memory first.

## Capabilities and delegation

```js
const grants = [{
  tool: 'report.publish',
  fingerprint: registry.get('report.publish').fingerprint,
  values: { /* optional top-level argument name -> exact allowed JSON values */ },
  origins: ['https://reports.example.com'],
}];
```

The trusted host installs profiles with IDs, tenant, grants and limits. Multiple grants can represent alternatives. Child sessions may reduce tools, origins, argument value sets, TTL or budgets. Removing a parent constraint or increasing a limit is rejected. Child requests consume all ancestor budgets; sibling sessions cannot reset a parent's budget or provenance.

Budget meanings:

- `maxCalls`: unique attempted calls, including policy denials; cached retries do not charge again.
- `maxCost`: cumulative host-assigned integer units reserved before dispatch; never refunded automatically.
- `maxConcurrent`: reserved outstanding operations, including unresolved timeout/crash uncertainty.
- `maxOutputBytes`: cumulative serialized bytes returned by inspected tools. The call that crosses the threshold executes but its output is withheld.
- `ttlMs`: session lifetime, also bounded by the parent's expiry.

To compare policies without changing enforcement, construct a candidate `Policy` and call `gateway.simulate`, or use the operator simulation endpoint. This compares rule outcomes against a state snapshot; it is **not** a full hypothetical execution of capabilities, redaction, budgets or side effects.
