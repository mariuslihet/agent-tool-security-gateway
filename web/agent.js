// Real local-model tasks only. No canned model responses or automatic task submissions.
(() => {
  let configuration = null, run = null, ticket = 0, configTicket = 0, polling = null, pendingFollow = null, pendingStart = null, followBusy = false;
  let historyTicket = 0, historyOffset = 0, historyNext = null, templateTicket = 0, healthTicket = 0, selectedOrganization = null, selectedTemplate = null;
  const liveOperator = () => canChange() && configuration?.configured;
  function clear() {
    ticket++; configTicket++; clearTimeout(polling); polling = null; configuration = null; run = null; pendingFollow = pendingStart = null; followBusy = false;
    historyTicket++; templateTicket++; healthTicket++; historyOffset = 0; historyNext = null; selectedOrganization = selectedTemplate = null;
    $('agent-health').replaceChildren(); $('agent-health-note').textContent = 'Select a task to inspect its current limits and restrictions.'; $('agent-health-refresh').disabled = true;
    $('agent-activity').textContent = ''; $('agent-workspace-info').textContent = 'Workspace tools require a host-configured folder of reviewed text documents.';
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
    $('agent-submit').disabled = !liveOperator() || busyRun; $('agent-check').disabled = !liveOperator(); $('agent-history-refresh').disabled = !canChange();
    $('agent-resume').disabled = !liveOperator() || !run || run.organization?.archived || !['waiting', 'interrupted'].includes(run.state);
    $('agent-cancel').disabled = !canChange() || !run || !['queued', 'running', 'waiting', 'interrupted'].includes(run.state);
    $('agent-follow-submit').disabled = !liveOperator() || followBusy || !run || run.organization?.archived || run.state !== 'completed' || run.turns >= run.limits.maxTurns;
    $('agent-export').disabled = !canChange() || !run;
    $('agent-health-refresh').disabled = !canChange() || !run;
    for (const id of ['agent-template-new', 'task-organization-save', 'task-template-save']) $(id).disabled = !canChange();
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
    $('agent-follow-note').textContent = run.turns >= run.limits.maxTurns ? 'This task has reached its model-turn budget. Start a new task to continue.' : run.state === 'completed' ? `Continues task ${short(run.id)} · ${run.limits.maxTurns - run.turns} model turns remain · permissions stay ${run.toolMode ?? 'all'}.` : 'Follow-ups are available after the current task completes. Resolve any pending call first.';
    if (run.organization?.archived) $('agent-follow-note').textContent = 'This task is archived. Restore it through Organize before adding another message.';
    const selectedTask = run, organize = button('Organize selected task', 'button secondary', () => editOrganization(selectedTask)); organize.disabled = !canChange(); $('agent-run-info').append(organize);
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
      if (currentPage === 'agent' && ['queued', 'running'].includes(run.state)) polling = setTimeout(() => loadRun(id), 2500);
      else if (currentPage === 'agent') history();
    } catch (error) { if (source === generation && request === ticket) $('agent-error').textContent = userError(error); }
  }
  async function loadHealth() {
    if (!canChange() || !run) return; const id = run.id, source = generation, request = ++healthTicket;
    $('agent-health-note').textContent = 'Checking the current task snapshot…';
    try {
      const health = await api('/v1/operator/agent/runs/' + encodeURIComponent(id) + '/health');
      if (source !== generation || request !== healthTicket || run?.id !== id) return;
      const labels = { modelTurns: 'Model turns', toolEvaluations: 'Tool evaluations', sessionCalls: 'Session calls', costUnits: 'Tool cost units', outputBytes: 'Output bytes' };
      const grid = el('div', undefined, 'detail-grid'); for (const [key, value] of Object.entries(health.budgets)) grid.append(field(labels[key] ?? key, `${number(value.remaining)} remaining · ${number(value.used)} / ${number(value.limit)} used`));
      grid.append(field('Session status', health.session.status), field('Session expires', date(health.session.expires)), field('Session labels', health.session.labels.join(', ') || 'None'));
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
      $('agent-provider').textContent = config.configured ? `${config.model} via local Ollama · ${canChange() ? 'Ready to test the connection.' : 'Operator access is required to generate and view tasks.'}` : 'Ollama is not configured on this gateway. Follow the local setup instructions below.'; controls(); if (canChange()) { await Promise.all([history(), templates()]); if (run) loadRun(run.id); }
    } catch (error) { if (source === generation) $('agent-error').textContent = userError(error); }
  }
  $('agent-task-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!liveOperator() || $('agent-submit').disabled) return;
    const source = generation, prompt = $('agent-prompt').value, toolMode = $('agent-tool-mode').value;
    if (!pendingStart || pendingStart.prompt !== prompt || pendingStart.toolMode !== toolMode) pendingStart = { id: crypto.randomUUID(), prompt, toolMode };
    const input = pendingStart; $('agent-submit').disabled = true; $('agent-error').textContent = '';
    try { const next = await api('/v1/operator/agent/runs', input); if (source !== generation) return; pendingStart = null; pendingFollow = null; run = next; render(); await loadRun(input.id); await history(); }
    catch (error) { if (source === generation) { $('agent-error').textContent = userError(error); controls(); } }
  });
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
      for (const item of page.items) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', item.title), el('p', `${item.toolMode} · revision ${item.revision} · ${item.enabled ? 'enabled' : 'disabled'}`, 'small muted'));
        const load = button('Load prompt', 'text-button', () => { if (!canChange() || !item.enabled) return; $('agent-prompt').value = item.prompt; $('agent-tool-mode').value = item.toolMode; pendingStart = null; notify(`Template loaded with ${item.toolMode} tools. Review the prompt and access mode, then start a new task.`); $('agent-prompt').focus(); }); load.disabled = !item.enabled;
        row.append(text, load, button('Edit template', 'text-button', () => editTemplate(item))); target.append(row); }
      if (!page.items.length) target.append(el('p', 'No matching templates. Save a reusable prompt to begin.', 'muted'));
    } catch (error) { if (source === generation && request === templateTicket) $('agent-error').textContent = userError(error); }
  }
  function editTemplate(item = null) {
    if (!canChange()) return; selectedTemplate = item; $('template-title').value = item?.title ?? ''; $('template-prompt').value = item?.prompt ?? $('agent-prompt').value; $('template-mode').value = item?.toolMode ?? $('agent-tool-mode').value; $('template-enabled').value = String(item?.enabled ?? true); $('task-template-error').textContent = ''; showDialog('task-template-dialog');
  }
  $('agent-template-new').addEventListener('click', () => editTemplate()); $('agent-template-filter').addEventListener('change', templates);
  $('task-template-form').addEventListener('submit', async event => { event.preventDefault(); if (!canChange()) return; const source = generation, item = selectedTemplate; $('task-template-save').disabled = true;
    try { await api('/v1/operator/agent/templates', { ...(item ? { id: item.id } : {}), expectedRevision: item?.revision ?? 0, title: $('template-title').value, prompt: $('template-prompt').value, toolMode: $('template-mode').value, enabled: $('template-enabled').value === 'true' }); if (source !== generation) return; $('task-template-dialog').close(); notify('Template saved. No task was started.'); await templates(); }
    catch (error) { if (source === generation) $('task-template-error').textContent = userError(error); } finally { if (source === generation) controls(); }
  });
  $('task-organization-dialog').addEventListener('close', () => { selectedOrganization = null; $('task-title').value = ''; $('task-tags').value = ''; });
  $('task-template-dialog').addEventListener('close', () => { selectedTemplate = null; $('template-title').value = ''; $('template-prompt').value = ''; });
  window.addEventListener('gateway:source-cleared', clear);
  window.addEventListener('gateway:workspace', () => { if (!configuration && currentPage === 'agent') loadConfig(); });
  window.addEventListener('hashchange', () => { clearTimeout(polling); if (currentPage === 'agent') loadConfig(); });
  clear(); loadConfig();
})();
