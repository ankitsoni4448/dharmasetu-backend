'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeProviderChart, compactContext, validateAuthoritativeBirthProfile,
  circularLongitudeDelta, compareReference,
} = require('../utils/kundliLifecycle');

const birth = { date_of_birth: '1990-02-28', birth_time: '23:59', birth_time_certainty: 'EXACT',
  latitude: 28.6, longitude: 77.2, timezone: 'Asia/Kolkata', utc_offset_minutes: 330,
  profile_version: 2, input_fingerprint: 'a'.repeat(64) };

test('authoritative birth validation rejects unknown time and bad coordinates', () => {
  assert.equal(validateAuthoritativeBirthProfile(birth).valid, true);
  const result = validateAuthoritativeBirthProfile({ ...birth, birth_time: null, birth_time_certainty: 'UNKNOWN', latitude: 91 });
  assert.deepEqual(result.errors, ['BIRTH_TIME_REQUIRED', 'INVALID_LATITUDE']);
});

test('normalization preserves supplied facts without inventing unsupported sections', () => {
  const normalized = normalizeProviderChart({ moon_sign: { name: 'Mesha' }, ascendant: { name: 'Karka' }, nakshatra: { name: 'Ashwini', pada: 2 } }, {}, birth);
  assert.deepEqual(normalized.core, { rashi: 'Mesha', lagna: 'Karka', nakshatra: 'Ashwini', nakshatraPada: 2 });
  assert.equal(normalized.charts.d9, null);
  assert.deepEqual(normalized.planets, []);
  assert.equal(compactContext(normalized).rashi, 'Mesha');
});

test('normalization accepts the documented Prokerala Kundli response nesting', () => {
  const normalized = normalizeProviderChart({}, {
    nakshatra_details: { nakshatra: { name: 'Uttara Bhadrapada', pada: 3 }, chandra_rasi: { name: 'Meena' } },
    mangal_dosha: { has_dosha: false, description: 'Not Manglik' },
    yoga_details: [{ name: 'Major Yogas', yoga_list: [] }],
    dasha_periods: [{ name: 'Saturn', start: '2020-01-01T00:00:00Z', end: '2040-01-01T00:00:00Z',
      antardasha: [{ name: 'Mercury', start: '2025-01-01T00:00:00Z', end: '2027-01-01T00:00:00Z' }] }],
  }, birth);
  assert.equal(normalized.core.rashi, 'Meena');
  assert.equal(normalized.core.nakshatra, 'Uttara Bhadrapada');
  assert.equal(normalized.core.nakshatraPada, 3);
  assert.equal(normalized.doshas.mangal.has_dosha, false);
  assert.equal(normalized.yogas.length, 1);
  assert.equal(compactContext(normalized).currentMahadasha, 'Saturn');
  assert.equal(compactContext(normalized).currentAntardasha, 'Mercury');
});

test('deep provider modules are normalized without fabricating unavailable values', () => {
  const svg = { format: 'svg', content: '<svg xmlns="http://www.w3.org/2000/svg" />' };
  const normalized = normalizeProviderChart({}, { mangal_dosha: { has_dosha: false } }, birth, {
    planetPosition: { planet_position: [{ planet: { name: 'Sun' }, rasi: { name: 'Kumbha' }, degree: 315.5 }] },
    d1: svg, d9: null, bhava: svg, kaalSarpDosha: { has_dosha: false },
    moduleStatus: { d1: 'READY', d9: 'UNAVAILABLE' }, generatedAt: '2026-08-23T00:00:00.000Z',
  });
  assert.equal(normalized.planets[0].name, 'Sun');
  assert.equal(normalized.planets[0].sign, 'Kumbha');
  assert.equal(normalized.charts.d1, svg);
  assert.equal(normalized.charts.d9, null);
  assert.equal(normalized.charts.bhava, svg);
  assert.equal(normalized.doshas.kaalSarp.has_dosha, false);
  assert.equal(normalized.moduleStatus.d9, 'UNAVAILABLE');
});

test('fingerprint reuse contract is represented in normalized output', () => {
  const normalized = normalizeProviderChart({}, {}, birth);
  assert.equal(normalized.birthProfileVersion, 2);
  assert.equal(normalized.inputFingerprint, 'a'.repeat(64));
  assert.equal(normalized.calculation.ayanamsha, 'lahiri');
  assert.equal(normalized.calculation.providerApiVersion, 'v2');
  assert.deepEqual(normalized.input, { dateOfBirth: '1990-02-28', birthTime: '23:59', latitude: 28.6,
    longitude: 77.2, timezone: 'Asia/Kolkata', utcOffsetMinutes: 330 });
});

test('longitude comparison handles the 360 degree boundary', () => {
  assert.equal(circularLongitudeDelta(359.95, 0.05), 0.10000000000002274);
  assert.equal(compareReference({}, { reference_status: 'REFERENCE_DATA_REQUIRED' }).status, 'NOT_COMPARABLE');
  const result = compareReference({ moon_sign: 'Mesha', planetary_longitudes: { sun: 10.05 } }, {
    reference_status: 'VERIFIED', expected: { moon_sign: 'Mesha', planetary_longitudes: { sun: 10 } },
  }, 0.1);
  assert.equal(result.status, 'PASS');
});

test('provider requests use the documented numeric Lahiri ayanamsa value', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'utils', 'prokeralaClient.js'), 'utf8');
  assert.match(client, /LAHIRI_AYANAMSA = 1/);
  assert.doesNotMatch(client, /ayanamsa:\s*['"]lahiri/);
});
