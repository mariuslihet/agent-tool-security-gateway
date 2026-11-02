import { randomUUID } from 'node:crypto';
import { ControlPlaneClient } from '../src/client.js';

// Real local-model smoke check. Uses only a synthetic arithmetic task and a read-only computation.
const client = new ControlPlaneClient({ baseUrl: `http://127.0.0.1:${process.env.GATEWAY_PORT ?? 8787}`, token: process.env.GATEWAY_OPERATOR_TOKEN });
const connection = await client.checkAgent();
const started = await client.startAgent({ id: randomUUID(), prompt: 'Use the compute.sum tool to add 19, 23 and 58. Then give a concise answer stating the result. Do not calculate without the tool.' });
const deadline = Date.now() + 360000;
let result = started;
while (['queued', 'running'].includes(result.state) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 2500)); result = await client.agentRun(started.id); }
console.log(JSON.stringify({ provider: connection.provider, model: connection.model, state: result.state, code: result.code, steps: result.steps, response: result.conversation.filter(m => m.role === 'assistant').map(m => m.text), runId: result.id }, null, 2));
if (result.state !== 'completed' || !result.steps.some(s => s.tool === 'compute.sum' && s.status === 'completed')) process.exitCode = 1;
