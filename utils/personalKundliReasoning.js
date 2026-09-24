'use strict';

const PERSONAL_KUNDLI_D3_BUILD = 'personal-kundli-v1-d3-deep-reasoning-20260924';

function text(value) {
  return String(value || '').normalize('NFC').trim().toLocaleLowerCase('en-IN');
}

function classifyPersonalQuestion(question) {
  const value = text(question);
  if (/(?:job|नौकरी).{0,25}(?:business|व्यवसाय|बिजनेस)|(?:business|व्यवसाय|बिजनेस).{0,25}(?:job|नौकरी)/iu.test(value)) return 'JOB_VS_BUSINESS';
  if (/^(?:why|क्यों|क्यूँ)(?:\s|[?!.]|$)/iu.test(value)) return 'WHY';
  if (/(?:jupiter|गुरु|बृहस्पति)/iu.test(value)) return 'JUPITER_ROLE';
  if (/(?:exact|which|किस|कौन).{0,25}(?:year|साल)|(?:when|कब).{0,30}(?:success|career|marriage|विवाह|सफल)/iu.test(value)) return 'TIMING';
  if (/(?:which|कौन).{0,30}(?:field|career|काम)|(?:career|work).{0,20}(?:field|option)|fields?/iu.test(value)) return 'CAREER_FIELDS';
  if (/(?:relationship|marriage|विवाह|शादी|partner|संबंध)/iu.test(value)) return 'RELATIONSHIP_PATTERN';
  if (/(?:money|finance|income|धन|पैसा|आय)/iu.test(value)) return 'MONEY_PATTERN';
  return 'DEEP_AREA_ANALYSIS';
}

function fact(kind, value) {
  return value === null || value === undefined || value === '' ? null : { source: 'CANONICAL_FACT', kind, value };
}

