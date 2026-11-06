import { assert, digest, idPattern, toolPattern, open, seal } from './util.js';
import { redact } from './scanners.js';

export const TASK_CHECK_LIMITS = Object.freeze({ maxPhrases: 8, maxPhraseChars: 128, maxTools: 8, maxAnswerChars: 32768, maxMessages: 12, maxSteps: 12, maxNumericChecks: 8, maxPathChars: 128, maxJsonDepth: 12 });
export const DEFAULT_TASK_CHECKS = Object.freeze({ requiredPhrases: Object.freeze([]), forbiddenPhrases: Object.freeze([]), requiredTools: Object.freeze([]), requireCompleted: true, rejectDenied: true });
export function validateCriteria(criteria) {
  const phrases = values => Array.isArray(values) && values.length <= TASK_CHECK_LIMITS.maxPhrases && values.every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= TASK_CHECK_LIMITS.maxPhraseChars && !/[\0\r\n]/.test(value)) && new Set(values.map(value => value.toLowerCase())).size === values.length;
  assert(criteria && typeof criteria === 'object' && !Array.isArray(criteria) && Object.keys(criteria).filter(key => key !== 'structuredOutput').sort().join(',') === 'forbiddenPhrases,rejectDenied,requireCompleted,requiredPhrases,requiredTools'
    && phrases(criteria.requiredPhrases) && phrases(criteria.forbiddenPhrases) && Array.isArray(criteria.requiredTools) && criteria.requiredTools.length <= TASK_CHECK_LIMITS.maxTools
    && criteria.requiredTools.every(tool => typeof tool === 'string' && toolPattern.test(tool)) && new Set(criteria.requiredTools).size === criteria.requiredTools.length
    && typeof criteria.requireCompleted === 'boolean' && typeof criteria.rejectDenied === 'boolean', 'INVALID_TASK_CHECKS');
  if (Object.hasOwn(criteria, 'structuredOutput')) {
    const output = criteria.structuredOutput;
    assert(output && typeof output === 'object' && !Array.isArray(output) && Object.keys(output).sort().join(',') === 'numbers,required' && typeof output.required === 'boolean'
      && Array.isArray(output.numbers) && output.numbers.length <= TASK_CHECK_LIMITS.maxNumericChecks, 'INVALID_TASK_CHECKS');
    const paths = new Set();
    for (const rule of output.numbers) {
      assert(rule && typeof rule === 'object' && !Array.isArray(rule) && Object.keys(rule).sort().join(',') === 'max,min,path'
        && typeof rule.path === 'string' && rule.path.length <= TASK_CHECK_LIMITS.maxPathChars && /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(rule.path)
        && rule.path.split('.').length <= TASK_CHECK_LIMITS.maxJsonDepth && !rule.path.split('.').some(key => ['__proto__', 'constructor', 'prototype'].includes(key)) && !paths.has(rule.path)
        && Number.isFinite(rule.min) && Number.isFinite(rule.max) && Math.abs(rule.min) <= Number.MAX_SAFE_INTEGER && Math.abs(rule.max) <= Number.MAX_SAFE_INTEGER && rule.min <= rule.max, 'INVALID_TASK_CHECKS');
      paths.add(rule.path);
    }
  }
}

