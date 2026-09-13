'use strict';

const CALCULATION_STANDARD = Object.freeze({
  schemaVersion: 'dharmasetu-kundli-v1',
  calculationVersion: 'prokerala-v2-lahiri-k1-v1',
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
    source: 'PROKERALA',
    status: 'AVAILABLE',
  };
}

function availableFact(value, extra = {}) {
  return value === null || value === undefined || value === ''
    ? { ...extra, source: 'PROKERALA', status: 'UNAVAILABLE', reason: 'PROVIDER_NOT_SUPPLIED' }
    : { ...extra, source: 'PROKERALA', status: 'AVAILABLE' };
}

function normalizeHouses(value) {
  return list(value).map((house, index) => ({
    number: finite(first(house?.number, house?.house, house?.house_number, index + 1)),
    sign: text(first(house?.sign, house?.rasi, house?.rashi, house?.name)),
    lord: text(first(house?.lord, house?.sign_lord, house?.rasi?.lord, house?.rashi?.lord)),
    source: 'PROKERALA', status: 'AVAILABLE',
  })).filter(house => house.number !== null || house.sign !== null);
}

function providerItems(value) {
  return list(value).map(item => ({
    name: text(item), source: 'PROKERALA', verification: 'PROVIDER_SUPPLIED',
    provenance: 'prokerala-v2', status: 'AVAILABLE', provider_data: item,
  })).filter(item => item.name);
}

function providerDoshas(mangal, kaalSarp) {
  return [
    mangal ? { name: 'Mangal Dosha', data: mangal } : null,
    kaalSarp ? { name: 'Kaal Sarp Dosha', data: kaalSarp } : null,
  ].filter(Boolean).map(item => ({
    name: item.name, source: 'PROKERALA', verification: 'PROVIDER_SUPPLIED',
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
  const planets = providerPositions.filter(row => PLANETS.includes(row.name.toLowerCase()));
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
  const houseRows = normalizeHouses(first(kundli.houses, kundli.bhavas, kundli.bhava));
  const chartFact = value => availableFact(value, { data: value || null });
  const lagnaFact = availableFact(core.lagna, { sign: core.lagna, longitude: ascendantPosition?.longitude ?? null });
  const sunSign = text(first(details.soorya_rasi, kundli.soorya_rasi, sunPosition?.sign));
  const moonFact = availableFact(core.rashi, { sign: core.rashi });
  const nakshatraFact = availableFact(core.nakshatra, { name: core.nakshatra, pada: core.nakshatraPada });
  const currentMahadasha = first(dasha?.current_mahadasha, dasha?.mahadasha, dasha?.current?.mahadasha, currentMaha);
  const currentAntardasha = first(dasha?.current_antardasha, dasha?.antardasha, dasha?.current?.antardasha, currentAntar);
  const precisionWarnings = birthProfile.birth_time_certainty === 'EXACT' ? []
    : ['Birth time is not exact; Lagna, houses, divisional charts and dasha timing may vary.'];

  return {
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
    houses: houseRows,
    dasha: dasha ? { mahadasha: currentMahadasha || null, antardasha: currentAntardasha || null,
      full_timeline: timeline, source: 'PROKERALA', status: 'AVAILABLE' }
      : { mahadasha: null, antardasha: null, full_timeline: [], source: 'PROKERALA', status: 'UNAVAILABLE', reason: 'PROVIDER_NOT_SUPPLIED' },
    yogas: providerItems(first(kundli.yogas, kundli.yoga_details)),
    doshas: providerDoshas(mangal, providerBundle.kaalSarpDosha),
    transits: { status: 'UNAVAILABLE', reason: 'NOT_IMPLEMENTED' },
    aspects: { status: 'UNAVAILABLE', reason: 'NOT_IMPLEMENTED' },
    strengths: { status: 'UNAVAILABLE', reason: 'NOT_IMPLEMENTED' },
    life_areas: { status: 'UNAVAILABLE', reason: 'NOT_IMPLEMENTED' },
    moduleStatus: providerBundle.moduleStatus || {},
    precisionWarnings,
  };
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

function validateAuthoritativeBirthProfile(profile = {}) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(profile.date_of_birth || ''))) errors.push('INVALID_DATE_OF_BIRTH');
  if (!['EXACT', 'APPROXIMATE', 'UNCERTAIN', 'UNKNOWN'].includes(profile.birth_time_certainty)) errors.push('INVALID_BIRTH_TIME_CERTAINTY');
  if (profile.birth_time_certainty === 'UNKNOWN' || !profile.birth_time) errors.push('BIRTH_TIME_REQUIRED');
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
  CALCULATION_STANDARD, normalizeProviderChart, compactContext,
  validateAuthoritativeBirthProfile, validateKundliReadiness, circularLongitudeDelta, compareReference,
};
