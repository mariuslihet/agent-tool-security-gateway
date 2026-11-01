import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';
const { gateway, store } = createDemo({ masterKey: randomBytes(32).toString('hex') });
const samples = [];
try {
  for (let i = 0; i < 200; i++) {
    const { sessionId } = gateway.createSession('demo-agent');
    const start = performance.now();
    const result = await gateway.execute('demo-agent', sessionId, { id: 'bench', tool: 'knowledge.read', arguments: { document: 'handbook' } });
    if (result.status !== 'completed') throw new Error('Benchmark execution failed');
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ scenario: 'in-memory SQLite, fixed read adapter, full gateway path', samples: samples.length, unit: 'ms', p50: samples[100], p95: samples[190], p99: samples[198], note: 'Local measurement; not a network or disk durability SLA.' }, null, 2));
} finally { store.close(); }
