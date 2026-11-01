import { canonical } from './util.js';

const patterns = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['API_KEY', /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,})\b/g],
  ['CREDENTIAL', /\b(?:password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[^\s,"'\\}]{4,}/gi],
  ['EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
];
const injection = /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|(?:system|developer)\s*:\s*|reveal\s+(?:the\s+)?(?:secret|password)|<\/?(?:system|developer)>/i;
export function inspect(value) {
  const text = canonical(value), findings = [];
  for (const [code, regex] of patterns) { regex.lastIndex = 0; if (regex.test(text)) findings.push(code); }
  if (injection.test(text)) findings.push('PROMPT_INJECTION_SIGNAL');
  // Bounded decoding catches common obfuscation; not a proof of arbitrary data lineage.
  for (const match of text.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    const decoded = Buffer.from(match[0], 'base64').toString('utf8');
    if (injection.test(decoded)) findings.push('ENCODED_INJECTION_SIGNAL');
    for (const [code, regex] of patterns) { regex.lastIndex = 0; if (regex.test(decoded)) findings.push(`ENCODED_${code}`); }
  }
  return [...new Set(findings)];
}
export function redact(value) {
  if (typeof value === 'string') {
    let clean = value;
    for (const [, regex] of patterns) { regex.lastIndex = 0; clean = clean.replace(regex, '[REDACTED]'); }
    return clean;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /password|token|secret|authorization|api.?key/i.test(k) ? '[REDACTED]' : redact(v)]));
  return value;
}
