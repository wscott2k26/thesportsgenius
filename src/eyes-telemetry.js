// Optional, sampled, numeric-only EyesOnYourAI telemetry.
// Disabled by default; never sends URLs, headers, cookies, payloads or user identifiers.
import { performance } from 'node:perf_hooks';
import { createIntelligenceClient } from '../sdk/intelligence-client.mjs';

export function createEyesTelemetryMiddleware({
  enabled = process.env.EOYAI_METRICS_ENABLED === '1',
  origin = process.env.EOYAI_ORIGIN,
  sourceKey = process.env.EOYAI_SOURCE_KEY,
  sampleRate = Number(process.env.EOYAI_SAMPLE_RATE || 0.05),
  fetchImpl = fetch,
  random = Math.random,
  onError = () => {}
} = {}) {
  const pass = (req, res, next) => next();
  if (!enabled) return pass;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 1) return pass;
  let client;
  try {
    client = createIntelligenceClient({ origin, sourceKey, service: 'sports-genius', fetchImpl });
  } catch (error) {
    // A bad configuration must not prevent the app from starting.
    try { onError(error); } catch {}
    return pass;
  }
  return (req, res, next) => {
    if (!req.path?.startsWith('/api/') || req.path.startsWith('/api/webhooks/') ||
        req.method === 'OPTIONS' || random() >= sampleRate) return next();
    const started = performance.now();
    res.once('finish', () => {
      const duration = Math.max(0, performance.now() - started);
      const metrics = [
        { metric: 'request_count', value: 1 },
        { metric: 'latency_ms', value: duration }
      ];
      if (res.statusCode >= 500) metrics.push({ metric: 'error_count', value: 1 });
      // Never delay or change the customer response if telemetry is down.
      void client.recordBatch(metrics).catch(error => { try { onError(error); } catch {} });
    });
    next();
  };
}
