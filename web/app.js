const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const pages = {
  overview: ['Overview', 'Security overview', 'YOUR ENFORCEMENT BOUNDARY', 'Understand what your agents can do, and what needs your attention.'],
  approvals: ['Approvals', 'Approval queue', 'HUMAN IN THE LOOP', 'Review exact requests before an agent can proceed.'],
  incidents: ['Incidents', 'Incident center', 'INVESTIGATE & RESPOND', 'Group high-risk events, record findings, and track the response.'],
  alerts: ['Security alerts', 'Security alerts', 'WATCH THE BOUNDARY', 'Turn repeated signals into a focused investigation queue.'],
  safety: ['Safety controls', 'Safety controls', 'TEMPORARY CONTAINMENT', 'Pause new reservations while investigating. Existing operations may still finish.'],
  sessions: ['Sessions', 'Session explorer', 'TASK-SCOPED AUTHORITY', 'Inspect capabilities, data context and resource budgets.'],
  requests: ['Request explorer', 'Request explorer', 'FOLLOW EACH DECISION', 'Search outcomes, inspect the timeline and review arguments with an audit trail.'],
  tools: ['Tool catalog', 'Tool catalog', 'REGISTERED EXECUTION SURFACE', 'Every tool has a contract. Every contract has a boundary.'],
  policy: ['Policy studio', 'Policy studio', 'DETERMINISTIC BY DESIGN', 'Validate and compare decisions before changing host configuration.'],
  audit: ['Audit explorer', 'Audit explorer', 'DURABLE EVIDENCE', 'Find the decision, follow the session, and export the record.'],
  agent: ['AI agent', 'Local AI agent', 'REAL MODEL · GUARDED TOOLS', 'Give the local model a task and inspect each tool decision at the gateway.'],
};
const reasons = {
  POLICY_DENIED: 'Blocked by a policy rule', CAPABILITY_DENIED: 'Outside task permissions', UNKNOWN_TOOL: 'Tool is not registered',
  SENSITIVE_EGRESS_DENIED: 'Sensitive data cannot leave', UNTRUSTED_EGRESS_DENIED: 'Untrusted source before outbound action',
  SECRET_EGRESS_DENIED: 'Detected credential in outgoing data', PII_EGRESS_DENIED: 'Detected personal data in outgoing data',
  CALL_BUDGET_EXCEEDED: 'Task call budget exhausted', COST_BUDGET_EXCEEDED: 'Task cost budget exhausted',
  SESSION_QUARANTINED: 'Session tree temporarily quarantined', TOOL_PAUSED: 'Registered tool temporarily paused',
  HUMAN_APPROVAL_REQUIRED: 'Human approval required', EXECUTION_TIMEOUT: 'Timed out; effect is uncertain',
  EXECUTION_UNCERTAIN: 'External effect requires reconciliation', REVOKED: 'Access has been revoked',
  SESSION_INACTIVE: 'Session expired or inactive', CONFIGURATION_CHANGED: 'Bound configuration has changed',
  SEQUENCE_IN_FLIGHT: 'Waiting for another operation', UNKNOWN_ARGUMENT: 'Argument is outside the tool contract',
  POLICY_ALLOW: 'Policy permits this hypothetical call', SCHEMA_MISMATCH: 'Arguments do not match the tool contract',
};
let accessToken = '', generation = 0, previewData, status, policyData, currentPage = 'overview';
let refreshRunning = false, selectedReview, selectedRevocation;
const controllers = new Set();
const paging = { sessions: { items: [], cursor: null, nextCursor: null, history: [], request: 0 }, audit: { items: [], cursor: null, nextCursor: null, history: [], request: 0, filters: {} } };
let mode = 'preview';

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function svg(tag, attributes = {}) { const node = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, String(v)); return node; }
function icon(name) { const node = svg('svg', { class: 'icon', 'aria-hidden': 'true' }); node.append(svg('use', { href: `#i-${name}` })); return node; }
function button(label, className, action) { const b = el('button', label, className); b.type = 'button'; b.addEventListener('click', action); return b; }
function badge(label, tone = 'neutral') { return el('span', label, `badge ${tone}`); }
function notify(message, error = false) { $('notice').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`; $('notice').hidden = !message; }
const number = value => new Intl.NumberFormat().format(value ?? 0);
const short = value => value ? `${value.slice(0, 8)}…` : '—';
const time = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const date = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const phrase = value => reasons[value] ?? (value ?? 'Recorded').replaceAll('_', ' ').toLowerCase();
const canChange = () => mode === 'live' && status?.identity.role === 'operator';
const pending = a => a.state === 'pending' && !(mode === 'preview' ? a.expired : a.expired || a.expires <= Date.now());
const tone = event => /denied|rejected|revoked/.test(event.type) ? 'red' : /approval|uncertain|duplicate/.test(event.type) ? 'amber' : /finished|started/.test(event.type) ? 'green' : 'neutral';
function empty(title, message, small = false) { const node = el('div', undefined, `empty-state${small ? ' small-empty' : ''}`); node.append(icon('shield'), el('h3', title), el('p', message)); return node; }
function emptyRow(target, columns, message) { const row = el('tr'), cell = el('td', message, 'table-empty'); cell.colSpan = columns; row.append(cell); target.replaceChildren(row); }
function showDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function field(label, value, mono = false) { const node = el('div', undefined, 'detail-field'); node.append(el('span', label), el('p', value, mono ? 'mono wrap' : '')); return node; }
function section(title, content) { const node = el('section', undefined, 'detail-section'); node.append(el('h3', title), content); return node; }
function disclosure(title, content) { const node = el('details', undefined, 'setup-details'); node.append(el('summary', title), content); return node; }
function details(title, eyebrow, content) { $('detail-title').textContent = title; $('detail-eyebrow').textContent = eyebrow; $('detail-content').replaceChildren(content); showDialog('detail-dialog'); }

async function api(path, body, { token = accessToken, raw = false } = {}) {
  const controller = new AbortController(); controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), path === '/v1/operator/agent/check' ? 15000 : 10000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Object.assign(new Error(error.code ?? `HTTP_${response.status}`), { requestId: response.headers.get('x-request-id') });
    }
    return raw ? await response.text() : await response.json();
  } finally { clearTimeout(timer); controllers.delete(controller); }
}
function userError(error) {
  if (error.name === 'AbortError') return 'The request was interrupted. Refresh to try again.';
  if (error.message === 'UNAUTHENTICATED') return 'The access token was not accepted. Connect with a current token.';
  if (error.message === 'FORBIDDEN') return 'This role cannot perform that action.';
  if (error.message === 'RATE_LIMITED') return 'Request limit reached. Wait a minute before refreshing.';
  if (error.message === 'INVALID_CURSOR') return 'This page belongs to another filter or workspace. Refresh the list.';
  return reasons[error.message] ?? `Request failed: ${error.message}.`;
}
async function busy(control, operation) {
  if (control.disabled) return;
  const observed = generation, original = [...control.childNodes];
  control.disabled = true; control.setAttribute('aria-busy', 'true'); control.textContent = 'Working…';
  try { return await operation(); }
  finally { control.removeAttribute('aria-busy'); if (observed === generation) { control.replaceChildren(...original); control.disabled = false; } }
}
function clearSource() {
  generation++; for (const controller of controllers) controller.abort(); controllers.clear(); accessToken = '';
  window.dispatchEvent(new Event('gateway:source-cleared'));
  status = null; policyData = null; previewData = null; selectedReview = null; selectedRevocation = null;
  for (const p of Object.values(paging)) { p.items = []; p.cursor = null; p.nextCursor = null; p.history = []; p.request++; }
  paging.audit.filters = {};
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of ['token', 'review-reason', 'policy-editor', 'test-arguments', 'approval-search', 'session-search', 'tool-search', 'audit-search']) $(id).value = '';
  for (const id of ['detail-content', 'review-context', 'connected-info', 'approval-list', 'attention-list', 'recent-events', 'reason-list', 'tool-list', 'policy-diagnostics', 'activity-chart', 'chart-axis']) $(id).replaceChildren();
  $('revoke-target').textContent = '';
  for (const id of ['metric-executions', 'metric-blocked', 'metric-approvals', 'metric-sessions']) $(id).textContent = '—';
  for (const id of ['overview-policy', 'overview-tools', 'overview-integrity', 'overview-latency', 'policy-fingerprint']) $(id).textContent = '—';
  $('workspace-name').textContent = 'Workspace'; $('workspace-subtitle').textContent = 'Loading…'; $('connection-label').textContent = 'Connect gateway';
  $('verification-time').textContent = 'Connect to inspect live integrity.';
  for (const id of ['verify-audit', 'validate-policy', 'test-policy']) $(id).disabled = true;
  $('nav-approval-count').textContent = '0'; $('audit-type').value = ''; $('audit-range').value = 'all';
  $('approval-filter').value = 'pending'; $('session-filter').value = 'all'; $('tool-filter').value = 'all';
  $('policy-result').replaceChildren(empty('Understand the decision.', 'Connect a workspace to compare hypothetical policy decisions.', true));
  emptyRow($('session-rows'), 7, 'Loading sessions…'); emptyRow($('audit-rows'), 6, 'Loading audit records…');
}
async function openPreview() {
  clearSource(); mode = 'preview'; $('mode-banner').hidden = false; notify(''); const observed = generation;
  try {
    const data = await api('/preview.json', undefined, { token: '' }); if (observed !== generation) return;
    previewData = data; status = data.status; policyData = data.policy;
    paging.sessions.items = data.sessions.items; paging.sessions.nextCursor = null;
    renderWorkspace(true); await loadAudit(null, []); renderSessions();
  } catch (error) { if (observed === generation) notify(userError(error), true); }
}
function renderWorkspace(resetEditor = false) {
  if (!status || !policyData) return;
  $('workspace-name').textContent = mode === 'preview' ? 'Demo workspace' : status.identity.tenant;
  $('workspace-subtitle').textContent = mode === 'preview' ? 'Read-only preview' : `${status.identity.role} access`;
  $('connection-label').textContent = mode === 'preview' ? 'Connect gateway' : `${status.identity.role} · connected`;
  const banner = $('mode-banner'); banner.hidden = mode === 'live';
  $('connected-info').hidden = mode !== 'live';
  $('connected-info').textContent = mode === 'live' ? `${status.identity.principal} · ${status.identity.tenant} · ${status.identity.role}` : '';
  $('disconnect').hidden = mode !== 'live';
  $('sync-status').textContent = mode === 'preview' ? 'Sample data · isolated workspace' : `Synced ${time(Date.now())}`;
  for (const id of ['verify-audit', 'validate-policy', 'test-policy']) { $(id).disabled = mode !== 'live'; $(id).title = mode === 'preview' ? 'Connect a live workspace to use this control.' : ''; }
  $('app-version').textContent = status.version;
  renderOverview(); renderApprovals(); renderTools();
  if (resetEditor || !$('policy-editor').value) resetEditorToActive();
  window.dispatchEvent(new Event('gateway:workspace'));
}
function renderOverview() {
  const stats = status.statistics, count = type => Object.entries(stats.counts).filter(([key]) => key.startsWith(type + '|')).reduce((sum, [, value]) => sum + value, 0);
  const waiting = status.approvals.filter(pending);
  $('metric-executions').textContent = number(count('execution.started'));
  $('metric-blocked').textContent = number(count('execution.denied') + count('request.rejected'));
  $('metric-approvals').textContent = number(waiting.length); $('metric-sessions').textContent = number(stats.sessions);
  $('nav-approval-count').textContent = waiting.length;
  $('overview-policy').textContent = status.policy.version; $('overview-tools').textContent = policyData.tools.length;
  $('overview-integrity').replaceChildren(badge(mode === 'preview' ? 'Sample data' : status.audit.valid ? 'Verified' : 'Corruption detected', mode === 'preview' ? 'neutral' : status.audit.valid ? 'green' : 'red'));
  $('overview-latency').textContent = `${stats.latency.averageMs.toFixed(1)} ms`;
  $('verification-time').textContent = mode === 'preview' ? 'Sample workspace. Connect to inspect live integrity.' : `Full chain last verified ${date(status.audit.verifiedAt)}. Tail checked on refresh.`;
  renderChart(stats.activity);
  $('attention-list').replaceChildren();
  if (!waiting.length) $('attention-list').append(empty('You’re all caught up.', 'No requests are waiting for a decision.', true));
  for (const a of waiting.slice(0, 3)) {
    const row = el('div', undefined, 'attention-row'), symbol = el('span', undefined, 'attention-symbol'); symbol.append(icon('shield'));
    const text = el('div'); text.append(el('h3', a.tool), el('p', `${a.principal} · ${a.requestId}`));
    const open = button('', 'icon-button', () => { location.hash = '#approvals'; }); open.append(icon('arrow')); open.setAttribute('aria-label', `View approval for ${a.tool}`);
    row.append(symbol, text, open); $('attention-list').append(row);
  }
  const reasonCounts = new Map();
  for (const [key, value] of Object.entries(stats.counts)) if (/^(execution.denied|request.rejected)\|/.test(key)) { const code = key.split('|')[1]; reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + value); }
  const top = [...reasonCounts].sort((a, b) => b[1] - a[1]).slice(0, 4), max = Math.max(1, ...top.map(([, n]) => n));
  $('reason-list').replaceChildren();
  if (!top.length) $('reason-list').append(empty('No denials recorded.', 'Enforcement reasons will appear as requests are evaluated.', true));
  for (const [code, count] of top) {
    const row = el('div', undefined, 'reason-row'), meta = el('div', undefined, 'reason-meta'); meta.append(el('span', phrase(code)), el('span', number(count), 'reason-count'));
    const track = el('div', undefined, 'reason-track'), bar = svg('svg', { viewBox: '0 0 100 4', preserveAspectRatio: 'none', 'aria-hidden': 'true' }); bar.append(svg('rect', { x: 0, y: 0, width: count / max * 100, height: 4 })); track.append(bar); row.append(meta, track); $('reason-list').append(row);
  }
  renderRecent($('recent-events'), status.events.filter(e => !e.type.startsWith('session.')).slice(0, 6));
}
function renderChart(activity) {
  const chart = svg('svg', { viewBox: '0 0 720 180', role: 'img', 'aria-label': 'Hourly dispatches, blocked requests and approval requests over the last 24 hours' });
  const maximum = Math.max(1, ...activity.map(b => b.allowed + b.blocked + b.approvals));
  for (const y of [15, 60, 105, 150]) chart.append(svg('line', { x1: 0, y1: y, x2: 720, y2: y, class: 'chart-grid' }));
  activity.forEach((bucket, i) => {
    let y = 165; const x = i * 30 + 7;
    for (const [key, className] of [['allowed', 'chart-allowed'], ['blocked', 'chart-blocked'], ['approvals', 'chart-review']]) {
      const height = bucket[key] / maximum * 145;
      if (height) { const rect = svg('rect', { x, y: y - height, width: 16, height, rx: 2, class: className }); const title = svg('title'); title.textContent = `${date(bucket.at)} · ${key}: ${bucket[key]}`; rect.append(title); chart.append(rect); y -= height; }
    }
  });
  $('activity-chart').replaceChildren(chart); $('chart-axis').replaceChildren(...[0, 6, 12, 18, 23].map(i => el('span', time(activity[i]?.at))));
}
function renderRecent(target, events) {
  target.replaceChildren(); if (!events.length) { target.append(empty('Nothing recorded yet.', 'Activity will appear after the first tool request.', true)); return; }
  for (const event of events) {
    const row = el('div', undefined, 'decision-row'), symbol = el('span', undefined, 'event-icon'); symbol.append(icon(tone(event) === 'green' ? 'check' : 'shield'));
    const text = el('div', undefined, 'event-text'); text.append(el('strong', event.type.replaceAll('.', ' ')), el('p', event.tool ?? event.code ?? event.principal ?? event.session ?? 'Gateway event'));
    const timestamp = el('time', time(event.at)); timestamp.dateTime = new Date(event.at).toISOString();
    const open = button('', 'icon-button', () => showEvent(event)); open.append(icon('arrow')); open.setAttribute('aria-label', `Inspect ${event.type}`);
    row.append(symbol, text, badge(event.code ? phrase(event.code) : event.status ?? 'Recorded', tone(event)), timestamp, open); target.append(row);
  }
}
function renderApprovals() {
  const query = $('approval-search').value.toLowerCase(), filter = $('approval-filter').value;
  const list = status.approvals.filter(a => `${a.tool} ${a.principal} ${a.requestId}`.toLowerCase().includes(query) && (filter === 'all' || (filter === 'pending' ? pending(a) : filter === 'expired' ? a.expired || (mode === 'live' && a.expires <= Date.now()) : a.state === filter)));
  $('approval-summary').textContent = `${list.length} shown · newest 100 open records`;
  $('approval-list').replaceChildren();
  if (!list.length) { $('approval-list').append(empty('No matching requests.', 'Adjust your filter or return when an agent requests a review.')); return; }
  for (const a of list) {
    const card = el('article', undefined, 'approval-card'), header = el('div', undefined, 'approval-card-header'), heading = el('div');
    heading.append(el('h3', a.tool), el('p', `${a.principal} · request ${a.requestId}`, 'small muted'));
    header.append(heading, badge(pending(a) ? 'Awaiting review' : a.expired ? 'Expired' : 'Approved · awaiting retry', pending(a) ? 'amber' : 'neutral'));
    const metadata = el('div', undefined, 'approval-meta'); metadata.append(el('span', `Session ${short(a.sessionId)}`), el('span', mode === 'preview' ? 'Sample request · no execution' : `Expires ${date(a.expires)}`));
    const binding = el('p', `Binding ${a.binding}`, 'mono muted wrap small'), footer = el('div', undefined, 'approval-card-footer');
    const ruleText = a.ruleIds?.length ? `Rules: ${a.ruleIds.join(', ')}` : 'Exact request and policy binding'; footer.append(el('span', ruleText, 'small muted'));
    const actions = el('div', undefined, 'approval-actions');
    if (pending(a)) for (const [decision, label] of [['reject', 'Reject'], ['approve', 'Review & approve']]) {
      const control = button(label, `button${decision === 'reject' ? ' secondary' : ''}`, () => review(a, decision)); control.disabled = !canChange(); control.title = canChange() ? '' : 'Operator access is required to record a decision.'; actions.append(control);
    }
    else actions.append(el('span', a.reason ? `Note: ${a.reason}` : 'No further decision is available.', 'small muted'));
    footer.append(actions); card.append(header, el('pre', JSON.stringify(a.arguments, null, 2)), metadata, binding, footer); $('approval-list').append(card);
  }
}
function review(a, decision) {
  if (!canChange()) return;
  selectedReview = { approval: a, decision, generation };
  $('review-title').textContent = decision === 'approve' ? 'Approve this exact request?' : 'Reject this request?';
  $('review-context').replaceChildren(el('h3', a.tool, 'mono'), el('pre', JSON.stringify(a.arguments, null, 2)), el('p', `Binding ${a.binding}`, 'mono wrap muted'));
  $('review-reason').value = ''; $('review-error').textContent = '';
  $('review-submit').textContent = decision === 'approve' ? 'Approve exact request' : 'Reject request'; showDialog('review-dialog');
  $('review-submit').disabled = false;
}
async function loadSessions(cursor = null, history = []) {
  const observed = generation, request = ++paging.sessions.request;
  try {
    const data = mode === 'preview' ? previewData.sessions : await api('/v1/operator/sessions?' + new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) }));
    if (observed !== generation || request !== paging.sessions.request) return;
    Object.assign(paging.sessions, { ...data, cursor, history }); renderSessions();
  } catch (error) { if (observed === generation) notify(userError(error), true); }
}
function renderSessions() {
  const query = $('session-search').value.toLowerCase(), filter = $('session-filter').value;
  const list = paging.sessions.items.filter(s => `${s.id} ${s.principal}`.toLowerCase().includes(query) && (filter === 'all' || s.status === filter));
  const target = $('session-rows'); target.replaceChildren();
  if (!list.length) emptyRow(target, 7, 'No sessions match this page’s filters.');
  for (const s of list) {
    const row = el('tr'), identity = el('td'), open = button(short(s.id), 'table-link', () => showSession(s.id)); open.setAttribute('aria-label', `Inspect session ${s.id}`); open.title = s.id;
    identity.append(open, el('p', s.principal, 'subtext'));
    const state = el('td'); state.append(badge(s.status.replaceAll('_', ' '), s.status === 'active' ? 'green' : s.status === 'revoked' ? 'red' : 'neutral'));
    const labels = el('td'); labels.append(...(s.labels.length ? s.labels.map(l => badge(l, l === 'sensitive' ? 'red' : 'amber')) : [badge('No labels', 'neutral')]));
    const budget = el('td', undefined, 'budget'); budget.append(el('span', `${s.usage.calls} / ${s.limits.maxCalls}`)); const meter = el('meter'); meter.max = s.limits.maxCalls; meter.value = s.usage.calls; meter.setAttribute('aria-label', `${s.usage.calls} of ${s.limits.maxCalls} tool calls`); budget.append(meter);
    const action = el('td'), arrow = button('', 'icon-button', () => showSession(s.id)); arrow.append(icon('arrow')); arrow.setAttribute('aria-label', `Open session ${s.id}`); action.append(arrow);
    row.append(identity, state, labels, budget, el('td', `${s.usage.cost} / ${s.limits.maxCost}`), el('td', date(s.created)), action); target.append(row);
  }
  $('session-page-label').textContent = `${list.length} shown · page ${paging.sessions.history.length + 1}`;
  $('session-previous').disabled = !paging.sessions.history.length; $('session-next').disabled = !paging.sessions.nextCursor;
}
async function showSession(id) {
  const observed = generation;
  try {
    const data = mode === 'preview' ? previewData.details[id] : await api(`/v1/operator/sessions/${encodeURIComponent(id)}`);
    if (observed !== generation) return;
    const s = data.session, content = el('div'), grid = el('div', undefined, 'detail-grid');
    grid.append(field('Session ID', s.id, true), field('Agent principal', s.principal), field('Status', s.status.replaceAll('_', ' ')), field('Data context', s.labels.join(', ') || 'Trusted'), field('Created', date(s.created)), field('Expires', date(s.expires)), field('Call budget', `${s.usage.calls} / ${s.limits.maxCalls}`), field('Cost budget', `${s.usage.cost} / ${s.limits.maxCost}`), field('Outstanding operations', String(s.usage.active)), field('Output bytes', `${number(s.usage.outputBytes)} / ${number(s.limits.maxOutputBytes)}`));
    const capabilities = el('div');
    for (const grant of s.grants) { const row = el('div', undefined, 'rule-row'); row.append(icon('tools'), el('span', grant.tool, 'mono'), badge(grant.revoked ? 'Revoked' : grant.origins.length ? `${grant.origins.length} approved origin` : 'Granted', grant.revoked ? 'red' : 'neutral')); capabilities.append(row); }
    content.append(grid, section('Task capabilities', capabilities), disclosure('Inspect full capability contracts', el('pre', JSON.stringify(s.grants, null, 2))));
    const events = el('div'); renderRecent(events, data.events.slice(0, 8)); content.append(section('Session timeline', events));
    const actions = el('div', undefined, 'detail-action'), revoke = button('Revoke session access', 'button danger', () => askRevoke('session', s.id));
    const quarantine = button('Quarantine temporarily', 'button secondary', () => window.dispatchEvent(new CustomEvent('gateway:contain-target', { detail: { kind: 'session', target: s.id } })));
    quarantine.disabled = !canChange(); revoke.disabled = !canChange() || s.status === 'revoked'; actions.append(el('p', s.containment ? `Session quarantine active until ${date(s.containment.expires)}.` : 'Revocation also blocks this session’s descendants.'), quarantine, revoke); content.append(actions);
    details('Session details', 'TASK AUTHORITY & PROVENANCE', content);
  } catch (error) { if (observed === generation) notify(userError(error), true); }
}
function renderTools() {
  const query = $('tool-search').value.toLowerCase(), filter = $('tool-filter').value;
  const list = policyData.tools.filter(t => `${t.name} ${t.description}`.toLowerCase().includes(query) && (filter === 'all' || (filter === 'outbound') === t.egress));
  $('tool-count').textContent = `${list.length} / ${policyData.tools.length} tools`; $('tool-list').replaceChildren();
  if (!list.length) $('tool-list').append(empty('No matching tools.', 'Try a different tool name or category.'));
  for (const tool of list) {
    const card = el('article', undefined, 'tool-card'), top = el('div', undefined, 'tool-card-top'); top.append(icon('tools'), badge(tool.revoked ? 'Revoked' : tool.egress ? 'Outbound' : 'Internal', tool.revoked ? 'red' : tool.egress ? 'amber' : 'neutral'));
    const count = Object.keys(tool.inputSchema.properties).length;
    const meta = el('div', undefined, 'tool-meta'); meta.append(badge(`${count} argument${count === 1 ? '' : 's'}`), ...tool.outputLabels.map(l => badge(`${l} source`, l === 'sensitive' ? 'red' : 'amber')));
    const footer = el('div', undefined, 'tool-card-footer'); footer.append(el('span', `${tool.cost} cost unit${tool.cost === 1 ? '' : 's'} · ${tool.timeoutMs / 1000}s timeout`), button('Inspect contract ↗', 'text-button', () => showTool(tool)));
    card.append(top, el('h3', tool.name), el('p', tool.description), meta, footer); $('tool-list').append(card);
  }
}
function showTool(tool) {
  const content = el('div'), grid = el('div', undefined, 'detail-grid');
  const hold = button('Review temporary tool hold', 'button secondary', () => window.dispatchEvent(new CustomEvent('gateway:contain-target', { detail: { kind: 'tool', target: tool.name } })));
  hold.disabled = !canChange(); content.append(hold);
  grid.append(field('Execution boundary', tool.egress ? 'Outbound' : 'Internal'), field('Output classification', tool.outputLabels.join(', ') || 'No predeclared labels'), field('Cost reservation', String(tool.cost)), field('Timeout', `${tool.timeoutMs} ms`));
  content.append(el('p', tool.description, 'muted'), section('Execution metadata', grid), section('Pinned fingerprint', el('p', tool.fingerprint, 'mono wrap')), section('Input contract', el('pre', JSON.stringify(tool.inputSchema, null, 2))), section('Output contract', el('pre', JSON.stringify(tool.outputSchema, null, 2))));
  const rules = policyData.policy.rules.filter(r => r.tools.includes('*') || r.tools.includes(tool.name));
  content.append(section('Applicable policy rules', el('pre', JSON.stringify(rules, null, 2))));
  const actions = el('div', undefined, 'detail-action'), revoke = button('Revoke tool access', 'button danger', () => askRevoke('tool', tool.name)); revoke.disabled = !canChange() || tool.revoked;
  actions.append(el('p', 'Stops new reservations of this tool throughout the tenant.'), revoke); content.append(actions); details(tool.name, 'REGISTERED TOOL CONTRACT', content);
}
function askRevoke(type, value) {
  if (!canChange()) return;
  selectedRevocation = { type, value, generation }; $('detail-dialog').close();
  $('confirm-revoke').disabled = false;
  $('revoke-title').textContent = `Revoke ${type} access?`; $('revoke-target').textContent = value; $('revoke-error').textContent = ''; showDialog('revoke-dialog');
}
function auditFilters() {
  const filters = {}; if ($('audit-search').value.trim()) filters.search = $('audit-search').value.trim(); if ($('audit-type').value) filters.type = $('audit-type').value;
  if ($('audit-range').value !== 'all') filters.from = String(Date.now() - Number($('audit-range').value) * 3600000);
  return filters;
}
async function loadAudit(cursor = null, history = [], filters = paging.audit.filters) {
  if (!status) return;
  const observed = generation, request = ++paging.audit.request;
  try {
    let data;
    if (mode === 'preview') {
      const filtered = previewData.audit.items.filter(e => (!filters.type || e.type === filters.type) && (!filters.from || e.at >= Number(filters.from)) && (!filters.search || JSON.stringify(e).toLowerCase().includes(filters.search.toLowerCase())));
      const offset = Number(cursor ?? 0); data = { items: filtered.slice(offset, offset + 25), nextCursor: offset + 25 < filtered.length ? String(offset + 25) : null };
    } else data = await api('/v1/operator/audit?' + new URLSearchParams({ ...filters, limit: '25', ...(cursor ? { cursor } : {}) }));
    if (observed !== generation || request !== paging.audit.request) return;
    Object.assign(paging.audit, { ...data, cursor, history, filters }); renderAudit();
  } catch (error) { if (observed === generation) notify(userError(error), true); }
}
function renderAudit() {
  const target = $('audit-rows'); target.replaceChildren();
  if (!paging.audit.items.length) emptyRow(target, 6, 'No records match these filters.');
  for (const event of paging.audit.items) {
    const row = el('tr'), state = el('td'); state.append(badge(event.code ? phrase(event.code) : event.status ?? 'Recorded', tone(event)));
    const control = el('td'), open = button('', 'icon-button', () => showEvent(event)); open.append(icon('arrow')); open.setAttribute('aria-label', `Inspect audit event ${event.sequence}`); control.append(open);
    row.append(el('td', date(event.at)), el('td', event.type), el('td', event.tool ?? event.principal ?? event.approver ?? '—', 'mono'), state, el('td', event.request ?? '—', 'mono'), control); target.append(row);
  }
  $('audit-page-label').textContent = `${paging.audit.items.length} records · page ${paging.audit.history.length + 1}${mode === 'preview' ? ' · sample' : ''}`;
  $('audit-previous').disabled = !paging.audit.history.length; $('audit-next').disabled = !paging.audit.nextCursor;
}
function showEvent(event) {
  const content = el('div'), grid = el('div', undefined, 'detail-grid');
  grid.append(field('Event', event.type), field('Recorded', date(event.at)), field('Outcome', event.code ? phrase(event.code) : event.status ?? 'Recorded'), field('Tool', event.tool ?? '—'));
  content.append(grid, section(mode === 'preview' ? 'Sample event record' : 'Authenticated event record', el('pre', JSON.stringify(event, null, 2))));
  if (event.session) content.append(button('Inspect related session →', 'button secondary', () => showSession(event.session)));
  details(`Audit event ${event.sequence}`, mode === 'preview' ? 'SAMPLE METADATA' : 'DECISION EVIDENCE', content);
}
function resetEditorToActive() {
  if (!policyData) return;
  $('policy-editor').value = JSON.stringify(policyData.policy, null, 2); $('policy-fingerprint').textContent = `Active fingerprint ${short(policyData.hash)}`;
  const selected = $('test-tool').value; $('test-tool').replaceChildren(...policyData.tools.map(t => { const option = el('option', t.name); option.value = t.name; return option; }));
  if (policyData.tools.some(t => t.name === selected)) $('test-tool').value = selected;
  else $('test-tool').value = 'report.publish';
  updateTestArguments(); $('policy-diagnostics').replaceChildren();
}
function updateTestArguments() {
  const samples = { 'knowledge.read': { document: 'handbook' }, 'external.read': { document: 'web-page' }, 'vault.read': { record: 'invoice' }, 'compute.sum': { numbers: [10, 20, 12] }, 'text.encode': { text: 'A safe summary.' }, 'report.publish': { url: 'https://reports.example.com/daily', body: 'A safe summary.' }, 'payment.send': { account: 'vendor-approved', amountCents: 12500 } };
  $('test-arguments').value = JSON.stringify(samples[$('test-tool').value] ?? {}, null, 2);
}
function renderComparison(data) {
  const target = $('policy-result'); target.replaceChildren(); const comparison = el('div', undefined, 'comparison');
  for (const [key, title] of [['current', 'Active policy'], ['candidate', 'Candidate policy']]) {
    const result = data[key], box = el('div'); box.append(el('p', title, 'small muted'), badge(result.decision === 'allow' ? 'Allow' : result.decision === 'approval' ? 'Human review' : 'Deny', result.decision === 'allow' ? 'green' : result.decision === 'approval' ? 'amber' : 'red'), el('p', phrase(result.code), 'small')); comparison.append(box);
  }
  target.append(comparison, el('p', 'Preview only. No capabilities, budgets, approval tokens or execution authority are issued.', 'small muted'));
  const matched = data.candidate.explanation?.rules ?? [];
  const rules = el('div');
  for (const rule of matched) { const row = el('div', undefined, 'rule-row'); row.append(icon(rule.matched ? 'check' : 'policy'), el('span', rule.id, 'mono'), badge(rule.matched ? rule.effect : 'No match', rule.matched ? rule.effect === 'deny' ? 'red' : 'amber' : 'neutral')); rules.append(row); }
  if (matched.length) target.append(section('Candidate rule evaluation', rules));
  if (data.candidate.findings?.length) target.append(section('Inspection signals', el('p', data.candidate.findings.join(', '), 'mono wrap')));
  if (data.candidate.transformed) target.append(section('Arguments after redaction', el('pre', JSON.stringify(data.candidate.arguments, null, 2))));
}
async function refreshWorkspace() {
  if (refreshRunning || mode !== 'live') return;
  refreshRunning = true; const observed = generation;
  try {
    const next = await api('/v1/operator/status'); if (observed !== generation) return;
    status = next; renderWorkspace();
  } catch (error) {
    if (observed !== generation) return;
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(error.message)) { await openPreview(); notify(userError(error), true); }
    else { $('sync-status').textContent = 'Connection interrupted'; notify(userError(error), true); }
  } finally { refreshRunning = false; }
}
function navigate(focus = false) {
  const requested = location.hash.slice(1); currentPage = Object.hasOwn(pages, requested) ? requested : 'overview';
  const [name, title, eyebrow, description] = pages[currentPage];
  $('breadcrumb-page').textContent = name; $('page-title').textContent = title; $('page-eyebrow').textContent = eyebrow; $('page-description').textContent = description; document.title = `${title} · Gateway`;
  for (const link of document.querySelectorAll('[data-page]')) { if (link.dataset.page === currentPage) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  for (const screen of document.querySelectorAll('[data-screen]')) screen.hidden = screen.dataset.screen !== currentPage;
  if (currentPage === 'sessions' && status && !paging.sessions.items.length) loadSessions();
  if (currentPage === 'audit' && status && !paging.audit.items.length) loadAudit(null, [], auditFilters());
  if ($('navigation-dialog').open) $('navigation-dialog').close();
  if (focus) $('main-content').focus({ preventScroll: true });
}

for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => $(control.dataset.close).close());
for (const id of ['connection-button', 'banner-connect']) $(id).addEventListener('click', () => { $('connect-error').textContent = ''; showDialog('connect-dialog'); });
$('disconnect').addEventListener('click', openPreview); $('switch-preview').addEventListener('click', openPreview);
$('connect-dialog').addEventListener('close', () => { $('token').value = ''; });
$('quick-nav').addEventListener('click', () => showDialog('navigation-dialog'));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!document.querySelector('dialog[open]')) showDialog('navigation-dialog'); }
  if ($('navigation-dialog').open && /^[0-9]$/.test(event.key)) { event.preventDefault(); location.hash = Object.keys(pages)[(Number(event.key) || 10) - 1]; $('navigation-dialog').close(); }
});
window.addEventListener('hashchange', () => navigate(true));
$('theme-toggle').addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('gateway.theme', theme); } catch {} });
try { const theme = localStorage.getItem('gateway.theme'); if (['dark', 'light'].includes(theme)) document.documentElement.dataset.theme = theme; } catch {}
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault(); const candidateToken = $('token').value.trim(); $('token').value = ''; $('connect-error').textContent = '';
  await busy($('connect-submit'), async () => {
    const observed = generation;
    try {
      const [nextStatus, nextPolicy] = await Promise.all([api('/v1/operator/status', undefined, { token: candidateToken }), api('/v1/operator/policy', undefined, { token: candidateToken })]);
      if (observed !== generation || !$('connect-dialog').open) return;
      clearSource(); mode = 'live'; accessToken = candidateToken; status = nextStatus; policyData = nextPolicy; renderWorkspace(true);
      await Promise.all([loadSessions(), loadAudit(null, [], {})]); notify(`Connected to ${status.identity.tenant} with ${status.identity.role} access.`);
    } catch (error) { if (observed === generation) $('connect-error').textContent = userError(error); }
  });
  $('connect-submit').disabled = false; $('connect-submit').textContent = 'Connect workspace →';
});
$('refresh').addEventListener('click', () => busy($('refresh'), async () => {
  notify(''); if (mode === 'preview') {
    const observed = generation;
    try {
      const data = await api('/preview.json', undefined, { token: '' });
      if (observed !== generation) return;
      previewData = data; status = data.status; policyData = data.policy; paging.sessions.items = data.sessions.items;
      renderWorkspace(); renderSessions(); await loadAudit(null, [], auditFilters());
    } catch (error) { if (observed === generation) notify(userError(error), true); }
  }
  else { await refreshWorkspace(); if (mode === 'live') { if (currentPage === 'sessions') await loadSessions(); if (currentPage === 'audit') await loadAudit(null, [], auditFilters()); } }
  $('refresh').replaceChildren(icon('refresh'), el('span', 'Refresh')); $('refresh').disabled = false;
}));
$('verify-audit').addEventListener('click', () => busy($('verify-audit'), async () => {
  const observed = generation;
  try { const result = await api('/v1/operator/audit/verify', {}); if (observed !== generation) return; status.audit = result; renderOverview(); notify('Full audit chain verified. Export checkpoints separately to detect log truncation.'); }
  catch (error) { if (observed === generation) { notify(userError(error), true); await refreshWorkspace(); } }
}));
for (const id of ['approval-search', 'approval-filter']) $(id).addEventListener(id.endsWith('search') ? 'input' : 'change', () => status && renderApprovals());
for (const id of ['session-search', 'session-filter']) $(id).addEventListener(id.endsWith('search') ? 'input' : 'change', renderSessions);
for (const id of ['tool-search', 'tool-filter']) $(id).addEventListener(id.endsWith('search') ? 'input' : 'change', () => policyData && renderTools());
for (const kind of ['sessions', 'audit']) {
  const prefix = kind === 'sessions' ? 'session' : 'audit', load = kind === 'sessions' ? loadSessions : loadAudit;
  $(`${prefix}-next`).addEventListener('click', () => { const p = paging[kind]; if (p.nextCursor) load(p.nextCursor, [...p.history, p.cursor]); });
  $(`${prefix}-previous`).addEventListener('click', () => { const p = paging[kind], history = [...p.history], cursor = history.pop(); load(cursor ?? null, history); });
}
let searchTimer;
$('audit-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadAudit(null, [], auditFilters()), 250); });
for (const id of ['audit-type', 'audit-range']) $(id).addEventListener('change', () => loadAudit(null, [], auditFilters()));
$('export-audit').addEventListener('click', () => busy($('export-audit'), async () => {
  const observed = generation;
  try {
    let text;
    if (mode === 'preview') {
      const filters = paging.audit.filters, events = previewData.audit.items.filter(e => (!filters.type || e.type === filters.type) && (!filters.from || e.at >= Number(filters.from)) && (!filters.search || JSON.stringify(e).toLowerCase().includes(filters.search.toLowerCase())));
      text = [JSON.stringify({ kind: 'manifest', sample: true, count: events.length }), ...events.map(e => JSON.stringify({ kind: 'event', ...e }))].join('\n') + '\n';
    } else text = await api('/v1/operator/audit/export?' + new URLSearchParams(paging.audit.filters), undefined, { raw: true });
    if (observed !== generation) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' })), anchor = el('a'); anchor.href = url; anchor.download = mode === 'preview' ? 'gateway-sample-audit.jsonl' : 'gateway-audit.jsonl'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Audit export prepared. Check the manifest for truncation and continuation information.');
  } catch (error) { if (observed === generation) notify(userError(error), true); }
}));
$('review-form').addEventListener('submit', event => {
  event.preventDefault(); if (!canChange() || !selectedReview || selectedReview.generation !== generation) return;
  const selected = selectedReview;
  busy($('review-submit'), async () => {
    try {
      await api('/v1/operator/approvals', { sessionId: selected.approval.sessionId, requestId: selected.approval.requestId, binding: selected.approval.binding, decision: selected.decision, reason: $('review-reason').value });
      if (selected.generation !== generation) return;
      $('review-dialog').close(); selectedReview = null; $('review-reason').value = ''; await refreshWorkspace();
      notify(selected.decision === 'approve' ? 'Approval recorded. The agent must retry the original call to continue.' : 'Request rejected. This request ID cannot execute.');
    } catch (error) { if (selected.generation === generation) $('review-error').textContent = userError(error); }
  });
});
$('confirm-revoke').addEventListener('click', () => busy($('confirm-revoke'), async () => {
  if (!canChange() || !selectedRevocation || selectedRevocation.generation !== generation) return;
  const selected = selectedRevocation;
  try {
    await api('/v1/operator/revocations', { type: selected.type, value: selected.value }); if (selected.generation !== generation) return;
    $('revoke-dialog').close(); selectedRevocation = null;
    policyData = await api('/v1/operator/policy'); if (selected.generation !== generation) return;
    await Promise.all([refreshWorkspace(), loadSessions()]); renderTools(); notify('Access revoked. New reservations are blocked; existing operations may still finish.');
  } catch (error) { if (selected.generation === generation) $('revoke-error').textContent = userError(error); }
}));
$('policy-editor').addEventListener('input', () => { $('policy-fingerprint').textContent = `Active fingerprint ${short(policyData?.hash)} · candidate draft`; });
$('reset-policy').addEventListener('click', resetEditorToActive); $('test-tool').addEventListener('change', updateTestArguments);
$('validate-policy').addEventListener('click', () => busy($('validate-policy'), async () => {
  const observed = generation; let document;
  try { document = JSON.parse($('policy-editor').value); } catch { $('policy-diagnostics').replaceChildren(el('p', 'Enter valid JSON in the candidate policy.', 'diagnostic error')); return; }
  try {
    const result = await api('/v1/operator/policy/validate', { policy: document }); if (observed !== generation) return;
    const nodes = [el('p', result.valid ? `Valid contract · ${result.rules} rules · ${result.version}` : 'Policy validation failed.', `diagnostic ${result.valid ? 'success' : 'error'}`), ...result.diagnostics.map(d => el('p', `${d.code}: ${d.message}`, `diagnostic ${d.severity === 'error' ? 'error' : ''}`))];
    $('policy-diagnostics').replaceChildren(...nodes);
  } catch (error) { if (observed === generation) $('policy-diagnostics').replaceChildren(el('p', userError(error), 'diagnostic error')); }
}));
$('policy-test-form').addEventListener('submit', event => {
  event.preventDefault(); if (mode !== 'live') return;
  busy($('test-policy'), async () => {
    const observed = generation; let policy, args;
    try { policy = JSON.parse($('policy-editor').value); args = JSON.parse($('test-arguments').value); }
    catch { $('policy-result').replaceChildren(el('p', 'Enter valid JSON for both policy and arguments.', 'diagnostic error')); return; }
    try { const data = await api('/v1/operator/policy/preview', { policy, tool: $('test-tool').value, arguments: args, labels: $('test-labels').value ? [$('test-labels').value] : [], principal: $('test-principal').value }); if (observed === generation) renderComparison(data); }
    catch (error) { if (observed === generation) $('policy-result').replaceChildren(el('p', userError(error), 'diagnostic error')); }
  });
});
setInterval(() => { if (document.visibilityState === 'visible' && mode === 'live' && !document.querySelector('dialog[open]')) refreshWorkspace(); }, 15000);
navigate(); openPreview();
api('/healthz', undefined, { token: '' }).then(() => { $('service-dot').classList.add('online'); $('service-status').textContent = 'Local service online'; }).catch(() => { $('service-status').textContent = 'Local service unavailable'; });
