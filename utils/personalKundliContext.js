'use strict';

const {
  KUNDLI_INTERPRETATION_VERSION,
  SUPPORTED_AREAS,
  withKundliInterpretation,
} = require('./kundliInterpretation');

const SUPPORTED_PERSONAL_KUNDLI_AREAS = Object.freeze([...SUPPORTED_AREAS]);
const SUPPORTED_AREA_SET = new Set(SUPPORTED_PERSONAL_KUNDLI_AREAS);

function normalizePersonalKundliArea(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return SUPPORTED_AREA_SET.has(normalized) ? normalized : null;
}

function localized(value, language) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  return value[language === 'hindi' ? 'hi' : 'en'] || value.en || value.hi || null;
}

function available(value) {
  return value?.status === 'AVAILABLE';
}

function cleanList(value, limit = 6) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, limit) : [];
}

function buildStructuralEvidence(k3Area, normalized) {
  const evidence = cleanList(k3Area?.evidence, 24);
  const houses = evidence
    .filter(item => item?.factor === 'HOUSE_STRUCTURE' && Number.isFinite(Number(item.house)))
    .slice(0, 3)
    .map(item => ({
      number: Number(item.house), sign: item.sign || null, lord: item.lord || null,
      occupants: cleanList(item.occupants, 9).map(String),
    }));
  const aspects = evidence
    .filter(item => item?.factor === 'HOUSE_RECEIVES_DRISHTI' && item.source_planet && Number.isFinite(Number(item.target_house)))
    .slice(0, 8)
    .map(item => ({ sourcePlanet: String(item.source_planet), targetHouse: Number(item.target_house) }));
  const names = new Set();
  for (const item of evidence) {
    if (item?.planet) names.add(String(item.planet));
    if (item?.lord) names.add(String(item.lord));
    if (item?.source_planet) names.add(String(item.source_planet));
    for (const occupant of cleanList(item?.occupants, 9)) names.add(String(occupant));
  }
  const relevantPlanets = cleanList(normalized?.planets, 20)
    .filter(planet => names.has(String(planet?.name || '')) && planet?.status === 'AVAILABLE' && planet?.source === 'PROVIDER')
    .slice(0, 9)
    .map(planet => ({
      name: String(planet.name), sign: planet.sign || null,
      house: Number.isFinite(Number(planet.house)) ? Number(planet.house) : null,
    }));
  return { houses, relevantPlanets, aspects };
}

function projectPersonalKundliContext({ normalized, selectedArea, preferredName = null, calculationVersion = null, language = 'english' } = {}) {
  const areaId = normalizePersonalKundliArea(selectedArea);
  if (!areaId || !normalized || typeof normalized !== 'object') return null;
  const certainty = normalized.birth_time_certainty || normalized.interpretation?.birth_time_certainty || null;
  const enriched = normalized.interpretation?.version === KUNDLI_INTERPRETATION_VERSION
    ? normalized
    : withKundliInterpretation(normalized, { birth_time_certainty: certainty });
  const interpretation = enriched.interpretation || {};
  const k4Area = interpretation.areas?.[areaId] || { status: 'UNAVAILABLE', limitations: ['AREA_EVIDENCE_UNAVAILABLE'] };
  const k3Area = cleanList(enriched.life_areas?.items, 20).find(item => item?.id === areaId) || null;
  const limitationCodes = cleanList(k4Area.limitations, 12).map(String);
  const precisionWarning = certainty === 'EXACT' ? null : 'Birth time is not exact; time-sensitive chart interpretation may vary.';
  return {
    schemaVersion: 'personal-kundli-context-v1',
    contextType: 'PERSONAL_KUNDLI',
    selectedArea: areaId,
    preferredName: preferredName ? String(preferredName).slice(0, 100) : null,
    calculationVersion: calculationVersion || enriched.calculation_version || null,
    interpretationVersion: interpretation.version || KUNDLI_INTERPRETATION_VERSION,
    birthTimeCertainty: certainty,
    precisionWarning,
    coreFacts: {
      rashi: available(enriched.moon_sign) ? enriched.moon_sign.sign || enriched.moon_sign.name || null : null,
      lagna: available(enriched.lagna) ? enriched.lagna.sign || enriched.lagna.name || null : null,
      nakshatra: available(enriched.nakshatra) ? enriched.nakshatra.name || null : null,
      pada: available(enriched.nakshatra) && Number.isFinite(Number(enriched.nakshatra.pada)) ? Number(enriched.nakshatra.pada) : null,
    },
    area: {
      id: areaId, status: k4Area.status || 'UNAVAILABLE',
      summary: localized(k4Area.summary, language),
      directions: cleanList(k4Area.directions).map(item => localized(item?.label || item, language)).filter(Boolean),
      strengths: cleanList(k4Area.strengths).map(item => localized(item, language)).filter(Boolean),
      challenges: cleanList(k4Area.challenges).map(item => localized(item, language)).filter(Boolean),
      evidenceSummary: localized(k4Area.evidenceSummary, language),
      limitations: limitationCodes,
    },
    structuralEvidence: buildStructuralEvidence(k3Area, enriched),
    availability: {
      dasha: available(enriched.dasha), d9: available(enriched.charts?.d9),
      bhava: available(enriched.charts?.bhava), transits: available(enriched.transits),
      verifiedScripture: false,
    },
  };
}

module.exports = {
  SUPPORTED_PERSONAL_KUNDLI_AREAS,
  normalizePersonalKundliArea,
  projectPersonalKundliContext,
};
