import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReportText } from '../src/report-diff.js';

test('report comparison identifies replacements and additions with reconstructible source lines', () => {
  const left = '# Report\nStatus: draft\nOwner: team\n', right = '# Report\nStatus: reviewed\nOwner: team\nNext: publish\n', result = compareReportText(left, right);
  assert.deepEqual(result.counts, { added: 2, removed: 1, same: 3 }); assert.equal(result.identicalText, false);
  assert.equal(result.lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n'), left);
  assert.equal(result.lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n'), right);
  assert.deepEqual(result.lines.find(line => line.kind === 'removed'), { kind: 'removed', text: 'Status: draft', leftLine: 2, rightLine: null });
});

test('report comparison preserves trailing empty lines and treats CRLF/CR as LF', () => {
  assert.equal(compareReportText('A\r\nB\r\n', 'A\nB\n').identicalText, true);
  assert.equal(compareReportText('A\rB', 'A\nB').identicalText, true);
  assert.equal(compareReportText('A', 'A\n').counts.added, 1);
  assert.deepEqual(compareReportText('', '').counts, { added: 0, removed: 0, same: 1 });
});

test('repeated-line alignment is deterministic and markup/Unicode stays literal', () => {
  const a = 'A\nB\nA\n<em>工程</em>', b = 'A\nA\nB\n<em>工程</em>', first = compareReportText(a, b);
  assert.deepEqual(compareReportText(a, b), first); assert.equal(first.counts.added, 1); assert.equal(first.counts.removed, 1); assert.equal(first.lines.at(-1).text, '<em>工程</em>');
  assert.equal(first.lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n'), a);
  assert.equal(first.lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n'), b);
});

test('diff input and matrix bounds reject excessive bytes or lines before processing', () => {
  for (const input of [null, 'x'.repeat(8193), '中'.repeat(2731)]) assert.throws(() => compareReportText(input, 'Safe'), /REPORT_DIFF_INPUT_LIMIT/);
  assert.throws(() => compareReportText('\n'.repeat(400), 'Safe'), /REPORT_DIFF_LINE_LIMIT/);
  const bounded = compareReportText(Array(400).fill('A').join('\n'), Array(400).fill('B').join('\n')); assert.equal(bounded.lines.length, 800); assert.deepEqual(bounded.counts, { added: 400, removed: 400, same: 0 });
});
