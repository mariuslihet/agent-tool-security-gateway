import { randomUUID } from 'node:crypto';
import { assert, digest, idPattern, open, seal } from './util.js';
import { redact } from './scanners.js';
import { templateVariables, renderPromptTemplate, redactTemplateSource, TEMPLATE_VARIABLE_LIMITS } from './prompt-templates.js';

export const TASK_LIBRARY_LIMITS = Object.freeze({ maxTitleChars: 80, maxTags: 8, maxTagChars: 32, maxTemplates: 25, maxPromptChars: 8000 });
const isId = value => typeof value === 'string' && idPattern.test(value) && value.length <= 96;
const isActor = value => typeof value === 'string' && idPattern.test(value);
const titleValid = title => typeof title === 'string' && title.trim().length > 0 && title.length <= TASK_LIBRARY_LIMITS.maxTitleChars && !title.includes('\0');
export class TaskLibrary {
  constructor(store, readRun) { this.store = store; this.readRun = readRun; }
  #decode(row, tenant, id) { const r = open(this.store.encryptionKey, row.data); assert(row.tenant === tenant && r.tenant === tenant && r.id === id && row.id === id, 'STORAGE_INTEGRITY_FAILURE'); return r; }
  #templatePublic(record) { return { ...redact(record), prompt: record.parameterized ? redactTemplateSource(record.prompt) : redact(record.prompt), parameterized: record.parameterized ?? false, variables: record.parameterized ? templateVariables(record.prompt) : [] }; }
  #templateRecord(tenant, id) { assert(isId(id), 'INVALID_TEMPLATE'); const row = this.store.db.prepare('SELECT * FROM task_templates WHERE tenant=? AND id=?').get(tenant, id); assert(row, 'TEMPLATE_NOT_FOUND'); return this.#decode(row, tenant, id); }
  organization(tenant, id) {
    this.readRun(tenant, id); const row = this.store.db.prepare('SELECT * FROM task_organization WHERE id=?').get(id);
    return row ? redact(this.#decode(row, tenant, id)) : { id, tenant, title: `AI task ${id.slice(0, 8)}`, tags: [], pinned: false, archived: false, revision: 0, updated: null };
  }
  organize(tenant, id, input, actor) {
    const { expectedRevision, title, tags, pinned, archived } = input;
    assert(isActor(actor) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && titleValid(title)
      && Array.isArray(tags) && tags.length <= TASK_LIBRARY_LIMITS.maxTags && new Set(tags).size === tags.length
      && tags.every(tag => typeof tag === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag)) && typeof pinned === 'boolean' && typeof archived === 'boolean', 'INVALID_TASK_ORGANIZATION');
    return this.store.transaction(() => {
      const run = this.readRun(tenant, id), previous = this.organization(tenant, id); assert(previous.revision === expectedRevision, 'VERSION_CONFLICT');
      if (archived) assert(['completed', 'failed', 'stopped'].includes(run.state), 'TASK_NOT_ARCHIVABLE');
      const record = { id, tenant, title, tags, pinned, archived, revision: previous.revision + 1, updated: Date.now() };
      this.store.db.prepare('INSERT INTO task_organization VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, tenant, seal(this.store.encryptionKey, record));
      this.store.append({ type: 'agent.organized', tenant, actor, run: id, session: run.sessionId, pinned, archived, revision: record.revision, metadataHash: digest({ title, tags }) });
      return redact(record);
    });
  }
  templates(tenant, { enabled = 'all' } = {}) {
    assert(['all', 'true', 'false'].includes(enabled), 'INVALID_QUERY');
    const rows = this.store.db.prepare('SELECT * FROM task_templates WHERE tenant=? ORDER BY rowid DESC LIMIT ?').all(tenant, TASK_LIBRARY_LIMITS.maxTemplates + 1);
    assert(rows.length <= TASK_LIBRARY_LIMITS.maxTemplates, 'STORAGE_INTEGRITY_FAILURE');
    const items = rows.map(row => this.#decode(row, tenant, row.id)).filter(r => enabled === 'all' || String(r.enabled) === enabled);
    return { items: items.map(record => this.#templatePublic(record)), limits: TASK_LIBRARY_LIMITS, variableLimits: TEMPLATE_VARIABLE_LIMITS };
  }
  template(tenant, id) { return this.#templatePublic(this.#templateRecord(tenant, id)); }
  renderTemplate(tenant, id, { expectedRevision, values }, actor) {
    assert(isActor(actor) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 1, 'INVALID_TEMPLATE_RENDER');
    return this.store.transaction(() => {
      const record = this.#templateRecord(tenant, id); assert(record.revision === expectedRevision, 'VERSION_CONFLICT'); assert(record.enabled, 'TEMPLATE_DISABLED');
      if (!record.parameterized) assert(values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length === 0, 'INVALID_TEMPLATE_VALUES');
      const prompt = record.parameterized ? renderPromptTemplate(record.prompt, values) : redact(record.prompt); assert(prompt.length <= TEMPLATE_VARIABLE_LIMITS.maxRenderedChars, 'RENDERED_PROMPT_TOO_LARGE');
      this.store.append({ type: 'agent.template_rendered', tenant, actor, template: id, revision: record.revision, inputHash: digest(values), promptHash: digest(prompt), toolMode: record.toolMode });
      return { id, revision: record.revision, prompt, toolMode: record.toolMode, variables: record.parameterized ? templateVariables(record.prompt) : [], reviewRequired: true };
    });
  }
  saveTemplate(tenant, input, actor) {
    const { id, expectedRevision, title, prompt, toolMode, enabled, parameterized } = input;
    assert(isActor(actor) && titleValid(title) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0
      && typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= TASK_LIBRARY_LIMITS.maxPromptChars && !prompt.includes('\0')
      && ['safe', 'chat_only', 'workspace_readonly', 'workspace', 'all'].includes(toolMode) && typeof enabled === 'boolean' && (parameterized === undefined || typeof parameterized === 'boolean') && (id === undefined || isId(id)), 'INVALID_TEMPLATE');
    return this.store.transaction(() => {
      const previous = id ? this.template(tenant, id) : null; assert((previous?.revision ?? 0) === expectedRevision, 'VERSION_CONFLICT');
      if (!previous) assert(this.templates(tenant).items.length < TASK_LIBRARY_LIMITS.maxTemplates, 'TEMPLATE_LIMIT');
      const useVariables = parameterized ?? previous?.parameterized ?? false; if (useVariables) templateVariables(prompt);
      const r = { id: previous?.id ?? randomUUID(), tenant, title, prompt, toolMode, enabled, parameterized: useVariables, revision: (previous?.revision ?? 0) + 1, updated: Date.now() };
      this.store.db.prepare('INSERT INTO task_templates VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(r.id, tenant, seal(this.store.encryptionKey, r));
      this.store.append({ type: 'agent.template_saved', tenant, actor, template: r.id, revision: r.revision, toolMode, enabled, parameterized: useVariables, contentHash: digest({ title, prompt }) });
      return this.#templatePublic(r);
    });
  }
}
