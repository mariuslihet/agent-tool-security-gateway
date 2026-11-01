import { assert, bounded, digest, field, freeze, idPattern, toolPattern } from './util.js';

const rootKeys = ['version', 'rules', 'limits'];
const ruleKeys = ['id', 'tools', 'effect', 'when', 'redactFields'];
const conditionKeys = ['field', 'op', 'value'];
const operators = ['equals', 'in', 'contains', 'gte'];
function conditionMatches(c, context) {
  const v = field(context, c.field);
  if (v === undefined) return false;
  if (c.op === 'equals') return digest(v) === digest(c.value);
  if (c.op === 'in') return c.value.some(x => digest(x) === digest(v));
  if (c.op === 'contains') return Array.isArray(v) ? v.includes(c.value) : typeof v === 'string' && typeof c.value === 'string' && v.includes(c.value);
  return typeof v === 'number' && v >= c.value;
}
export class Policy {
  constructor(input) {
    const data = bounded(input, 131072);
    assert(data && Object.keys(data).every(k => rootKeys.includes(k)) && typeof data.version === 'string' && idPattern.test(data.version), 'INVALID_POLICY');
    assert(Array.isArray(data.rules) && data.rules.length <= 256, 'INVALID_POLICY');
    const ids = new Set();
    for (const r of data.rules) {
      assert(Object.keys(r).every(k => ruleKeys.includes(k)) && typeof r.id === 'string' && idPattern.test(r.id) && !ids.has(r.id), 'INVALID_POLICY');
      ids.add(r.id);
      assert(Array.isArray(r.tools) && r.tools.length && r.tools.every(t => t === '*' || toolPattern.test(t)), 'INVALID_POLICY');
      assert(['allow', 'deny', 'approval', 'sanitize'].includes(r.effect), 'INVALID_POLICY');
      assert(Array.isArray(r.when) && r.when.length <= 16, 'INVALID_POLICY');
      for (const c of r.when) {
        assert(Object.keys(c).every(k => conditionKeys.includes(k)) && typeof c.field === 'string' && c.field.length <= 256 && operators.includes(c.op) && Object.hasOwn(c, 'value'), 'INVALID_POLICY');
        if (c.op === 'in') assert(Array.isArray(c.value), 'INVALID_POLICY');
        if (c.op === 'gte') assert(typeof c.value === 'number' && Number.isFinite(c.value), 'INVALID_POLICY');
      }
      if (r.effect === 'sanitize') assert(Array.isArray(r.redactFields) && r.redactFields.length && r.redactFields.every(k => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)), 'INVALID_POLICY');
      else assert(r.redactFields === undefined, 'INVALID_POLICY');
    }
    assert(data.limits && Object.keys(data.limits).sort().join(',') === 'approvalTtlMs,maxArgumentBytes,maxOutputBytes', 'INVALID_POLICY');
    for (const [key, value] of Object.entries(data.limits)) assert(Number.isSafeInteger(value) && value > 0 && value <= (key === 'approvalTtlMs' ? 86400000 : 1048576), 'INVALID_POLICY');
    this.data = freeze(data); this.hash = digest(data);
    Object.freeze(this);
  }
  evaluate(tool, context) {
    const matches = this.data.rules.filter(r => (r.tools.includes('*') || r.tools.includes(tool)) && r.when.every(c => conditionMatches(c, context)));
    const pick = effect => matches.some(r => r.effect === effect);
    return {
      effect: pick('deny') ? 'deny' : pick('approval') ? 'approval' : pick('allow') ? 'allow' : 'deny',
      ruleIds: matches.map(r => r.id),
      redactFields: [...new Set(matches.filter(r => r.effect === 'sanitize').flatMap(r => r.redactFields))],
    };
  }
  explain(tool, context) {
    return { ...this.evaluate(tool, context), rules: this.data.rules.map(r => {
      const toolMatches = r.tools.includes('*') || r.tools.includes(tool);
      const conditions = r.when.map(c => ({ field: c.field, op: c.op, matched: conditionMatches(c, context) }));
      return { id: r.id, effect: r.effect, toolMatches, matched: toolMatches && conditions.every(c => c.matched), conditions };
    }) };
  }
}
