import { readFileSync } from 'node:fs';
import { demoRegistry, loadDefaultPolicy } from '../src/demo.js';
import { Policy } from '../src/policy.js';
import { runPolicySuite } from '../src/policy-lab.js';

try {
  const policy = process.argv[2] ? new Policy(JSON.parse(readFileSync(process.argv[2], 'utf8'))) : loadDefaultPolicy();
  const cases = JSON.parse(readFileSync(new URL('../policies/regression.json', import.meta.url), 'utf8'));
  const report = runPolicySuite({ registry: demoRegistry(), policy, tenant: 'demo', cases });
  console.table(report.results.map(result => ({ scenario: result.id, expected: result.expected.decision, actual: result.actual.decision, code: result.actual.code, passed: result.passed })));
  console.log(`${report.passed}/${report.total} policy regression cases passed. No tools executed.`);
  if (report.failed) process.exitCode = 1;
} catch (error) { console.error(`Policy regression failed: ${error.code ?? 'INVALID_INPUT'}`); process.exitCode = 1; }
