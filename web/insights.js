// Same-origin console extension; credentials and inspected data remain in tab memory.
(() => {
  let requestPage = { items: [], nextCursor: null }, requestCursor = null, requestHistory = [], requestTicket = 0;
  let alertPage = { items: [], nextBefore: null }, alertBefore = null, alertHistory = [], alertTicket = 0;
  let selectedRequest = null, selectedRule = null, selectedAlert = null, detailTicket = 0;
  const path = r => `/v1/operator/requests/${encodeURIComponent(r.sessionId)}/${encodeURIComponent(r.requestId)}`;
  function download(report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
    const a = el('a'); a.href = url; a.download = mode === 'preview' ? 'gateway-sample-workspace.json' : 'gateway-workspace.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function clear() {
    requestTicket++; alertTicket++; detailTicket++; selectedRequest = selectedRule = selectedAlert = null;
    requestPage = { items: [], nextCursor: null }; requestCursor = null; requestHistory = [];
    alertPage = { items: [], nextBefore: null }; alertBefore = null; alertHistory = [];
    for (const id of ['request-rows', 'request-detail', 'argument-result', 'alert-list', 'rule-list']) $(id).replaceChildren();
    for (const id of ['argument-reason', 'rule-name', 'rule-reason', 'alert-reason', 'request-search']) $(id).value = '';
    for (const id of ['request-error', 'rule-error', 'alert-error', 'alert-context', 'request-page-label', 'alert-page-label']) $(id).textContent = '';
    $('request-state').value = ''; $('request-tool').replaceChildren(new Option('All tools', '')); $('alert-state').value = 'all';
    for (const id of ['argument-inspect', 'rule-new', 'rule-save', 'alert-save', 'workspace-report', 'request-next', 'request-previous', 'alert-next', 'alert-previous']) $(id).disabled = true;
    for (const [id, label] of Object.entries({ 'argument-inspect': 'Record reason and inspect arguments', 'rule-save': 'Save rule revision', 'alert-save': 'Save disposition', 'workspace-report': 'Download JSON report' })) { $(id).textContent = label; $(id).removeAttribute('aria-busy'); }
  }
  async function loadRequests(cursor = null, history = []) {
    if (!status) return;
    const source = generation, ticket = ++requestTicket;
    const filters = { search: $('request-search').value.trim(), status: $('request-state').value, tool: $('request-tool').value };
    try {
      const page = mode === 'preview' ? { items: (previewData.requests?.items ?? []).filter(r => (!filters.status || r.status === filters.status) && (!filters.tool || r.tool === filters.tool) && `${r.requestId} ${r.sessionId} ${r.principal}`.toLowerCase().includes(filters.search.toLowerCase())), nextCursor: null } : await api('/v1/operator/requests?' + new URLSearchParams({ limit: '25', ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(cursor ? { cursor } : {}) }));
      if (source !== generation || ticket !== requestTicket) return;
      requestPage = page; requestCursor = cursor; requestHistory = history; const target = $('request-rows'); target.replaceChildren();
      for (const r of page.items) {
        const row = el('tr'), id = el('td'), tool = el('td'), outcome = el('td'), action = el('td');
        id.append(el('strong', r.requestId, 'mono wrap'), el('p', short(r.sessionId), 'small muted'));
        tool.append(el('strong', r.tool, 'mono'), el('p', r.principal, 'small muted'));
        outcome.append(badge(r.status, r.status === 'completed' ? 'green' : r.status === 'denied' ? 'red' : 'amber'), el('p', r.code, 'small muted'));
        action.append(button('Investigate →', 'text-button', () => openRequest(r))); row.append(id, tool, outcome, el('td', date(r.created), 'small'), action); target.append(row);
      }
      if (!page.items.length) emptyRow(target, 5, 'No persisted requests match these filters.');
      $('request-page-label').textContent = `${page.items.length} records · page ${history.length + 1}`;
      $('request-previous').disabled = !history.length; $('request-next').disabled = !page.nextCursor;
    } catch (error) { if (source === generation && ticket === requestTicket) notify(userError(error), true); }
  }
  async function openRequest(r) {
    const source = generation, ticket = ++detailTicket; selectedRequest = null;
    $('request-detail').replaceChildren(); $('argument-result').replaceChildren(); $('argument-reason').value = ''; $('request-error').textContent = ''; $('argument-inspect').disabled = true;
    showDialog('request-dialog');
    try {
      const data = mode === 'preview' ? previewData.requestDetails?.[`${r.sessionId}:${r.requestId}`] : await api(path(r));
      if (source !== generation || ticket !== detailTicket || !$('request-dialog').open) return;
      selectedRequest = r; const meta = data.request, grid = el('div', undefined, 'detail-grid');
      grid.append(field('Request', meta.requestId, true), field('Session', meta.sessionId, true), field('Agent', meta.principal), field('Tool', meta.tool), field('Outcome', meta.code), field('State', meta.status), field('Arguments transformed', meta.transformed ? 'Yes' : 'No'), field('Request fingerprint', meta.requestHash, true));
      const timeline = el('div'); for (const e of data.events) timeline.append(field(`${date(e.at)} · ${e.type}`, e.code ?? e.status ?? e.sourceEventId ?? 'Recorded'));
      if (!data.events.length) timeline.append(el('p', 'No matching events in the bounded timeline.'));
      $('request-detail').replaceChildren(grid, section('Recent request timeline · up to 100 events', timeline)); $('argument-inspect').disabled = !canChange();
    } catch (error) { if (source === generation && ticket === detailTicket) $('request-error').textContent = userError(error); }
  }
  $('argument-form').addEventListener('submit', event => { event.preventDefault(); busy($('argument-inspect'), async () => {
    if (!canChange() || !selectedRequest) return;
    const source = generation, ticket = detailTicket, r = selectedRequest;
    try { const result = await api(path(r) + '/inspect', { reason: $('argument-reason').value }); if (source !== generation || ticket !== detailTicket || !$('request-dialog').open) return;
      $('argument-result').replaceChildren(section('Redacted stored arguments', el('pre', JSON.stringify(result.arguments, null, 2), 'code-block'))); $('argument-reason').value = ''; $('request-error').textContent = '';
    } catch (error) { if (source === generation && ticket === detailTicket) $('request-error').textContent = userError(error); }
  }); });
  $('request-dialog').addEventListener('close', () => { detailTicket++; selectedRequest = null; $('argument-result').replaceChildren(); $('argument-reason').value = ''; });
  function editRule(rule = null) {
    if (!canChange()) return; selectedRule = rule;
    $('rule-name').value = rule?.title ?? ''; $('rule-category').value = rule?.category ?? 'denials'; $('rule-threshold').value = rule?.threshold ?? 3; $('rule-window').value = rule?.windowMinutes ?? 15;
    $('rule-enabled').value = String(rule?.enabled ?? true); $('rule-reason').value = ''; $('rule-error').textContent = ''; showDialog('rule-dialog');
  }
  async function loadAlerts(before = null, history = []) {
    if (!status) return;
    const source = generation, ticket = ++alertTicket;
    try {
      const [page, rules] = mode === 'preview' ? [{ items: (previewData.alerts?.items ?? []).filter(a => $('alert-state').value === 'all' || a.state === $('alert-state').value), nextBefore: null }, previewData.alertRules ?? { items: [] }] : await Promise.all([api('/v1/operator/alerts?' + new URLSearchParams({ state: $('alert-state').value, limit: '25', ...(before ? { before } : {}) })), api('/v1/operator/alert-rules')]);
      if (source !== generation || ticket !== alertTicket) return;
      alertPage = page; alertBefore = before; alertHistory = history; $('alert-list').replaceChildren(); $('rule-list').replaceChildren();
      for (const a of page.items) {
        const card = el('article', undefined, 'panel incident-card'), header = el('div', undefined, 'panel-heading'), title = el('div'); title.append(el('h2', a.title), el('p', `${a.category} · rule revision ${a.ruleVersion}`)); header.append(title, badge(a.state, a.state === 'resolved' ? 'green' : 'amber'));
        const grid = el('div', undefined, 'detail-grid'); grid.append(field('Matching events', `${a.count}${a.count === 1000 ? '+' : ''}`), field('Trigger', `${a.threshold} in ${a.windowMinutes} min`), field('Last observed', date(a.updated)), field('Source audit event', a.sourceEventId, true));
        card.append(header, grid);
        if (a.notes.length) card.append(disclosure('Investigation notes', el('pre', a.notes.map(n => `${date(n.at)} · ${n.actor}\n${n.text}`).join('\n\n'), 'code-block')));
        const update = button('Update disposition →', 'text-button', () => { selectedAlert = a; $('alert-context').textContent = `${a.title} · revision ${a.version}`; $('alert-reason').value = ''; $('alert-error').textContent = ''; showDialog('alert-dialog'); }); update.disabled = !canChange(); card.append(update); $('alert-list').append(card);
      }
      if (!page.items.length) $('alert-list').append(empty('No matching alerts.', 'Configure a threshold rule to watch new gateway events.'));
      for (const rule of rules.items) {
        const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', rule.title), el('p', `${rule.category} · ${rule.threshold} events / ${rule.windowMinutes} min · revision ${rule.version}`, 'small muted'));
        const edit = button('Edit rule', 'text-button', () => editRule(rule)); edit.disabled = !canChange(); row.append(text, badge(rule.enabled ? 'Enabled' : 'Disabled', rule.enabled ? 'green' : 'neutral'), edit); $('rule-list').append(row);
      }
      if (!rules.items.length) $('rule-list').append(el('p', 'No rules configured. Live workspaces start without rules.', 'muted'));
      $('alert-page-label').textContent = `${page.items.length} alerts · page ${history.length + 1}`; $('alert-next').disabled = !page.nextBefore; $('alert-previous').disabled = !history.length;
    } catch (error) { if (source === generation && ticket === alertTicket) notify(userError(error), true); }
  }
  $('rule-form').addEventListener('submit', event => { event.preventDefault(); busy($('rule-save'), async () => {
    if (!canChange()) return; const source = generation;
    try { await api('/v1/operator/alert-rules', { ...(selectedRule ? { id: selectedRule.id } : {}), expectedVersion: selectedRule?.version ?? 0, title: $('rule-name').value, category: $('rule-category').value, threshold: Number($('rule-threshold').value), windowMinutes: Number($('rule-window').value), enabled: $('rule-enabled').value === 'true', reason: $('rule-reason').value }); if (source !== generation) return; $('rule-dialog').close(); notify('Rule revision saved. It will evaluate on the next matching gateway event.'); await loadAlerts(); }
    catch (error) { if (source === generation) $('rule-error').textContent = userError(error); }
  }); });
  $('alert-form').addEventListener('submit', event => { event.preventDefault(); busy($('alert-save'), async () => {
    if (!canChange() || !selectedAlert) return; const source = generation;
    try { await api('/v1/operator/alerts/' + encodeURIComponent(selectedAlert.id), { expectedVersion: selectedAlert.version, state: $('alert-disposition').value, reason: $('alert-reason').value }); if (source !== generation) return; $('alert-dialog').close(); notify('Alert disposition saved.'); await loadAlerts(alertBefore, alertHistory); }
    catch (error) { if (source === generation) $('alert-error').textContent = userError(error); }
  }); });
  $('workspace-report').addEventListener('click', () => busy($('workspace-report'), async () => {
    if (!status) return; const source = generation;
    try { const report = mode === 'preview' ? previewData.workspaceReport : await api('/v1/operator/report', {}); if (source !== generation) return; download(report); notify(mode === 'preview' ? 'Isolated sample report downloaded.' : 'Workspace report downloaded; generation is recorded in the audit log.'); }
    catch (error) { if (source === generation) notify(userError(error), true); }
  }));
  $('request-filters').addEventListener('submit', event => { event.preventDefault(); loadRequests(); });
  $('request-next').addEventListener('click', () => loadRequests(requestPage.nextCursor, [...requestHistory, requestCursor]));
  $('request-previous').addEventListener('click', () => loadRequests(requestHistory.at(-1), requestHistory.slice(0, -1)));
  $('alert-next').addEventListener('click', () => loadAlerts(alertPage.nextBefore, [...alertHistory, alertBefore]));
  $('alert-previous').addEventListener('click', () => loadAlerts(alertHistory.at(-1), alertHistory.slice(0, -1)));
  $('alert-state').addEventListener('change', () => loadAlerts()); $('alert-refresh').addEventListener('click', () => loadAlerts()); $('rule-new').addEventListener('click', () => editRule());
  function workspace() {
    if (!status) return; $('rule-new').disabled = $('rule-save').disabled = $('alert-save').disabled = !canChange(); $('workspace-report').disabled = false;
    const selected = $('request-tool').value; $('request-tool').replaceChildren(new Option('All tools', ''), ...(policyData?.tools ?? []).map(t => new Option(t.name, t.name))); $('request-tool').value = selected;
    if (currentPage === 'requests') loadRequests(requestCursor, requestHistory); if (currentPage === 'alerts') loadAlerts(alertBefore, alertHistory);
  }
  // Rebuild the palette with the same order used by numeric keyboard shortcuts.
  $('quick-links').replaceChildren(...Object.entries(pages).map(([key, value], index) => { const a = el('a', value[0]); a.href = '#' + key; if (index < 10) a.append(el('kbd', String((index + 1) % 10))); a.addEventListener('click', () => $('navigation-dialog').close()); return a; }));
  window.addEventListener('gateway:source-cleared', clear); window.addEventListener('gateway:workspace', workspace);
  window.addEventListener('hashchange', () => { if (currentPage === 'requests') loadRequests(); if (currentPage === 'alerts') loadAlerts(); });
  clear(); workspace();
})();
