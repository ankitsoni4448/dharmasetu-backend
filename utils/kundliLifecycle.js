'use strict';

const { buildLifeAreas } = require('./kundliLifeAreas');

const CALCULATION_STANDARD = Object.freeze({
  schemaVersion: 'dharmasetu-kundli-v1',
  calculationVersion: 'prokerala-v2-lahiri-k3-life-areas-v1',
  provider: 'prokerala',
  providerApiVersion: 'v2',
  zodiac: 'sidereal',
  ayanamsha: 'lahiri',
  chartConvention: 'provider-supplied Vedic chart; presentation is non-authoritative',
  timezone: 'IANA birth timezone with historical UTC offset resolved before calculation',
  coordinatePrecision: 6,
  dashaSystem: 'vimshottari when supplied by provider',
});

const PLANETS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu'];
const WHOLE_SIGN_METHOD = 'WHOLE_SIGN_FROM_PROVIDER_SIDEREAL_SIGNS_V1';
const STRUCTURAL_CONDITION_METHOD = 'PROVIDER_FLAGS_AND_SIGN_COINCIDENCE_V1';
const DRISHTI_METHOD = 'PARASHARI_GRAHA_DRISHTI_V1';
const DRISHTI_CALCULATION_VERSION = 'kundli-k2.5-parashari-drishti-v1';
const SIGN_ORDER = ['mesha', 'vrishabha', 'mithuna', 'karka', 'simha', 'kanya', 'tula', 'vrischika', 'dhanu', 'makara', 'kumbha', 'meena'];
const SIGN_ALIASES = Object.freeze({
  aries: 'mesha', mesh: 'mesha', taurus: 'vrishabha', vrishabh: 'vrishabha',
  gemini: 'mithuna', mithun: 'mithuna', cancer: 'karka', kark: 'karka', leo: 'simha',
  kanya: 'kanya', virgo: 'kanya', libra: 'tula', scorpio: 'vrischika', vrishchika: 'vrischika',
  vrischika: 'vrischika', sagittarius: 'dhanu', capricorn: 'makara', makar: 'makara',
  aquarius: 'kumbha', kumbh: 'kumbha', pisces: 'meena', meen: 'meena',
});
const SIGN_NAMES = Object.freeze({ mesha: 'Mesha', vrishabha: 'Vrishabha', mithuna: 'Mithuna', karka: 'Karka',
  simha: 'Simha', kanya: 'Kanya', tula: 'Tula', vrischika: 'Vrischika', dhanu: 'Dhanu', makara: 'Makara',
  kumbha: 'Kumbha', meena: 'Meena' });
const SIGN_LORDS = Object.freeze({ mesha: 'Mars', vrishabha: 'Venus', mithuna: 'Mercury', karka: 'Moon',
  simha: 'Sun', kanya: 'Mercury', tula: 'Venus', vrischika: 'Mars', dhanu: 'Jupiter', makara: 'Saturn',
  kumbha: 'Saturn', meena: 'Jupiter' });
const DRISHTI_RULES = Object.freeze({
  sun: [7], moon: [7], mercury: [7], venus: [7], mars: [4, 7, 8], jupiter: [5, 7, 9], saturn: [3, 7, 10],
});
const DIGNITY_RULES = Object.freeze({
  sun: { own: ['simha'], exalted: 'mesha', debilitated: 'tula' },
  moon: { own: ['karka'], exalted: 'vrishabha', debilitated: 'vrischika' },
  mars: { own: ['mesha', 'vrischika'], exalted: 'makara', debilitated: 'karka' },
  mercury: { own: ['mithuna', 'kanya'], exalted: 'kanya', debilitated: 'meena' },
  jupiter: { own: ['dhanu', 'meena'], exalted: 'karka', debilitated: 'makara' },
  venus: { own: ['vrishabha', 'tula'], exalted: 'meena', debilitated: 'kanya' },
  saturn: { own: ['makara', 'kumbha'], exalted: 'tula', debilitated: 'mesha' },
});

