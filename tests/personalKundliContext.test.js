'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { KUNDLI_INTERPRETATION_VERSION } = require('../utils/kundliInterpretation');
const { normalizePersonalKundliArea, projectPersonalKundliContext } = require('../utils/personalKundliContext');
const { QUERY_INTENTS, resolveDharmaQueryIntent } = require('../utils/queryRouter');
const { buildOrchestration, PERSONAL_KUNDLI_REASONING_CONTRACT } = require('../utils/dharmaOrchestrator');
const { enforceUnverifiedCitationSafety } = require('../utils/aiSafety');
const { enforceCitationPolicy } = require('../utils/scriptureCitationValidator');

function fixture(certainty = 'APPROXIMATE') {
  const careerEvidence = [
    { factor: 'HOUSE_STRUCTURE', house: 10, sign: 'Karka', lord: 'Moon', occupants: ['Jupiter'] },
    { factor: 'HOUSE_LORD_PLACEMENT', house: 10, lord: 'Moon', lord_house: 4 },
    { factor: 'HOUSE_RECEIVES_DRISHTI', source_planet: 'Jupiter', target_house: 10 },
  ];
  return {
    birth_time_certainty: certainty,
    moon_sign: { status: 'AVAILABLE', sign: 'Vrishabha' },
    lagna: { status: 'AVAILABLE', sign: 'Mesha' },
    nakshatra: { status: 'AVAILABLE', name: 'Rohini', pada: 2 },
    planets: [
      { status: 'AVAILABLE', source: 'PROVIDER', name: 'Moon', sign: 'Karka', house: 4, longitude: 100 },
      { status: 'AVAILABLE', source: 'PROVIDER', name: 'Jupiter', sign: 'Karka', house: 10, raw: { secret: true } },
    ],
    life_areas: { status: 'READY', items: [
      { id: 'CAREER', status: 'READY', evidence: careerEvidence },
      { id: 'MARRIAGE', status: 'READY', evidence: [{ factor: 'HOUSE_STRUCTURE', house: 7 }] },
    ] },
    interpretation: {
      version: KUNDLI_INTERPRETATION_VERSION, birth_time_certainty: certainty,
      areas: {
        CAREER: { status: 'AVAILABLE', summary: { en: 'Career pattern.', hi: 'करियर संकेत।' },
          directions: [{ label: { en: 'Advisory work', hi: 'परामर्श कार्य' } }],
          strengths: [{ en: 'Knowledge', hi: 'ज्ञान' }], challenges: [{ en: 'Overextension', hi: 'अधिक विस्तार' }],
          evidenceSummary: { en: 'House 10: Karka · Lord: Moon · Jupiter', hi: 'भाव 10' },
          limitations: ['NO_TIMING_WITHOUT_AUTHORITATIVE_DASHA', 'NO_D9_OR_BHAVA_INTERPRETATION', 'BIRTH_TIME_NOT_EXACT_TIME_SENSITIVE_FACTORS_MAY_VARY'] },
        MARRIAGE: { status: 'AVAILABLE', summary: { en: 'Unrelated area must not leak.' }, limitations: [] },
      },
    },
    dasha: { status: 'UNAVAILABLE', raw: 'hidden' }, charts: { d9: { status: 'UNAVAILABLE' }, bhava: { status: 'UNAVAILABLE' } },
    provider_response: { hidden: true }, birth_date: '2000-01-01', birth_time: '10:00', place_name: 'Hidden', phone: '9999999999', id: 'db-id',
  };
}

test('area validation accepts only the eight K4.1 areas', () => {
  assert.equal(normalizePersonalKundliArea('career'), 'CAREER');
  assert.equal(normalizePersonalKundliArea('unknown'), null);
});

