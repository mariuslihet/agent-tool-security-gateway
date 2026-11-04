import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { templateVariables, renderPromptTemplate } from '../src/prompt-templates.js';
import { AgentRuntime } from '../src/agent-runtime.js';
import { fixture } from './helpers.js';

const input = { expectedRevision: 0, title: 'Document summary', prompt: 'Summarize {{document}} for {{audience}}. Cite {{document}}.', parameterized: true, toolMode: 'workspace_readonly', enabled: true };
const create = f => new AgentRuntime({ gateway: f.gateway, provider: { model: 'template-test', complete: async () => { throw new Error('Rendering must not call the model'); } } });

test('template fields are explicit, unique, bounded identifiers without expression evaluation', () => {
  assert.deepEqual(templateVariables(input.prompt), ['document', 'audience']);
  for (const prompt of ['{{ user }}', '{{user.name}}', '{{__proto__}}', '{{A}}', '{{x', 'x}}', '{{x()}}', '{{' + 'a'.repeat(33) + '}}']) assert.throws(() => templateVariables(prompt), /INVALID_TEMPLATE_PLACEHOLDER/);
  assert.throws(() => templateVariables(Array.from({ length: 9 }, (_, i) => `{{field${i}}}`).join(' ')), /TEMPLATE_VARIABLE_LIMIT/);
  assert.equal(renderPromptTemplate('{{constructor}}: {{value}} / {{value}}', { constructor: 'literal', value: '$& {{nested}} <em>text</em>' }), 'literal: $& {{nested}} <em>text</em> / $& {{nested}} <em>text</em>');
});

test('render values reject missing/extra fields, non-text, NULs and expansion beyond prompt bounds', () => {
  for (const values of [null, [], {}, { a: 'yes', extra: 'no' }, { a: 1 }, { a: '  ' }, { a: '\0' }, { a: 'x'.repeat(2001) }, Object.create({ a: 'inherited' })]) assert.throws(() => renderPromptTemplate('{{a}}', values), /INVALID_TEMPLATE_VALUES/);
  assert.throws(() => renderPromptTemplate('{{a}}'.repeat(5), { a: 'x'.repeat(2000) }), /RENDERED_PROMPT_TOO_LARGE/);
  assert.equal(renderPromptTemplate('{{a}}'.repeat(4), { a: 'x'.repeat(2000) }).length, 8000);
  assert.equal(renderPromptTemplate('For {{audience}}', { audience: '工程团队' }), 'For 工程团队');
});

test('rendered prompts redact known secret fields and patterns after literal substitution', () => {
  const result = renderPromptTemplate('For {{audience}}: password=fixed-secret; {{message}} {{password}}', { audience: 'reviewers', message: 'Contact synthetic@example.com', password: 'sensitive-value-7744' });
  assert.ok(!result.includes('fixed-secret')); assert.ok(!result.includes('synthetic@example.com')); assert.ok(!result.includes('sensitive-value-7744')); assert.match(result, /REDACTED/);
  assert.ok(!renderPromptTemplate('password=fixed-secret{{break}}tail', { break: '\nx' }).includes('fixed-secret'));
});

