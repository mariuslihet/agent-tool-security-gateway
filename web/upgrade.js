// Operator workflows: explicit evaluation starts, read-only investigation and host diagnostics.
(() => {
  const root = document.querySelector('[data-screen="agent"]'); if (!root) return;
  let epoch = 0, busy = false, suite = null, rows = [], suites = [], runs = [], selectedRun = null, selectedTask = null, pendingStart = null, poll = null, runTicket = 0, listTicket = 0, caseSerial = 0;
  const base = '/v1/operator/evaluations', defaults = () => ({ requiredPhrases: [], forbiddenPhrases: [], requiredTools: [], requireCompleted: true, rejectDenied: true });
  const control = (tag, id, text, className) => { const node = el(tag, text, className); node.id = id; return node; };
  const panel = (title, description) => { const node = el('article', undefined, 'panel'); node.append(el('h2', title), el('p', description, 'muted')); root.append(node); return node; };
  const label = (title, input) => { const node = el('label', title); node.append(input); return node; };
  const message = control('p', 'upgrade-error', '', 'error-text'); message.setAttribute('role', 'alert');
  const evaluationPanel = panel('Reusable evaluations', 'Save prompts and acceptance checks together. Starting a suite invokes your real local model in separate tasks; read-only modes and normal gateway controls apply.');
  const actions = el('div', undefined, 'dialog-actions'), newSuite = button('New evaluation suite', 'button', () => editSuite()), refresh = button('Refresh evaluations', 'button secondary', () => perform(loadLists)); actions.append(newSuite, refresh); evaluationPanel.append(actions, message);
  const suiteList = control('div', 'evaluation-suites'), runList = control('div', 'evaluation-runs'), runOutput = control('div', 'evaluation-run-output'); runOutput.setAttribute('aria-live', 'polite');
  evaluationPanel.append(el('h3', 'Saved suites'), suiteList, el('h3', 'Evaluation runs'), runList, runOutput);
  const compareForm = el('form', undefined, 'stack-form'), left = control('select', 'evaluation-compare-left'), right = control('select', 'evaluation-compare-right'), compareButton = control('button', 'evaluation-compare-submit', 'Compare evaluation runs', 'button secondary'), comparison = control('div', 'evaluation-comparison'); compareButton.type = 'submit';
  compareForm.append(label('Baseline run', left), label('Newer run', right), compareButton); evaluationPanel.append(el('h3', 'Compare results'), compareForm, comparison);
  evaluationPanel.id = 'evaluation-workspace'; evaluationPanel.classList.add('upgrade-panel');
  const operations = panel('Diagnostics and investigation', 'Check service readiness and inspect recorded task evidence. These actions never start or resume an agent task.');
  const diagnosticsButton = button('Run operational diagnostics', 'button secondary', () => perform(loadDiagnostics)), timelineButton = button('Inspect selected task timeline', 'button secondary', () => perform(loadTimeline)), operationsActions = el('div', undefined, 'dialog-actions'); operationsActions.append(diagnosticsButton, timelineButton);
  const taskNote = control('p', 'upgrade-task-note', 'Select a task to inspect its timeline.', 'small muted'), diagnosticsOutput = control('div', 'upgrade-diagnostics'), connectorOutput = control('div', 'upgrade-connectors'); operations.append(operationsActions, taskNote, diagnosticsOutput, el('h3', 'Configured read-only database tools'), connectorOutput, el('p', 'Connections are configured on the host through GATEWAY_CONNECTORS_FILE. Choose Read-only tools when creating a task. Default sensitive results remain withheld from model context.', 'small muted'));
  operations.id = 'operations-workspace'; operations.classList.add('upgrade-panel');
  const shortcuts = el('div', undefined, 'dialog-actions'); shortcuts.append(button('Evaluation suites', 'button secondary', () => evaluationPanel.scrollIntoView({ block: 'start' })), button('Service diagnostics', 'button secondary', () => operations.scrollIntoView({ block: 'start' }))); $('agent-workspace-info').after(shortcuts);
  const backupInfo = el('details', undefined, 'setup-details'); backupInfo.append(el('summary', 'Encrypted backup and restore'), el('p', 'Backup and recovery run locally on the host. They never download the service database through this console. Restore writes to a new database; retain the original master key separately.', 'small muted'), el('p', 'Set GATEWAY_BACKUP_PASSPHRASE privately on the host and follow docs/backup.md. Example commands use directories you create and control:', 'small muted'), el('pre', 'node --env-file=.env src/cli.js backup D:\\private-backups\\gateway.backup\nnode --env-file=.env src/cli.js verify-backup D:\\private-backups\\gateway.backup\nnode --env-file=.env src/cli.js restore-backup D:\\private-backups\\gateway.backup D:\\recovery\\gateway-restored.sqlite', 'wrap')); operations.append(backupInfo);

  function dialog(id, title) { const node = control('dialog', id, undefined, 'detail-dialog'), header = el('div', undefined, 'dialog-heading'), heading = control('h2', `${id}-title`, title); node.setAttribute('aria-labelledby', heading.id); header.append(heading, button(`Close ${title.toLowerCase()}`, 'button secondary', () => node.close())); node.append(header); document.body.append(node); return node; }
  const editor = dialog('evaluation-editor-dialog', 'Evaluation suite'), form = el('form', undefined, 'stack-form'), title = control('input', 'evaluation-suite-title'), caseHost = control('div', 'evaluation-case-editor'), editorError = control('p', 'evaluation-editor-error', '', 'error-text'), addCase = button('Add evaluation case', 'button secondary', () => { if (!canChange() || busy || rows.length >= 8) return; appendCase(); controls(); rows.at(-1)?.prompt.focus(); }), saveSuite = control('button', 'evaluation-suite-save', 'Save evaluation suite', 'button');
  title.required = true; title.maxLength = 128; title.autocomplete = 'off'; saveSuite.type = 'submit'; editorError.setAttribute('role', 'alert'); form.append(label('Suite title', title), el('p', 'Up to eight cases. Saving does not invoke the model. Each run snapshots the saved suite and creates separate tasks; suite edits do not alter earlier runs.', 'small muted'), caseHost, addCase, editorError, saveSuite); editor.append(form);
  const timelineDialog = dialog('upgrade-timeline-dialog', 'Task timeline'), timelineOutput = control('div', 'upgrade-timeline-output'); timelineDialog.append(timelineOutput);
  const policyDialog = dialog('upgrade-policy-dialog', 'Recorded policy comparison'), policyOutput = control('div', 'upgrade-policy-output'); policyDialog.append(policyOutput);
  const policyButton = button('Compare recorded requests', 'button secondary', () => perform(comparePolicy)); $('validate-policy').parentElement.append(policyButton);

  function controls() {
    const enabled = canChange();
    for (const node of [newSuite, refresh, diagnosticsButton, policyButton, saveSuite]) node.disabled = !enabled || busy;
    timelineButton.disabled = !enabled || busy || !selectedTask;
    addCase.disabled = !enabled || busy || rows.length >= 8;
    compareButton.disabled = !enabled || busy || runs.length < 2; left.disabled = right.disabled = !enabled || busy || runs.length < 2;
    for (const node of form.querySelectorAll('input,textarea,select,button')) if (node !== addCase) node.disabled = !enabled || busy; for (const row of rows) row.refreshNumberControls?.();
    for (const node of [...suiteList.querySelectorAll('button'), ...runList.querySelectorAll('button'), ...runOutput.querySelectorAll('button')]) node.disabled = !enabled || busy;
    taskNote.textContent = selectedTask ? `Selected task: ${selectedTask}` : 'Select a task to inspect its timeline.';
  }
  async function perform(action) {
    if (!canChange() || busy) return; const source = generation, scope = epoch; busy = true; controls(); message.textContent = '';
    try { await action(source, scope); } catch (error) { if (source === generation && scope === epoch) { const text = error.message === 'INVALID_TASK_CHECKS' ? 'Check the criteria: use unique fields and finite bounds, with minimum no greater than maximum.' : error.message === 'EXPORT_CHECKSUM_MISMATCH' ? 'The download failed its integrity check. Retry the export.' : userError(error); message.textContent = text; if (editor.open) editorError.textContent = text; notify(text, true); } }
    finally { if (source === generation && scope === epoch) { busy = false; controls(); } }
  }
  const current = (source, scope) => source === generation && scope === epoch && canChange();
  const titleRun = item => `${item.title} · ${date(item.created)} · ${short(item.id)} · ${item.state}`;
  function renderLists() {
    suiteList.replaceChildren();
    for (const item of suites) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', item.title), el('p', `${item.caseCount} cases · revision ${item.revision}`, 'small muted')); row.append(text, button('Edit suite', 'text-button', () => perform((source, scope) => loadSuite(item.id, source, scope))), button('Start suite', 'button secondary', () => perform((source, scope) => startSuite(item, source, scope)))); suiteList.append(row); }
    if (!suites.length) suiteList.append(el('p', 'No saved evaluation suites.', 'muted'));
    runList.replaceChildren();
    for (const item of runs) { const row = el('div', undefined, 'rule-summary'); row.append(el('p', titleRun(item), 'small wrap'), badge(item.state, item.state === 'completed' && item.code === 'ALL_CHECKS_PASSED' ? 'green' : 'amber'), button('Inspect evaluation', 'text-button', () => loadRun(item.id))); runList.append(row); }
    if (!runs.length) runList.append(el('p', 'No evaluation runs. Starting a saved suite invokes the local model.', 'muted'));
    const selected = [left.value, right.value]; [left, right].forEach((select, index) => { select.replaceChildren(); for (const item of runs) { const option = el('option', titleRun(item)); option.value = item.id; select.append(option); } if (runs.some(item => item.id === selected[index])) select.value = selected[index]; else if (index && runs.length > 1) select.value = runs[1].id; }); if (runs.length > 1 && left.value === right.value) right.value = runs.find(item => item.id !== left.value).id; controls();
  }
  async function loadLists(source = generation, scope = epoch) {
    if (!canChange()) return; const request = ++listTicket, results = await Promise.all([api(base + '/suites'), api(base + '/runs'), api('/v1/operator/agent/config')]);
    if (!current(source, scope) || request !== listTicket) return; suites = results[0].items; runs = results[1].items; renderLists(); connectorOutput.replaceChildren();
    for (const connector of results[2].connectors ?? []) connectorOutput.append(el('p', `${connector.name} · ${connector.classification} · ${connector.maxRows} rows / ${connector.maxBytes} bytes / ${connector.timeoutMs} ms`, 'small wrap'));
    if (!(results[2].connectors ?? []).length) connectorOutput.append(el('p', 'No database connectors configured on this host.', 'muted'));
  }
  async function loadSuite(id, source, scope) { const value = await api(base + '/suites/' + encodeURIComponent(id)); if (current(source, scope)) editSuite(value); }
  function editSuite(value) {
    if (!canChange()) return; suite = value ?? null; title.value = value?.title ?? ''; rows = []; caseSerial = 0; caseHost.replaceChildren(); editorError.textContent = '';
    for (const item of value?.cases ?? [{ id: `case_${crypto.randomUUID()}`, prompt: $('agent-prompt').value, toolMode: ['safe', 'chat_only', 'readonly', 'workspace_readonly'].includes($('agent-tool-mode').value) ? $('agent-tool-mode').value : 'safe', criteria: defaults() }]) appendCase(item);
    controls(); showDialog(editor.id); title.focus();
  }
  function appendCase(item = { id: `case_${crypto.randomUUID()}`, prompt: '', toolMode: 'safe', criteria: defaults() }) {
    const node = el('fieldset', undefined, 'number-check-row'), serial = ++caseSerial, prompt = el('textarea'), toolMode = el('select'), phrases = el('textarea'), tools = el('textarea'), criteria = el('textarea', undefined, 'code-editor'), entry = { id: item.id, node, prompt, toolMode, criteria };
    node.append(el('legend', `Case ${serial}`)); prompt.required = true; prompt.maxLength = 8000; prompt.rows = 3; prompt.value = item.prompt; prompt.setAttribute('aria-label', `Case ${serial} prompt`);
    for (const [value, name] of [['safe', 'Safe tools'], ['chat_only', 'Chat only'], ['readonly', 'Read-only tools'], ['workspace_readonly', 'Workspace read only']]) { const option = el('option', name); option.value = value; toolMode.append(option); } toolMode.value = item.toolMode; toolMode.setAttribute('aria-label', `Case ${serial} tools`);
    const forbidden = el('textarea'), completed = el('input'), denied = el('input'), jsonRequired = el('input'), numberHost = el('div'); let numberRows = [], numberSerial = 0;
    for (const input of [phrases, tools, forbidden]) { input.rows = 2; input.maxLength = input === tools ? 775 : 1031; }
    for (const input of [completed, denied, jsonRequired]) input.type = 'checkbox';
    phrases.setAttribute('aria-label', 'Case ' + serial + ' required phrases'); tools.setAttribute('aria-label', 'Case ' + serial + ' required successful tools'); forbidden.setAttribute('aria-label', 'Case ' + serial + ' forbidden phrases');
    completed.setAttribute('aria-label', 'Case ' + serial + ' require completed task'); denied.setAttribute('aria-label', 'Case ' + serial + ' reject denied calls'); jsonRequired.setAttribute('aria-label', 'Case ' + serial + ' require JSON object');
    criteria.value = JSON.stringify(item.criteria, null, 2); criteria.rows = 8; criteria.maxLength = 16384; criteria.setAttribute('aria-label', 'Case ' + serial + ' advanced checks JSON');
    const lines = input => input.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const edit = change => { try { const value = JSON.parse(criteria.value); change(value); criteria.value = JSON.stringify(value, null, 2); editorError.textContent = ''; } catch { editorError.textContent = 'Fix the advanced checks JSON before using the visual fields.'; } };
    const updateNumbers = () => edit(value => { if (jsonRequired.checked || numberRows.length) value.structuredOutput = { required: jsonRequired.checked, numbers: numberRows.map(row => ({ path: row.path.value, min: row.min.valueAsNumber, max: row.max.valueAsNumber })) }; else delete value.structuredOutput; });
    const addNumber = button('Add number check to case ' + serial, 'button secondary', () => { if (busy || !canChange() || numberRows.length >= 8) return; appendNumber(); updateNumbers(); controls(); numberRows.at(-1)?.path.focus(); });
    function appendNumber(rule = { path: '', min: 0, max: 0 }) {
      const numberRow = el('fieldset', undefined, 'number-check-row'), numberId = ++numberSerial, grid = el('div', undefined, 'task-budget-grid'), fields = { node: numberRow };
      numberRow.append(el('legend', 'Number check ' + numberId));
      for (const [key, name] of [['path', 'Number field'], ['min', 'Minimum'], ['max', 'Maximum']]) {
        const input = el('input'); input.type = key === 'path' ? 'text' : 'number'; input.required = true; input.value = String(rule[key]); input.setAttribute('aria-label', 'Case ' + serial + ' ' + name.toLowerCase() + ' ' + numberId);
        if (key === 'path') { input.maxLength = 128; input.placeholder = 'total or invoice.total'; } else input.step = 'any';
        input.addEventListener('input', updateNumbers); fields[key] = input; grid.append(label(name, input));
      }
      numberRow.append(grid, button('Remove case ' + serial + ' number check ' + numberId, 'text-button', () => { if (busy || !canChange()) return; numberRow.remove(); numberRows = numberRows.filter(row => row !== fields); updateNumbers(); controls(); })); numberRows.push(fields); numberHost.append(numberRow);
    }
    entry.refreshNumberControls = () => { addNumber.disabled = !canChange() || busy || numberRows.length >= 8; };
    const syncVisual = value => {
      if (!value || !['requiredPhrases', 'forbiddenPhrases', 'requiredTools'].every(key => Array.isArray(value[key]) && value[key].every(item => typeof item === 'string')) || typeof value.requireCompleted !== 'boolean' || typeof value.rejectDenied !== 'boolean') throw Error('Invalid criteria');
      if (value.structuredOutput && (typeof value.structuredOutput.required !== 'boolean' || !Array.isArray(value.structuredOutput.numbers) || value.structuredOutput.numbers.length > 8 || value.structuredOutput.numbers.some(rule => !rule || typeof rule.path !== 'string' || !Number.isFinite(rule.min) || !Number.isFinite(rule.max)))) throw Error('Invalid number checks');
      phrases.value = value.requiredPhrases.join('\n'); forbidden.value = value.forbiddenPhrases.join('\n'); tools.value = value.requiredTools.join('\n'); completed.checked = value.requireCompleted; denied.checked = value.rejectDenied; jsonRequired.checked = value.structuredOutput?.required ?? false;
      numberRows = []; numberSerial = 0; numberHost.replaceChildren(); for (const rule of value.structuredOutput?.numbers ?? []) appendNumber(rule); entry.refreshNumberControls();
    };
    for (const [input, key] of [[phrases, 'requiredPhrases'], [forbidden, 'forbiddenPhrases'], [tools, 'requiredTools']]) input.addEventListener('input', () => edit(value => { value[key] = lines(input); }));
    for (const [input, key] of [[completed, 'requireCompleted'], [denied, 'rejectDenied']]) input.addEventListener('change', () => edit(value => { value[key] = input.checked; }));
    jsonRequired.addEventListener('change', updateNumbers);
    criteria.addEventListener('input', () => { try { syncVisual(JSON.parse(criteria.value)); editorError.textContent = ''; } catch { editorError.textContent = 'Advanced criteria are incomplete or invalid. Fix them before using the visual fields or saving.'; } });
    const advanced = el('details', undefined, 'setup-details'); advanced.append(el('summary', 'Advanced acceptance checks JSON'), el('p', 'Stable case reference: ' + item.id, 'small mono wrap'), el('p', 'Optional raw editor. Visual fields and JSON stay synchronized; unknown rules remain intact for server validation.', 'small muted'), criteria);
    const numeric = el('details', undefined, 'setup-details'); numeric.append(el('summary', 'JSON and number checks for case ' + serial), label('Require a JSON object answer', jsonRequired), numberHost, addNumber, el('p', 'Use a field such as total or invoice.total. Bounds are inclusive; use the same minimum and maximum for an exact number. Adding a number check also requires JSON. Up to eight checks.', 'small muted'));
    node.append(label('Prompt', prompt), label('Tool access', toolMode), label('Required phrases, one per line', phrases), label('Forbidden phrases, one per line', forbidden), label('Required successful tools, one per line', tools), label('Require a completed task', completed), label('Reject denied tool calls', denied), numeric, advanced, button('Remove case ' + serial, 'text-button', () => { if (!canChange() || busy || rows.length <= 1) return; rows = rows.filter(value => value !== entry); node.remove(); controls(); }));
    syncVisual(item.criteria); caseHost.append(node); rows.push(entry);
  }
  form.addEventListener('submit', event => { event.preventDefault(); perform(async (source, scope) => {
    editorError.textContent = ''; let cases;
    try { cases = rows.map(row => ({ id: row.id, prompt: row.prompt.value, toolMode: row.toolMode.value, criteria: JSON.parse(row.criteria.value) })); }
    catch { editorError.textContent = 'Enter valid JSON in every advanced acceptance checks field.'; return; }
    const value = await api(base + '/suites', { ...(suite ? { id: suite.id } : {}), expectedRevision: suite?.revision ?? 0, title: title.value, cases }); if (!current(source, scope)) return; suite = value; editor.close(); notify('Evaluation suite saved. No model was run.'); await loadLists(source, scope);
  }); });
  editor.addEventListener('close', () => { suite = null; rows = []; title.value = ''; caseHost.replaceChildren(); editorError.textContent = ''; controls(); });
  async function startSuite(item, source, scope) {
    if (!pendingStart || pendingStart.suiteId !== item.id || pendingStart.expectedRevision !== item.revision) pendingStart = { id: crypto.randomUUID(), suiteId: item.id, expectedRevision: item.revision };
    const result = await api(base + '/runs', pendingStart); if (!current(source, scope)) return; pendingStart = null; selectedRun = result; renderRun(); await loadLists(source, scope); loadRun(result.id);
  }
  function renderRun() {
    runOutput.replaceChildren(); if (!selectedRun) return; const item = selectedRun;
    runOutput.append(el('h3', 'Selected evaluation'), field('Run', titleRun(item)), field('Outcome', `${item.code} · ${item.results.filter(x => x.passed).length}/${item.results.length} recorded cases passed`), field('Snapshot', `${item.model} · suite revision ${item.suiteRevision} · ${item.suiteHash}`, true));
    const exportFormat = el('select'); exportFormat.setAttribute('aria-label', 'Evaluation export format'); for (const format of ['json', 'csv']) { const option = el('option', format === 'json' ? 'JSON with check details' : 'CSV case summary'); option.value = format; exportFormat.append(option); }
    runOutput.append(label('Export format', exportFormat), button('Download evaluation results', 'button secondary', () => perform(async (source, scope) => {
      const result = await api(base + '/runs/' + encodeURIComponent(item.id) + '/export', { format: exportFormat.value }); if (!current(source, scope)) return;
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(result.content)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); if (!current(source, scope)) return; if (hash !== result.contentHash) throw Error('EXPORT_CHECKSUM_MISMATCH');
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType })), link = el('a'); link.href = url; link.download = 'evaluation-' + item.id + '.' + result.format; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Verified evaluation snapshot downloaded and audited. Review before sharing.');
    })), el('p', 'Downloads are snapshots. JSON includes selected check values; CSV summarizes recorded cases and protects text cells against spreadsheet formulas. Review before sharing.', 'small muted'));
    if (item.activeTask) runOutput.append(field('Active task', item.activeTask, true), button('Open active case task', 'text-button', () => { if (canChange()) window.dispatchEvent(new CustomEvent('gateway:open-task', { detail: { id: item.activeTask } })); }));
    for (const result of item.results) { const detail = el('details', undefined, 'setup-details'); detail.append(el('summary', `${result.passed ? 'PASS' : 'FAIL'} · ${result.caseId} · ${result.state} · ${result.code}`), el('pre', JSON.stringify(result.checks, null, 2), 'wrap'), button('Open case task', 'text-button', () => { if (canChange()) { window.location.hash = 'agent'; window.dispatchEvent(new CustomEvent('gateway:open-task', { detail: { id: result.taskId } })); } })); runOutput.append(detail); }
    if ((['running', 'interrupted'].includes(item.state) || item.state === 'stopped' && item.activeTask)) runOutput.append(button(item.state === 'stopped' ? 'Retry stopping case task' : 'Stop evaluation', 'button secondary', () => perform(async (source, scope) => { const next = await api(base + '/runs/' + encodeURIComponent(item.id) + '/cancel', {}); if (current(source, scope)) { selectedRun = next; renderRun(); await loadLists(source, scope); } })));
    if (item.state === 'blocked') runOutput.append(el('p', 'A case requires a separate operator decision. Inspect its task. This evaluation does not automatically approve or resume it.', 'small muted')); controls();
  }
  async function loadRun(id) {
    if (!canChange()) return; clearTimeout(poll); const source = generation, scope = epoch, request = ++runTicket;
    try { const value = await api(base + '/runs/' + encodeURIComponent(id)); if (!current(source, scope) || request !== runTicket) return; selectedRun = value; renderRun(); if (value.state === 'running' && currentPage === 'agent') poll = setTimeout(() => loadRun(id), 2500); else if (currentPage === 'agent') await loadLists(source, scope); }
    catch (error) { if (current(source, scope) && request === runTicket) message.textContent = userError(error); }
  }
  compareForm.addEventListener('submit', event => { event.preventDefault(); if (!left.value || left.value === right.value) { message.textContent = 'Choose two different evaluation runs.'; return; } perform(async (source, scope) => {
    const result = await api(base + '/compare', { left: left.value, right: right.value }); if (!current(source, scope)) return; comparison.replaceChildren(el('p', result.advisory, 'small muted'), field('Suite snapshot', result.sameSuiteSnapshot ? 'Same saved suite snapshot' : 'Changed suite snapshot; interpret results with care'), field('Models', result.models.join(' → ')), field('Policy changed', result.policyChanged ? 'Yes' : 'No'));
    for (const item of result.results) comparison.append(el('p', `${item.caseId} · ${item.change} · ${item.before === null ? 'missing' : item.before ? 'pass' : 'fail'} → ${item.after === null ? 'missing' : item.after ? 'pass' : 'fail'} · tokens ${item.beforeTokens} → ${item.afterTokens}`, 'small wrap'));
  }); });
  async function loadDiagnostics(source, scope) { const report = await api('/v1/operator/diagnostics', {}); if (!current(source, scope)) return; diagnosticsOutput.replaceChildren(el('h3', report.healthy ? 'No current diagnostic warnings' : 'Diagnostics need attention'), el('p', report.scope, 'small muted'));
    for (const check of report.checks) { const item = el('div', undefined, 'detail-section'); item.append(badge(check.state, check.state === 'ok' ? 'green' : 'amber'), el('strong', ` ${check.title}`), el('p', `${check.code ?? check.detail ?? ''}${check.count !== undefined ? ` · count ${check.count}` : ''}`, 'small wrap'), el('p', check.recovery, 'small muted')); if (check.destination) { const link = el('a', 'Open related workspace', 'text-link'); link.href = '#' + check.destination; item.append(link); } diagnosticsOutput.append(item); }
  }
  async function loadTimeline(source, scope) { if (!selectedTask) return; const id = selectedTask, report = await api('/v1/operator/agent/runs/' + encodeURIComponent(id) + '/timeline'); if (!current(source, scope) || selectedTask !== id) return;
    timelineOutput.replaceChildren(field('Task', [report.id, report.state, report.code].filter(Boolean).join(' · '), true), field('Gateway session', report.sessionId, true), field('Activity totals', `${report.modelTurns} model turns · ${report.toolCalls} tool calls`), el('p', report.advisory, 'small muted'));
    for (const item of report.events) timelineOutput.append(el('p', `#${item.sequence} · ${date(item.at)} · ${item.type}${item.tool ? ` · ${item.tool}` : ''}${item.code ? ` · ${item.code}` : ''}${item.turn !== undefined ? ` · turn ${item.turn}` : ''}${item.durationMs !== undefined ? ` · ${item.durationMs} ms` : ''}`, 'small wrap'));
    for (const [page, name] of [['requests', 'Request explorer'], ['approvals', 'Approval queue'], ['audit', 'Audit explorer']]) { const link = el('a', name + ' →', 'text-link'); link.href = '#' + page; link.addEventListener('click', () => timelineDialog.close()); timelineOutput.append(link, el('br')); } showDialog(timelineDialog.id);
  }
  async function comparePolicy(source, scope) { let policy; try { policy = JSON.parse($('policy-editor').value); } catch { message.textContent = 'Enter valid candidate policy JSON before comparing.'; notify('Enter valid candidate policy JSON before comparing.', true); return; }
    const report = await api('/v1/operator/policy/compare-recorded', { policy, limit: 25 }); if (!current(source, scope)) return; policyOutput.replaceChildren(field('Sampled requests', `${report.sampled} sampled · ${report.changed} changed · ${report.unchanged} unchanged${report.truncated ? ' · sample is partial' : ''}`), el('p', report.contextBasis, 'small muted'), el('p', report.advisory, 'small muted'));
    for (const item of report.results) policyOutput.append(el('p', `${item.changed ? 'CHANGED' : 'UNCHANGED'} · ${item.tool} · ${item.requestId} · current ${item.current.decision} (${item.current.code}) → candidate ${item.proposed.decision} (${item.proposed.code}) · historical ${item.historical.status} (${item.historical.code})`, 'small wrap')); showDialog(policyDialog.id);
  }
  function clear() { epoch++; runTicket++; listTicket++; clearTimeout(poll); poll = null; busy = false; suite = null; rows = []; suites = []; runs = []; selectedRun = selectedTask = pendingStart = null; editor.close(); timelineDialog.close(); policyDialog.close(); for (const node of [suiteList, runList, runOutput, comparison, diagnosticsOutput, connectorOutput, timelineOutput, policyOutput, caseHost, left, right]) node.replaceChildren(); title.value = ''; message.textContent = editorError.textContent = ''; connectorOutput.append(el('p', 'Connect with operator access to inspect host connectors.', 'muted')); controls(); }
  window.addEventListener('gateway:source-cleared', clear);
  window.addEventListener('gateway:task-selected', event => { if (!canChange()) return; selectedTask = event.detail?.id ?? null; controls(); });
  const refreshQuietly = () => { const source = generation, scope = epoch; loadLists(source, scope).catch(error => { if (current(source, scope)) message.textContent = userError(error); }); };
  window.addEventListener('gateway:workspace', () => { controls(); if (canChange() && currentPage === 'agent' && !busy) refreshQuietly(); });
  window.addEventListener('hashchange', () => { clearTimeout(poll); if (currentPage === 'agent' && canChange()) { refreshQuietly(); if (selectedRun?.state === 'running') loadRun(selectedRun.id); } });
  clear();
})();
