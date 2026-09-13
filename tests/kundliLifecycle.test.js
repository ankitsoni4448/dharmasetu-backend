'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeProviderChart, compactContext, validateAuthoritativeBirthProfile,
  compactStructuralContext, deriveWholeSignHouses, assignPlanetHouses, deriveStructuralConditions,
  WHOLE_SIGN_METHOD, validateKundliReadiness, circularLongitudeDelta, compareReference,
} = require('../utils/kundliLifecycle');

const birth = { date_of_birth: '1990-02-28', birth_time: '23:59', birth_time_certainty: 'EXACT',
  latitude: 28.6, longitude: 77.2, timezone: 'Asia/Kolkata', utc_offset_minutes: 330,
  profile_version: 2, input_fingerprint: 'a'.repeat(64) };

test('authoritative birth validation rejects unknown time and bad coordinates', () => {
  assert.equal(validateAuthoritativeBirthProfile(birth).valid, true);
  const result = validateAuthoritativeBirthProfile({ ...birth, birth_time: null, birth_time_certainty: 'UNKNOWN', latitude: 91 });
  assert.deepEqual(result.errors, ['BIRTH_TIME_REQUIRED', 'INVALID_LATITUDE']);
});

test('birth-time certainty modes preserve truthful precision semantics', () => {
  for (const certainty of ['EXACT', 'APPROXIMATE', 'UNCERTAIN']) {
    const profile = { ...birth, birth_time_certainty: certainty };
    assert.equal(validateAuthoritativeBirthProfile(profile).valid, true);
    const normalized = normalizeProviderChart({}, {}, profile);
    assert.equal(normalized.precision, certainty === 'EXACT' ? 'FULL' : 'REDUCED');
    assert.equal(normalized.precisionWarnings.length > 0, certainty !== 'EXACT');
  }
  const unknown = { ...birth, birth_time: null, birth_time_certainty: 'UNKNOWN' };
  assert.equal(validateAuthoritativeBirthProfile(unknown).errors.includes('BIRTH_TIME_REQUIRED'), true);
});

test('normalization preserves supplied facts without inventing unsupported sections', () => {
  const normalized = normalizeProviderChart({ moon_sign: { name: 'Mesha' }, ascendant: { name: 'Karka' }, nakshatra: { name: 'Ashwini', pada: 2 } }, {}, birth);
  assert.deepEqual(normalized.core, { rashi: 'Mesha', lagna: 'Karka', nakshatra: 'Ashwini', nakshatraPada: 2 });
  assert.equal(normalized.charts.d9.status, 'UNAVAILABLE');
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
  assert.equal(normalized.doshas[0].provider_data.has_dosha, false);
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
  assert.equal(normalized.charts.d1.data, svg);
  assert.equal(normalized.charts.d9.status, 'UNAVAILABLE');
  assert.equal(normalized.charts.bhava.data, svg);
  assert.equal(normalized.doshas[1].provider_data.has_dosha, false);
  assert.equal(normalized.moduleStatus.d9, 'UNAVAILABLE');
});

function readyNormalized({ deepEnabled = false } = {}) {
  const planetPosition = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'prokerala', 'planet-position-ascendant.redacted.json'), 'utf8'));
  const svg = { format: 'svg', content: '<svg xmlns="http://www.w3.org/2000/svg" />' };
  const moduleStatus = deepEnabled
    ? { birthDetails: 'READY', advancedKundli: 'READY', planetPosition: 'READY', d1: 'READY' }
    : { birthDetails: 'READY', basicKundli: 'READY', planetPosition: 'READY', d1: 'READY' };
  return normalizeProviderChart({}, {
    nakshatra_details: { nakshatra: { name: 'Ashwini', pada: 2 }, chandra_rasi: { name: 'Mesha' } },
  }, birth, { planetPosition, d1: svg, moduleStatus, generatedAt: '2026-08-23T00:00:00.000Z' });
}

test('documented live Planet Position ASCENDANT id 100 supplies Lagna evidence', () => {
  const normalized = readyNormalized();
  assert.equal(normalized.core.lagna, 'Mesha');
  assert.deepEqual(normalized.providerEvidence.lagna, { module: 'planetPosition', planetId: 100 });
  assert.equal(normalized.planets.some(item => item.name === 'Ascendant'), false);
});

