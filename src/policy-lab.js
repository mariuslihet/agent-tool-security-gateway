import { Policy } from './policy.js';
import { assert, bounded, digest, GatewayError, idPattern } from './util.js';
import { validate } from './schema.js';
import { inspect, redact } from './scanners.js';

export function validatePolicyDocument(document, registry) {
  let policy;
  try { policy = new Policy(document); }
  catch { return { valid: false, diagnostics: [{ severity: 'error', code: 'INVALID_POLICY', message: 'The policy does not match the supported contract. Check its version, rules, conditions and limits.' }] }; }
  const diagnostics = [], tools = new Set(registry.list().map(t => t.name));
  for (const rule of policy.data.rules) {
    for (const tool of rule.tools) if (tool !== '*' && !tools.has(tool)) diagnostics.push({ severity: 'warning', code: 'UNKNOWN_TOOL', ruleId: rule.id, message: `Tool ${tool} is not registered.` });
    if (rule.tools.includes('*') && rule.effect === 'allow' && !rule.when.length) diagnostics.push({ severity: 'warning', code: 'BROAD_ALLOW', ruleId: rule.id, message: 'This rule allows every registered tool unless another control denies it.' });
    if (rule.tools.includes('*') && rule.effect === 'deny' && !rule.when.length) diagnostics.push({ severity: 'warning', code: 'GLOBAL_DENY', ruleId: rule.id, message: 'This rule denies all tools, including approval-gated tools.' });
  }
  return { valid: true, hash: policy.hash, version: policy.data.version, rules: policy.data.rules.length, diagnostics };
}

// Pure preview: never creates sessions, approvals, reservations or audit records.
export function previewPolicy({ registry, policy, tenant, principal = 'policy-preview', tool, arguments: input, labels = [] }) {
  assert(typeof principal === 'string' && idPattern.test(principal) && typeof tool === 'string', 'INVALID_PREVIEW');
  assert(Array.isArray(labels) && labels.every(l => ['sensitive', 'untrusted'].includes(l)), 'INVALID_PREVIEW');
  const definition = registry.get(tool)?.definition;
  const result = { execution: false, scope: 'hypothetical-policy-and-inspection', capabilityChecks: false, budgetChecks: false, decision: 'deny', code: 'UNKNOWN_TOOL', findings: [], transformed: false };
  if (!definition) return result;
  try {
    let args = bounded(input, policy.data.limits.maxArgumentBytes);
    validate(definition.inputSchema, args);
    const context = value => ({ arguments: value, identity: { principal, tenant }, session: { labels, calls: 1, cost: 0 }, findings: inspect(value) });
    let explanation = policy.explain(tool, context(args));
    if (explanation.effect !== 'deny' && explanation.redactFields.length) {
      for (const key of explanation.redactFields) if (Object.hasOwn(args, key)) args[key] = redact(args[key]);
      validate(definition.inputSchema, args);
      result.transformed = digest(args) !== digest(input); explanation = policy.explain(tool, context(args));
    }
    Object.assign(result, { explanation, findings: inspect(args), arguments: redact(args), decision: explanation.effect, code: explanation.effect === 'deny' ? 'POLICY_DENIED' : explanation.effect === 'approval' ? 'HUMAN_APPROVAL_REQUIRED' : 'POLICY_ALLOW' });
    if (definition.egress) {
      let code;
      if (labels.includes('sensitive')) code = 'SENSITIVE_EGRESS_DENIED';
      else if (labels.includes('untrusted')) code = 'UNTRUSTED_EGRESS_DENIED';
      else if (result.findings.some(f => /PRIVATE_KEY|API_KEY|CREDENTIAL/.test(f))) code = 'SECRET_EGRESS_DENIED';
      else if (result.findings.some(f => f.includes('EMAIL'))) code = 'PII_EGRESS_DENIED';
      if (code) Object.assign(result, { decision: 'deny', code, hardBlock: true });
    }
    return result;
  } catch (error) { return { ...result, decision: 'deny', code: error instanceof GatewayError ? error.code : 'INVALID_PREVIEW' }; }
}
