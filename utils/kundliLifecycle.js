'use strict';

const CALCULATION_STANDARD = Object.freeze({
  schemaVersion: 'dharmasetu-kundli-v1',
  calculationVersion: 'prokerala-v2-lahiri-v1',
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
    name,
    sign: text(first(item.rasi, item.rashi, item.sign, item.zodiac)),
    longitude: finite(first(item.longitude, item.degree, item.degrees, item.full_degree)),
    house: finite(first(item.house, item.house_number, item.bhava)),
    nakshatra: text(item.nakshatra),
    pada: finite(first(item.nakshatra?.pada, item.pada)),
    retrograde: typeof item.retrograde === 'boolean' ? item.retrograde
      : typeof item.is_retrograde === 'boolean' ? item.is_retrograde : null,
    dignity: text(first(item.dignity, item.status)),
  };
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
  const planets = findPlanetRows(planetPosition, kundli, details).filter(row => PLANETS.includes(row.name.toLowerCase()));
  const charts = kundli.charts || kundli.chart || {};
  const dasha = first(kundli.dasha, kundli.dasha_periods, details.dasha, details.dasha_periods) || null;

  const core = {
    rashi: text(moonSign),
    lagna: text(ascendant),
    nakshatra: text(nakshatra),
    nakshatraPada: finite(first(nakshatra?.pada, details.nakshatra_pada, kundli.nakshatra_pada)),
  };
  const mangal = first(kundli.mangal_dosha, kundli.doshas?.mangal, kundli.dosha?.mangal);
  const precisionWarnings = birthProfile.birth_time_certainty === 'EXACT' ? []
    : ['Birth time is not exact; Lagna, houses, divisional charts and dasha timing may vary.'];

  return {
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
    planets,
    charts: {
      d1: first(providerBundle.d1, charts.d1, charts.rasi, kundli.rasi_chart, kundli.birth_chart),
      d9: first(providerBundle.d9, charts.d9, charts.navamsa, kundli.navamsa_chart),
      bhava: first(providerBundle.bhava, charts.bhava, kundli.bhava_chart),
    },
    houses: first(kundli.houses, kundli.bhavas, kundli.bhava),
    dasha,
    yogas: list(first(kundli.yogas, kundli.yoga_details)),
    doshas: { mangal: mangal || null, kaalSarp: providerBundle.kaalSarpDosha || null },
    moduleStatus: providerBundle.moduleStatus || {},
    precisionWarnings,
  };
}

function compactContext(normalized = {}) {
  const dasha = normalized.dasha || {};
  const timeline = Array.isArray(dasha) ? dasha : list(dasha.dasha_periods);
  const now = Date.now();
  const currentMaha = timeline.find(item => Date.parse(item.start) <= now && Date.parse(item.end) >= now) || null;
  const currentAntar = list(currentMaha?.antardasha).find(item => Date.parse(item.start) <= now && Date.parse(item.end) >= now) || null;
  return {
    birthTimeCertainty: normalized.birthTimeCertainty || null,
    rashi: normalized.core?.rashi || null,
    lagna: normalized.core?.lagna || null,
    nakshatra: normalized.core?.nakshatra || null,
    nakshatraPada: normalized.core?.nakshatraPada || null,
    currentMahadasha: text(first(dasha.current_mahadasha, dasha.mahadasha, dasha.current?.mahadasha, currentMaha)),
    currentAntardasha: text(first(dasha.current_antardasha, dasha.antardasha, dasha.current?.antardasha, currentAntar)),
    precisionWarning: normalized.birthTimeCertainty === 'EXACT' ? null
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
  validateAuthoritativeBirthProfile, circularLongitudeDelta, compareReference,
};
