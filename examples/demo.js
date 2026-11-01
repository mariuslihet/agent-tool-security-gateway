import { randomBytes } from 'node:crypto';
import { createDemo } from '../src/demo.js';
import { GatewayClient } from '../src/client.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

if (process.argv.includes('--remote') || process.argv.includes('--resume')) {
  if (!process.env.GATEWAY_AGENT_TOKEN) throw new Error('Load .env with node --env-file=.env examples/demo.js --remote');
  const client = new GatewayClient({ token: process.env.GATEWAY_AGENT_TOKEN });
  if (process.argv.includes('--resume')) {
    const saved = JSON.parse(readFileSync('var/demo-task.json', 'utf8'));
    console.log('Resumed result:', await client.execute(saved.sessionId, saved.request));
  } else {
  const { sessionId } = await client.createSession();
  console.log('Session:', sessionId);
  console.log('Read:', await client.execute(sessionId, { id: 'read', tool: 'knowledge.read', arguments: { document: 'handbook' } }));
  const request = { id: 'publish', tool: 'report.publish', arguments: { url: 'https://reports.example.com/daily', body: 'The daily summary is ready.' } };
  mkdirSync('var', { recursive: true, mode: 0o700 });
  writeFileSync('var/demo-task.json', JSON.stringify({ sessionId, request }, null, 2), { mode: 0o600 });
  console.log('Publish:', await client.execute(sessionId, request));
  console.log('Approve in the dashboard, then run: node --env-file=.env examples/demo.js --resume');
  }
} else {
  const { gateway, store } = createDemo({ masterKey: randomBytes(32).toString('hex') });
  try {
    const { sessionId } = gateway.createSession('demo-agent');
    const execute = (id, tool, args) => gateway.execute('demo-agent', sessionId, { id, tool, arguments: args });
    console.log('Isolated calculation:', await execute('sum', 'compute.sum', { numbers: [10, 20, 12] }));
    console.log('Unknown tool:', await execute('shell', 'shell.exec', { command: 'whoami' }));
    const args = { url: 'https://reports.example.com/daily', body: 'Contact reviewer@example.com for the summary.' };
    const pending = await execute('publish', 'report.publish', args);
    console.log('Approval required:', pending);
    console.log('Operator preview:', gateway.approvals('demo'));
    gateway.decideApproval({ tenant: 'demo', approver: 'local-operator' }, { sessionId, requestId: 'publish', binding: pending.binding, decision: 'approve' });
    console.log('Approved execution:', await execute('publish', 'report.publish', args));
    console.log('Duplicate returns cached result:', await execute('publish', 'report.publish', args));
    await execute('read-secret', 'vault.read', { record: 'invoice' });
    console.log('Exfiltration blocked:', await execute('exfiltrate', 'report.publish', { url: 'https://reports.example.com/daily', body: 'Confidential data' }));
    console.log('Audit verification:', store.verifyAudit());
  } finally { store.close(); }
}