test('canonical schema exposes only provider facts and explicit unavailable states', () => {
  const normalized = readyNormalized();
  assert.equal(normalized.schema_version, 'dharmasetu-kundli-v1');
  assert.equal(normalized.provider, 'prokerala');
  assert.deepEqual(normalized.lagna, { sign: 'Mesha', longitude: 12.5, source: 'PROVIDER', status: 'AVAILABLE' });
  assert.equal(normalized.moon_sign.sign, 'Mesha');
  assert.equal(normalized.nakshatra.name, 'Ashwini');
  assert.equal(normalized.nakshatra.pada, 2);
  assert.equal(normalized.sun_sign.sign, 'Makara');
  assert.equal(normalized.planets[0].source, 'PROVIDER');
  assert.equal(normalized.transits.status, 'UNAVAILABLE');
  assert.equal(normalized.aspects.status, 'UNAVAILABLE');
  assert.equal(normalized.strengths.status, 'UNAVAILABLE');
  assert.equal(normalized.life_areas.status, 'UNAVAILABLE');
  assert.deepEqual(normalized.yogas, []);
  assert.deepEqual(normalized.doshas, []);
  assert.equal(Object.hasOwn(normalized, 'remedies'), false);
});

test('missing canonical facts never receive astrological defaults', () => {
  const normalized = normalizeProviderChart({}, {}, birth);
  assert.equal(normalized.lagna.status, 'UNAVAILABLE');
  assert.equal(normalized.lagna.sign, null);
  assert.equal(normalized.moon_sign.status, 'UNAVAILABLE');
  assert.equal(normalized.nakshatra.status, 'UNAVAILABLE');
  assert.equal(normalized.nakshatra.name, null);
  assert.equal(normalized.sun_sign.status, 'UNAVAILABLE');
  assert.deepEqual(normalized.planets, []);
  assert.equal(compactContext(normalized).lagna, null);
  assert.equal(compactContext(normalized).currentMahadasha, null);
});

test('current Dasha is retained only when provider supplied it', () => {
  const absent = normalizeProviderChart({}, {}, birth);
  assert.equal(absent.dasha.status, 'UNAVAILABLE');
  const supplied = normalizeProviderChart({}, { dasha_periods: [{ name: 'Saturn', start: '2020-01-01', end: '2040-01-01' }] }, birth);
  assert.equal(supplied.dasha.status, 'AVAILABLE');
  assert.equal(compactContext(supplied).currentMahadasha, 'Saturn');
});

test('whole-sign houses require a valid provider Lagna and remain deterministic', () => {
  const unavailable = deriveWholeSignHouses(null, [], []);
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.deepEqual(unavailable.items, []);
  const planets = [{ name: 'Sun', sign: 'Mesha' }, { name: 'Moon', sign: 'Karka' }];
  const houses = deriveWholeSignHouses('Mesha', planets, []);
  assert.equal(houses.status, 'AVAILABLE');
  assert.equal(houses.source, 'DERIVED');
  assert.equal(houses.method, WHOLE_SIGN_METHOD);
  assert.equal(houses.items.length, 12);
  assert.deepEqual(houses.items[0], {
    number: 1, sign: 'Mesha', lord: 'Mars', occupants: ['Sun'], source: 'DERIVED',
    method: WHOLE_SIGN_METHOD, calculation_version: 'prokerala-v2-lahiri-k2-structural-v1',
    required_inputs: ['provider_lagna_sign', 'provider_planet_signs'], status: 'AVAILABLE',
  });
  assert.equal(houses.items[3].sign, 'Karka');
  assert.equal(houses.items[3].lord, 'Moon');
  assert.deepEqual(houses.items[3].occupants, ['Moon']);
});

test('planet house assignment follows the explicit whole-sign model only', () => {
  const houses = deriveWholeSignHouses('Karka', [{ name: 'Sun', sign: 'Simha' }], []);
  const [sun] = assignPlanetHouses([{ name: 'Sun', sign: 'Simha', source: 'PROVIDER', status: 'AVAILABLE' }], houses);
  assert.equal(sun.house, 2);
  assert.equal(sun.house_source, 'DERIVED');
  assert.equal(sun.house_method, WHOLE_SIGN_METHOD);
  const [unknown] = assignPlanetHouses([{ name: 'Sun', sign: null }], houses);
  assert.equal(unknown.house, null);
  assert.equal(unknown.house_status, 'UNAVAILABLE');
});

