// Real local-model tasks only. No canned model responses or automatic task submissions.
(() => {
  let configuration = null, run = null, ticket = 0, configTicket = 0, polling = null;
  const liveOperator = () => canChange() && configuration?.configured;
  function clear() {
    ticket++; configTicket++; clearTimeout(polling); polling = null; configuration = null; run = null;
    for (const id of ['agent-conversation', 'agent-steps', 'agent-run-info', 'agent-history']) $(id).replaceChildren();
    $('agent-prompt').value = ''; $('agent-error').textContent = ''; $('agent-provider').textContent = 'Connect with operator access to use the local model.'; $('agent-run-status').textContent = 'No task selected.'; $('agent-state').textContent = 'Not started';
    for (const id of ['agent-submit', 'agent-check', 'agent-resume', 'agent-cancel', 'agent-history-refresh']) $(id).disabled = true;
  }
  function controls() {
    const busyRun = run && ['queued', 'running'].includes(run.state);
    $('agent-submit').disabled = !liveOperator() || busyRun; $('agent-check').disabled = !liveOperator(); $('agent-history-refresh').disabled = !canChange();
    $('agent-resume').disabled = !liveOperator() || !run || !['waiting', 'interrupted'].includes(run.state);
    $('agent-cancel').disabled = !canChange() || !run || !['queued', 'running', 'waiting', 'interrupted'].includes(run.state);
  }
  function render() {
    controls(); if (!run) return;
    $('agent-state').textContent = run.state; $('agent-state').className = `badge ${run.state === 'completed' ? 'green' : ['failed', 'stopped'].includes(run.state) ? 'red' : 'amber'}`;
    $('agent-run-status').textContent = `${run.model} · ${run.turns} model turns · ${run.toolCalls} evaluated tool calls · ${run.code}`;
    $('agent-conversation').replaceChildren(...run.conversation.map(message => { const card = el('article', undefined, `agent-message ${message.role}`); card.append(el('strong', message.role === 'user' ? 'Your task' : 'Model-generated response'), el('p', message.text)); return card; }));
    if (!run.conversation.some(m => m.role === 'assistant') && ['queued', 'running'].includes(run.state)) $('agent-conversation').append(el('p', 'The local model is generating. First use may take longer while the model loads.', 'muted'));
    const info = el('div', undefined, 'detail-grid'); info.append(field('Gateway session', run.sessionId, true), field('Task ID', run.id, true)); $('agent-run-info').replaceChildren(info);
    const steps = el('div'); for (const step of run.steps) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', step.tool, 'mono'), el('p', `${step.code} · ${step.requestId}`, 'small muted wrap')); row.append(text, badge(step.status, step.status === 'completed' ? 'green' : step.status === 'denied' ? 'red' : 'amber')); steps.append(row); }
    $('agent-steps').replaceChildren(section('Gateway execution trace', steps));
    if (run.state === 'waiting') { const link = el('a', run.code === 'HUMAN_APPROVAL_REQUIRED' ? 'Open approval queue →' : 'Open safety controls →', 'text-link'); link.href = run.code === 'HUMAN_APPROVAL_REQUIRED' ? '#approvals' : '#safety'; $('agent-steps').append(link); }
    if (run.code === 'MODEL_DATA_WITHHELD') $('agent-steps').append(el('p', 'The task stopped before forwarding classified or detected sensitive tool data to the model.', 'muted'));
  }
  async function loadRun(id) {
    if (!canChange()) return; const source = generation, request = ++ticket;
    clearTimeout(polling);
    try { const next = await api('/v1/operator/agent/runs/' + encodeURIComponent(id)); if (source !== generation || request !== ticket) return; run = next; render();
      if (currentPage === 'agent' && ['queued', 'running'].includes(run.state)) polling = setTimeout(() => loadRun(id), 2500);
      else if (currentPage === 'agent') history();
    } catch (error) { if (source === generation && request === ticket) $('agent-error').textContent = userError(error); }
  }
  async function history() {
    if (!canChange()) return; const source = generation;
    try { const page = await api('/v1/operator/agent/runs'); if (source !== generation) return; const target = $('agent-history'); target.replaceChildren();
      for (const item of page.items) { const row = el('div', undefined, 'rule-summary'), text = el('div'); text.append(el('strong', item.id, 'mono wrap'), el('p', `${date(item.created)} · ${item.model}`, 'small muted')); row.append(text, badge(item.state), button('Open task →', 'text-button', () => loadRun(item.id))); target.append(row); }
      if (!page.items.length) target.append(el('p', 'No AI tasks have run in this workspace yet.', 'muted'));
    } catch (error) { if (source === generation) $('agent-error').textContent = userError(error); }
  }
  async function loadConfig() {
    if (!status || currentPage !== 'agent') return;
    if (mode === 'preview') { $('agent-provider').textContent = 'Sample workspace: connect with operator access for real local inference. No fake AI answers are shown.'; controls(); return; }
    const source = generation, request = ++configTicket;
    try { const config = await api('/v1/operator/agent/config'); if (source !== generation || request !== configTicket) return; configuration = config;
      $('agent-provider').textContent = config.configured ? `${config.model} via local Ollama · ${canChange() ? 'Ready to test the connection.' : 'Operator access is required to generate and view tasks.'}` : 'Ollama is not configured on this gateway. Follow the local setup instructions below.'; controls(); if (canChange()) { await history(); if (run) loadRun(run.id); }
    } catch (error) { if (source === generation) $('agent-error').textContent = userError(error); }
  }
  $('agent-task-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!liveOperator() || $('agent-submit').disabled) return;
    const source = generation, id = crypto.randomUUID(); $('agent-submit').disabled = true; $('agent-error').textContent = '';
    try { const next = await api('/v1/operator/agent/runs', { id, prompt: $('agent-prompt').value }); if (source !== generation) return; run = next; render(); await loadRun(id); await history(); }
    catch (error) { if (source === generation) { $('agent-error').textContent = userError(error); controls(); } }
  });
  $('agent-check').addEventListener('click', async () => { if (!liveOperator()) return; const source = generation; $('agent-check').disabled = true;
    try { const check = await api('/v1/operator/agent/check', {}); if (source !== generation) return; $('agent-provider').textContent = `${check.model} · Local Ollama connection verified; function tools supported.`; $('agent-error').textContent = ''; }
    catch (error) { if (source === generation) $('agent-error').textContent = userError(error); } finally { if (source === generation) controls(); }
  });
  for (const action of ['resume', 'cancel']) $('agent-' + action).addEventListener('click', async () => { if (!canChange() || !run) return;
    const source = generation, id = run.id; $('agent-' + action).disabled = true;
    try { const next = await api(`/v1/operator/agent/runs/${encodeURIComponent(id)}/${action}`, {}); if (source !== generation) return; run = next; render(); await loadRun(id); await history(); }
    catch (error) { if (source === generation) { $('agent-error').textContent = userError(error); controls(); } }
  });
  $('agent-history-refresh').addEventListener('click', history);
  window.addEventListener('gateway:source-cleared', clear);
  window.addEventListener('gateway:workspace', () => { if (!configuration && currentPage === 'agent') loadConfig(); });
  window.addEventListener('hashchange', () => { clearTimeout(polling); if (currentPage === 'agent') loadConfig(); });
  clear(); loadConfig();
})();
