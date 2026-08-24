'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localDateInTimezone, localDateTimeWithOffset, cacheKey, normalizeAuthoritativePanchang, PanchangCache } = require('../utils/panchangService');

test('India local date is correct across UTC midnight boundary', () => {
  assert.equal(localDateInTimezone('2026-08-23T19:00:00.000Z', 'Asia/Kolkata'), '2026-08-24');
  assert.equal(localDateInTimezone('2026-08-23T18:00:00.000Z', 'Asia/Kolkata'), '2026-08-23');
  assert.equal(localDateTimeWithOffset('2026-08-24', '06:00:00', 'Asia/Kolkata'), '2026-08-24T06:00:00+05:30');
});
test('cache key separates date, rounded location, timezone and provider version', () => {
  const base = { date: '2026-08-24', latitude: 28.61391, longitude: 77.20902, timezone: 'Asia/Kolkata' };
  assert.notEqual(cacheKey(base), cacheKey({ ...base, latitude: 25.3176 }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, timezone: 'Asia/Dubai' }));
});
test('authoritative normalization rejects plausible incomplete fallback values', () => {
  const context = { date: '2026-08-24', latitude: 28.614, longitude: 77.209, timezone: 'Asia/Kolkata', generatedAt: '2026-08-24T00:00:00Z' };
  assert.throws(() => normalizeAuthoritativePanchang({ tithi: 'Unknown' }, context), /PANCHANG_PROVIDER_MALFORMED/);
  const raw = { weekday: 'Monday', tithi: 'Dvitiya', nakshatra: 'Ashwini', yoga: 'Siddha', karana: 'Bava', sunrise: '06:01', sunset: '18:42' };
  const result = normalizeAuthoritativePanchang(raw, context); assert.equal(result.provider, 'prokerala');
  const cache = new PanchangCache(); cache.set(cacheKey(context), result, 1); assert.equal(cache.get(cacheKey(context), 2).cached, true);
});
