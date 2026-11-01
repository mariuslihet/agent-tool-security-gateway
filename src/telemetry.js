// No raw arguments, results, tokens, session identifiers or tenant identifiers in metric labels.
export class Metrics {
  #counts = new Map();
  #durations = new Map();
  record = event => {
    const counts = this.#counts.get(event.tenant) ?? new Map(), durations = this.#durations.get(event.tenant) ?? [];
    const key = `${event.type}|${event.code ?? 'OK'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1); this.#counts.set(event.tenant, counts);
    if (event.durationMs !== undefined) { durations.push(event.durationMs); if (durations.length > 10000) durations.shift(); this.#durations.set(event.tenant, durations); }
  };
  snapshot(tenant) {
    const sorted = [...(this.#durations.get(tenant) ?? [])].sort((a, b) => a - b);
    return { counts: Object.fromEntries(this.#counts.get(tenant) ?? []), executionLatencyMs: { samples: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? 0, p95: sorted[Math.floor(sorted.length * .95)] ?? 0 } };
  }
}
// Supply an OpenTelemetry API tracer from the host application. No mandatory SDK dependency.
export function openTelemetrySink(tracer) {
  return event => {
    const span = tracer.startSpan('agent.gateway.event');
    try {
      for (const key of ['type', 'tool', 'code', 'status', 'transformed', 'durationMs']) if (event[key] !== undefined) span.setAttribute(`gateway.${key}`, event[key]);
      if (event.ruleIds) span.setAttribute('gateway.rule_ids', event.ruleIds);
    } finally { span.end(); }
  };
}
