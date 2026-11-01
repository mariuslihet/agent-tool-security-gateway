import { assert, bounded, digest, freeze, toolPattern } from './util.js';
import { checkSchema } from './schema.js';

export class Registry {
  #tools = new Map();
  #locked = false;
  register(definition, handler) {
    assert(!this.#locked && typeof definition.name === 'string' && toolPattern.test(definition.name) && !this.#tools.has(definition.name) && typeof handler === 'function', 'INVALID_TOOL');
    const d = bounded(definition);
    assert(Object.keys(d).every(k => ['name', 'description', 'inputSchema', 'outputSchema', 'egress', 'destinationField', 'outputLabels', 'cost', 'timeoutMs'].includes(k)), 'INVALID_TOOL');
    assert(typeof d.description === 'string' && d.description.length <= 2048, 'INVALID_TOOL');
    checkSchema(d.inputSchema); checkSchema(d.outputSchema);
    assert(d.inputSchema.type === 'object', 'INVALID_TOOL');
    assert(typeof d.egress === 'boolean' && Array.isArray(d.outputLabels) && d.outputLabels.every(x => ['untrusted', 'sensitive'].includes(x)), 'INVALID_TOOL');
    assert(Number.isSafeInteger(d.cost) && d.cost >= 0 && Number.isSafeInteger(d.timeoutMs) && d.timeoutMs > 0 && d.timeoutMs <= 60000, 'INVALID_TOOL');
    if (d.destinationField !== undefined) assert(d.egress && d.inputSchema.properties?.[d.destinationField]?.format === 'https-url', 'INVALID_TOOL');
    const fingerprint = digest(d);
    this.#tools.set(d.name, Object.freeze({ definition: freeze(d), handler, fingerprint }));
    return fingerprint;
  }
  lock() { this.#locked = true; return this; }
  get(name) { return this.#tools.get(name); }
  list() { return [...this.#tools.values()].map(t => ({ ...t.definition, fingerprint: t.fingerprint })); }
  get hash() { return digest(this.list()); }
}
