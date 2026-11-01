import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchema, validate } from '../src/schema.js';
import { Policy } from '../src/policy.js';
import { loadDefaultPolicy } from '../src/demo.js';

test('unsupported and nonsensical schema constraints are rejected at configuration time', () => {
  for (const schema of [
    { type: 'string', pattern: '.*' }, { type: 'number', maxLength: 10 },
    { type: 'string', maxLength: -1 }, { type: 'string', minLength: 10, maxLength: 2 },
    { type: 'object', properties: {}, required: [], additionalProperties: true },
    { type: 'array', items: { type: 'string' }, maxItems: 1.5 },
  ]) assert.throws(() => checkSchema(schema), /INVALID_SCHEMA/);
});
test('relative path format rejects traversal, Windows paths and shell metacharacters', () => {
  const schema = { type: 'string', format: 'relative-path' };
  validate(schema, 'docs/guide.txt');
  for (const value of ['../secret', '/etc/passwd', 'C:\\Windows', 'a//b', 'a/./b', 'a;whoami', 'a\0b']) assert.throws(() => validate(schema, value));
});
test('policy operators use typed values and deny dominates conflicting rules', () => {
  const data = structuredClone(loadDefaultPolicy().data);
  data.rules.push({ id: 'typed-conditions', tools: ['knowledge.read'], effect: 'deny', when: [
    { field: 'identity.tenant', op: 'in', value: ['demo'] },
    { field: 'arguments.document', op: 'equals', value: 'handbook' },
  ] });
  const policy = new Policy(data);
  assert.equal(policy.evaluate('knowledge.read', { identity: { tenant: 'demo' }, arguments: { document: 'handbook' } }).effect, 'deny');
  assert.equal(policy.evaluate('knowledge.read', { identity: { tenant: 'other' }, arguments: { document: 'handbook' } }).effect, 'allow');
  assert.equal(policy.evaluate('unknown.tool', {}).effect, 'deny');
});