test('projector supplies selected K3 and K4.1 evidence and excludes unrelated/private/raw data', () => {
  const context = projectPersonalKundliContext({ normalized: fixture(), selectedArea: 'CAREER', preferredName: 'A', calculationVersion: 'calc-v1' });
  assert.equal(context.schemaVersion, 'personal-kundli-context-v1');
  assert.equal(context.selectedArea, 'CAREER');
  assert.equal(context.interpretationVersion, 'kundli-k4.1-interpretation-v1');
  assert.equal(context.area.summary, 'Career pattern.');
  assert.deepEqual(context.structuralEvidence.houses, [{ number: 10, sign: 'Karka', lord: 'Moon', occupants: ['Jupiter'] }]);
  assert.deepEqual(context.structuralEvidence.aspects, [{ sourcePlanet: 'Jupiter', targetHouse: 10 }]);
  assert.equal(context.structuralEvidence.relevantPlanets.length, 2);
  const serialized = JSON.stringify(context);
  for (const forbidden of ['Unrelated area must not leak', '9999999999', '2000-01-01', '10:00', 'Hidden', 'db-id', 'provider_response', 'longitude', 'secret']) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

test('projector exposes missing-module availability and approximate-time limitation', () => {
  const context = projectPersonalKundliContext({ normalized: fixture(), selectedArea: 'career' });
  assert.deepEqual(context.availability, { dasha: false, d9: false, bhava: false, transits: false, verifiedScripture: false });
  assert.equal(context.birthTimeCertainty, 'APPROXIMATE');
  assert.match(context.precisionWarning, /not exact/i);
  assert.ok(context.area.limitations.includes('BIRTH_TIME_NOT_EXACT_TIME_SENSITIVE_FACTORS_MAY_VARY'));
});

test('older READY normalized charts receive existing deterministic K4.1 enrichment', () => {
  const normalized = fixture('EXACT');
  delete normalized.interpretation;
  const context = projectPersonalKundliContext({ normalized, selectedArea: 'career' });
  assert.equal(context.interpretationVersion, 'kundli-k4.1-interpretation-v1');
  assert.equal(context.area.status, 'AVAILABLE');
  assert.ok(context.area.directions.length >= 2);
});

test('personal orchestration contains selected K3/K4.1 context and strict reasoning rules', () => {
  const personalKundli = projectPersonalKundliContext({ normalized: fixture(), selectedArea: 'career' });
  const result = buildOrchestration({ question: 'Job or business?', forcedIntent: QUERY_INTENTS.PERSONAL_JYOTISH, personalKundli, language: 'english' });
  assert.equal(result.intent, QUERY_INTENTS.PERSONAL_JYOTISH);
  assert.equal(result.metadata.selectedArea, 'CAREER');
  assert.match(result.promptContext, /Career pattern/);
  assert.match(result.promptContext, /House 10/);
  assert.match(result.promptContext, /only source of this user's chart facts/);
  assert.match(result.promptContext, /availability\.dasha is false/);
  assert.match(result.promptContext, /availability\.d9 is false/);
  assert.match(result.promptContext, /availability\.bhava is false/);
  assert.match(result.promptContext, /no diagnosis/);
  assert.match(PERSONAL_KUNDLI_REASONING_CONTRACT, /Never invent a placement/);
});

test('Personal Kundli conversation retains short follow-ups and releases clear domain changes', () => {
  const options = { conversationType: 'PERSONAL_KUNDLI' };
  for (const question of ['Why?', 'क्यों?', 'Job or business?', 'What about Jupiter?', 'Jupiter का क्या role है?', 'Which fields?', 'और detail में बताओ']) {
    assert.equal(resolveDharmaQueryIntent(question, [], options), QUERY_INTENTS.PERSONAL_JYOTISH, question);
  }
  assert.equal(resolveDharmaQueryIntent('What does Bhagavad Gita say about karma?', [], options), QUERY_INTENTS.SCRIPTURE);
  assert.equal(resolveDharmaQueryIntent('What is today panchang?', [], options), QUERY_INTENTS.PANCHANG);
});

test('unsupported citations are naturalized without internal labels while verified citations survive', () => {
  const unsupported = enforceCitationPolicy(enforceUnverifiedCitationSafety('See Bhagavad Gita 2.47.', []).text, []);
  assert.doesNotMatch(unsupported.text, /\[unverified scripture reference\]|SOURCE NOT VERIFIED/);
  assert.doesNotMatch(unsupported.text, /Bhagavad Gita 2\.47/);
  const verified = enforceCitationPolicy(enforceUnverifiedCitationSafety('See Bhagavad Gita 2.47.', ['Bhagavad Gita 2.47']).text,
    [{ title: 'Bhagavad Gita', chapter: '2', verse: '47' }]);
  assert.match(verified.text, /Bhagavad Gita 2\.47/);
  assert.equal(verified.citationStatus, 'VALID');
});

test('server contract authenticates and retrieves canonical READY chart without client facts', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.post('/ai/dharma-chat'"), server.indexOf('// ───', server.indexOf("app.post('/ai/dharma-chat'") + 30));
  assert.match(server, /app\.post\('\/ai\/dharma-chat', requireSupabaseUser/);
  assert.match(server, /status=eq\.KUNDLI_READY/);
  assert.match(route, /normalizePersonalKundliArea\(conversationContext\.area\)/);
  assert.match(route, /projectPersonalKundliContext/);
  assert.match(route, /KUNDLI_CONTEXT_NOT_READY/);
  assert.match(route, /INVALID_CONVERSATION_CONTEXT/);
  assert.doesNotMatch(route, /conversationContext\.(?:planets|houses|birth|kundli)/);
  assert.match(route, /runProviderFallback|callAI/);
});

test('general Dharma orchestration remains lexical and does not attach personal context', () => {
  const result = buildOrchestration({ question: 'What is dharma?', personalKundli: projectPersonalKundliContext({ normalized: fixture(), selectedArea: 'career' }) });
  assert.equal(result.intent, QUERY_INTENTS.GENERAL_DHARMA);
  assert.equal(result.selected.jyotish, null);
});
