import { assert } from './util.js';
import { redact } from './scanners.js';

export const TEMPLATE_VARIABLE_LIMITS = Object.freeze({ maxVariables: 8, maxValueChars: 2000, maxRenderedChars: 8000 });
const placeholders = () => /\{\{([a-z][a-z0-9_]{0,31})\}\}/g;

export function templateVariables(prompt) {
  assert(typeof prompt === 'string' && prompt.length <= TEMPLATE_VARIABLE_LIMITS.maxRenderedChars && !prompt.includes('\0'), 'INVALID_TEMPLATE');
  const remainder = prompt.replace(placeholders(), ''); assert(!remainder.includes('{{') && !remainder.includes('}}'), 'INVALID_TEMPLATE_PLACEHOLDER');
  const names = [...new Set([...prompt.matchAll(placeholders())].map(match => match[1]))]; assert(names.length <= TEMPLATE_VARIABLE_LIMITS.maxVariables, 'TEMPLATE_VARIABLE_LIMIT'); return names;
}

export function redactTemplateSource(prompt) {
  templateVariables(prompt); let result = '', cursor = 0;
  for (const match of prompt.matchAll(placeholders())) { result += redact(prompt.slice(cursor, match.index)) + match[0]; cursor = match.index + match[0].length; }
  return result + redact(prompt.slice(cursor));
}

export function renderPromptTemplate(prompt, values) {
  const names = templateVariables(prompt);
  assert(values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length === names.length && names.every(name => Object.hasOwn(values, name))
    && Object.values(values).every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= TEMPLATE_VARIABLE_LIMITS.maxValueChars && !value.includes('\0')), 'INVALID_TEMPLATE_VALUES');
  const clean = redact(values), source = redactTemplateSource(prompt); let result = '', cursor = 0;
  const append = text => { assert(result.length + text.length <= TEMPLATE_VARIABLE_LIMITS.maxRenderedChars, 'RENDERED_PROMPT_TOO_LARGE'); result += text; };
  for (const match of source.matchAll(placeholders())) { append(source.slice(cursor, match.index)); append(clean[match[1]]); cursor = match.index + match[0].length; }
  append(source.slice(cursor)); const rendered = redact(result); assert(rendered.length <= TEMPLATE_VARIABLE_LIMITS.maxRenderedChars, 'RENDERED_PROMPT_TOO_LARGE'); return rendered;
}
