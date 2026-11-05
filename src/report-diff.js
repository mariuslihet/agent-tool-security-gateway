import { assert } from './util.js';

export const REPORT_DIFF_LIMITS = Object.freeze({ maxBytesPerReport: 8192, maxLinesPerReport: 400 });
export function compareReportText(left, right) {
  assert([left, right].every(value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= REPORT_DIFF_LIMITS.maxBytesPerReport), 'REPORT_DIFF_INPUT_LIMIT');
  const split = value => value.replace(/\r\n?/g, '\n').split('\n'), a = split(left), b = split(right);
  assert(a.length <= REPORT_DIFF_LIMITS.maxLinesPerReport && b.length <= REPORT_DIFF_LIMITS.maxLinesPerReport, 'REPORT_DIFF_LINE_LIMIT');
  const width = b.length + 1, table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * width + j] = a[i] === b[j] ? 1 + table[(i + 1) * width + j + 1] : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  let i = 0, j = 0; const lines = [], counts = { added: 0, removed: 0, same: 0 };
  const add = (kind, text, leftLine, rightLine) => { counts[kind]++; lines.push({ kind, text, leftLine, rightLine }); };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { add('same', a[i], i + 1, j + 1); i++; j++; }
    else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) { add('removed', a[i], i + 1, null); i++; }
    else { add('added', b[j], null, j + 1); j++; }
  }
  return { lines, counts, identicalText: counts.added === 0 && counts.removed === 0, normalization: 'CRLF and CR line endings are compared as LF; trailing empty lines are retained.', limits: REPORT_DIFF_LIMITS };
}
