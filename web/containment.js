// Uses the console's authenticated transport and source generation guard.
(() => {
  let holdTicket = 0, healthTicket = 0, reviewTicket = 0, selected = null, holds = [], healthLoadedAt = 0;
  const targetURL = (kind, target) => '/v1/operator/containment/target?' + new URLSearchParams({ kind, target });
  function clear() {
    holdTicket++; healthTicket++; reviewTicket++; selected = null; holds = []; healthLoadedAt = 0;
    for (const id of ['scoped-list', 'scoped-context', 'scoped-suggestions', 'health-checks']) $(id).replaceChildren();
    for (const id of ['scoped-target', 'scoped-reason', 'scoped-confirm-reason']) $(id).value = '';
    for (const id of ['scoped-error', 'scoped-confirm-error', 'scoped-count']) $(id).textContent = '';
    $('health-coverage').textContent = 'Connect a workspace to inspect operational health.'; $('scoped-filter').value = 'active';
    for (const id of ['scoped-review', 'scoped-confirm', 'health-refresh', 'scoped-refresh']) $(id).disabled = true;
    for (const [id, label] of Object.entries({ 'scoped-review': 'Review scoped hold', 'scoped-confirm': 'Confirm change' })) { $(id).textContent = label; $(id).removeAttribute('aria-busy'); }
  }
  function suggestions() {
    const options = $('scoped-kind').value === 'tool' ? (policyData?.tools ?? []).map(t => t.name) : holds.filter(h => h.kind === 'session').map(h => h.target);
    $('scoped-suggestions').replaceChildren(...options.map(value => new Option(value, value)));
  }
  function renderHolds() {
    const records = holds.filter(h => $('scoped-filter').value === 'all' || h.active), target = $('scoped-list'); target.replaceChildren();
    for (const h of records) {
      const card = el('article', undefined, 'incident-card scoped-card'), top = el('div', undefined, 'panel-heading'), name = el('div');
      name.append(el('h3', h.kind === 'session' ? 'Session quarantine' : 'Tool hold'), el('p', h.target, 'mono wrap')); top.append(name, badge(h.state, h.active ? 'amber' : 'neutral'));
      const grid = el('div', undefined, 'detail-grid'); grid.append(field('Revision', String(h.revision)), field('Automatic expiry', date(h.expires)), field('Operator', h.releasedBy ?? h.actor), field('Reason', h.reason));
      if (h.releaseReason) grid.append(field('Release reason', h.releaseReason));
      const action = button('Review release →', 'text-button', () => reviewRelease(h)); action.disabled = !canChange() || !h.enabled;
      card.append(top, grid, action); target.append(card);
    }
    if (!records.length) target.append(empty('No matching scoped holds.', 'Use a temporary hold to contain one task tree or one registered tool.'));
    $('scoped-count').textContent = `${records.length} shown · ${holds.length} recorded targets · maximum 100 per workspace`;
    suggestions();
  }
  async function loadHolds() {
    if (!status) return; const source = generation, ticket = ++holdTicket;
    try { const data = mode === 'preview' ? previewData.containment ?? { items: [] } : await api('/v1/operator/containment');
      if (source !== generation || ticket !== holdTicket) return; holds = data.items; renderHolds();
    } catch (error) { if (source === generation && ticket === holdTicket) { holds = []; renderHolds(); $('scoped-error').textContent = userError(error); } }
  }
  function confirmContext(input) {
    selected = { ...input, source: generation };
    const grid = el('div', undefined, 'detail-grid'); grid.append(field('Action', input.action === 'hold' ? 'Temporarily block new reservations' : 'Release this scoped hold'), field('Workspace', status.identity.tenant), field('Target type', input.kind === 'session' ? 'Session and descendants' : 'Tool across tenant'), field('Exact target', input.target, true), field('Expected revision', String(input.expectedRevision)));
    if (input.action === 'hold') grid.append(field('Duration', `${input.durationMinutes} minutes`));
    $('scoped-context').replaceChildren(grid); $('scoped-confirm-reason').value = input.reason ?? ''; $('scoped-confirm-error').textContent = ''; $('scoped-confirm').disabled = !canChange(); showDialog('scoped-dialog');
  }
  function reviewRelease(h) {
    if (!canChange()) return; reviewTicket++;
    confirmContext({ action: 'release', kind: h.kind, target: h.target, expectedRevision: h.revision });
  }
  $('scoped-form').addEventListener('submit', event => { event.preventDefault(); if (!canChange()) return;
    const source = generation, ticket = ++reviewTicket, input = { action: 'hold', kind: $('scoped-kind').value, target: $('scoped-target').value.trim(), durationMinutes: Number($('scoped-duration').value), reason: $('scoped-reason').value };
    busy($('scoped-review'), async () => {
      try { const previous = await api(targetURL(input.kind, input.target)); if (source !== generation || ticket !== reviewTicket) return; $('scoped-error').textContent = ''; confirmContext({ ...input, expectedRevision: previous.revision }); }
      catch (error) { if (source === generation && ticket === reviewTicket) $('scoped-error').textContent = userError(error); }
    });
  });
  $('scoped-confirm-form').addEventListener('submit', event => { event.preventDefault(); if (!canChange() || !selected || selected.source !== generation) return;
    const reviewed = selected; busy($('scoped-confirm'), async () => {
      try { await api('/v1/operator/containment/' + reviewed.action, { kind: reviewed.kind, target: reviewed.target, expectedRevision: reviewed.expectedRevision, ...(reviewed.action === 'hold' ? { durationMinutes: reviewed.durationMinutes } : {}), reason: $('scoped-confirm-reason').value });
        if (reviewed.source !== generation) return; $('scoped-dialog').close(); selected = null; $('scoped-reason').value = ''; $('scoped-confirm-reason').value = ''; await loadHolds(); notify(reviewed.action === 'hold' ? 'Scoped hold recorded. Matching new reservations are blocked until release or expiry.' : 'Scoped hold released. Other holds and normal authorization still apply.');
      } catch (error) { if (reviewed.source === generation) $('scoped-confirm-error').textContent = error.message === 'VERSION_CONFLICT' ? 'This target changed after review. Close this dialog, refresh holds and review the current revision.' : userError(error); }
    });
  });
  $('scoped-dialog').addEventListener('close', () => { selected = null; $('scoped-confirm-reason').value = ''; $('scoped-context').replaceChildren(); });
  for (const id of ['scoped-kind', 'scoped-target', 'scoped-duration', 'scoped-reason']) $(id).addEventListener('input', () => { reviewTicket++; });
  $('scoped-kind').addEventListener('change', () => { $('scoped-target').value = ''; suggestions(); });
  $('scoped-filter').addEventListener('change', renderHolds); $('scoped-refresh').addEventListener('click', loadHolds);
  async function loadHealth() {
    if (!status) return; const source = generation, ticket = ++healthTicket;
    $('health-coverage').textContent = 'Checking operational records…';
    try { const health = mode === 'preview' ? previewData.health : await api('/v1/operator/workspace-health');
      if (source !== generation || ticket !== healthTicket) return;
      healthLoadedAt = Date.now();
      const coverage = health.coverage; $('health-checks').replaceChildren();
      $('health-coverage').textContent = `${mode === 'preview' ? 'Sample · ' : ''}Checked ${date(health.generatedAt)} · ${coverage.pendingSample} pending records, ${coverage.sessionSample} sessions sampled${coverage.pendingTruncated || coverage.sessionsTruncated ? ' · More records exist; sample is incomplete.' : '.'}`;
      for (const check of health.checks) {
        const card = el('article', undefined, 'health-check'), top = el('div', undefined, 'panel-heading'); top.append(el('h3', check.title), badge(check.state, check.state === 'warning' ? 'red' : check.state === 'attention' ? 'amber' : check.state === 'ok' ? 'green' : 'neutral'));
        const link = el('a', 'Investigate →', 'text-link'); link.href = '#' + check.destination; card.append(top, el('strong', number(check.count), 'health-count'), el('p', check.detail, 'small muted'), link); $('health-checks').append(card);
      }
    } catch (error) { if (source === generation && ticket === healthTicket) { $('health-checks').replaceChildren(); $('health-coverage').textContent = 'Health check unavailable. ' + userError(error); } }
  }
  $('health-refresh').addEventListener('click', loadHealth);
  window.addEventListener('gateway:contain-target', event => { if (!canChange()) return; $('detail-dialog').close(); location.hash = '#safety'; $('scoped-kind').value = event.detail.kind; $('scoped-target').value = event.detail.target; suggestions(); $('scoped-target').focus(); });
  function workspace() {
    if (!status) return; $('scoped-review').disabled = !canChange(); $('scoped-refresh').disabled = $('health-refresh').disabled = false; suggestions();
    if (currentPage === 'safety') loadHolds(); if (currentPage === 'overview' && Date.now() - healthLoadedAt >= 60000) loadHealth();
  }
  window.addEventListener('gateway:workspace', workspace); window.addEventListener('gateway:source-cleared', clear);
  window.addEventListener('hashchange', () => { if (currentPage === 'safety') loadHolds(); if (currentPage === 'overview') loadHealth(); });
  clear(); workspace();
})();
