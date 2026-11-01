import { httpsJsonAdapter } from './adapters.js';
import { assert, mac } from './util.js';

// This sink only notifies. Webhook responses never grant approvals.
export function signedApprovalWebhook({ url, signingKey, adapter, onFailure = () => {}, clock = Date.now }) {
  assert(typeof signingKey === 'string' && signingKey.length >= 32, 'WEBHOOK_KEY_REQUIRED');
  const target = new URL(url);
  const send = adapter ?? httpsJsonAdapter({ origin: target.origin });
  return async event => {
    if (event.type !== 'approval.required') return;
    const envelope = { timestamp: clock(), event };
    const payload = { ...envelope, signature: mac(signingKey, envelope) };
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await send({ url, payload }, { signal: AbortSignal.timeout(5000) }); return; }
      catch { if (attempt === 2) { onFailure({ code: 'WEBHOOK_DELIVERY_FAILED', eventId: event.request }); return; } }
    }
  };
}
