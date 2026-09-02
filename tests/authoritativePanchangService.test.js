'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProviderPanchang, validDate, validateLocation, getDailyPanchang, getMonthlyPanchang, getYearOverview,
  calculationIdentity, MAX_MONTH_DAYS, _dailyCache, _monthCache, _inFlight } = require('../utils/authoritativePanchangService');
const { resetTokenCacheForTests } = require('../utils/prokeralaClient');

const raw = {
  vaara: 'Thursday', sunrise: '2026-08-27T06:00:30+05:30', sunset: '2026-08-27T18:44:37+05:30',
  moonrise: '2026-08-27T18:23:16+05:30', moonset: '2026-08-28T05:51:56+05:30',
  tithi: [{ name: 'Purnima', paksha: 'Shukla Paksha', start: '2026-08-26T20:00:00+05:30', end: '2026-08-27T20:00:00+05:30' }],
  nakshatra: [{ name: 'Shravana', start: '2026-08-26T20:00:00+05:30', end: '2026-08-27T20:00:00+05:30' }],
  yoga: [{ name: 'Shubha', start: '2026-08-26T20:00:00+05:30', end: '2026-08-27T20:00:00+05:30' }],
  karana: [{ name: 'Bava', start: '2026-08-26T20:00:00+05:30', end: '2026-08-27T20:00:00+05:30' }],
  auspicious_period: [{ name: 'Abhijit Muhurat', period: [{ start: '2026-08-27T11:55:00+05:30', end: '2026-08-27T12:45:00+05:30' }] }],
  inauspicious_period: [{ name: 'Rahu', period: [{ start: '2026-08-27T13:30:00+05:30', end: '2026-08-27T15:00:00+05:30' }] }],
};
const context = { date: '2026-08-27', datetime: '2026-08-27T06:00:00+05:30', detail: 'advanced', location: { latitude: 28.614, longitude: 77.209, timezone: 'Asia/Kolkata', label: 'Delhi' } };

test('normalizes transition arrays into authoritative nested and compatibility contracts', () => {
  const result = normalizeProviderPanchang(raw, context);
  assert.equal(result.panchang.tithi.name, 'Purnima'); assert.equal(result.tithi, 'Purnima');
  assert.equal(result.traditionalDate.paksha, 'Shukla Paksha'); assert.equal(result.avoidPeriods.rahuKalam.name, 'Rahu');
  assert.equal(result.events[0].providerDerived, true); assert.equal(result.metadata.ayanamsa.name, 'Lahiri/Chitrapaksha');
});

test('never fabricates missing provider fields', () => {
  const result = normalizeProviderPanchang(raw, context);
  assert.equal(result.traditionalDate.masa, null); assert.equal(result.traditionalDate.samvat, null);
  assert.equal(result.muhurta.brahma, null);
  assert.throws(() => normalizeProviderPanchang({ ...raw, tithi: [] }, context), /PANCHANG_CORE_INCOMPLETE/);
});

test('validates dates, locations, timezone, and bounded month size', () => {
  assert.equal(validDate('2026-08-27'), true); assert.equal(validDate('2026-02-30'), false); assert.equal(MAX_MONTH_DAYS, 31);
  assert.throws(() => validateLocation({ latitude: 91, longitude: 0, timezone: 'UTC' }), /PANCHANG_LOCATION_INVALID/);
  assert.throws(() => validateLocation({ latitude: 0, longitude: 0, timezone: 'Invalid\/Zone' }), /PANCHANG_INVALID_TIMEZONE/);
});

test('year overview is lazy and never launches daily provider calls', () => {
  const result = getYearOverview({ year: 2027, latitude: 28.614, longitude: 77.209, timezone: 'Asia/Kolkata', locationLabel: 'Delhi' });
  assert.equal(result.months.length, 12); assert.ok(result.months.every(month => month.status === 'LOAD_MONTH_ON_DEMAND'));
  assert.match(result.metadata.strategy, /no 365-call fan-out/);
});

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function providerHarness(providerData = raw, providerStatus = 200) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).endsWith('/token')) return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
    return providerStatus === 200 ? jsonResponse({ status: 'ok', data: providerData }) : jsonResponse({}, providerStatus);
  };
  return { calls, fetchImpl, providerCalls: () => calls.filter(url => url.includes('/v2/astrology/')) };
}

function resetPanchangCaches() { _dailyCache.clear(); _monthCache.clear(); _inFlight.clear(); resetTokenCacheForTests(); }
const location = { latitude: 25.9147883, longitude: 78.5662626, timezone: 'Asia/Kolkata', locationLabel: 'Test' };

