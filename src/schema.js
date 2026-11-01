import { assert, canonical } from './util.js';

// Deliberately limited contract language. Unsupported keywords fail at registration.
const keys = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'format']);
const types = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
export function checkSchema(schema, depth = 0) {
  assert(depth <= 12 && schema && typeof schema === 'object' && !Array.isArray(schema), 'INVALID_SCHEMA');
  assert(Object.keys(schema).every(k => keys.has(k)) && types.has(schema.type), 'INVALID_SCHEMA');
  const relevant = {
    object: ['properties', 'required', 'additionalProperties'], array: ['items', 'maxItems'],
    string: ['minLength', 'maxLength', 'format'], number: ['minimum', 'maximum'], integer: ['minimum', 'maximum'], boolean: [], null: [],
  };
  assert(Object.keys(schema).every(k => ['type', 'enum', ...relevant[schema.type]].includes(k)), 'INVALID_SCHEMA');
  if (schema.type === 'object') {
    assert(schema.additionalProperties === false && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties), 'INVALID_SCHEMA');
    assert(Array.isArray(schema.required) && new Set(schema.required).size === schema.required.length && schema.required.every(k => typeof k === 'string' && Object.hasOwn(schema.properties, k)), 'INVALID_SCHEMA');
    Object.values(schema.properties).forEach(s => checkSchema(s, depth + 1));
  }
  if (schema.type === 'array') checkSchema(schema.items, depth + 1);
  if (schema.enum) assert(Array.isArray(schema.enum) && schema.enum.length > 0, 'INVALID_SCHEMA');
  if (schema.format) assert(['https-url', 'relative-path'].includes(schema.format), 'INVALID_SCHEMA');
  for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems']) {
    if (schema[k] !== undefined) assert(Number.isFinite(schema[k]), 'INVALID_SCHEMA');
  }
  for (const k of ['minLength', 'maxLength', 'maxItems']) if (schema[k] !== undefined) assert(Number.isSafeInteger(schema[k]) && schema[k] >= 0, 'INVALID_SCHEMA');
  assert((schema.minimum ?? -Infinity) <= (schema.maximum ?? Infinity) && (schema.minLength ?? 0) <= (schema.maxLength ?? Infinity), 'INVALID_SCHEMA');
}
export function validate(schema, value, depth = 0) {
  assert(depth <= 12, 'SCHEMA_MISMATCH');
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  assert(schema.type === 'integer' ? Number.isSafeInteger(value) : type === schema.type, 'SCHEMA_MISMATCH');
  if (schema.enum) assert(schema.enum.some(v => canonical(v) === canonical(value)), 'SCHEMA_MISMATCH');
  if (type === 'object') {
    assert(Object.keys(value).every(k => Object.hasOwn(schema.properties, k)), 'UNKNOWN_ARGUMENT');
    assert(schema.required.every(k => Object.hasOwn(value, k)), 'MISSING_ARGUMENT');
    for (const [k, v] of Object.entries(value)) validate(schema.properties[k], v, depth + 1);
  }
  if (type === 'array') {
    assert(value.length <= (schema.maxItems ?? 100), 'SCHEMA_MISMATCH');
    value.forEach(v => validate(schema.items, v, depth + 1));
  }
  if (type === 'string') {
    assert(value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 16384), 'SCHEMA_MISMATCH');
    assert(!value.includes('\0'), 'SCHEMA_MISMATCH');
    if (schema.format === 'https-url') {
      let url;
      try { url = new URL(value); } catch { assert(false, 'INVALID_DESTINATION'); }
      assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443'), 'INVALID_DESTINATION');
      assert(url.href === value, 'NON_CANONICAL_URL');
    }
    if (schema.format === 'relative-path') {
      assert(/^[a-zA-Z0-9_./-]+$/.test(value) && !value.startsWith('/') && value.split('/').every(s => s && s !== '.' && s !== '..'), 'INVALID_PATH');
    }
  }
  if (type === 'number') {
    assert(Number.isFinite(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity), 'SCHEMA_MISMATCH');
  }
}
