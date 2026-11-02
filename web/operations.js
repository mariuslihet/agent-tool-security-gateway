// Uses the main console's authenticated transport, source generation and safe DOM helpers.
(() => {
  let incidentPage = { items: [], nextBefore: null, history: [], before: null }, incidentRequest = 0;
  let selectedIncident = null, selectedSafety = null, safety = null, lastReport = null, examples = [];
  const fallbackCounts = { open: 0, acknowledged: 0, resolved: 0 };
  const observedSource = () => generation;
  function clear() {
    incidentRequest++; incidentPage = { items: [], nextBefore: null, history: [], before: null };
    selectedIncident = null; selectedSafety = null; safety = null; lastReport = null;
    for (const id of ['incident-list', 'incident-detail', 'safety-current', 'suite-results']) $(id).replaceChildren();
    for (const id of ['incident-open', 'incident-acknowledged', 'incident-resolved']) $(id).textContent = '—';
    $('safety-status-badge').textContent = 'Loading'; $('safety-confirm-description').textContent = '';
    for (const id of ['incident-note', 'incident-owner', 'safety-reason', 'safety-confirm-reason']) $(id).value = '';
    $('suite-editor').value = JSON.stringify(examples, null, 2);
    $('incident-search').value = ''; $('incident-state').value = 'all';
    $('nav-incident-count').textContent = '0'; $('suite-export').disabled = true;
    $('suite-summary').textContent = 'Connect a workspace to run regression checks.';
    for (const id of ['incident-save', 'safety-pause', 'safety-resume', 'suite-run']) $(id).disabled = true;
    const banner = document.getElementById('response-banner'); if (banner) { banner.replaceChildren(); banner.hidden = true; }
  }
  function renderSummary() {
    if (!status) return;
    const operations = status.operations ?? { incidents: fallbackCounts, safety: { active: false, revision: 0, status: 'normal' } };
    const counts = operations.incidents;
    $('incident-open').textContent = number(counts.open); $('incident-acknowledged').textContent = number(counts.acknowledged); $('incident-resolved').textContent = number(counts.resolved);
    $('nav-incident-count').textContent = number(counts.open + counts.acknowledged);
    safety = operations.safety;
    const scopeName = safety.scope === 'all' ? 'All tools' : 'Outbound tools';
    $('safety-status-badge').className = `badge ${safety.active ? 'amber' : 'green'}`;
    $('safety-status-badge').textContent = safety.active ? `${scopeName} paused` : 'No active pause';
    const current = el('div', undefined, 'detail-grid');
    current.append(field('Containment', safety.active ? scopeName + ' paused' : safety.status === 'expired' ? 'Pause expired automatically' : 'Normal authorization'), field('Revision', String(safety.revision)), field('Automatic expiry', safety.expires ? date(safety.expires) : 'No pause configured'), field('Last operator', safety.resumedBy ?? safety.actor ?? '—'));
    if (safety.reason) current.append(field('Pause reason', safety.reason));
    if (safety.resumeReason) current.append(field('Resume reason', safety.resumeReason));
    $('safety-current').replaceChildren(current);
    $('safety-pause').disabled = !canChange(); $('safety-resume').disabled = !canChange() || !safety.active;
    $('safety-access-note').textContent = canChange() ? 'Changes require an exact-revision confirmation and an operator reason.' : 'Connect with operator access to change containment. Sample and viewer modes are read-only.';
    $('incident-save').disabled = !canChange(); $('suite-run').disabled = mode !== 'live';
    if (mode === 'live' && $('suite-summary').textContent === 'Connect a workspace to run regression checks.') $('suite-summary').textContent = 'Ready to compare up to 50 cases against the candidate policy.';
    let banner = document.getElementById('response-banner');
    if (!banner) { banner = el('div', undefined, 'info-strip response-banner'); banner.id = 'response-banner'; document.querySelector('[data-screen="overview"]').prepend(banner); }
    banner.replaceChildren(); banner.hidden = !(counts.open + counts.acknowledged || safety.active);
    if (!banner.hidden) {
      const text = el('div'); text.append(el('strong', safety.active ? `${scopeName} are temporarily paused.` : `${counts.open + counts.acknowledged} incidents need attention.`), el('p', mode === 'preview' ? 'Isolated sample records. No live changes are possible.' : 'Inspect the incident record and containment state before resuming work.'));
      banner.append(icon('shield'), text, button(safety.active ? 'View safety controls →' : 'View incidents →', 'text-button', () => { location.hash = safety.active ? '#safety' : '#incidents'; }));
    }
    const enforcement = document.querySelector('.boundary-panel .status-list dd');
    if (enforcement) enforcement.replaceChildren(badge(safety.active ? `${scopeName} paused` : 'Default deny', safety.active ? 'amber' : 'green'));
  }
  async function loadIncidents(before = null, history = []) {
    if (!status) return;
    const source = observedSource(), request = ++incidentRequest;
    try {
      let page;
      if (mode === 'preview') {
        const stateFilter = $('incident-state').value;
        page = { items: (previewData.incidents?.items ?? []).filter(i => stateFilter === 'all' || i.state === stateFilter), nextBefore: null };
      } else page = await api('/v1/operator/incidents?' + new URLSearchParams({ state: $('incident-state').value, limit: '25', ...(before ? { before } : {}) }));
      if (source !== generation || request !== incidentRequest) return;
      incidentPage = { ...page, before, history }; renderIncidents();
    } catch (error) { if (source === generation) notify(userError(error), true); }
  }
  function renderIncidents() {
    const search = $('incident-search').value.toLowerCase();
    const records = incidentPage.items.filter(i => `${i.title} ${i.code} ${i.owner} ${i.tool ?? ''}`.toLowerCase().includes(search));
    const target = $('incident-list'); target.replaceChildren();
    if (!records.length) target.append(empty('No matching incidents.', 'Selected high-risk denials and uncertain executions will appear here.'));
    for (const record of records) {
      const card = el('article', undefined, 'panel incident-card'), header = el('div', undefined, 'panel-heading'), title = el('div');
      title.append(el('h2', record.title), el('p', record.code, 'mono'));
      header.append(title, badge(record.severity, record.severity === 'high' ? 'red' : 'amber'));
      const metadata = el('div', undefined, 'incident-metadata');
      metadata.append(badge(record.state, record.state === 'resolved' ? 'green' : 'neutral'), el('span', `${record.occurrences} occurrence${record.occurrences === 1 ? '' : 's'}`, 'small muted'), el('span', `Owner: ${record.owner || 'Unassigned'}`, 'small muted'));
      const footer = el('div', undefined, 'detail-action'); footer.append(el('p', `${record.tool ?? 'Runtime request'} · last observed ${date(record.updated)}`), button('Investigate →', 'button secondary', () => openIncident(record.id)));
      card.append(header, metadata, footer); target.append(card);
    }
    $('incident-page-label').textContent = `${records.length} shown · page ${incidentPage.history.length + 1} · newest first-seen records`;
    $('incident-next').disabled = !incidentPage.nextBefore; $('incident-previous').disabled = !incidentPage.history.length;
  }
  async function openIncident(id) {
    const source = observedSource();
    try {
      const record = mode === 'preview' ? previewData.incidents.items.find(i => i.id === id) : (await api(`/v1/operator/incidents/${encodeURIComponent(id)}`)).incident;
      if (source !== generation) return;
      selectedIncident = { record, source }; $('incident-title').textContent = record.title;
      const grid = el('div', undefined, 'detail-grid');
      grid.append(field('Severity', record.severity), field('Occurrences', String(record.occurrences)), field('First observed', date(record.created)), field('Last observed', date(record.updated)), field('Signal', record.code, true), field('Record version', String(record.version)));
      const content = [grid];
      const links = el('div', undefined, 'editor-actions');
      if (record.sessionId) links.append(button('Inspect related session →', 'button secondary', () => { $('incident-dialog').close(); showSession(record.sessionId); }));
      links.append(button('Find source event →', 'text-button', () => {
        $('incident-dialog').close(); $('audit-search').value = record.lastEventId; $('audit-type').value = ''; $('audit-range').value = 'all'; location.hash = '#audit'; loadAudit(null, [], { search: record.lastEventId });
      })); content.push(links);
      const notes = el('div');
      if (!record.notes.length) notes.append(el('p', 'No operator notes yet.', 'small muted'));
      for (const note of record.notes) { const entry = el('div', undefined, 'incident-note'); entry.append(el('p', `${note.actor} · ${date(note.at)}`, 'small muted'), el('p', note.text)); notes.append(entry); }
      if (record.notesTruncated) notes.append(el('p', 'Showing the latest 20 notes. Earlier note fingerprints remain in the audit trail.', 'small muted'));
      content.push(section('Investigation notes', notes)); $('incident-detail').replaceChildren(...content);
      $('incident-new-state').value = record.state; $('incident-owner').value = record.owner; $('incident-note').value = ''; $('incident-error').textContent = ''; $('incident-save').disabled = !canChange(); showDialog('incident-dialog');
    } catch (error) { if (source === generation) notify(userError(error), true); }
  }
  function safetyReview(action) {
    if (!canChange() || !safety) return;
    selectedSafety = { action, expectedRevision: safety.revision, source: generation,
      scope: $('safety-scope').value, durationMinutes: Number($('safety-duration').value) };
    $('safety-confirm-title').textContent = action === 'pause' ? 'Pause new reservations?' : 'Resume normal authorization?';
    $('safety-confirm-description').textContent = action === 'pause' ? `Pause ${selectedSafety.scope === 'all' ? 'all tools' : 'outbound tools'} for ${selectedSafety.durationMinutes} minutes in tenant ${status.identity.tenant}. Existing operations may finish.` : 'Remove this temporary pause. Every task capability, policy, revocation and data-flow check still applies.';
    $('safety-confirm-reason').value = action === 'pause' ? $('safety-reason').value : '';
    $('safety-error').textContent = ''; $('safety-confirm-submit').textContent = action === 'pause' ? 'Pause reservations' : 'Resume authorization'; showDialog('safety-confirm-dialog');
    $('safety-confirm-submit').disabled = false;
  }
  function renderSuite(report) {
    const target = $('suite-results'); target.replaceChildren();
    $('suite-summary').textContent = `${report.passed}/${report.total} passed · ${report.failed} failed · no execution`;
    for (const result of report.results) {
      const row = el('div', undefined, 'suite-result-row');
      row.append(badge(result.passed ? 'Pass' : 'Fail', result.passed ? 'green' : 'red'), el('strong', result.id, 'mono'), el('span', `Expected ${result.expected.decision} · got ${result.actual.decision}`, 'small muted'), el('span', result.actual.code, 'mono muted'));
      target.append(row);
    }
    $('suite-export').disabled = false;
  }
  function conflictMessage(error) { return error.message === 'VERSION_CONFLICT' ? 'This record changed in another request. Close and reopen it before saving again.' : userError(error); }
  $('incident-search').addEventListener('input', renderIncidents);
  $('incident-state').addEventListener('change', () => loadIncidents());
  $('incident-refresh').addEventListener('click', () => loadIncidents());
  $('incident-next').addEventListener('click', () => { if (incidentPage.nextBefore) loadIncidents(incidentPage.nextBefore, [...incidentPage.history, incidentPage.before]); });
  $('incident-previous').addEventListener('click', () => { const history = [...incidentPage.history], before = history.pop(); loadIncidents(before ?? null, history); });
  $('incident-form').addEventListener('submit', event => {
    event.preventDefault(); if (!canChange() || !selectedIncident || selectedIncident.source !== generation) return;
    const selected = selectedIncident;
    busy($('incident-save'), async () => {
      try {
        await api(`/v1/operator/incidents/${encodeURIComponent(selected.record.id)}`, { expectedVersion: selected.record.version, state: $('incident-new-state').value, owner: $('incident-owner').value.trim(), reason: $('incident-note').value });
        if (selected.source !== generation) return;
        $('incident-dialog').close(); $('incident-note').value = ''; selectedIncident = null; await refreshWorkspace(); await loadIncidents(); notify('Incident disposition saved. Tool permissions and containment are unchanged.');
      } catch (error) { if (selected.source === generation) $('incident-error').textContent = conflictMessage(error); }
    });
  });
  $('safety-form').addEventListener('submit', event => { event.preventDefault(); safetyReview('pause'); });
  $('safety-resume').addEventListener('click', () => safetyReview('resume'));
  $('safety-confirm-form').addEventListener('submit', event => {
    event.preventDefault(); if (!canChange() || !selectedSafety || selectedSafety.source !== generation) return;
    const selected = selectedSafety;
    busy($('safety-confirm-submit'), async () => {
      try {
        const input = { expectedRevision: selected.expectedRevision, reason: $('safety-confirm-reason').value };
        if (selected.action === 'pause') Object.assign(input, { scope: selected.scope, durationMinutes: selected.durationMinutes });
        const updated = await api(`/v1/operator/safety/${selected.action}`, input);
        if (selected.source !== generation) return;
        $('safety-confirm-dialog').close(); $('safety-confirm-reason').value = ''; $('safety-reason').value = ''; selectedSafety = null;
        status.operations.safety = updated; renderSummary(); await refreshWorkspace(); notify(selected.action === 'pause' ? 'Temporary pause recorded. New matching reservations are blocked.' : 'Pause removed. Normal security checks still apply.');
      } catch (error) { if (selected.source === generation) $('safety-error').textContent = conflictMessage(error); }
    });
  });
  $('suite-reset').addEventListener('click', () => { $('suite-editor').value = JSON.stringify(examples, null, 2); lastReport = null; $('suite-export').disabled = true; $('suite-results').replaceChildren(); $('suite-summary').textContent = 'Example cases loaded; candidate policy remains unchanged.'; });
  function invalidateSuite() { lastReport = null; $('suite-export').disabled = true; $('suite-results').replaceChildren(); $('suite-summary').textContent = 'Draft changed. Run the suite again to produce a matching report.'; }
  for (const id of ['suite-editor', 'policy-editor']) $(id).addEventListener('input', invalidateSuite);
  $('reset-policy').addEventListener('click', invalidateSuite);
  $('suite-run').addEventListener('click', () => busy($('suite-run'), async () => {
    if (mode !== 'live') return;
    const source = generation; let cases, policy;
    try { cases = JSON.parse($('suite-editor').value); policy = JSON.parse($('policy-editor').value); }
    catch { $('suite-summary').textContent = 'Enter valid JSON for the candidate policy and scenario suite.'; return; }
    try { const report = await api('/v1/operator/policy/suite', { policy, cases }); if (source !== generation) return; lastReport = report; renderSuite(report); }
    catch (error) { if (source === generation) $('suite-summary').textContent = userError(error); }
  }));
  $('suite-export').addEventListener('click', () => {
    if (!lastReport) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' }));
    const anchor = el('a'); anchor.href = url; anchor.download = 'gateway-policy-regression.json'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('gateway:source-cleared', clear);
  window.addEventListener('gateway:workspace', () => { renderSummary(); if (currentPage === 'incidents') loadIncidents(incidentPage.before, incidentPage.history); });
  window.addEventListener('hashchange', () => { if (currentPage === 'incidents') loadIncidents(); if (currentPage === 'safety') renderSummary(); });
  // Public example cases only; never carry a token on the fixture request.
  api('/regression.json', undefined, { token: '' }).then(cases => { examples = cases; if (!$('suite-editor').value || $('suite-editor').value === '[]') $('suite-editor').value = JSON.stringify(examples, null, 2); }).catch(() => { $('suite-summary').textContent = 'Example cases could not be loaded. You may enter your own JSON suite.'; });
  clear(); if (status) { renderSummary(); if (currentPage === 'incidents') loadIncidents(); }
})();
