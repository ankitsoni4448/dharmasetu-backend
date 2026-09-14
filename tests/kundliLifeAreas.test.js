'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIFE_AREA_RULESET, LIFE_AREA_CALCULATION_VERSION, LIFE_AREA_RULES,
  buildLifeAreas, compactLifeAreaContext,
} = require('../utils/kundliLifeAreas');

function fixture({ dasha = false, houses = true } = {}) {
  const houseItems = Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    sign: `Sign ${index + 1}`,
    lord: ['Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter'][index],
    occupants: index === 0 ? ['Moon'] : [],
    source: 'DERIVED', method: 'WHOLE_SIGN_FROM_PROVIDER_SIDEREAL_SIGNS_V1',
    calculation_version: 'prokerala-v2-lahiri-k3-life-areas-v1', status: 'AVAILABLE',
  }));
  const names = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Ketu'];
  const planets = names.map((name, index) => ({ name, sign: `Sign ${index + 1}`, house: index + 1,
    house_status: 'AVAILABLE', source: 'PROVIDER', status: 'AVAILABLE' }));
  return {
    calculation_version: 'prokerala-v2-lahiri-k3-life-areas-v1',
    houses: houses ? { status: 'AVAILABLE', source: 'DERIVED', method: 'WHOLE_SIGN_FROM_PROVIDER_SIDEREAL_SIGNS_V1', items: houseItems }
      : { status: 'UNAVAILABLE', items: [] },
    planets,
    aspects: { status: 'AVAILABLE', items: [{ source_planet: 'Jupiter', target_house: 1, target_sign: 'Sign 1',
      method: 'PARASHARI_GRAHA_DRISHTI_V1', calculation_version: 'kundli-k2.5-parashari-drishti-v1' }] },
    structural_conditions: { status: 'AVAILABLE', items: planets.map(planet => ({ planet: planet.name,
      conditions: [], source: 'DERIVED', method: 'PROVIDER_FLAGS_AND_SIGN_COINCIDENCE_V1',
      calculation_version: 'prokerala-v2-lahiri-k3-life-areas-v1' })) },
    dasha: dasha ? { status: 'AVAILABLE', source: 'PROVIDER', mahadasha: { name: 'Saturn' }, antardasha: { name: 'Mercury' } }
      : { status: 'UNAVAILABLE', source: 'UNAVAILABLE', mahadasha: null, antardasha: null },
    transits: { status: 'UNAVAILABLE', planets: [] },
  };
}

test('central ruleset covers every required life area with the declared house mappings', () => {
  assert.equal(LIFE_AREA_RULESET, 'KUNDLI_LIFE_AREA_RULESET_V1');
  assert.equal(LIFE_AREA_CALCULATION_VERSION, 'kundli-k3-life-areas-v1');
  assert.deepEqual(Object.keys(LIFE_AREA_RULES), [
    'PERSONALITY', 'CAREER', 'FINANCE', 'EDUCATION', 'MARRIAGE', 'HEALTH',
    'PROPERTY', 'VEHICLE', 'BUSINESS', 'TRAVEL_FOREIGN', 'CHILDREN_CREATIVITY', 'SPIRITUALITY',
  ]);
  assert.deepEqual(LIFE_AREA_RULES.CAREER, { houses: [10], secondary_houses: [2, 6, 11], planets: [], label: 'Career' });
  assert.deepEqual(Object.fromEntries(Object.entries(LIFE_AREA_RULES).map(([id, rule]) => [id, rule.houses])), {
    PERSONALITY: [1], CAREER: [10], FINANCE: [2, 11], EDUCATION: [4, 5], MARRIAGE: [7],
    HEALTH: [1, 6, 8], PROPERTY: [4], VEHICLE: [4], BUSINESS: [7, 10],
    TRAVEL_FOREIGN: [3, 9, 12], CHILDREN_CREATIVITY: [5], SPIRITUALITY: [5, 9, 12],
  });
});