// Bounded JSON parsing with unique object keys and a depth ceiling. Nothing is evaluated.
function structuredAnswer(answer) {
  let text = answer.trim().replace(/\r\n?/g, '\n');
  if (text.startsWith('```')) { const fence = /^```(?:json)?\n([\s\S]*)\n```$/i.exec(text); if (!fence) return null; text = fence[1]; }
  let value; try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      let next = i + 1; while (/\s/.test(text[next] ?? '') && next < text.length) next++;
      if (text[next] === ':') { const key = JSON.parse(text.slice(start, i + 1)), keys = stack.at(-1); if (keys.has(key)) return null; keys.add(key); }
    } else if (char === '{' || char === '[') { stack.push(char === '{' ? new Set() : null); if (stack.length > TASK_CHECK_LIMITS.maxJsonDepth) return null; }
    else if (char === '}' || char === ']') stack.pop();
  }
  return value;
}
function ownNumber(value, path) {
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key)) return null;
    value = value[key];
  }
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}
function snapshot(task) {
  assert(task && Array.isArray(task.conversation) && task.conversation.length <= TASK_CHECK_LIMITS.maxMessages && Array.isArray(task.steps) && task.steps.length <= TASK_CHECK_LIMITS.maxSteps, 'TASK_CHECK_INPUT_LIMIT');
  const answer = task.conversation.filter(message => message.role === 'assistant').at(-1)?.text ?? '';
  assert(typeof answer === 'string' && answer.length <= TASK_CHECK_LIMITS.maxAnswerChars, 'TASK_CHECK_INPUT_LIMIT');
  return { answer, snapshotHash: digest({ revision: task.revision, state: task.state, code: task.code, answer, steps: task.steps }) };
}
export function evaluateTaskChecks(task, criteria) {
  validateCriteria(criteria); const { answer, snapshotHash } = snapshot(task), text = answer.toLowerCase(), checks = [];
  const add = (kind, passed, value = null) => checks.push({ kind, passed, value });
  add('assistant_answer_present', answer.trim().length > 0);
  if (criteria.requireCompleted) add('task_completed', task.state === 'completed');
  for (const phrase of criteria.requiredPhrases) add('required_phrase', text.includes(phrase.toLowerCase()), phrase);
  for (const phrase of criteria.forbiddenPhrases) add('forbidden_phrase_absent', !text.includes(phrase.toLowerCase()), phrase);
  for (const tool of criteria.requiredTools) add('required_tool_completed', task.steps.some(step => step.tool === tool && step.status === 'completed'), tool);
  if (criteria.rejectDenied) add('no_denied_tool_calls', !task.steps.some(step => step.status === 'denied'));
  const structured = criteria.structuredOutput;
  if (structured && (structured.required || structured.numbers.length)) {
    const object = structuredAnswer(answer); add('json_object_answer', object !== null);
    for (const rule of structured.numbers) { const actual = object && ownNumber(object, rule.path); add('number_in_range', actual !== null && actual >= rule.min && actual <= rule.max, { path: rule.path, min: rule.min, max: rule.max, actual }); }
  }
  return { passed: checks.every(check => check.passed), checks, snapshotHash, answerHash: digest(answer) };
}

export class TaskChecks {
  constructor(store, readTask) { this.store = store; this.readTask = readTask; }
  #read(tenant, id) {
    const row = this.store.db.prepare('SELECT * FROM task_checks WHERE id=?').get(id); if (!row) return null;
    const record = open(this.store.encryptionKey, row.data); assert(row.tenant === tenant && record.tenant === tenant && record.run === id && row.id === id, 'STORAGE_INTEGRITY_FAILURE'); return record;
  }
  get(tenant, id) {
    return this.store.transaction(() => { const task = this.readTask(tenant, id), review = this.#read(tenant, id); return { review: review ? redact(review) : null, currentTaskRevision: task.revision, stale: review ? review.snapshotHash !== snapshot(task).snapshotHash : false, limits: TASK_CHECK_LIMITS }; });
  }
  evaluate(tenant, id, { expectedRevision, expectedTaskRevision, criteria }, actor) {
    assert(typeof actor === 'string' && idPattern.test(actor) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && Number.isSafeInteger(expectedTaskRevision) && expectedTaskRevision >= 0, 'INVALID_TASK_CHECKS'); validateCriteria(criteria);
    return this.store.transaction(() => {
      const task = this.readTask(tenant, id), previous = this.#read(tenant, id); assert(task.revision === expectedTaskRevision && (previous?.revision ?? 0) === expectedRevision, 'VERSION_CONFLICT');
      const result = evaluateTaskChecks(task, criteria), record = { run: id, tenant, revision: (previous?.revision ?? 0) + 1, taskRevision: task.revision, taskState: task.state, taskCode: task.code, checkedAt: Date.now(), criteria, ...result };
      this.store.db.prepare('INSERT INTO task_checks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, tenant, seal(this.store.encryptionKey, record));
      this.store.append({ type: 'agent.checked', tenant, actor, run: id, taskRevision: task.revision, revision: record.revision, passed: result.passed, criteriaHash: digest(criteria), resultHash: digest(record) });
      return { review: redact(record), currentTaskRevision: task.revision, stale: false, limits: TASK_CHECK_LIMITS };
    });
  }
}
