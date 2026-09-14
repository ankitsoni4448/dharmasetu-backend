'use strict';

const LIFE_AREA_RULESET = 'KUNDLI_LIFE_AREA_RULESET_V1';
const LIFE_AREA_CALCULATION_VERSION = 'kundli-k3-life-areas-v1';
const INTERPRETATION_SCOPE = 'TRADITIONAL_JYOTISHA_INTERPRETATION';

const LIFE_AREA_RULES = Object.freeze({
  PERSONALITY: { houses: [1], planets: ['Moon'], label: 'Personality / Self' },
  CAREER: { houses: [10], secondary_houses: [2, 6, 11], planets: [], label: 'Career' },
  FINANCE: { houses: [2, 11], planets: [], label: 'Finance' },
  EDUCATION: { houses: [4, 5], planets: ['Mercury', 'Jupiter'], label: 'Education' },
  MARRIAGE: { houses: [7], planets: [], label: 'Marriage / Relationships' },
  HEALTH: { houses: [1, 6, 8], planets: [], label: 'Health Themes' },
  PROPERTY: { houses: [4], planets: [], label: 'Property / Home' },
  VEHICLE: { houses: [4], planets: ['Venus'], label: 'Vehicle' },
  BUSINESS: { houses: [7, 10], planets: [], label: 'Business' },
  TRAVEL_FOREIGN: { houses: [3, 9, 12], planets: [], label: 'Travel / Foreign Residence' },
  CHILDREN_CREATIVITY: { houses: [5], planets: [], label: 'Children / Creativity' },
  SPIRITUALITY: { houses: [5, 9, 12], planets: ['Jupiter', 'Moon', 'Ketu'], label: 'Spirituality' },
});

function list(value) { return Array.isArray(value) ? value : []; }
function planetByName(planets, name) {
  return list(planets).find(planet => String(planet?.name || '').toLowerCase() === String(name || '').toLowerCase()) || null;
}
function conditionByPlanet(structuralConditions, name) {
  return list(structuralConditions?.items).find(item => String(item?.planet || '').toLowerCase() === String(name || '').toLowerCase()) || null;
}
function periodName(value) {
  if (typeof value === 'string') return value.trim();
  return typeof value?.name === 'string' ? value.name.trim() : '';
}