test('validated natal structure produces all areas with traceable context-dependent evidence', () => {
  const result = buildLifeAreas(fixture());
  assert.equal(result.status, 'READY');
  assert.equal(result.items.length, 12);
  for (const area of result.items) {
    assert.equal(area.status, 'READY', area.id);
    assert.equal(area.confidence, 'MODERATE', area.id);
    assert.ok(area.evidence.some(item => item.factor === 'HOUSE_STRUCTURE'), area.id);
    assert.ok(area.evidence.every(item => item.polarity === 'CONTEXT_DEPENDENT'), area.id);
    assert.ok(area.context_dependent_factors.length > 0, area.id);
    assert.deepEqual(area.supportive_factors, []);
    assert.deepEqual(area.challenging_factors, []);
    assert.equal(area.provenance.ruleset, LIFE_AREA_RULESET);
    assert.equal(area.transit_status, 'UNAVAILABLE');
  }
});

test('provider Dasha is optional evidence and never replaced with generated timing', () => {
  const absent = buildLifeAreas(fixture()).items[0];
  assert.equal(absent.dasha_status, 'UNAVAILABLE');
  assert.equal(absent.timing_status, 'UNAVAILABLE');
  assert.equal(absent.evidence.some(item => item.factor === 'CURRENT_PERIOD'), false);
  const suppliedChart = fixture({ dasha: true });
  suppliedChart.dasha.mahadasha = { name: 'Mars' };
  const supplied = buildLifeAreas(suppliedChart).items[0];
  const current = supplied.evidence.find(item => item.factor === 'CURRENT_PERIOD');
  assert.equal(supplied.dasha_status, 'AVAILABLE');
  assert.equal(supplied.timing_status, 'LIMITED');
  assert.deepEqual(current.mahadasha, { name: 'Mars' });
  assert.equal(current.source, 'PROVIDER');
  assert.equal(current.relevance, 'RELEVANT');
  assert.equal(supplied.confidence, 'HIGH');
  const unrelated = buildLifeAreas(fixture({ dasha: true })).items[0];
  assert.equal(unrelated.evidence.find(item => item.factor === 'CURRENT_PERIOD').relevance, 'NOT_ESTABLISHED');
  assert.equal(unrelated.confidence, 'MODERATE');
});

test('missing natal structure remains explicitly unavailable without conclusions', () => {
  const result = buildLifeAreas(fixture({ houses: false }));
  assert.equal(result.status, 'UNAVAILABLE');
  assert.ok(result.items.every(area => area.status === 'UNAVAILABLE'));
  assert.ok(result.items.every(area => area.evidence.every(item => item.factor === 'RELEVANT_PLANET_CONDITIONS')));
  assert.ok(result.items.every(area => area.unavailable_factors.some(item => item.factor === 'HOUSE_STRUCTURE')));
});

test('health and vehicle areas preserve safety boundaries', () => {
  const result = buildLifeAreas(fixture());
  const health = result.items.find(item => item.id === 'HEALTH');
  const vehicle = result.items.find(item => item.id === 'VEHICLE');
  assert.match(health.disclaimer, /not medical advice/i);
  assert.deepEqual(vehicle.relevant_houses, [4]);
  assert.ok(vehicle.evidence.some(item => item.planet === 'Venus'));
  assert.doesNotMatch(JSON.stringify(vehicle), /colour|color|registration|purchase_date|lucky/i);
});

test('life-area output contains no prediction scores, certainty claims, remedies, or private birth input', () => {
  const serialized = JSON.stringify(buildLifeAreas(fixture()));
  assert.doesNotMatch(serialized, /numeric_score|prediction_score|percentage|guaranteed|certain outcome|remed(?:y|ies)|gemstone|dateOfBirth|birthTime|latitude|longitude|address/i);
  assert.ok(buildLifeAreas(fixture()).items.every(area => area.transit_status === 'UNAVAILABLE'));
});

test('compact area context selects one safe structured area and rejects unknown IDs', () => {
  const areas = buildLifeAreas(fixture({ dasha: true }));
  const career = compactLifeAreaContext(areas, 'CAREER');
  assert.equal(career.life_area, 'CAREER');
  assert.deepEqual(career.relevant_houses, [10]);
  assert.equal(career.current_period_status, 'AVAILABLE');
  assert.equal(career.transit_status, 'UNAVAILABLE');
  assert.equal(Object.hasOwn(career, 'input'), false);
  assert.deepEqual(compactLifeAreaContext(areas, 'UNKNOWN'), { status: 'UNAVAILABLE', life_area: 'UNKNOWN' });
});
