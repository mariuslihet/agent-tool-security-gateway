import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { Gateway } from '../src/gateway.js';
import { Policy } from '../src/policy.js';
import { demoRegistry, demoProfile, loadDefaultPolicy, objectSchema } from '../src/demo.js';

export function fixture(t, options = {}) {
  let now = 1700000000000;
  const registry = demoRegistry();
  options.register?.(registry);
  const profiles = options.profiles ?? [demoProfile(registry, { limits: options.limits }), demoProfile(registry, { id: 'other-agent', tenant: 'other' })];
  const store = new Store(options.path ?? ':memory:', options.key ?? randomBytes(32).toString('hex'));
  t?.after(() => { try { store.close(); } catch {} });
  const policy = options.policy ? new Policy(options.policy) : loadDefaultPolicy();
  const gateway = new Gateway({ store, registry, policy, profiles, clock: () => now, onEvent: options.onEvent });
  const sessionId = gateway.createSession('demo-agent').sessionId;
  return { gateway, store, registry, policy, sessionId, profiles,
    advance: ms => { now += ms; },
    run: (tool, args, id = randomBytes(8).toString('hex')) => gateway.execute('demo-agent', sessionId, { id, tool, arguments: args }),
  };
}
export const report = { url: 'https://reports.example.com/daily', body: 'A safe summary.' };
export const admin = { tenant: 'demo', approver: 'reviewer' };
export const testTool = (name, overrides = {}) => ({ name, description: 'Test tool', inputSchema: objectSchema({}), outputSchema: objectSchema({ text: { type: 'string' } }), egress: false, outputLabels: [], cost: 1, timeoutMs: 1000, ...overrides });
export function allowTool(name) { const p = structuredClone(loadDefaultPolicy().data); p.rules.push({ id: 'test-allow', tools: [name], effect: 'allow', when: [] }); return p; }