function buildLifeArea(id, rule, normalized) {
  const housesReady = normalized.houses?.status === 'AVAILABLE';
  const houseItems = housesReady ? list(normalized.houses.items) : [];
  const relevant = rule.houses.map(number => houseItems.find(house => house.number === number)).filter(Boolean);
  const complete = housesReady && relevant.length === rule.houses.length;
  const evidence = [];
  const unavailable = [];

  for (const houseNumber of rule.houses) {
    const house = relevant.find(item => item.number === houseNumber);
    if (!house) { unavailable.push({ factor: 'HOUSE_STRUCTURE', house: houseNumber, status: 'UNAVAILABLE' }); continue; }
    evidence.push({ factor: 'HOUSE_STRUCTURE', house: house.number, sign: house.sign, lord: house.lord,
      occupants: [...list(house.occupants)], source: house.source, method: house.method,
      calculation_version: house.calculation_version, polarity: 'CONTEXT_DEPENDENT' });
    const lord = planetByName(normalized.planets, house.lord);
    if (lord?.house_status === 'AVAILABLE') {
      evidence.push({ factor: 'HOUSE_LORD_PLACEMENT', house: house.number, lord: house.lord, lord_house: lord.house,
        lord_sign: lord.sign, source: 'DERIVED', method: normalized.houses.method,
        calculation_version: normalized.calculation_version, polarity: 'CONTEXT_DEPENDENT' });
      const lordConditions = conditionByPlanet(normalized.structural_conditions, house.lord);
      if (lordConditions) evidence.push({ factor: 'HOUSE_LORD_CONDITIONS', house: house.number, lord: house.lord,
        conditions: lordConditions.conditions, source: lordConditions.source, method: lordConditions.method,
        calculation_version: lordConditions.calculation_version, polarity: 'CONTEXT_DEPENDENT' });
    } else unavailable.push({ factor: 'HOUSE_LORD_PLACEMENT', house: house.number, lord: house.lord, status: 'UNAVAILABLE' });

    for (const aspect of list(normalized.aspects?.items).filter(item => item.target_house === house.number)) {
      evidence.push({ factor: 'HOUSE_RECEIVES_DRISHTI', source_planet: aspect.source_planet, target_house: house.number,
        target_sign: aspect.target_sign, rule: aspect.method, source: 'DERIVED',
        calculation_version: aspect.calculation_version, polarity: 'CONTEXT_DEPENDENT' });
    }
  }

  for (const planetName of rule.planets) {
    const planet = planetByName(normalized.planets, planetName);
    const conditions = conditionByPlanet(normalized.structural_conditions, planetName);
    if (planet && conditions) evidence.push({ factor: 'RELEVANT_PLANET_CONDITIONS', planet: planetName,
      house: planet.house, sign: planet.sign, conditions: conditions.conditions, source: conditions.source,
      method: conditions.method, calculation_version: conditions.calculation_version, polarity: 'CONTEXT_DEPENDENT' });
    else unavailable.push({ factor: 'RELEVANT_PLANET_CONDITIONS', planet: planetName, status: 'UNAVAILABLE' });
  }

  const dashaReady = normalized.dasha?.status === 'AVAILABLE';
  let relevantDasha = false;
  if (dashaReady) {
    const relevantNames = [...new Set([...relevant.map(house => house.lord), ...rule.planets])];
    const activeNames = [periodName(normalized.dasha.mahadasha), periodName(normalized.dasha.antardasha)].filter(Boolean);
    const matchedNames = activeNames.filter(active => relevantNames.some(name => name.toLowerCase() === active.toLowerCase()));
    relevantDasha = matchedNames.length > 0;
    evidence.push({ factor: 'CURRENT_PERIOD', mahadasha: normalized.dasha.mahadasha,
      antardasha: normalized.dasha.antardasha, relevant_planets: relevantNames,
      matched_relevant_planets: matchedNames, relevance: relevantDasha ? 'RELEVANT' : 'NOT_ESTABLISHED',
      source: 'PROVIDER', calculation_version: normalized.calculation_version, polarity: 'CONTEXT_DEPENDENT' });
  } else unavailable.push({ factor: 'CURRENT_PERIOD', status: 'UNAVAILABLE' });
  unavailable.push({ factor: 'CURRENT_TRANSITS', status: 'UNAVAILABLE' });

  return {
    id, label: rule.label, status: complete ? 'READY' : housesReady ? 'LIMITED' : 'UNAVAILABLE',
    natal_status: complete ? 'READY' : housesReady ? 'LIMITED' : 'UNAVAILABLE',
    relevant_houses: [...rule.houses], secondary_houses: [...(rule.secondary_houses || [])], evidence,
    supportive_factors: [], challenging_factors: [], unavailable_factors: unavailable,
    context_dependent_factors: evidence.map(item => ({ factor: item.factor, polarity: 'CONTEXT_DEPENDENT' })),
    confidence: complete ? (relevantDasha ? 'HIGH' : 'MODERATE') : housesReady ? 'LIMITED' : 'UNAVAILABLE',
    dasha_status: dashaReady ? 'AVAILABLE' : 'UNAVAILABLE', transit_status: 'UNAVAILABLE',
    timing_status: dashaReady ? 'LIMITED' : 'UNAVAILABLE', interpretation_scope: INTERPRETATION_SCOPE,
    provenance: { ruleset: LIFE_AREA_RULESET, calculation_version: LIFE_AREA_CALCULATION_VERSION,
      source: 'DERIVED', required_inputs: ['validated_whole_sign_houses', 'validated_planet_houses',
        'validated_parashari_drishti', 'validated_structural_conditions', 'provider_dasha_when_available'] },
    ...(id === 'HEALTH' ? { disclaimer: 'Traditional structural themes only; not medical advice or diagnosis.' } : {}),
  };
}

function buildLifeAreas(normalized = {}) {
  const items = Object.entries(LIFE_AREA_RULES).map(([id, rule]) => buildLifeArea(id, rule, normalized));
  return { status: items.some(item => item.status === 'READY') ? 'READY' : 'UNAVAILABLE',
    ruleset: LIFE_AREA_RULESET, calculation_version: LIFE_AREA_CALCULATION_VERSION,
    interpretation_scope: INTERPRETATION_SCOPE, source: 'DERIVED', transit_status: 'UNAVAILABLE', items };
}

function compactLifeAreaContext(lifeAreas, areaId) {
  const item = list(lifeAreas?.items).find(area => area.id === areaId);
  if (!item) return { status: 'UNAVAILABLE', life_area: areaId || null };
  return { life_area: item.id, status: item.status, relevant_houses: item.relevant_houses,
    evidence: item.evidence, confidence: item.confidence, limitations: item.unavailable_factors,
    current_period_status: item.dasha_status, transit_status: item.transit_status,
    interpretation_scope: item.interpretation_scope, provenance: item.provenance };
}

module.exports = { LIFE_AREA_RULESET, LIFE_AREA_CALCULATION_VERSION, INTERPRETATION_SCOPE,
  LIFE_AREA_RULES, buildLifeArea, buildLifeAreas, compactLifeAreaContext };