test('transits and aspects remain explicit unavailable boundaries without fabricated positions or Western rules', () => {
  const normalized = normalizeProviderChart({}, {}, birth);
  assert.deepEqual(normalized.transits.planets, []);
  assert.equal(normalized.transits.source, 'UNAVAILABLE');
  assert.equal(normalized.transits.cache_strategy, 'NO_CACHE_UNTIL_AUTHORITATIVE_SOURCE');
  assert.deepEqual(normalized.aspects.items, []);
  assert.equal(normalized.aspects.method, null);
  assert.doesNotMatch(JSON.stringify(normalized.aspects), /opposition|trine|sextile|square/i);
});

test('structural conditions use provider flags and sign coincidence without a numeric strength score', () => {
  const result = deriveStructuralConditions([
    { name: 'Mercury', sign: 'Makara', retrograde: true },
    { name: 'Venus', sign: 'Makara', retrograde: false },
  ]);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.items[0].conditions[0].type, 'RETROGRADE');
  assert.equal(result.items[0].conditions[1].type, 'SIGN_CONJUNCTION');
  assert.equal(result.items[0].conditions[1].source, 'DERIVED');
  assert.equal(JSON.stringify(result).includes('score'), false);
});

test('compact structural context contains validated facts without private birth data', () => {
  const compact = compactStructuralContext(readyNormalized());
  assert.equal(compact.natal.lagna.sign, 'Mesha');
  assert.equal(compact.houses.status, 'AVAILABLE');
  assert.equal(compact.transits.status, 'UNAVAILABLE');
  assert.equal(compact.aspects.status, 'UNAVAILABLE');
  assert.equal(JSON.stringify(compact).includes('dateOfBirth'), false);
  assert.equal(JSON.stringify(compact).includes('birthTime'), false);
  assert.equal(JSON.stringify(compact).includes('remed'), false);
  assert.doesNotMatch(compactStructuralContext.toString(), /fetch|requestModule|Prokerala|\bAI\b|\bLLM\b/i);
});

test('complete basic and deep primary charts satisfy strict readiness', () => {
  assert.deepEqual(validateKundliReadiness(readyNormalized(), birth), { valid: true, error: null, missingFields: [] });
  assert.equal(validateKundliReadiness(readyNormalized({ deepEnabled: true }), birth, { deepEnabled: true }).valid, true);
});

test('each missing critical core field is rejected independently', () => {
  const mutations = {
    lagna: value => { value.core.lagna = null; },
    rashi: value => { value.core.rashi = null; },
    nakshatra: value => { value.core.nakshatra = null; },
    nakshatra_pada: value => { value.core.nakshatraPada = null; },
    d1: value => { value.charts.d1 = null; },
    planets: value => { value.planets = []; },
  };
  for (const [field, mutate] of Object.entries(mutations)) {
    const normalized = readyNormalized(); mutate(normalized);
    const result = validateKundliReadiness(normalized, birth);
    assert.equal(result.valid, false, field);
    assert.equal(result.error, 'KUNDLI_CORE_INCOMPLETE');
    assert.ok(result.missingFields.includes(field), field);
  }
});

test('stale fingerprint, profile version and required deep module are rejected', () => {
  const normalized = readyNormalized({ deepEnabled: true });
  normalized.inputFingerprint = 'stale';
  normalized.birthProfileVersion = 1;
  normalized.moduleStatus.planetPosition = 'FAILED';
  const result = validateKundliReadiness(normalized, birth, { deepEnabled: true });
  assert.ok(result.missingFields.includes('input_fingerprint'));
  assert.ok(result.missingFields.includes('birth_profile_version'));
  assert.ok(result.missingFields.includes('module.planetPosition'));
});

test('server cannot persist an incomplete normalized result as KUNDLI_READY', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.post('/account/kundli/generate'"), server.indexOf("app.get('/admin/ai/health'"));
  assert.match(route, /validateKundliReadiness\(normalized, birth/);
  assert.match(route, /KUNDLI_CORE_INCOMPLETE/);
  assert.match(route, /missing_fields: readiness\.missingFields/);
  assert.doesNotMatch(route, /!context\.rashi && !context\.lagna && !context\.nakshatra/);
});

test('DharmaChat boundary accepts only validated canonical provider facts', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const context = server.slice(server.indexOf('async function getUserAstrologyContext'), server.indexOf('// ─── AUDIT LOGGER'));
  assert.match(context, /planet\?\.status === 'AVAILABLE'/);
  assert.match(context, /planet\?\.source === 'PROVIDER'/);
  assert.match(context, /compactStructuralContext\(normalized\)/);
  assert.doesNotMatch(context, /remed|insight|prediction|birth_time|date_of_birth|place_name/i);
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
