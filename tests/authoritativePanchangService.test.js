'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProviderPanchang, validDate, validateLocation, getYearOverview, MAX_MONTH_DAYS } = require('../utils/authoritativePanchangService');

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
  assert.throws(() => normalizeProviderPanchang({ ...raw, tithi: [] }, context), /PROVIDER_MALFORMED_RESPONSE/);
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