test('Daily defaults to one Basic request on cache miss and zero provider calls on cache hit', async () => {
  resetPanchangCaches(); const harness = providerHarness();
  const first = await getDailyPanchang({ ...location, date: '2026-08-29' }, { fetchImpl: harness.fetchImpl, env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } });
  assert.equal(first.metadata.detail, 'basic');
  assert.equal(harness.providerCalls().length, 1);
  assert.match(harness.providerCalls()[0], /\/astrology\/panchang\?/);
  assert.doesNotMatch(harness.providerCalls()[0], /\/advanced/);
  const second = await getDailyPanchang({ ...location, date: '2026-08-29' }, { fetchImpl: harness.fetchImpl, env: {} });
  assert.equal(second.metadata.cached, true); assert.equal(harness.providerCalls().length, 1);
});

test('shared DB hit skips provider and a true miss is saved then reused', async () => {
  resetPanchangCaches(); const harness = providerHarness(); const rows = new Map(); let saves = 0;
  const store = { getDay: async identity => rows.get(identity.canonicalKey) || null,
    saveDay: async (identity, value) => { saves += 1; rows.set(identity.canonicalKey, value); }, getMonth: async () => [] };
  const options = { store, fetchImpl: harness.fetchImpl, env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } };
  const first = await getDailyPanchang({ ...location, date: '2026-09-01' }, options);
  assert.equal(harness.providerCalls().length, 1); assert.equal(saves, 1);
  _dailyCache.clear();
  const second = await getDailyPanchang({ ...location, date: '2026-09-01' }, { ...options, fetchImpl: async () => { throw new Error('provider must not run'); } });
  assert.equal(second.date, first.date); assert.equal(second.metadata.cacheLayer, 'shared'); assert.equal(harness.providerCalls().length, 1);
});

test('concurrent same-key misses coalesce to one Basic provider request', async () => {
  resetPanchangCaches(); const harness = providerHarness();
  const store = { getDay: async () => null, saveDay: async () => {}, getMonth: async () => [] };
  const input = { ...location, date: '2026-09-02' }; const options = { store, fetchImpl: harness.fetchImpl,
    env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } };
  const results = await Promise.all(Array.from({ length: 8 }, () => getDailyPanchang(input, options)));
  assert.equal(harness.providerCalls().length, 1); assert.ok(results.every(result => result.date === input.date)); assert.equal(_inFlight.size, 0);
});

test('different canonical keys calculate independently and GPS jitter shares one key', async () => {
  resetPanchangCaches(); const harness = providerHarness(); const options = { store: null, fetchImpl: harness.fetchImpl,
    env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } };
  await Promise.all([
    getDailyPanchang({ ...location, latitude: 25.91461, date: '2026-09-03' }, options),
    getDailyPanchang({ ...location, latitude: 25.91462, date: '2026-09-03' }, options),
    getDailyPanchang({ ...location, date: '2026-09-04' }, options),
  ]);
  assert.equal(harness.providerCalls().length, 2);
  const first = calculationIdentity('2026-09-03', validateLocation({ ...location, latitude: 25.91461 }));
  const second = calculationIdentity('2026-09-03', validateLocation({ ...location, latitude: 25.91462 }));
  assert.equal(first.canonicalKey, second.canonicalKey); assert.doesNotMatch(first.canonicalKey, /hindi|english/);
});

test('shared cache write failure still returns a valid provider response', async () => {
  resetPanchangCaches(); const harness = providerHarness(); const warnings = [];
  const value = await getDailyPanchang({ ...location, date: '2026-09-05' }, { store: { getDay: async () => null,
    saveDay: async () => { throw new Error('database unavailable'); } }, logger: { warn: message => warnings.push(message) },
    fetchImpl: harness.fetchImpl, env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } });
  assert.equal(value.available, true); assert.equal(harness.providerCalls().length, 1); assert.equal(warnings.length, 1);
});

test('historical dates and nearby GPS preserve exact requested context through mocked Basic routing', async () => {
  const cases = [
    ['2026-08-29', 25.9147883, 78.5662626], ['2026-08-19', 25.9147883, 78.5662626],
    ['2026-08-07', 25.9147883, 78.5662626], ['2025-02-15', 25.9147883, 78.5662626],
    ['2026-08-29', 25.916862, 78.564843],
  ];
  resetPanchangCaches(); const harness = providerHarness();
  for (const [date, latitude, longitude] of cases) {
    const result = await getDailyPanchang({ ...location, date, latitude, longitude }, { fetchImpl: harness.fetchImpl,
      env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } });
    assert.equal(result.modernDate.isoDate, date); assert.equal(result.metadata.detail, 'basic');
  }
  assert.equal(harness.providerCalls().length, 5);
  assert.notEqual(cases[0][1].toFixed(3), cases[4][1].toFixed(3));
});

