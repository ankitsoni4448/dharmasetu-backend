'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransitService, unavailableTransit } = require('../utils/kundliTransitService');

test('disabled transit refresh is truthful and makes no provider call', async () => {
  let calls = 0;
  const service = createTransitService({ fetchPositions: async () => { calls += 1; return { planets: [] }; } });
  const result = await service.getCurrent({ cacheKey: 'lahiri:hour', timezone: 'Asia/Kolkata' });
  assert.deepEqual(result, unavailableTransit());
  assert.equal(calls, 0);
});

test('controlled refresh coalesces calls and reuses fresh provider data', async () => {
  let calls = 0;
  let clock = Date.parse('2026-09-13T00:00:00Z');
  const service = createTransitService({ refreshEnabled: true, ttlMs: 3600000, now: () => clock,
    fetchPositions: async () => { calls += 1; return { planets: [{ planet: 'Sun', sign: 'Simha', source: 'PROVIDER', status: 'AVAILABLE' }] }; } });
  const request = { cacheKey: 'lahiri:hour', timezone: 'Asia/Kolkata' };
  const [a, b, c] = await Promise.all([service.getCurrent(request), service.getCurrent(request), service.getCurrent(request)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  assert.equal(a.status, 'AVAILABLE'); assert.equal(a.source, 'PROVIDER');
  await service.getCurrent(request);
  assert.equal(calls, 1);
  clock += 3600001;
  await service.getCurrent(request);
  assert.equal(calls, 2);
});

test('invalid transit context and provider payload never create fake positions', async () => {
  const service = createTransitService({ refreshEnabled: true, fetchPositions: async () => ({ planets: [] }) });
  assert.equal((await service.getCurrent()).status, 'UNAVAILABLE');
  const result = await service.getCurrent({ cacheKey: 'x', timezone: 'Asia/Kolkata' });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.deepEqual(result.planets, []);
});