test('template renders are revision-bound, tenant scoped, audited and never create work or persist values', t => {
  const f = fixture(t), agent = create(f), saved = agent.library.saveTemplate('demo', input, 'reviewer'), before = f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  assert.deepEqual(saved.variables, ['document', 'audience']); const values = { document: 'private-document-7841.md', audience: 'private-audience-4132' };
  const rendered = agent.library.renderTemplate('demo', saved.id, { expectedRevision: saved.revision, values }, 'reviewer'); assert.equal(rendered.prompt, 'Summarize private-document-7841.md for private-audience-4132. Cite private-document-7841.md.'); assert.equal(rendered.toolMode, 'workspace_readonly'); assert.equal(rendered.reviewRequired, true);
  assert.equal(agent.list('demo').total, 0); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, before);
  const event = f.store.events('demo')[0]; assert.equal(event.type, 'agent.template_rendered'); assert.equal(event.actor, 'reviewer'); assert.ok(!JSON.stringify(event).includes(values.document)); assert.ok(!JSON.stringify(event).includes(values.audience)); assert.ok(!f.store.db.prepare('SELECT data FROM task_templates').get().data.includes(values.document));
  assert.throws(() => agent.library.renderTemplate('other', saved.id, { expectedRevision: 1, values }, 'reviewer'), /TEMPLATE_NOT_FOUND/);
  const disabled = agent.library.saveTemplate('demo', { ...input, id: saved.id, expectedRevision: 1, enabled: false }, 'reviewer');
  assert.throws(() => agent.library.renderTemplate('demo', saved.id, { expectedRevision: 1, values }, 'reviewer'), /VERSION_CONFLICT/);
  assert.throws(() => agent.library.renderTemplate('demo', saved.id, { expectedRevision: disabled.revision, values }, 'reviewer'), /TEMPLATE_DISABLED/);
  const secretField = agent.library.saveTemplate('demo', { ...input, prompt: 'password={{password}}' }, 'reviewer'); assert.equal(secretField.prompt, 'password={{password}}'); assert.deepEqual(secretField.variables, ['password']);
});

test('plain templates preserve legacy literal braces, while parameterized saves validate atomically', t => {
  const f = fixture(t), agent = create(f), saved = agent.library.saveTemplate('demo', { ...input, parameterized: false, prompt: 'Literal {{user.name}} text' }, 'reviewer'); assert.deepEqual(saved.variables, []);
  assert.equal(agent.library.renderTemplate('demo', saved.id, { expectedRevision: 1, values: {} }, 'reviewer').prompt, 'Literal {{user.name}} text');
  assert.throws(() => agent.library.renderTemplate('demo', saved.id, { expectedRevision: 1, values: { unknown: 'no' } }, 'reviewer'), /INVALID_TEMPLATE_VALUES/);
  const count = agent.library.templates('demo').items.length, events = f.store.verifyAudit().count;
  assert.throws(() => agent.library.saveTemplate('demo', { ...input, prompt: '{{x.y}}' }, 'reviewer'), /INVALID_TEMPLATE_PLACEHOLDER/); assert.equal(agent.library.templates('demo').items.length, count); assert.equal(f.store.verifyAudit().count, events);
  const parameterized = agent.library.saveTemplate('demo', input, 'reviewer'); const { parameterized: omitted, ...oldClientUpdate } = { ...input, id: parameterized.id, expectedRevision: 1, title: 'Updated' };
  assert.equal(agent.library.saveTemplate('demo', oldClientUpdate, 'reviewer').parameterized, true);
});

test('mandatory render audit failures prevent delivery and template state remains unchanged', t => {
  const f = fixture(t), agent = create(f), saved = agent.library.saveTemplate('demo', input, 'reviewer'), append = f.store.append.bind(f.store); f.store.append = () => { throw new Error('Injected audit failure'); };
  assert.throws(() => agent.library.renderTemplate('demo', saved.id, { expectedRevision: 1, values: { document: 'notes.md', audience: 'reviewers' } }, 'reviewer'), /Injected audit failure/); f.store.append = append; assert.equal(agent.library.template('demo', saved.id).revision, 1); assert.equal(agent.list('demo').total, 0);
});

test('parameterized templates survive encrypted reopen with field metadata and disabled state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-variables-')), path = join(dir, 'state.sqlite'), key = randomBytes(32).toString('hex'); let f;
  try {
    f = fixture(null, { path, key }); let agent = create(f); const saved = agent.library.saveTemplate('demo', { ...input, enabled: false }, 'reviewer'); f.store.close(); f = fixture(null, { path, key }); agent = create(f);
    const restored = agent.library.template('demo', saved.id); assert.equal(restored.parameterized, true); assert.equal(restored.enabled, false); assert.deepEqual(restored.variables, ['document', 'audience']); assert.throws(() => agent.library.renderTemplate('demo', saved.id, { expectedRevision: 1, values: { document: 'notes.md', audience: 'reviewers' } }, 'reviewer'), /TEMPLATE_DISABLED/);
  } finally { f?.store.close(); assert.ok(dir.startsWith(join(tmpdir(), 'gateway-variables-'))); rmSync(dir, { recursive: true, force: true }); }
});