test('missing optional Basic fields never destroy valid core Panchang', () => {
  const result = normalizeProviderPanchang({ ...raw, moonrise: undefined, moonset: undefined,
    auspicious_period: undefined, inauspicious_period: undefined, events: undefined, festivals: undefined }, { ...context, detail: 'basic' });
  assert.equal(result.available, true); assert.equal(result.sunMoon.moonrise, null); assert.equal(result.muhurta.abhijit, null);
  assert.equal(result.traditionalDate.masa, null); assert.ok(result.events.every(event => event.providerDerived));
});

test('Month returns cached summaries only and makes zero provider calls', async () => {
  resetPanchangCaches(); const harness = providerHarness(); const options = { fetchImpl: harness.fetchImpl,
    env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } };
  await getDailyPanchang({ ...location, date: '2026-08-19' }, options);
  const before = harness.providerCalls().length;
  const month = await getMonthlyPanchang({ ...location, year: 2026, month: 8 }, { fetchImpl: async () => { throw new Error('provider must not run'); } });
  assert.equal(harness.providerCalls().length, before); assert.equal(month.days.length, 1);
  assert.equal(month.days[0].date, '2026-08-19'); assert.equal(month.partial, true);
  assert.match(month.metadata.strategy, /zero provider fan-out/);
});

test('Month reuses one shared-store range query and never expands missing days', async () => {
  resetPanchangCaches(); const normalized = normalizeProviderPanchang(raw, { ...context, date: '2026-08-27', detail: 'basic' });
  let monthReads = 0; const month = await getMonthlyPanchang({ ...location, year: 2026, month: 8 }, { store: {
    getMonth: async (_identity, start, end) => { monthReads += 1; assert.equal(start, '2026-08-01'); assert.equal(end, '2026-08-31'); return [normalized]; }
  }, fetchImpl: async () => { throw new Error('provider must not run'); } });
  assert.equal(monthReads, 1); assert.equal(month.days.length, 1); assert.equal(month.days[0].date, '2026-08-27'); assert.equal(month.partial, true);
});

test('provider failures are sanitized and never cached as successful Panchang', async () => {
  for (const [status, code] of [[429, 'PROVIDER_RATE_LIMITED'], [401, 'PROVIDER_AUTH_ERROR'], [403, 'PROVIDER_PLAN_OR_QUOTA'], [503, 'PROVIDER_TEMPORARILY_UNAVAILABLE']]) {
    resetPanchangCaches(); const harness = providerHarness(raw, status);
    await assert.rejects(getDailyPanchang({ ...location, date: '2026-08-07' }, { fetchImpl: harness.fetchImpl,
      env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } }), error => error.code === code);
    assert.equal(_dailyCache.size, 0); assert.equal(harness.providerCalls().length, 1);
  }
});

test('timeout, malformed provider payload, and incomplete core retain diagnostic categories', async () => {
  resetPanchangCaches();
  const timeoutFetch = async url => {
    if (String(url).endsWith('/token')) return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
    const error = new Error('aborted'); error.name = 'AbortError'; throw error;
  };
  await assert.rejects(getDailyPanchang({ ...location, date: '2026-08-19' }, { fetchImpl: timeoutFetch,
    env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } }), error => error.code === 'PROVIDER_TIMEOUT');
  assert.equal(_dailyCache.size, 0);

  resetPanchangCaches();
  const malformedFetch = async url => String(url).endsWith('/token')
    ? jsonResponse({ access_token: 'test-token', expires_in: 3600 }) : jsonResponse({ status: 'ok', data: null });
  await assert.rejects(getDailyPanchang({ ...location, date: '2026-08-19' }, { fetchImpl: malformedFetch,
    env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } }), error => error.code === 'PROVIDER_BAD_RESPONSE');

  resetPanchangCaches(); const incomplete = providerHarness({ ...raw, sunrise: null });
  await assert.rejects(getDailyPanchang({ ...location, date: '2026-08-19' }, { fetchImpl: incomplete.fetchImpl,
    env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } }), error => error.code === 'PANCHANG_CORE_INCOMPLETE');
  assert.equal(_dailyCache.size, 0);
});

test('daily Panchang remains Basic even if an advanced detail option is supplied', async () => {
  resetPanchangCaches(); const harness = providerHarness();
  const value = await getDailyPanchang({ ...location, date: '2026-08-29' }, { detail: 'advanced', fetchImpl: harness.fetchImpl,
    env: { PROKERALA_CLIENT_ID: 'id', PROKERALA_CLIENT_SECRET: 'secret' } });
  assert.equal(value.metadata.detail, 'basic'); assert.equal(harness.providerCalls().length, 1);
  assert.match(harness.providerCalls()[0], /\/astrology\/panchang\?/); assert.doesNotMatch(harness.providerCalls()[0], /advanced/);
});
