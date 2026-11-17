import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createEyesTelemetryMiddleware } from '../src/eyes-telemetry.js';

const key = 'eyot_' + 'a'.repeat(43);
const flush = () => new Promise(resolve => setImmediate(resolve));
function response(statusCode = 200) { const res = new EventEmitter(); res.statusCode = statusCode; return res; }

test('Eyes telemetry is disabled without explicit opt-in', async () => {
  let sent = 0;
  const middleware = createEyesTelemetryMiddleware({ enabled: false, fetchImpl: async () => { sent++; } });
  const res = response();
  let next = 0;
  middleware({ path: '/api/scores', method: 'GET' }, res, () => { next++; });
  res.emit('finish');
  await flush();
  assert.equal(next, 1);
  assert.equal(sent, 0);
});

test('Eyes telemetry sends only sampled numeric metrics, no request/user content', async () => {
  const calls = [];
  const middleware = createEyesTelemetryMiddleware({
    enabled: true, origin: 'https://example.invalid', sourceKey: key, sampleRate: 1, random: () => 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ accepted: 3 }) };
    }
  });
  const req = { path: '/api/scores?token=private', method: 'GET', headers: { cookie: 'secret' }, body: { private: 'secret' } };
  const res = response(503);
  let next = 0;
  middleware(req, res, () => { next++; });
  res.emit('finish');
  await flush();
  assert.equal(next, 1);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.metrics.map(x => x.metric), ['request_count', 'latency_ms', 'error_count']);
  assert.equal(body.metrics[0].service, 'sports-genius');
  assert.equal(JSON.stringify(body).includes('secret'), false);
  assert.equal(JSON.stringify(body).includes('/api/scores'), false);
  assert.equal(JSON.stringify(body).includes(key), false);
});

test('Eyes telemetry ignores static and webhook paths and never interrupts app on failure', async () => {
  let calls = 0, errors = 0;
  const middleware = createEyesTelemetryMiddleware({
    enabled: true, origin: 'https://example.invalid', sourceKey: key, sampleRate: 1, random: () => 0,
    fetchImpl: async () => { calls++; throw Error('telemetry outage'); },
    onError: () => { errors++; }
  });
  for (const path of ['/logo.svg', '/api/webhooks/stripe']) {
    const res = response();
    middleware({ path, method: 'GET' }, res, () => {});
    res.emit('finish');
  }
  assert.equal(calls, 0);
  const res = response(200);
  let next = 0;
  middleware({ path: '/api/scores', method: 'GET' }, res, () => { next++; });
  res.emit('finish');
  await flush();
  assert.equal(next, 1);
  assert.equal(calls, 1);
  assert.equal(errors, 1);
});