function text(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value.name === 'string') return value.name.trim() || null;
  return null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function first(...values) {
  return values.find(value => value !== null && value !== undefined && value !== '') ?? null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePlanet(item = {}) {
  const name = text(first(item.name, item.planet, item.id));
  if (!name) return null;
  return {
    id: finite(item.id),
    name,
    sign: text(first(item.rasi, item.rashi, item.sign, item.zodiac)),
    longitude: finite(first(item.longitude, item.degree, item.degrees, item.full_degree)),
    degree: finite(first(item.degree, item.degrees_in_sign)),
    house: finite(first(item.house, item.house_number, item.bhava)),
    nakshatra: text(item.nakshatra),
    pada: finite(first(item.nakshatra?.pada, item.pada)),
    retrograde: typeof item.retrograde === 'boolean' ? item.retrograde
      : typeof item.is_retrograde === 'boolean' ? item.is_retrograde : null,
    dignity: text(first(item.dignity, item.status)),
    source: 'PROVIDER',
    status: 'AVAILABLE',
  };
}

function availableFact(value, extra = {}) {
  return value === null || value === undefined || value === ''
    ? { ...extra, source: 'UNAVAILABLE', status: 'UNAVAILABLE', reason: 'PROVIDER_NOT_SUPPLIED' }
    : { ...extra, source: 'PROVIDER', status: 'AVAILABLE' };
}

function normalizeProviderHouses(value) {
  return list(value).map((house, index) => ({
    number: finite(first(house?.number, house?.house, house?.house_number, index + 1)),
    sign: text(first(house?.sign, house?.rasi, house?.rashi, house?.name)),
    lord: text(first(house?.lord, house?.sign_lord, house?.rasi?.lord, house?.rashi?.lord)),
    occupants: list(house?.occupants).map(text).filter(Boolean),
    source: 'PROVIDER', method: 'PROVIDER_SUPPLIED', calculation_version: CALCULATION_STANDARD.calculationVersion,
    required_inputs: ['provider_house_data'], status: 'AVAILABLE',
  })).filter(house => house.number !== null || house.sign !== null);
}

function canonicalSign(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (SIGN_ORDER.includes(key)) return key;
  return SIGN_ALIASES[key] || null;
}

function deriveWholeSignHouses(lagnaSign, planets, providerHouses) {
  if (providerHouses.length) {
    return { status: 'AVAILABLE', source: 'PROVIDER', method: 'PROVIDER_SUPPLIED',
      calculation_version: CALCULATION_STANDARD.calculationVersion, required_inputs: ['provider_house_data'], items: providerHouses };
  }
  const lagnaKey = canonicalSign(lagnaSign);
  if (!lagnaKey) return { status: 'UNAVAILABLE', source: 'UNAVAILABLE', method: WHOLE_SIGN_METHOD,
    calculation_version: CALCULATION_STANDARD.calculationVersion, required_inputs: ['provider_lagna_sign', 'provider_planet_signs'],
    reason: 'VALID_PROVIDER_LAGNA_REQUIRED', items: [] };
  const start = SIGN_ORDER.indexOf(lagnaKey);
  const items = SIGN_ORDER.map((_, offset) => {
    const signKey = SIGN_ORDER[(start + offset) % 12];
    return { number: offset + 1, sign: SIGN_NAMES[signKey], lord: SIGN_LORDS[signKey],
      occupants: planets.filter(planet => canonicalSign(planet.sign) === signKey).map(planet => planet.name),
      source: 'DERIVED', method: WHOLE_SIGN_METHOD, calculation_version: CALCULATION_STANDARD.calculationVersion,
      required_inputs: ['provider_lagna_sign', 'provider_planet_signs'], status: 'AVAILABLE' };
  });
  return { status: 'AVAILABLE', source: 'DERIVED', method: WHOLE_SIGN_METHOD,
    calculation_version: CALCULATION_STANDARD.calculationVersion, required_inputs: ['provider_lagna_sign', 'provider_planet_signs'], items };
}

function assignPlanetHouses(planets, houses) {
  if (houses.status !== 'AVAILABLE') return planets.map(planet => ({ ...planet, house: null, house_status: 'UNAVAILABLE' }));
  return planets.map(planet => {
    const house = houses.items.find(item => canonicalSign(item.sign) === canonicalSign(planet.sign));
    return { ...planet, house: house?.number || null, house_status: house ? 'AVAILABLE' : 'UNAVAILABLE',
      house_source: house ? houses.source : 'UNAVAILABLE', house_method: house ? houses.method : null };
  });
}

function deriveParashariAspects(planets, houses) {
  if (houses?.status !== 'AVAILABLE' || !Array.isArray(houses.items) || houses.items.length !== 12) {
    return { status: 'UNAVAILABLE', source: 'UNAVAILABLE', method: DRISHTI_METHOD,
      calculation_version: DRISHTI_CALCULATION_VERSION, required_inputs: ['validated_planet_house', 'validated_whole_sign_houses'],
      items: [], node_special_drishti: 'UNAVAILABLE', reason: 'VALIDATED_HOUSES_REQUIRED' };
  }
  const items = [];
  for (const planet of planets) {
    const key = String(planet.name || '').toLowerCase();
    const rules = DRISHTI_RULES[key];
    if (!rules || planet.house_status !== 'AVAILABLE' || !Number.isInteger(planet.house)) continue;
    const sourceHouse = houses.items.find(house => house.number === planet.house);
    if (!sourceHouse || canonicalSign(sourceHouse.sign) !== canonicalSign(planet.sign)) continue;
    for (const distance of rules) {
      const targetHouseNumber = ((planet.house + distance - 2) % 12) + 1;
      const target = houses.items.find(house => house.number === targetHouseNumber);
      if (!target) continue;
      items.push({ source_planet: planet.name, source_house: planet.house, target_house: targetHouseNumber,
        target_sign: target.sign, target_planets: [...target.occupants], drishti_distance: distance,
        drishti_type: distance === 7 ? 'GENERAL_7TH' : `SPECIAL_${distance}TH`,
        rule: `${planet.name}_${distance}TH_HOUSE_DRISHTI`, source: 'DERIVED', method: DRISHTI_METHOD,
        calculation_version: DRISHTI_CALCULATION_VERSION, status: 'AVAILABLE' });
    }
  }
  return { status: items.length ? 'AVAILABLE' : 'UNAVAILABLE', source: items.length ? 'DERIVED' : 'UNAVAILABLE',
    method: DRISHTI_METHOD, calculation_version: DRISHTI_CALCULATION_VERSION,
    required_inputs: ['validated_planet_house', 'validated_whole_sign_houses'], items,
    node_special_drishti: 'UNAVAILABLE', reason: items.length ? null : 'VALIDATED_CLASSICAL_GRAHA_PLACEMENT_REQUIRED' };
}

function dignityClassification(planetName, sign) {
  const rule = DIGNITY_RULES[String(planetName || '').toLowerCase()];
  const signKey = canonicalSign(sign);
  if (!rule || !signKey) return 'UNAVAILABLE';
  if (rule.exalted === signKey) return 'EXALTED';
  if (rule.debilitated === signKey) return 'DEBILITATED';
  if (rule.own.includes(signKey)) return 'OWN_SIGN';
  return 'NONE';
}

function deriveStructuralConditions(planets) {
  if (!planets.length) return { status: 'UNAVAILABLE', source: 'UNAVAILABLE', method: STRUCTURAL_CONDITION_METHOD,
    calculation_version: CALCULATION_STANDARD.calculationVersion, required_inputs: ['provider_planet_signs', 'provider_retrograde_flags'],
    combustion: { status: 'UNAVAILABLE', reason: 'APPROVED_COMBUSTION_RULE_REQUIRED' },
    shadbala: { status: 'UNAVAILABLE', reason: 'NOT_IMPLEMENTED' }, items: [] };
  const items = planets.map(planet => {
    const companions = planets.filter(other => other.name !== planet.name && canonicalSign(other.sign) === canonicalSign(planet.sign)).map(other => other.name);
    const conditions = [];
    if (planet.retrograde === true) conditions.push({ type: 'RETROGRADE', source: 'PROVIDER' });
    if (companions.length) conditions.push({ type: 'SIGN_CONJUNCTION', with: companions, source: 'DERIVED', rule: 'same_sidereal_sign' });
    const dignity = dignityClassification(planet.name, planet.sign);
    if (dignity !== 'UNAVAILABLE') conditions.push({ type: 'DIGNITY', classification: dignity, source: 'DERIVED',
      rule: 'DIGNITY_RULES_V1', calculation_version: 'kundli-k2.5-dignity-v1' });
    return { planet: planet.name, conditions, source: conditions.some(item => item.source === 'DERIVED') ? 'DERIVED' : 'PROVIDER',
      method: STRUCTURAL_CONDITION_METHOD, calculation_version: CALCULATION_STANDARD.calculationVersion,
      required_inputs: ['provider_planet_signs', 'provider_retrograde_flags'], status: 'AVAILABLE' };
  });
  return { status: 'AVAILABLE', source: 'DERIVED', method: STRUCTURAL_CONDITION_METHOD,
    calculation_version: CALCULATION_STANDARD.calculationVersion, required_inputs: ['provider_planet_signs', 'provider_retrograde_flags'],
    combustion: { status: 'UNAVAILABLE', reason: 'APPROVED_COMBUSTION_RULE_REQUIRED' },
    shadbala: { status: 'UNAVAILABLE', reason: 'NOT_IMPLEMENTED' }, items };
}

function providerItems(value) {
  return list(value).map(item => ({
    name: text(item), source: 'PROVIDER', verification: 'PROVIDER_SUPPLIED',
    provenance: 'prokerala-v2', status: 'AVAILABLE', provider_data: item,
  })).filter(item => item.name);
}

function providerDoshas(mangal, kaalSarp) {
  return [
    mangal ? { name: 'Mangal Dosha', data: mangal } : null,
    kaalSarp ? { name: 'Kaal Sarp Dosha', data: kaalSarp } : null,
  ].filter(Boolean).map(item => ({
    name: item.name, source: 'PROVIDER', verification: 'PROVIDER_SUPPLIED',
    provenance: 'prokerala-v2', status: 'AVAILABLE', provider_data: item.data,
  }));
}

function findPlanetRows(...sources) {
  for (const source of sources) {
    const rows = list(source?.planet_positions || source?.planets || source?.planet_position);
    if (rows.length) return rows.map(normalizePlanet).filter(Boolean);
  }
  return [];
}

function normalizeProviderChart(details = {}, kundli = {}, birthProfile = {}, providerBundle = {}) {
  const nakshatraDetails = first(kundli.nakshatra_details, details.nakshatra_details) || {};
  const nakshatra = first(details.nakshatra, kundli.nakshatra, nakshatraDetails.nakshatra) || {};
  const moonSign = first(details.chandra_rasi, details.moon_sign, details.rasi,
    kundli.moon_sign, kundli.chandra_rasi, nakshatraDetails.chandra_rasi);
  const ascendant = first(details.lagna, details.ascendant, kundli.lagna, kundli.ascendant);
  const planetPosition = providerBundle.planetPosition || {};
  const providerPositions = findPlanetRows(planetPosition, kundli, details);
  const ascendantPosition = providerPositions.find(row => row.name.toLowerCase() === 'ascendant');
  const providerPlanets = providerPositions.filter(row => PLANETS.includes(row.name.toLowerCase()));
  const sunPosition = providerPositions.find(row => row.name.toLowerCase() === 'sun');
  const charts = kundli.charts || kundli.chart || {};
  const dasha = first(kundli.dasha, kundli.dasha_periods, details.dasha, details.dasha_periods) || null;
  const timeline = Array.isArray(dasha) ? dasha : list(dasha?.dasha_periods);
  const now = Date.now();
  const currentMaha = timeline.find(item => Date.parse(item.start) <= now && Date.parse(item.end) >= now) || null;
  const currentAntar = list(currentMaha?.antardasha).find(item => Date.parse(item.start) <= now && Date.parse(item.end) >= now) || null;

  const core = {
    rashi: text(moonSign),
    lagna: text(first(ascendant, ascendantPosition?.sign)),
    nakshatra: text(nakshatra),
    nakshatraPada: finite(first(nakshatra?.pada, details.nakshatra_pada, kundli.nakshatra_pada)),
  };
  const mangal = first(kundli.mangal_dosha, kundli.doshas?.mangal, kundli.dosha?.mangal);
  const providerHouseRows = normalizeProviderHouses(first(kundli.houses, kundli.bhavas, kundli.bhava));
  const chartFact = value => availableFact(value, { data: value || null });
  const lagnaFact = availableFact(core.lagna, { sign: core.lagna, longitude: ascendantPosition?.longitude ?? null });
  const sunSign = text(first(details.soorya_rasi, kundli.soorya_rasi, sunPosition?.sign));
  const moonFact = availableFact(core.rashi, { sign: core.rashi });
  const nakshatraFact = availableFact(core.nakshatra, { name: core.nakshatra, pada: core.nakshatraPada });
  const currentMahadasha = first(dasha?.current_mahadasha, dasha?.mahadasha, dasha?.current?.mahadasha, currentMaha);
  const currentAntardasha = first(dasha?.current_antardasha, dasha?.antardasha, dasha?.current?.antardasha, currentAntar);
  const houseModel = deriveWholeSignHouses(core.lagna, providerPlanets, providerHouseRows);
  const planets = assignPlanetHouses(providerPlanets, houseModel);
  const structuralConditions = deriveStructuralConditions(planets);
  const aspects = deriveParashariAspects(planets, houseModel);
  const precisionWarnings = birthProfile.birth_time_certainty === 'EXACT' ? []
    : ['Birth time is not exact; Lagna, houses, divisional charts and dasha timing may vary.'];

  const canonical = {
    schema_version: CALCULATION_STANDARD.schemaVersion,
    calculation_version: CALCULATION_STANDARD.calculationVersion,
    provider: CALCULATION_STANDARD.provider,
    ayanamsha: CALCULATION_STANDARD.ayanamsha,
    birth_time_certainty: text(birthProfile.birth_time_certainty),
    lagna: lagnaFact,
    sun_sign: availableFact(sunSign, { sign: sunSign }),
    moon_sign: moonFact,
    nakshatra: nakshatraFact,
    schemaVersion: CALCULATION_STANDARD.schemaVersion,
    calculation: { ...CALCULATION_STANDARD, generatedAt: providerBundle.generatedAt || null },
    birthProfileVersion: finite(birthProfile.profile_version),
    inputFingerprint: text(birthProfile.input_fingerprint),
    birthTimeCertainty: text(birthProfile.birth_time_certainty),
    input: {
      dateOfBirth: text(birthProfile.date_of_birth),
      birthTime: text(birthProfile.birth_time),
      latitude: finite(birthProfile.latitude),
      longitude: finite(birthProfile.longitude),
      timezone: text(birthProfile.timezone),
      utcOffsetMinutes: finite(birthProfile.utc_offset_minutes),
    },
    precision: birthProfile.birth_time_certainty === 'EXACT' ? 'FULL' : 'REDUCED',
    core,
    overview: core,
    providerEvidence: {
      lagna: ascendantPosition?.sign ? { module: 'planetPosition', planetId: 100 } : ascendant ? { module: 'birthDetailsOrKundli' } : null,
      rashi: moonSign ? { module: 'birthDetailsOrKundli' } : null,
      nakshatra: nakshatra ? { module: 'birthDetailsOrKundli' } : null,
    },
    planets,
    charts: {
      d1: chartFact(first(providerBundle.d1, charts.d1, charts.rasi, kundli.rasi_chart, kundli.birth_chart)),
      d9: chartFact(first(providerBundle.d9, charts.d9, charts.navamsa, kundli.navamsa_chart)),
      bhava: chartFact(first(providerBundle.bhava, charts.bhava, kundli.bhava_chart)),
    },
    houses: houseModel,
    dasha: dasha ? { mahadasha: currentMahadasha || null, antardasha: currentAntardasha || null,
      full_timeline: timeline, source: 'PROVIDER', status: 'AVAILABLE' }
      : { mahadasha: null, antardasha: null, full_timeline: [], source: 'UNAVAILABLE', status: 'UNAVAILABLE', reason: 'PROVIDER_NOT_SUPPLIED' },
    yogas: providerItems(first(kundli.yogas, kundli.yoga_details)),
    doshas: providerDoshas(mangal, providerBundle.kaalSarpDosha),
    transits: { status: 'UNAVAILABLE', calculated_at: null, expires_at: null, timezone: null,
      ayanamsha: CALCULATION_STANDARD.ayanamsha, calculation_version: CALCULATION_STANDARD.calculationVersion,
      source: 'UNAVAILABLE', method: null, cache_strategy: 'NO_CACHE_UNTIL_AUTHORITATIVE_SOURCE', planets: [], reason: 'AUTHORITATIVE_TRANSIT_SOURCE_REQUIRED' },
    aspects,
    structural_conditions: structuralConditions,
    strengths: { status: 'UNAVAILABLE', source: 'UNAVAILABLE', method: null, calculation_version: CALCULATION_STANDARD.calculationVersion,
      items: [], reason: 'SHADBALA_NOT_IMPLEMENTED' },
    life_areas: null,
    moduleStatus: providerBundle.moduleStatus || {},
    precisionWarnings,
  };
  canonical.life_areas = buildLifeAreas(canonical);
  return canonical;
}

function validateKundliReadiness(normalized = {}, birthProfile = {}, { deepEnabled = false } = {}) {
  const missingFields = [];
  if (!text(normalized.core?.lagna)) missingFields.push('lagna');
  if (!text(normalized.core?.rashi)) missingFields.push('rashi');
  if (!text(normalized.core?.nakshatra)) missingFields.push('nakshatra');
  if (!Number.isInteger(Number(normalized.core?.nakshatraPada)) || Number(normalized.core.nakshatraPada) < 1 || Number(normalized.core.nakshatraPada) > 4) missingFields.push('nakshatra_pada');
  if (normalized.charts?.d1?.status !== 'AVAILABLE' || normalized.charts.d1.data?.format !== 'svg' || !text(normalized.charts.d1.data.content)) missingFields.push('d1');
  if (!Array.isArray(normalized.planets) || normalized.planets.length === 0) missingFields.push('planets');
  if (normalized.calculation?.provider !== 'prokerala') missingFields.push('calculation.provider');
  if (!text(normalized.calculation?.providerApiVersion)) missingFields.push('calculation.provider_api_version');
  if (!text(normalized.calculation?.calculationVersion)) missingFields.push('calculation.calculation_version');
  if (normalized.calculation?.ayanamsha !== 'lahiri') missingFields.push('calculation.ayanamsha');
  if (!text(birthProfile.input_fingerprint) || normalized.inputFingerprint !== birthProfile.input_fingerprint) missingFields.push('input_fingerprint');
  if (!Number.isInteger(Number(birthProfile.profile_version)) || normalized.birthProfileVersion !== Number(birthProfile.profile_version)) missingFields.push('birth_profile_version');
  const requiredModules = deepEnabled ? ['birthDetails', 'advancedKundli', 'planetPosition', 'd1']
    : ['birthDetails', 'basicKundli', 'planetPosition', 'd1'];
  for (const moduleName of requiredModules) {
    if (normalized.moduleStatus?.[moduleName] !== 'READY') missingFields.push(`module.${moduleName}`);
  }
  return { valid: missingFields.length === 0, error: missingFields.length ? 'KUNDLI_CORE_INCOMPLETE' : null, missingFields };
}

function compactContext(normalized = {}) {
  const dasha = normalized.dasha || {};
  const available = fact => fact?.status === 'AVAILABLE';
  return {
    birthTimeCertainty: normalized.birth_time_certainty || null,
    rashi: available(normalized.moon_sign) ? normalized.moon_sign.sign : null,
    lagna: available(normalized.lagna) ? normalized.lagna.sign : null,
    sunSign: available(normalized.sun_sign) ? normalized.sun_sign.sign : null,
    nakshatra: available(normalized.nakshatra) ? normalized.nakshatra.name : null,
    nakshatraPada: available(normalized.nakshatra) ? normalized.nakshatra.pada : null,
    currentMahadasha: dasha.status === 'AVAILABLE' ? text(dasha.mahadasha) : null,
    currentAntardasha: dasha.status === 'AVAILABLE' ? text(dasha.antardasha) : null,
    currentMahadashaStart: dasha.status === 'AVAILABLE' ? text(dasha.mahadasha?.start) : null,
    currentMahadashaEnd: dasha.status === 'AVAILABLE' ? text(dasha.mahadasha?.end) : null,
    currentAntardashaStart: dasha.status === 'AVAILABLE' ? text(dasha.antardasha?.start) : null,
    currentAntardashaEnd: dasha.status === 'AVAILABLE' ? text(dasha.antardasha?.end) : null,
    precisionWarning: normalized.birth_time_certainty === 'EXACT' ? null
      : 'Birth time is not exact; time-sensitive chart interpretation may vary.',
  };
}

function compactStructuralContext(normalized = {}) {
  const available = fact => fact?.status === 'AVAILABLE';
  const safeFact = fact => available(fact) ? fact : null;
  return {
    schema_version: normalized.schema_version || null,
    calculation_version: normalized.calculation_version || null,
    natal: {
      lagna: safeFact(normalized.lagna), sun_sign: safeFact(normalized.sun_sign),
      moon_sign: safeFact(normalized.moon_sign), nakshatra: safeFact(normalized.nakshatra),
      planets: list(normalized.planets).filter(planet => planet?.status === 'AVAILABLE' && planet?.source === 'PROVIDER')
        .map(({ id, name, sign, longitude, degree, retrograde, house, house_status, house_source }) =>
          ({ id, name, sign, longitude, degree, retrograde, house, house_status, house_source })),
    },
    houses: normalized.houses?.status === 'AVAILABLE' ? normalized.houses : { status: 'UNAVAILABLE', items: [] },
    current_period: normalized.dasha?.status === 'AVAILABLE'
      ? { status: 'AVAILABLE', source: normalized.dasha.source, mahadasha: normalized.dasha.mahadasha,
        antardasha: normalized.dasha.antardasha }
      : { status: 'UNAVAILABLE', source: 'UNAVAILABLE', mahadasha: null, antardasha: null },
    transits: normalized.transits?.status === 'AVAILABLE' ? normalized.transits : { status: 'UNAVAILABLE', planets: [] },
    aspects: normalized.aspects?.status === 'AVAILABLE' ? normalized.aspects : { status: 'UNAVAILABLE', items: [] },
    structural_conditions: normalized.structural_conditions?.status === 'AVAILABLE'
      ? normalized.structural_conditions : { status: 'UNAVAILABLE', items: [] },
    life_areas: normalized.life_areas?.status === 'READY'
      ? normalized.life_areas : { status: 'UNAVAILABLE', items: [] },
  };
}

function validateAuthoritativeBirthProfile(profile = {}) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(profile.date_of_birth || ''))) errors.push('INVALID_DATE_OF_BIRTH');
  if (!['EXACT', 'APPROXIMATE', 'UNCERTAIN', 'PERIOD_ONLY', 'UNKNOWN'].includes(profile.birth_time_certainty)) errors.push('INVALID_BIRTH_TIME_CERTAINTY');
  if (['UNKNOWN', 'PERIOD_ONLY'].includes(profile.birth_time_certainty) || !profile.birth_time) errors.push('BIRTH_TIME_REQUIRED');
  const latitude = finite(profile.latitude);
  const longitude = finite(profile.longitude);
  if (latitude === null || latitude < -90 || latitude > 90) errors.push('INVALID_LATITUDE');
  if (longitude === null || longitude < -180 || longitude > 180) errors.push('INVALID_LONGITUDE');
  if (!text(profile.timezone) || !Number.isInteger(Number(profile.utc_offset_minutes))) errors.push('UNRESOLVED_TIMEZONE');
  if (!text(profile.input_fingerprint) || !Number.isInteger(Number(profile.profile_version))) errors.push('INVALID_PROFILE_VERSION');
  return { valid: errors.length === 0, errors };
}

