// Real local-model tasks only. No canned model responses or automatic task submissions.
(() => {
  let configuration = null, run = null, ticket = 0, configTicket = 0, polling = null, pendingFollow = null, pendingStart = null, followBusy = false;
  let historyTicket = 0, historyOffset = 0, historyNext = null, templateTicket = 0, healthTicket = 0, selectedOrganization = null, selectedTemplate = null;
  let filesTicket = 0, reportTicket = 0;
  let renderTicket = 0, selectedRender = null, templateInputs = [], renderBusy = false;
  let comparisonTicket = 0, comparisonFiles = [], comparisonBusy = false, comparison = null;
  let checkTicket = 0, checkReview = null, checkLoadedId = null, checkBinding = null, checkBusy = false, checkServerStale = false;
  let planTicket = 0, planBusy = false, selectedPlan = null, startBusy = false;
  const liveOperator = () => canChange() && configuration?.configured;
  function clear() {
    planTicket++; planBusy = false; startBusy = false; selectedPlan = null; $('task-plan-dialog').close(); $('task-plan-output').replaceChildren(); $('task-plan-error').textContent = '';
    ticket++; configTicket++; clearTimeout(polling); polling = null; configuration = null; run = null; pendingFollow = pendingStart = null; followBusy = false;
    historyTicket++; templateTicket++; healthTicket++; historyOffset = 0; historyNext = null; selectedOrganization = selectedTemplate = null;
    checkTicket++; checkReview = null; checkLoadedId = null; checkBinding = null; checkBusy = false; checkServerStale = false; $('task-check-dialog').close(); $('agent-check-summary').replaceChildren(); $('task-check-output').replaceChildren(); $('task-check-error').textContent = ''; for (const id of ['task-check-required', 'task-check-forbidden', 'task-check-tools']) $(id).value = '';
    comparisonTicket++; comparisonFiles = []; comparisonBusy = false; comparison = null; $('report-compare-left').replaceChildren(); $('report-compare-right').replaceChildren(); $('report-compare-dialog').close(); $('report-compare-content').textContent = ''; $('report-compare-meta').textContent = ''; $('report-compare-note').textContent = 'Refresh files to select two saved reports.';
    renderTicket++; renderBusy = false; selectedRender = null; templateInputs = []; $('template-values-dialog').close(); $('template-values-fields').replaceChildren(); $('template-values-context').textContent = ''; $('template-values-error').textContent = ''; $('template-kind').value = 'plain';
    filesTicket++; reportTicket++; $('workspace-inputs').replaceChildren(); $('workspace-reports').replaceChildren(); $('workspace-files-note').textContent = 'Connect with operator access to inspect local workspace files.'; $('workspace-files-refresh').disabled = true; $('workspace-report-dialog').close(); $('workspace-report-content').textContent = ''; $('workspace-report-meta').textContent = '';
    $('agent-health').replaceChildren(); $('agent-health-note').textContent = 'Select a task to inspect its current limits and restrictions.'; $('agent-health-refresh').disabled = true;
    $('agent-activity').textContent = ''; $('agent-workspace-info').textContent = 'Workspace tools require a host-configured folder of reviewed text documents.';
    $('agent-budget-preset').value = 'standard'; $('agent-budget-turns').value = '6'; $('agent-budget-calls').value = '12'; $('agent-budget-minutes').value = '6';
    $('agent-history-search').value = ''; $('agent-history-state').value = 'all'; $('agent-history-archive').value = 'active'; $('agent-history-pin').value = 'all'; $('agent-template-filter').value = 'true';
    for (const id of ['task-title', 'task-tags', 'template-title', 'template-prompt']) $(id).value = '';
    for (const id of ['task-organization-context', 'task-organization-error', 'task-template-error', 'agent-history-count']) $(id).textContent = '';
    $('agent-templates').replaceChildren();
    for (const id of ['agent-conversation', 'agent-steps', 'agent-run-info', 'agent-history', 'agent-usage']) $(id).replaceChildren();
    $('agent-follow-prompt').value = ''; $('agent-tool-mode').value = 'safe'; $('agent-follow-note').textContent = 'Complete a task to continue its conversation.';
    $('agent-export-format').value = 'json'; $('agent-export-note').textContent = 'Exports are redacted and audited. Downloaded files contain conversation text; review before sharing.';
    $('agent-prompt').value = ''; $('agent-error').textContent = ''; $('agent-provider').textContent = 'Connect with operator access to use the local model.'; $('agent-run-status').textContent = 'No task selected.'; $('agent-state').textContent = 'Not started';
    for (const id of ['agent-submit', 'agent-check', 'agent-resume', 'agent-cancel', 'agent-history-refresh', 'agent-follow-submit', 'agent-export', 'agent-history-next', 'agent-history-previous', 'agent-template-new', 'task-organization-save', 'task-template-save']) $(id).disabled = true;
  }
  function controls() {
    const busyRun = run && ['queued', 'running'].includes(run.state);
    $('agent-plan').disabled = !liveOperator() || busyRun || planBusy || startBusy;
    $('task-plan-start').disabled = !liveOperator() || !selectedPlan || selectedPlan.result.blockers.length > 0 || busyRun || startBusy;
    $('agent-submit').disabled = !liveOperator() || busyRun || startBusy; $('agent-check').disabled = !liveOperator(); $('agent-history-refresh').disabled = !canChange();
    $('agent-resume').disabled = !liveOperator() || !run || run.organization?.archived || !['waiting', 'interrupted'].includes(run.state);
    $('agent-cancel').disabled = !canChange() || !run || !['queued', 'running', 'waiting', 'interrupted'].includes(run.state);
    $('agent-follow-submit').disabled = !liveOperator() || followBusy || !run || run.organization?.archived || run.state !== 'completed' || run.turns >= run.limits.maxTurns;
    $('agent-export').disabled = !canChange() || !run;
    $('workspace-files-refresh').disabled = !canChange();
    $('agent-health-refresh').disabled = !canChange() || !run;
    for (const id of ['agent-template-new', 'task-organization-save', 'task-template-save']) $(id).disabled = !canChange();
    $('template-values-submit').disabled = !canChange() || renderBusy;
    $('report-compare-submit').disabled = !canChange() || comparisonBusy || comparisonFiles.length < 2;
    for (const id of ['report-compare-left', 'report-compare-right']) $(id).disabled = !canChange() || comparisonBusy || comparisonFiles.length < 2;
    $('report-compare-download').disabled = !canChange() || !comparison;
    $('task-check-submit').disabled = !canChange() || checkBusy || !checkBinding;
    $('task-check-download').disabled = !canChange() || !checkReview || checkReview.run !== run?.id;
  }
  function render() {
    controls(); if (!run) return;
    $('agent-state').textContent = run.state; $('agent-state').className = `badge ${run.state === 'completed' ? 'green' : ['failed', 'stopped'].includes(run.state) ? 'red' : 'amber'}`;
    $('agent-run-status').textContent = `${run.organization?.title ?? short(run.id)} · ${run.model} · ${run.turns} model turns · ${run.toolCalls} tool calls · ${run.code}`;
    const phases = { queued: 'Starting task', model_generation: 'Local model generating', tool_execution: 'Gateway evaluating or executing tool', waiting: 'Waiting for a separate operator decision', interrupted: 'Interrupted; inspect before resuming', completed: 'Task completed', failed: 'Task failed', stopped: 'Task stopped' };
    $('agent-activity').textContent = `${phases[run.activity?.phase] ?? run.state}${run.activity?.tool ? ` · ${run.activity.tool}` : ''}`;
    $('agent-conversation').replaceChildren(...run.conversation.map(message => { const card = el('article', undefined, `agent-message ${message.role}`); card.append(el('strong', message.role === 'user' ? 'Your task' : 'Model-generated response'), el('p', message.text)); return card; }));
    if (!run.conversation.some(m => m.role === 'assistant') && ['queued', 'running'].includes(run.state)) $('agent-conversation').append(el('p', 'The local model is generating. First use may take longer while the model loads.', 'muted'));
    const info = el('div', undefined, 'detail-grid'); info.append(field('Gateway session', run.sessionId, true), field('Task ID', run.id, true), field('Fixed tool mode', run.toolMode ?? 'all'), field('Granted tools', run.allowedTools?.join(', ') || 'None')); $('agent-run-info').replaceChildren(info);
    info.append(field('Fixed task budget', `${run.limits.maxTurns} model turns · ${run.limits.maxToolCalls} tool evaluations · ${run.limits.maxRunMs / 1000}s per attempt`));
    $('agent-follow-note').textContent = run.turns >= run.limits.maxTurns ? 'This task has reached its model-turn budget. Start a new task to continue.' : run.state === 'completed' ? `Continues task ${short(run.id)} · ${run.limits.maxTurns - run.turns} model turns remain · permissions stay ${run.toolMode ?? 'all'}.` : 'Follow-ups are available after the current task completes. Resolve any pending call first.';
    if (run.organization?.archived) $('agent-follow-note').textContent = 'This task is archived. Restore it through Organize before adding another message.';
    const selectedTask = run, organize = button('Organize selected task', 'button secondary', () => editOrganization(selectedTask)); organize.disabled = !canChange(); $('agent-run-info').append(organize);
    const check = button('Check result', 'button secondary', openChecks); check.disabled = !canChange() || checkBusy || ['queued', 'running'].includes(run.state); $('agent-run-info').append(check); renderCheckSummary();
    const reuse = button('Reuse original prompt', 'button secondary', () => {
      if (!canChange()) return; const original = selectedTask.conversation.find(m => m.role === 'user'); if (!original) return;
      $('agent-prompt').value = original.text; $('agent-tool-mode').value = 'safe'; pendingStart = null; $('agent-prompt').focus();
      notify('Original prompt loaded with safe tools. Review and start a separate task; conversation history, approvals and permissions were not copied.');
    }); reuse.disabled = !canChange() || !run.conversation.some(m => m.role === 'user'); $('agent-run-info').append(reuse);
    const usage = run.usage ?? { requests: 0, reportedRequests: 0 };
    $('agent-usage').replaceChildren(field('Completed model requests', number(usage.requests)), field('Input tokens', usage.reportedRequests ? number(usage.inputTokens) : 'Not reported'), field('Output tokens', usage.reportedRequests ? number(usage.outputTokens) : 'Not reported'), field('Provider duration', usage.reportedRequests ? `${(usage.modelDurationMs / 1000).toFixed(2)} s` : 'Not reported'), field('Recorded local request time', usage.timedRequests ? `${((usage.wallDurationMs ?? 0) / 1000).toFixed(2)} s` : 'Not recorded'), field('Usage coverage', `${usage.reportedRequests} of ${usage.requests} responses reported statistics · ${usage.timedRequests ?? 0} requests timed`));
    const steps = el('div'); for (const step of run.steps) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', step.tool, 'mono'), el('p', `${step.code} · ${step.requestId}`, 'small muted wrap')); row.append(text, badge(step.status, step.status === 'completed' ? 'green' : step.status === 'denied' ? 'red' : 'amber')); steps.append(row); }
    $('agent-steps').replaceChildren(section('Gateway execution trace', steps));
    if (run.state === 'waiting') { const link = el('a', run.code === 'HUMAN_APPROVAL_REQUIRED' ? 'Open approval queue →' : 'Open safety controls →', 'text-link'); link.href = run.code === 'HUMAN_APPROVAL_REQUIRED' ? '#approvals' : '#safety'; $('agent-steps').append(link); }
    if (run.code === 'MODEL_DATA_WITHHELD') $('agent-steps').append(el('p', 'The task stopped before forwarding classified or detected sensitive tool data to the model.', 'muted'));
  }
  async function loadRun(id) {
    if (!canChange()) return; const source = generation, request = ++ticket;
    clearTimeout(polling);
    try { const next = await api('/v1/operator/agent/runs/' + encodeURIComponent(id)); if (source !== generation || request !== ticket) return;
      if (run?.id !== next.id) { pendingFollow = null; $('agent-follow-prompt').value = ''; $('agent-health').replaceChildren(); } run = next; render(); loadHealth();
      if (checkLoadedId !== run.id) { checkLoadedId = run.id; loadChecks(run.id); }
      if (currentPage === 'agent' && ['queued', 'running'].includes(run.state)) polling = setTimeout(() => loadRun(id), 2500);
      else if (currentPage === 'agent') history();
    } catch (error) { if (source === generation && request === ticket) $('agent-error').textContent = userError(error); }
  }
  function checksStale() { return Boolean(checkReview && (checkServerStale || checkReview.taskRevision !== run?.revision || checkReview.taskState !== run?.state || checkReview.taskCode !== run?.code)); }
  function renderCheckSummary() {
    const node = $('agent-check-summary'); node.replaceChildren(); if (!run) return;
    if (!checkReview || checkReview.run !== run.id) { node.append(el('p', 'No acceptance checks loaded for this task. Use Check result to evaluate the answer and completed tools.', 'small muted')); return; }
    node.append(badge(checksStale() ? 'Checks stale' : checkReview.passed ? 'Checks passed' : 'Checks failed', checksStale() ? 'amber' : checkReview.passed ? 'green' : 'red'), el('p', `Loaded check revision ${checkReview.revision} · evaluated task revision ${checkReview.taskRevision}${checksStale() ? ' · Re-run against the latest task.' : ''}`, 'small muted'));
  }
  async function loadChecks(id) {
    const source = generation, request = ++checkTicket;
    try { const result = await api(`/v1/operator/agent/runs/${encodeURIComponent(id)}/checks`); if (source !== generation || request !== checkTicket || run?.id !== id) return; checkReview = result.review; checkServerStale = result.stale; renderCheckSummary(); }
    catch (error) { if (source === generation && request === checkTicket && run?.id === id) $('agent-check-summary').replaceChildren(el('p', userError(error), 'small muted')); }
  }
  function renderCheckOutput() {
    const node = $('task-check-output'); node.replaceChildren(); if (!checkReview || checkReview.run !== run?.id) return;
    node.append(el('h3', checksStale() ? 'Saved checks are stale' : checkReview.passed ? 'Configured checks passed' : 'Configured checks failed'), el('p', `Task revision ${checkReview.taskRevision} · check revision ${checkReview.revision} · ${checkReview.checks.filter(item => item.passed).length}/${checkReview.checks.length} passed`, 'small muted'));
    const labels = { assistant_answer_present: 'Assistant answer present', task_completed: 'Task completed', required_phrase: 'Required phrase', forbidden_phrase_absent: 'Forbidden phrase absent', required_tool_completed: 'Required tool completed', no_denied_tool_calls: 'No denied tool calls' };
    for (const item of checkReview.checks) { const row = el('p', `${item.passed ? 'PASS' : 'FAIL'} · ${labels[item.kind] ?? item.kind}${item.value ? ` · ${item.value}` : ''}`, 'small wrap'); node.append(row); }
    controls();
  }
  async function openChecks() {
    if (!canChange() || !run || checkBusy) return; const source = generation, id = run.id, request = ++checkTicket; checkBusy = true; controls();
    try {
      const result = await api(`/v1/operator/agent/runs/${encodeURIComponent(id)}/checks`); if (source !== generation || request !== checkTicket || run?.id !== id) return;
      if (result.currentTaskRevision !== run.revision) { $('agent-error').textContent = 'The task changed. Reload its latest answer before checking it.'; await loadRun(id); return; }
      checkReview = result.review; checkServerStale = result.stale; checkBinding = { id, taskRevision: run.revision, revision: result.review?.revision ?? 0 };
      const criteria = result.review?.criteria ?? { requiredPhrases: [], forbiddenPhrases: [], requiredTools: [], requireCompleted: true, rejectDenied: true };
      $('task-check-required').value = criteria.requiredPhrases.join('\n'); $('task-check-forbidden').value = criteria.forbiddenPhrases.join('\n'); $('task-check-tools').value = criteria.requiredTools.join('\n'); $('task-check-completed').checked = criteria.requireCompleted; $('task-check-denied').checked = criteria.rejectDenied;
      $('task-check-context').textContent = `${run.organization?.title ?? id} · task revision ${run.revision}`; $('task-check-error').textContent = ''; renderCheckOutput(); renderCheckSummary(); showDialog('task-check-dialog'); $('task-check-dialog').scrollTop = 0;
    } catch (error) { if (source === generation && request === checkTicket) $('agent-error').textContent = userError(error); }
    finally { if (source === generation && request === checkTicket) { checkBusy = false; controls(); } }
  }
  $('task-check-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!canChange() || checkBusy || !checkBinding || run?.id !== checkBinding.id) return;
    const source = generation, binding = checkBinding, request = ++checkTicket, lines = id => $(id).value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const criteria = { requiredPhrases: lines('task-check-required'), forbiddenPhrases: lines('task-check-forbidden'), requiredTools: lines('task-check-tools'), requireCompleted: $('task-check-completed').checked, rejectDenied: $('task-check-denied').checked };
    checkBusy = true; checkReview = null; checkServerStale = false; renderCheckSummary(); renderCheckOutput(); controls(); $('task-check-error').textContent = '';
    try {
      const result = await api(`/v1/operator/agent/runs/${encodeURIComponent(binding.id)}/checks`, { expectedRevision: binding.revision, expectedTaskRevision: binding.taskRevision, criteria });
      if (source !== generation || request !== checkTicket || run?.id !== binding.id) return; checkReview = result.review; checkServerStale = result.stale; checkBinding.revision = result.review.revision; renderCheckSummary(); renderCheckOutput(); $('task-check-output').scrollIntoView({ block: 'nearest' }); notify('Acceptance checks saved and audited. No model or tool was run.');
    } catch (error) { if (source === generation && request === checkTicket) $('task-check-error').textContent = error.message === 'VERSION_CONFLICT' ? 'The task or checks changed. Close this form and reopen the latest version.' : error.message === 'INVALID_TASK_CHECKS' ? 'Use up to eight unique phrases per list (128 characters each) and eight valid tool names.' : userError(error); }
    finally { if (source === generation && request === checkTicket) { checkBusy = false; controls(); } }
  });
  $('task-check-download').addEventListener('click', () => { if (!canChange() || !run || checkReview?.run !== run.id) return; const content = JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), stale: checksStale(), review: checkReview }, null, 2), url = URL.createObjectURL(new Blob([content], { type: 'application/json' })), link = el('a'); link.href = url; link.download = `task-checks-${run.id}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Saved check snapshot downloaded. Its evaluation is audited.'); });
  $('task-check-dialog').addEventListener('close', () => { checkTicket++; checkBinding = null; checkBusy = false; for (const id of ['task-check-required', 'task-check-forbidden', 'task-check-tools']) $(id).value = ''; $('task-check-context').textContent = ''; $('task-check-error').textContent = ''; $('task-check-output').replaceChildren(); controls(); });
  async function loadHealth() {
    if (!canChange() || !run) return; const id = run.id, source = generation, request = ++healthTicket;
    $('agent-health-note').textContent = 'Checking the current task snapshot…';
    try {
      const health = await api('/v1/operator/agent/runs/' + encodeURIComponent(id) + '/health');
      if (source !== generation || request !== healthTicket || run?.id !== id) return;
      const labels = { modelTurns: 'Model turns', toolEvaluations: 'Tool evaluations', sessionCalls: 'Session calls', costUnits: 'Tool cost units', outputBytes: 'Output bytes' };
      const grid = el('div', undefined, 'detail-grid'); for (const [key, value] of Object.entries(health.budgets)) grid.append(field(labels[key] ?? key, `${number(value.remaining)} remaining · ${number(value.used)} / ${number(value.limit)} used`));
      grid.append(field('Session status', health.session.status), field('Session expires', date(health.session.expires)), field('Session labels', health.session.labels.join(', ') || 'None'), field('Time limit per attempt', `${health.attemptTimeLimitMs / 1000}s`));
      const messages = el('div'); messages.append(el('p', health.followUp.available ? 'No current task or session blocker for a follow-up.' : `Follow-up blockers: ${health.followUp.blockers.join(', ')}`, 'small muted'));
      if (health.session.containment) messages.append(el('p', `Session restriction: ${health.session.containment.code}`, 'small muted'));
      for (const tool of health.tools.filter(t => t.restriction)) messages.append(el('p', `${tool.name}: ${tool.restriction}`, 'small muted'));
      if (health.pending) messages.append(el('p', `Pending ${health.pending.tool} · ${health.pending.status}${health.pending.approval ? ` · approval ${health.pending.approval.state}${health.pending.approval.expired ? ' (expired)' : ''}` : ''} · ${health.pending.requestId}`, 'small muted wrap'));
      $('agent-health').replaceChildren(grid, messages); $('agent-health-note').textContent = `Checked ${new Date(health.checkedAt).toLocaleTimeString()} · ${health.advisory}`;
    } catch (error) { if (source === generation && request === healthTicket && run?.id === id) { $('agent-health').replaceChildren(); $('agent-health-note').textContent = userError(error); } }
  }
  $('agent-health-refresh').addEventListener('click', loadHealth);
  async function history(offset = historyOffset) {
    if (!canChange()) return; const source = generation, request = ++historyTicket;
    const filters = new URLSearchParams({ search: $('agent-history-search').value, state: $('agent-history-state').value, archive: $('agent-history-archive').value, pinned: $('agent-history-pin').value, limit: '25', offset: String(offset) });
    try { const page = await api('/v1/operator/agent/runs?' + filters); if (source !== generation || request !== historyTicket) return; historyOffset = offset; historyNext = page.nextOffset; const target = $('agent-history'); target.replaceChildren();
      for (const item of page.items) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', item.organization?.title ?? item.id, 'wrap'), el('p', `${item.organization?.pinned ? 'Pinned · ' : ''}${date(item.updated)} · ${item.model} · ${(item.organization?.tags ?? []).join(', ')}`, 'small muted')); row.append(text, badge(item.organization?.archived ? 'archived' : item.state), button('Open task →', 'text-button', () => loadRun(item.id)), button('Organize', 'text-button', () => editOrganization(item))); target.append(row); }
      if (!page.items.length) target.append(el('p', 'No matching tasks. Try another search or archive view.', 'muted'));
      $('agent-history-count').textContent = `${page.items.length} shown · ${page.total} matching · page ${Math.floor(offset / 25) + 1}`; $('agent-history-previous').disabled = offset === 0; $('agent-history-next').disabled = page.nextOffset === null;
    } catch (error) { if (source === generation && request === historyTicket) $('agent-error').textContent = userError(error); }
  }
  async function loadConfig() {
    if (!status || currentPage !== 'agent') return;
    if (mode === 'preview') { $('agent-provider').textContent = 'Sample workspace: connect with operator access for real local inference. No fake AI answers are shown.'; controls(); return; }
    const source = generation, request = ++configTicket;
    try { const config = await api('/v1/operator/agent/config'); if (source !== generation || request !== configTicket) return; configuration = config;
      $('agent-workspace-info').textContent = config.workspace?.configured ? 'Workspace mode can search/read reviewed local files and create reports after exact-request approval. Reports are real local files; publishing and payments remain simulations. Progress refreshes every 2.5 seconds while a task runs.' : 'Workspace tools are not configured on this server. See the workspace tools guide to enable a dedicated folder.';
      $('agent-provider').textContent = config.configured ? `${config.model} via local Ollama · ${canChange() ? 'Ready to test the connection.' : 'Operator access is required to generate and view tasks.'}` : 'Ollama is not configured on this gateway. Follow the local setup instructions below.'; controls(); if (canChange()) { await Promise.all([history(), templates(), loadFiles()]); if (run) loadRun(run.id); }
    } catch (error) { if (source === generation) $('agent-error').textContent = userError(error); }
  }
  const taskDraft = () => ({ prompt: $('agent-prompt').value, toolMode: $('agent-tool-mode').value, taskLimits: { maxTurns: $('agent-budget-turns').valueAsNumber, maxToolCalls: $('agent-budget-calls').valueAsNumber, maxRunMs: $('agent-budget-minutes').valueAsNumber * 60000 } });
  $('agent-plan').addEventListener('click', async () => {
    if (!liveOperator() || $('agent-plan').disabled || !$('agent-task-form').reportValidity()) return;
    const source = generation, request = ++planTicket, draft = taskDraft(); planBusy = true; selectedPlan = null; controls(); $('agent-error').textContent = '';
    try {
      const result = await api('/v1/operator/agent/plan', draft); if (source !== generation || request !== planTicket) return;
      selectedPlan = { draft, result }; const node = $('task-plan-output'); node.replaceChildren();
      node.append(el('p', result.advisory, 'small muted'), field('Model and mode', `${result.model} · ${result.toolMode}`), field('Task budget', `${result.taskLimits.maxTurns} turns · ${result.taskLimits.maxToolCalls} tool evaluations · ${result.taskLimits.maxRunMs / 1000}s per attempt`), field('Session budget', `${result.sessionLimits.maxCalls} calls · ${result.sessionLimits.maxCost} cost units · ${result.sessionLimits.maxOutputBytes} output bytes`), field('Capacity snapshot', `${result.capacity.active}/${result.capacity.maxActive} active · ${result.capacity.retained}/${result.capacity.maxRuns} retained`));
      node.append(el('h3', 'Host-granted tools'));
      for (const tool of result.tools) node.append(el('p', `${tool.name} · ${tool.costUnits} cost unit${tool.costUnits === 1 ? '' : 's'}${tool.egress ? ' · outbound data' : ''}${tool.simulation ? ' · simulation' : ''}${tool.approvalRules.length ? ` · approval rules may apply: ${tool.approvalRules.join(', ')}` : ''}`, 'small wrap'));
      if (!result.tools.length) node.append(el('p', 'No tool permissions.'));
      node.append(el('h3', 'Prompt preview'), el('pre', result.redactedPrompt, 'wrap'), el('p', 'Detected secrets are hidden in this preview. The original prompt is sent to your configured local model when you start.', 'small muted'), field('Heuristic findings', result.findings.join(', ') || 'None detected'), field('Current blockers', result.blockers.join(', ') || 'None at review time'), field('Configuration receipt', result.planHash, true));
      $('task-plan-error').textContent = ''; showDialog('task-plan-dialog');
    } catch (error) { if (source === generation && request === planTicket) $('agent-error').textContent = userError(error); }
    finally { if (source === generation && request === planTicket) { planBusy = false; controls(); } }
  });
  $('task-plan-start').addEventListener('click', () => {
    if (!liveOperator() || $('task-plan-start').disabled || !selectedPlan) return;
    if (JSON.stringify(taskDraft()) !== JSON.stringify(selectedPlan.draft)) { $('task-plan-error').textContent = 'The task draft changed. Close this review and review the latest draft.'; return; }
    pendingStart = { id: crypto.randomUUID(), ...selectedPlan.draft, expectedPlanHash: selectedPlan.result.planHash }; $('task-plan-dialog').close(); $('agent-task-form').requestSubmit();
  });
  $('task-plan-dialog').addEventListener('close', () => { planTicket++; planBusy = false; selectedPlan = null; $('task-plan-output').replaceChildren(); $('task-plan-error').textContent = ''; controls(); });
  $('agent-task-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!liveOperator() || $('agent-submit').disabled) return;
    const source = generation, prompt = $('agent-prompt').value, toolMode = $('agent-tool-mode').value, taskLimits = { maxTurns: $('agent-budget-turns').valueAsNumber, maxToolCalls: $('agent-budget-calls').valueAsNumber, maxRunMs: $('agent-budget-minutes').valueAsNumber * 60000 };
    if (!pendingStart || pendingStart.prompt !== prompt || pendingStart.toolMode !== toolMode || JSON.stringify(pendingStart.taskLimits) !== JSON.stringify(taskLimits)) pendingStart = { id: crypto.randomUUID(), prompt, toolMode, taskLimits };
    const input = pendingStart; startBusy = true; controls(); $('agent-error').textContent = '';
    try { const next = await api('/v1/operator/agent/runs', input); if (source !== generation) return; pendingStart = null; pendingFollow = null; run = next; render(); await loadRun(input.id); await history(); }
    catch (error) { if (source === generation) { if (error.message === 'AGENT_PLAN_CHANGED') pendingStart = null; $('agent-error').textContent = error.message === 'AGENT_PLAN_CHANGED' ? 'Configuration changed since review. Review the task again before starting.' : userError(error); controls(); } }
    finally { if (source === generation) { startBusy = false; controls(); } }
  });
  $('agent-budget-preset').addEventListener('change', () => { const preset = $('agent-budget-preset').value; if (preset === 'custom') return; const values = preset === 'quick' ? [2, 2, 1] : [6, 12, 6]; ['turns', 'calls', 'minutes'].forEach((key, i) => { $('agent-budget-' + key).value = String(values[i]); }); pendingStart = null; });
  for (const key of ['turns', 'calls', 'minutes']) $('agent-budget-' + key).addEventListener('input', () => { $('agent-budget-preset').value = 'custom'; pendingStart = null; });
  $('agent-follow-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!liveOperator() || !run || $('agent-follow-submit').disabled) return;
    const source = generation, id = run.id, prompt = $('agent-follow-prompt').value;
    if (!pendingFollow || pendingFollow.id !== id || pendingFollow.prompt !== prompt) pendingFollow = { id, prompt, messageId: crypto.randomUUID(), expectedRevision: run.revision };
    const input = pendingFollow; followBusy = true; controls(); $('agent-error').textContent = '';
    try { const next = await api(`/v1/operator/agent/runs/${encodeURIComponent(id)}/messages`, { prompt: input.prompt, messageId: input.messageId, expectedRevision: input.expectedRevision }); if (source !== generation || run?.id !== id) return;
      pendingFollow = null; $('agent-follow-prompt').value = ''; run = next; render(); await loadRun(id); await history();
    } catch (error) { if (source === generation) { $('agent-error').textContent = error.message === 'VERSION_CONFLICT' ? 'The conversation changed. Reopen the latest task before sending your follow-up again.' : userError(error); if (error.message === 'VERSION_CONFLICT') { pendingFollow = null; await loadRun(id); } } }
    finally { if (source === generation) { followBusy = false; controls(); } }
  });
  $('agent-export').addEventListener('click', async () => {
    if (!canChange() || !run) return; const source = generation, id = run.id; $('agent-export').disabled = true;
    try { const result = await api(`/v1/operator/agent/runs/${encodeURIComponent(id)}/export`, { format: $('agent-export-format').value }); if (source !== generation) return;
      const url = URL.createObjectURL(new Blob([result.content], { type: result.format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' })), a = el('a'); a.href = url; a.download = `gateway-conversation-${id}.${result.format === 'json' ? 'json' : 'md'}`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('agent-export-note').textContent = `Export downloaded and audited. SHA-256: ${result.contentHash}. Review conversation text before sharing.`;
    } catch (error) { if (source === generation) $('agent-error').textContent = userError(error); }
    finally { if (source === generation) controls(); }
  });
  $('agent-check').addEventListener('click', async () => { if (!liveOperator()) return; const source = generation; $('agent-check').disabled = true;
    try { const check = await api('/v1/operator/agent/check', {}); if (source !== generation) return; $('agent-provider').textContent = `${check.model} · Local Ollama connection verified; function tools supported.`; $('agent-error').textContent = ''; }
    catch (error) { if (source === generation) $('agent-error').textContent = userError(error); } finally { if (source === generation) controls(); }
  });
  for (const action of ['resume', 'cancel']) $('agent-' + action).addEventListener('click', async () => { if (!canChange() || !run) return;
    const source = generation, id = run.id; $('agent-' + action).disabled = true;
    try { const next = await api(`/v1/operator/agent/runs/${encodeURIComponent(id)}/${action}`, {}); if (source !== generation) return; notify(action === 'resume' ? 'Task resumed. The gateway will recheck the exact pending call before execution.' : 'Task stop recorded. Operations already dispatched may still finish.'); run = next; render(); await loadRun(id); await history(); }
    catch (error) { if (source === generation) { $('agent-error').textContent = userError(error); controls(); } }
  });
  $('agent-history-refresh').addEventListener('click', () => history());
  async function loadFiles() {
    if (!canChange()) return; const source = generation, request = ++filesTicket; $('workspace-files-note').textContent = 'Checking local files…';
    comparisonTicket++; comparisonBusy = false; comparisonFiles = []; $('report-compare-left').replaceChildren(); $('report-compare-right').replaceChildren(); controls();
    try {
      const result = await api('/v1/operator/workspace'); if (source !== generation || request !== filesTicket) return;
      $('workspace-inputs').replaceChildren(); $('workspace-reports').replaceChildren();
      if (!result.configured) { $('workspace-files-note').textContent = 'No workspace file library is configured for this operator workspace.'; return; }
      for (const item of result.inputs) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', item.file, 'wrap'), el('p', item.status === 'verified' ? `${number(item.bytes)} bytes · SHA-256 ${item.sha256}` : 'This source changed or is unavailable. Review it on the host before restarting the gateway.', 'small muted wrap')); row.append(text, badge(item.status, item.status === 'verified' ? 'green' : 'amber')); $('workspace-inputs').append(row); }
      for (const item of result.reports) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', item.file, 'wrap'), el('p', `${number(item.bytes)} bytes · SHA-256 ${item.sha256}`, 'small muted wrap')); row.append(text, button('Preview report', 'text-button', () => readReport(item, 'preview')), button('Download report', 'text-button', () => readReport(item, 'download'))); $('workspace-reports').append(row); }
      if (!result.reports.length) $('workspace-reports').append(el('p', 'No readable reports found. Approved report saves appear here after you refresh.', 'muted'));
      comparisonFiles = result.reports;
      for (const id of ['report-compare-left', 'report-compare-right']) for (const item of comparisonFiles) { const option = el('option', item.file); option.value = item.file; $(id).append(option); }
      if (comparisonFiles.length > 1) $('report-compare-right').value = comparisonFiles[1].file;
      $('report-compare-note').textContent = comparisonFiles.length < 2 ? 'Save two reports under different filenames, then refresh to compare them.' : 'Choose a baseline and a newer report. Comparison reads are audited; neither file is changed.'; controls();
      $('workspace-files-note').textContent = `${result.inputs.length} pinned sources · ${result.reports.length} readable reports${result.skipped ? ` · ${result.skipped} unsupported or unreadable entries skipped` : ''}${result.truncated ? ' · scan limit reached; this list is partial' : ''}. Refresh after saving a report. The folder listing does not prove a file was approved by the gateway.`;
    } catch (error) { if (source === generation && request === filesTicket) { $('workspace-inputs').replaceChildren(); $('workspace-reports').replaceChildren(); comparisonFiles = []; controls(); $('workspace-files-note').textContent = userError(error); } }
  }
  const comparisonText = result => [`--- ${result.left.file}`, `+++ ${result.right.file}`, `Left SHA-256: ${result.left.sha256}`, `Right SHA-256: ${result.right.sha256}`, `Comparison SHA-256: ${result.comparisonHash}`, result.normalization, '', ...result.lines.map(line => `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.text}`)].join('\n');
  const canonicalComparison = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonicalComparison).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalComparison(value[key])).join(',') + '}';
  $('report-compare-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!canChange() || comparisonBusy) return;
    const left = comparisonFiles.find(item => item.file === $('report-compare-left').value), right = comparisonFiles.find(item => item.file === $('report-compare-right').value);
    if (!left || !right || left.file === right.file) { $('report-compare-note').textContent = 'Choose two different reports.'; return; }
    const source = generation, request = ++comparisonTicket; comparisonBusy = true; controls(); $('report-compare-note').textContent = 'Reading and verifying both reports…';
    try {
      const result = await api('/v1/operator/workspace/reports/compare', { left: { file: left.file, expectedHash: left.sha256 }, right: { file: right.file, expectedHash: right.sha256 } });
      if (source !== generation || request !== comparisonTicket) return;
      const { comparisonHash, ...receipt } = result, bytes = new TextEncoder().encode(canonicalComparison(receipt));
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (source !== generation || request !== comparisonTicket) return;
      if (hash !== comparisonHash || result.left.sha256 !== left.sha256 || result.right.sha256 !== right.sha256 || result.left.file !== left.file || result.right.file !== right.file) throw new Error('REPORT_COMPARISON_CHECKSUM_MISMATCH');
      comparison = result; $('report-compare-meta').textContent = `${result.left.file} → ${result.right.file} · ${result.counts.added} added · ${result.counts.removed} removed · ${result.counts.same} unchanged · ${result.identicalBytes ? 'identical bytes' : 'different bytes'} · Comparison audited`;
      $('report-compare-content').textContent = comparisonText(result); $('report-compare-note').textContent = 'Comparison verified and audited. Refresh files before comparing later changes.'; controls(); showDialog('report-compare-dialog');
    } catch (error) { if (source === generation && request === comparisonTicket) $('report-compare-note').textContent = error.message === 'REPORT_CHANGED' ? 'A report changed since the list was loaded. Refresh files before comparing again.' : error.message === 'REPORT_DIFF_LINE_LIMIT' ? 'A report exceeds the 400-line comparison limit. Download the reports to compare them separately.' : userError(error); }
    finally { if (source === generation && request === comparisonTicket) { comparisonBusy = false; controls(); } }
  });
  $('report-compare-download').addEventListener('click', () => { if (!canChange() || !comparison) return; const url = URL.createObjectURL(new Blob([comparisonText(comparison)], { type: 'text/plain;charset=utf-8' })), link = el('a'); link.href = url; link.download = `comparison-${comparison.left.file}-vs-${comparison.right.file}.txt`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Comparison downloaded as plain text. The comparison read is audited.'); });
  $('report-compare-dialog').addEventListener('close', () => { comparisonTicket++; comparisonBusy = false; comparison = null; $('report-compare-content').textContent = ''; $('report-compare-meta').textContent = ''; controls(); });
  async function readReport(item, purpose) {
    if (!canChange()) return; const source = generation, request = ++reportTicket;
    try {
      const result = await api('/v1/operator/workspace/reports/read', { file: item.file, expectedHash: item.sha256, purpose });
      if (source !== generation || request !== reportTicket) return;
      const bytes = new TextEncoder().encode(result.content), checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (source !== generation || request !== reportTicket) return;
      if (checksum !== item.sha256 || checksum !== result.sha256 || bytes.length !== result.bytes || result.file !== item.file) throw new Error('REPORT_CHECKSUM_MISMATCH');
      if (purpose === 'preview') { $('workspace-report-content').textContent = result.content; $('workspace-report-meta').textContent = `${result.file} · ${result.bytes} bytes · SHA-256 ${checksum} · Read audited`; $('workspace-report-dialog').showModal(); }
      else { const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' })), link = el('a'); link.href = url; link.download = result.file; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify(`Report downloaded with verified checksum. Read audited: ${result.file}`); }
    } catch (error) { if (source === generation && request === reportTicket) $('workspace-files-note').textContent = error.message === 'REPORT_CHANGED' ? 'The report changed since the list was loaded. Refresh files and review the latest version.' : userError(error); }
  }
  $('workspace-files-refresh').addEventListener('click', loadFiles);
  $('workspace-report-dialog').addEventListener('close', () => { reportTicket++; $('workspace-report-content').textContent = ''; $('workspace-report-meta').textContent = ''; });
  $('agent-history-filters').addEventListener('submit', event => { event.preventDefault(); history(0); });
  for (const id of ['agent-history-state', 'agent-history-archive', 'agent-history-pin']) $(id).addEventListener('change', () => history(0));
  $('agent-history-previous').addEventListener('click', () => history(Math.max(0, historyOffset - 25))); $('agent-history-next').addEventListener('click', () => { if (historyNext !== null) history(historyNext); });
  function editOrganization(item) {
    if (!canChange()) return; selectedOrganization = item; const meta = item.organization;
    $('task-organization-context').textContent = item.id; $('task-title').value = meta.title; $('task-tags').value = meta.tags.join(', '); $('task-pin').value = String(meta.pinned); $('task-archive').value = String(meta.archived);
    $('task-organization-error').textContent = ''; showDialog('task-organization-dialog');
  }
  $('task-organization-form').addEventListener('submit', async event => { event.preventDefault(); if (!canChange() || !selectedOrganization) return; const item = selectedOrganization, source = generation; $('task-organization-save').disabled = true;
    try { await api(`/v1/operator/agent/runs/${encodeURIComponent(item.id)}/organize`, { expectedRevision: item.organization.revision, title: $('task-title').value, tags: $('task-tags').value.split(',').map(t => t.trim()).filter(Boolean), pinned: $('task-pin').value === 'true', archived: $('task-archive').value === 'true' }); if (source !== generation) return;
      $('task-organization-dialog').close(); notify('Task organization saved. Execution permissions and budgets are unchanged.'); await history(); if (run?.id === item.id) await loadRun(item.id);
    } catch (error) { if (source === generation) $('task-organization-error').textContent = userError(error); } finally { if (source === generation) controls(); }
  });
  async function templates() {
    if (!canChange()) return; const source = generation, request = ++templateTicket;
    try { const page = await api('/v1/operator/agent/templates?' + new URLSearchParams({ enabled: $('agent-template-filter').value })); if (source !== generation || request !== templateTicket) return; const target = $('agent-templates'); target.replaceChildren();
      for (const item of page.items) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', item.title), el('p', `${item.toolMode} · revision ${item.revision} · ${item.enabled ? 'enabled' : 'disabled'}${item.parameterized ? ` · ${item.variables.length} fields` : ''}`, 'small muted'));
        const load = button(item.parameterized && item.variables.length ? 'Fill template fields' : 'Load prompt', 'text-button', () => loadTemplate(item)); load.disabled = !item.enabled;
        row.append(text, load, button('Edit template', 'text-button', () => editTemplate(item))); target.append(row); }
      if (!page.items.length) target.append(el('p', 'No matching templates. Save a reusable prompt to begin.', 'muted'));
    } catch (error) { if (source === generation && request === templateTicket) $('agent-error').textContent = userError(error); }
  }
  function editTemplate(item = null) {
    if (!canChange()) return; selectedTemplate = item; $('template-title').value = item?.title ?? ''; $('template-prompt').value = item?.prompt ?? $('agent-prompt').value; $('template-kind').value = item?.parameterized ? 'variables' : 'plain'; $('template-mode').value = item?.toolMode ?? $('agent-tool-mode').value; $('template-enabled').value = String(item?.enabled ?? true); $('task-template-error').textContent = ''; showDialog('task-template-dialog');
  }
  $('agent-template-new').addEventListener('click', () => editTemplate()); $('agent-template-filter').addEventListener('change', templates);
  $('task-template-form').addEventListener('submit', async event => { event.preventDefault(); if (!canChange()) return; const source = generation, item = selectedTemplate; $('task-template-save').disabled = true;
    try { await api('/v1/operator/agent/templates', { ...(item ? { id: item.id } : {}), expectedRevision: item?.revision ?? 0, title: $('template-title').value, prompt: $('template-prompt').value, parameterized: $('template-kind').value === 'variables', toolMode: $('template-mode').value, enabled: $('template-enabled').value === 'true' }); if (source !== generation) return; $('task-template-dialog').close(); notify('Template saved. No task was started.'); await templates(); }
    catch (error) { if (source === generation) $('task-template-error').textContent = templateError(error); } finally { if (source === generation) controls(); }
  });
  function templateError(error) { return ({ INVALID_TEMPLATE_PLACEHOLDER: 'Use fields like {{document}} with a lowercase letter followed by lowercase letters, numbers or underscores (up to 32 characters).', TEMPLATE_VARIABLE_LIMIT: 'Use at most eight different fields.', INVALID_TEMPLATE_VALUES: 'Fill every field; each value must be 1–2,000 characters.', RENDERED_PROMPT_TOO_LARGE: 'The completed prompt exceeds 8,000 characters. Shorten the template or field values.', VERSION_CONFLICT: 'This template changed. Close this form and reopen its latest version.', TEMPLATE_DISABLED: 'This template was disabled. Close this form and choose an enabled template.' })[error.message] ?? userError(error); }
  function loadTemplate(item) {
    if (!canChange() || !item.enabled) return;
    if (!item.parameterized || !item.variables.length) { fillTemplate(item, {}); return; }
    renderTicket++; selectedRender = item; renderBusy = false; templateInputs = []; $('template-values-error').textContent = ''; $('template-values-context').textContent = `${item.title} · revision ${item.revision} · ${item.toolMode}`; $('template-values-fields').replaceChildren();
    for (const [index, name] of item.variables.entries()) { const label = el('label', `{{${name}}}`), input = el('textarea'); input.id = `template-value-${index}`; label.htmlFor = input.id; input.required = true; input.maxLength = 2000; input.rows = 2; templateInputs.push({ name, input }); $('template-values-fields').append(label, input); }
    controls(); showDialog('template-values-dialog');
  }
  async function fillTemplate(item, values) {
    if (!canChange()) return; const source = generation, request = ++renderTicket; renderBusy = true; controls();
    try {
      const rendered = await api(`/v1/operator/agent/templates/${encodeURIComponent(item.id)}/render`, { expectedRevision: item.revision, values });
      if (source !== generation || request !== renderTicket) return;
      $('agent-prompt').value = rendered.prompt; $('agent-tool-mode').value = rendered.toolMode; pendingStart = null;
      if ($('template-values-dialog').open) $('template-values-dialog').close();
      notify(`Template loaded with ${rendered.toolMode} tools. No task started. Review the completed prompt and budget, then start explicitly.`); $('agent-prompt').focus();
    } catch (error) { if (source === generation && request === renderTicket) { ($('template-values-dialog').open ? $('template-values-error') : $('agent-error')).textContent = templateError(error); if (['VERSION_CONFLICT', 'TEMPLATE_DISABLED'].includes(error.message)) templates(); } }
    finally { if (source === generation && request === renderTicket) { renderBusy = false; controls(); } }
  }
  $('template-values-form').addEventListener('submit', event => { event.preventDefault(); if (!selectedRender || renderBusy) return; fillTemplate(selectedRender, Object.fromEntries(templateInputs.map(({ name, input }) => [name, input.value]))); });
  $('template-values-dialog').addEventListener('close', () => { renderTicket++; renderBusy = false; selectedRender = null; templateInputs = []; $('template-values-fields').replaceChildren(); $('template-values-context').textContent = ''; $('template-values-error').textContent = ''; controls(); });
  $('task-organization-dialog').addEventListener('close', () => { selectedOrganization = null; $('task-title').value = ''; $('task-tags').value = ''; });
  $('task-template-dialog').addEventListener('close', () => { selectedTemplate = null; $('template-title').value = ''; $('template-prompt').value = ''; });
  window.addEventListener('gateway:source-cleared', clear);
  window.addEventListener('gateway:workspace', () => { if (!configuration && currentPage === 'agent') loadConfig(); });
  window.addEventListener('hashchange', () => { clearTimeout(polling); if (currentPage === 'agent') loadConfig(); });
  clear(); loadConfig();
})();
