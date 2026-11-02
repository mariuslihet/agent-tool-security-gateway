import { assert } from './util.js';

// Read-only operational diagnostics, not a security assessment. No payloads or names are returned.
export function workspaceHealth(gateway, tenant) {
  return gateway.store.transaction(() => {
    assert(gateway.store.readiness(), 'GATEWAY_UNAVAILABLE'); const now = gateway.clock();
    const rows = gateway.store.db.prepare("SELECT session,id FROM request_index WHERE tenant=? AND status='pending' ORDER BY rowid DESC LIMIT 101").all(tenant);
    let expired = 0, awaiting = 0;
    for (const row of rows.slice(0, 100)) {
      const r = gateway.store.request(row.session, row.id), s = gateway.store.session(row.session);
      assert(r?.status === 'pending' && s?.tenant === tenant && r.approval, 'STORAGE_INTEGRITY_FAILURE');
      if (r.approval.expires <= now) expired++; else if (r.approval.state === 'pending') awaiting++;
    }
    const requests = Object.fromEntries(gateway.store.db.prepare('SELECT status,COUNT(*) AS n FROM request_index WHERE tenant=? GROUP BY status').all(tenant).map(r => [r.status, r.n]));
    const sessions = gateway.sessions(tenant, { limit: 100 }), changed = sessions.items.filter(s => s.status === 'configuration_changed').length;
    const holds = gateway.containment.list(tenant).items, activeHolds = holds.filter(h => h.active).length;
    const enabledRules = gateway.alerts.rules(tenant).filter(r => r.enabled).length;
    const audit = gateway.store.auditStatus();
    const checks = [
      { id: 'audit', state: audit.valid ? 'ok' : 'warning', title: 'Audit availability', count: audit.valid ? 0 : 1, detail: 'Cached full-chain verification and current tail check; use full verification for a fresh chain scan.', destination: 'audit' },
      { id: 'pending', state: awaiting ? 'attention' : 'ok', title: 'Awaiting human review', count: awaiting, detail: 'Unexpired pending decisions in the sampled queue.', destination: 'approvals' },
      { id: 'expired', state: expired ? 'warning' : 'ok', title: 'Expired approval records', count: expired, detail: 'These requests cannot execute using an expired approval.', destination: 'approvals' },
      { id: 'uncertain', state: requests.indeterminate ? 'warning' : 'ok', title: 'Uncertain executions', count: requests.indeterminate ?? 0, detail: 'Reconcile external effects before retrying with a new request ID.', destination: 'requests' },
      { id: 'running', state: requests.running ? 'attention' : 'ok', title: 'Outstanding reservations', count: requests.running ?? 0, detail: 'Includes work in progress and interrupted reservations; this is not a stuck-process detector.', destination: 'requests' },
      { id: 'drift', state: changed ? 'warning' : 'ok', title: 'Changed session configuration', count: changed, detail: 'Sampled sessions bound to an earlier policy, registry or identity configuration require a new session.', destination: 'sessions' },
      { id: 'holds', state: activeHolds ? 'attention' : 'ok', title: 'Active scoped containment', count: activeHolds, detail: 'Temporary session or tool holds; tenant-wide pauses are managed separately.', destination: 'safety' },
      { id: 'alerts', state: 'info', title: 'Enabled local alert rules', count: enabledRules, detail: enabledRules ? 'Evaluated on new matching gateway events.' : 'No rules enabled. Operators can configure local threshold monitoring.', destination: 'alerts' },
    ];
    return { generatedAt: now, checks, scope: 'operational diagnostics; not a security certification', coverage: { pendingSample: Math.min(rows.length, 100), pendingTruncated: rows.length > 100, sessionSample: sessions.items.length, sessionsTruncated: Boolean(sessions.nextCursor), sampleLimit: 100 }, auditVerifiedAt: audit.verifiedAt };
  });
}