function circularLongitudeDelta(actual, expected) {
  const a = finite(actual); const e = finite(expected);
  if (a === null || e === null) return null;
  const raw = Math.abs(((a - e) % 360 + 360) % 360);
  return Math.min(raw, 360 - raw);
}

function compareReference(actual, expected, toleranceDegrees = 0.1) {
  if (!expected || expected.reference_status !== 'VERIFIED') {
    return { status: 'NOT_COMPARABLE', reason: 'REFERENCE_DATA_REQUIRED', comparisons: [] };
  }
  const comparisons = [];
  for (const field of ['ascendant', 'moon_sign', 'nakshatra', 'nakshatra_pada']) {
    const actualValue = actual?.[field] ?? null;
    const expectedValue = expected?.expected?.[field] ?? null;
    comparisons.push({ field, actual: actualValue, expected: expectedValue,
      status: expectedValue == null ? 'NOT_COMPARABLE' : actualValue === expectedValue ? 'PASS' : 'FAIL' });
  }
  for (const [planet, expectedLongitude] of Object.entries(expected.expected?.planetary_longitudes || {})) {
    const actualLongitude = actual?.planetary_longitudes?.[planet];
    const delta = circularLongitudeDelta(actualLongitude, expectedLongitude);
    comparisons.push({ field: `planetary_longitudes.${planet}`, actual: actualLongitude ?? null,
      expected: expectedLongitude, deltaDegrees: delta,
      status: delta === null ? 'NOT_COMPARABLE' : delta <= toleranceDegrees ? 'PASS' : 'FAIL' });
  }
  return { status: comparisons.some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS', comparisons };
}

module.exports = {
  CALCULATION_STANDARD, WHOLE_SIGN_METHOD, STRUCTURAL_CONDITION_METHOD, DRISHTI_METHOD,
  DRISHTI_CALCULATION_VERSION, DRISHTI_RULES, DIGNITY_RULES, canonicalSign, dignityClassification,
  deriveWholeSignHouses, assignPlanetHouses, deriveParashariAspects, deriveStructuralConditions,
  normalizeProviderChart, compactContext, compactStructuralContext,
  validateAuthoritativeBirthProfile, validateKundliReadiness, circularLongitudeDelta, compareReference,
};