function uniqueEvidence(items, limit) {
  const seen = new Set();
  return items.filter(Boolean).filter(item => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}

function structuralEvidence(context) {
  const structural = context?.structuralEvidence || {};
  const items = [];
  for (const house of structural.houses || []) {
    const occupants = Array.isArray(house.occupants) ? house.occupants.filter(Boolean) : [];
    items.push({
      source: 'K3_STRUCTURAL_EVIDENCE', kind: 'HOUSE_STRUCTURE',
      house: house.number, sign: house.sign || null, lord: house.lord || null,
      ...(occupants.length ? { occupants } : {}),
    });
  }
  for (const aspect of structural.aspects || []) items.push({
    source: 'K3_STRUCTURAL_EVIDENCE', kind: 'VERIFIED_ASPECT',
    planet: aspect.sourcePlanet, targetHouse: aspect.targetHouse,
  });
  for (const planet of structural.relevantPlanets || []) items.push({
    source: 'CANONICAL_FACT', kind: 'RELEVANT_PLANET',
    planet: planet.name, sign: planet.sign || null, house: planet.house ?? null,
  });
  return items;
}

function unavailableEvidence(context) {
  const availability = context?.availability || {};
  const missing = [];
  for (const key of ['dasha', 'd9', 'bhava', 'transits']) if (!availability[key]) missing.push(key.toUpperCase());
  if (!availability.verifiedScripture) missing.push('VERIFIED_SCRIPTURE');
  return missing;
}

function requirementsFor(questionType, context) {
  const common = [
    'Answer the exact question before explaining supporting detail.',
    'Connect at least two supplied factors when two relevant factors exist; do not output a placement inventory.',
    'Trace every major personal conclusion to supplied canonical, K3, or K4.1 evidence.',
    'Translate the connected evidence into practical meaning without turning synthesis into a calculated fact.',
    'Mention genuine tension or uncertainty from supplied challenges and limitations; do not manufacture contradiction.',
    'Absence of evidence is not positive evidence. An empty house or missing planet is descriptive only and cannot imply weakness, delay, unclear identity, promotion difficulty, or any positive outcome unless K3/K4.1 explicitly says so.',
    'Never map a planet directly to a profession. Derive supported work characteristics first; any small set of role families must be explicitly illustrative and must explain the supplied evidence-to-characteristic-to-example link.',
    'For a deep answer, form two to four meaningful evidence chains when enough evidence exists: connect facts into a supported interpretation, connect that interpretation to practical meaning, then integrate qualifiers so the conclusion is not absolute.',
    'Integrate challenges and limitations into the conclusion they modify; do not turn them into a generic standalone Challenges list.',
    'Use few adaptive headings and one precise limitation statement where needed.',
  ];
  const specific = {
    JOB_VS_BUSINESS: [
      'Compare JOB SIDE and BUSINESS/INDEPENDENT SIDE using supplied evidence for each side.',
      'Explain the tension and conclude whether one environment, a hybrid progression, or insufficient evidence is better supported.',
      'Do not give generic entrepreneurship advice or invent an age, year, Dasha, or transit.',
    ],
    WHY: [
      'Explain the evidence chain behind the immediately preceding conclusion; do not restart the full Kundli analysis.',
      'State how the primary factor, supporting factor, and any qualifier produced that conclusion.',
    ],
    JUPITER_ROLE: [
      'Discuss Jupiter only where Jupiter appears in supplied evidence and relate it to the preceding conclusion.',
      'Do not give a generic textbook description of Jupiter or infer an unsupplied Jupiter relation.',
      'State what Jupiter alone cannot establish.',
    ],
    CAREER_FIELDS: [
      'Derive supported work characteristics first, then map them to a small number of example role families.',
      'For each role family show evidence to work characteristic to fit; do not present destiny or a large occupation list.',
    ],
    TIMING: [
      'If Dasha or transit evidence is unavailable, clearly say the loaded evidence does not establish an exact year or event time.',
      'Do not derive a year, age, Mahadasha, Antardasha, or transit from general Jyotish knowledge.',
    ],
  };
  if (context?.selectedArea === 'HEALTH') common.push('Keep the answer traditional and general: no diagnosis, disease or medical-risk prediction, or treatment advice; recommend professional care when relevant.');
  return [...common, ...(specific[questionType] || [])];
}

function buildPersonalKundliReasoningPlan({ question, recentMessages = [], context } = {}) {
  if (!context || context.contextType !== 'PERSONAL_KUNDLI') return null;
  const questionType = classifyPersonalQuestion(question);
  const previousUser = [...recentMessages].reverse().find(item => item?.role === 'user')?.content || null;
  const structural = structuralEvidence(context);
  const core = context.coreFacts || {};
  const primary = uniqueEvidence([
    structural.find(item => item.kind === 'HOUSE_STRUCTURE'),
    structural.find(item => item.kind === 'RELEVANT_PLANET'),
    fact('LAGNA', core.lagna),
    context.area?.summary ? { source: 'K4.1_DETERMINISTIC_INTERPRETATION', kind: 'AREA_SUMMARY', value: context.area.summary } : null,
  ], 4);
  const supporting = uniqueEvidence([
    ...structural.filter(item => !primary.some(primaryItem => JSON.stringify(primaryItem) === JSON.stringify(item))),
    ...(context.area?.directions || []).map(value => ({ source: 'K4.1_DETERMINISTIC_INTERPRETATION', kind: 'DIRECTION', value })),
    ...(context.area?.strengths || []).map(value => ({ source: 'K4.1_DETERMINISTIC_INTERPRETATION', kind: 'STRENGTH', value })),
  ], 8);
  const qualifying = uniqueEvidence([
    ...(context.area?.challenges || []).map(value => ({ source: 'K4.1_DETERMINISTIC_INTERPRETATION', kind: 'CHALLENGE', value })),
    ...(context.area?.limitations || []).map(value => ({ source: 'K4.1_LIMITATION', kind: 'LIMITATION', value })),
    context.precisionWarning ? { source: 'CANONICAL_LIMITATION', kind: 'BIRTH_TIME_PRECISION', value: context.precisionWarning } : null,
  ], 8);
  const jupiter = [...primary, ...supporting].filter(item => /jupiter|गुरु|बृहस्पति/iu.test(JSON.stringify(item)));
  const evidenceChains = [];
  if (primary.length && supporting.length) evidenceChains.push({
    inputs: [primary[0], supporting[0]], purpose: 'Connect supplied factors into one supported interpretation.',
  });
  if ((primary.length > 1 || supporting.length > 1) && context.area?.summary) evidenceChains.push({
    inputs: [primary[1] || primary[0], supporting[1] || supporting[0], { source: 'K4.1_DETERMINISTIC_INTERPRETATION', kind: 'AREA_SUMMARY', value: context.area.summary }],
    purpose: 'Explain the practical implication supported by the combined evidence.',
  });
  if (qualifying.length) evidenceChains.push({
    inputs: [qualifying[0]], purpose: 'Modify the relevant conclusion and prevent an absolute claim; do not present a generic challenge list.',
  });
  return {
    schemaVersion: 'personal-kundli-reasoning-plan-v1',
    target: context.selectedArea || 'GENERAL', questionType,
    conversationAnchor: ['WHY', 'JUPITER_ROLE'].includes(questionType) ? previousUser : null,
    primaryEvidence: questionType === 'JUPITER_ROLE' ? jupiter.slice(0, 4) : primary,
    supportingEvidence: questionType === 'JUPITER_ROLE' ? jupiter.slice(4, 8) : supporting,
    qualifyingEvidence: qualifying,
    evidenceChains: evidenceChains.slice(0, 4),
    unavailableEvidence: unavailableEvidence(context),
    responseRequirements: requirementsFor(questionType, context),
  };
}

module.exports = {
  PERSONAL_KUNDLI_D3_BUILD,
  classifyPersonalQuestion,
  buildPersonalKundliReasoningPlan,
};
