// Server-side only; never bundle this file or the source key into a web client.
// One source key may report numeric-only metrics, sanitized inventory and OTLP JSON.
import { randomUUID } from 'node:crypto';

export function createIntelligenceClient({ origin, sourceKey, service, fetchImpl = fetch, timeoutMs = 5000, onTelemetryError = () => {} }) {
  if (typeof window !== 'undefined') throw new Error('Intelligence client must run on a trusted server');
  if (!/^https:\/\/[^/]+$/.test(origin || '') && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || '')) throw new Error('HTTPS origin required');
  if (!/^eyot_[A-Za-z0-9_-]{40,55}$/.test(sourceKey || '')) throw new Error('Invalid telemetry source key');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(service || '')) throw new Error('Invalid service label');
  async function send(path, body) {
    const response = await fetchImpl(origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EOYAI-Source-Key': sourceKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error('Intelligence ingestion rejected (HTTP ' + response.status + ')');
    return response.json();
  }
  const record = (metric, value, eventId = randomUUID()) => send('/api/intelligence/metrics', {
    metrics: [{ event_id: eventId, service, metric, value }]
  });
  const recordBatch = entries => send('/api/intelligence/metrics', {
    metrics: entries.map(e => ({ event_id: e.event_id || randomUUID(), service, metric: e.metric, value: e.value }))
  });
  async function measure(fn) {
    if (typeof fn !== 'function') throw new TypeError('measure requires a function');
    const start = performance.now();
    let failed = false;
    try { return await fn(); }
    catch (error) { failed = true; throw error; }
    finally {
      const duration = Math.max(0, performance.now() - start);
      try {
        await recordBatch([{ metric: 'request_count', value: 1 }, { metric: 'latency_ms', value: duration }, ...(failed ? [{ metric: 'error_count', value: 1 }] : [])]);
      } catch (error) { onTelemetryError(error); } // Reporting cannot break the actual business operation.
    }
  }
  return Object.freeze({
    record,
    recordBatch,
    measure,
    reportInventory: resources => send('/api/telemetry/inventory', { resources }),
    sendOtlp: resourceSpans => send('/api/telemetry/otlp/v1/traces', { resourceSpans })
  });
}
