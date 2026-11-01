import { createHash, createHmac, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export class GatewayError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
export function assert(condition, code, message) {
  if (!condition) throw new GatewayError(code, message);
}
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    assert(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'INVALID_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'INVALID_JSON');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const mac = (key, value) => createHmac('sha256', key).update(canonical(value)).digest('hex');
export function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function jsonClone(value) { return JSON.parse(canonical(value)); }
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function bounded(value, maxBytes = 65536) {
  const text = canonical(value);
  assert(Buffer.byteLength(text) <= maxBytes, 'PAYLOAD_TOO_LARGE');
  return JSON.parse(text);
}
export function seal(key, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(canonical(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function open(key, text) {
  const data = Buffer.from(text, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
}
export function field(object, path) {
  return path.split('.').reduce((v, k) => v && Object.hasOwn(v, k) ? v[k] : undefined, object);
}
export const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
export const toolPattern = /^[a-z][a-z0-9_.-]{0,95}$/;
