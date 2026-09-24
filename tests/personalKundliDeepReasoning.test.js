'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { QUERY_INTENTS } = require('../utils/queryRouter');
const { buildOrchestration, PERSONAL_KUNDLI_REASONING_CONTRACT } = require('../utils/dharmaOrchestrator');
const { PERSONAL_KUNDLI_D3_BUILD, classifyPersonalQuestion, buildPersonalKundliReasoningPlan } = require('../utils/personalKundliReasoning');
const { enforceUnverifiedCitationSafety } = require('../utils/aiSafety');
const { enforceCitationPolicy } = require('../utils/scriptureCitationValidator');

function context(area = 'CAREER') {
  return {
    schemaVersion: 'personal-kundli-context-v1', contextType: 'PERSONAL_KUNDLI', selectedArea: area,
    interpretationVersion: 'kundli-k4.1-interpretation-v1', birthTimeCertainty: 'APPROXIMATE',
    precisionWarning: 'Birth time is not exact; time-sensitive chart interpretation may vary.',
    coreFacts: { rashi: 'Vrishabha', lagna: 'Tula', nakshatra: 'Rohini', pada: 2 },
    area: { id: area, status: 'AVAILABLE', summary: 'Work style combines responsive service with knowledge-based guidance.',
      directions: ['Client-responsive work', 'Knowledge and advisory contribution', 'Structured responsibility'],
      strengths: ['Explaining complex subjects clearly'], challenges: ['Taking on too many obligations'],
      evidenceSummary: 'House 10: Karka · Lord: Moon · Occupants: Jupiter · Supported influence: Saturn',
      limitations: ['NO_TIMING_WITHOUT_AUTHORITATIVE_DASHA', 'NO_D9_OR_BHAVA_INTERPRETATION'] },
    structuralEvidence: {
      houses: [{ number: 10, sign: 'Karka', lord: 'Moon', occupants: ['Jupiter'] }],
      relevantPlanets: [{ name: 'Moon', sign: 'Karka', house: 4 }, { name: 'Jupiter', sign: 'Karka', house: 10 }],
      aspects: [{ sourcePlanet: 'Saturn', targetHouse: 10 }],
    },
    availability: { dasha: false, d9: false, bhava: false, transits: false, verifiedScripture: false },
  };
}

test('D3 build and career plan select connected canonical, K3, and K4.1 evidence', () => {
  assert.equal(PERSONAL_KUNDLI_D3_BUILD, 'personal-kundli-v1-d3-deep-reasoning-20260924');
  const plan = buildPersonalKundliReasoningPlan({ question: 'Give me a deep career analysis', context: context() });
  assert.equal(plan.target, 'CAREER');
  assert.equal(plan.questionType, 'DEEP_AREA_ANALYSIS');
  assert.ok(plan.primaryEvidence.some(item => item.source === 'K3_STRUCTURAL_EVIDENCE'));
  assert.ok(plan.primaryEvidence.some(item => item.source === 'K4.1_DETERMINISTIC_INTERPRETATION'));
  assert.ok(plan.supportingEvidence.some(item => item.kind === 'VERIFIED_ASPECT'));
  assert.ok(plan.qualifyingEvidence.some(item => item.kind === 'CHALLENGE'));
  assert.ok(plan.responseRequirements.some(value => /Connect at least two supplied factors/i.test(value)));
  assert.ok(plan.responseRequirements.some(value => /practical meaning/i.test(value)));
});

test('career orchestration requests synthesis rather than placement or occupation lists', () => {
  const result = buildOrchestration({ question: 'Explain my career deeply', forcedIntent: QUERY_INTENTS.PERSONAL_JYOTISH, personalKundli: context(), language: 'english' });
  assert.match(result.promptContext, /PERSONAL KUNDLI REASONING PLAN/);
  assert.match(result.promptContext, /connected synthesis/);
  assert.match(result.promptContext, /do not output a placement inventory/i);
  assert.match(result.promptContext, /practical meaning/i);
  assert.match(result.promptContext, /qualifyingEvidence/);
  assert.match(result.promptContext, /never print the plan/i);
  assert.ok(result.personalReasoningPlan.evidenceChains.length >= 2);
  assert.ok(result.personalReasoningPlan.evidenceChains.some(chain => /Modify the relevant conclusion/.test(chain.purpose)));
});

test('empty-house evidence is descriptive only and cannot authorize negative inference', () => {
  const empty = context();
  empty.structuralEvidence.houses[0].occupants = [];
  empty.structuralEvidence.relevantPlanets = [];
  const result = buildOrchestration({ question: 'Explain my career', forcedIntent: QUERY_INTENTS.PERSONAL_JYOTISH, personalKundli: empty });
  const house = result.personalReasoningPlan.primaryEvidence.find(item => item.kind === 'HOUSE_STRUCTURE');
  assert.equal(house.house, 10);
  assert.equal(house.sign, 'Karka');
  assert.equal(house.lord, 'Moon');
  const serialized = JSON.stringify(result.personalReasoningPlan);
  assert.doesNotMatch(serialized, /"emptyHouse":true|"occupants":\[\]|noOccupants|noPlanets/);
  assert.match(result.promptContext, /never infer weakness, delay, unclear public identity, promotion difficulty/);
  assert.match(result.promptContext, /Empty houses may be described only/);
});

test('positive house occupants remain available to the serialized reasoning plan', () => {
  const positive = context();
  positive.structuralEvidence.houses[0].occupants = ['Mars'];
  positive.structuralEvidence.relevantPlanets = [{ name: 'Mars', sign: 'Karka', house: 10 }];
  const plan = buildPersonalKundliReasoningPlan({ question: 'Explain my career', context: positive });
  const house = plan.primaryEvidence.find(item => item.kind === 'HOUSE_STRUCTURE');
  assert.deepEqual(house.occupants, ['Mars']);
  assert.match(JSON.stringify(plan), /"occupants":\["Mars"\]/);
});

test('profession discipline requires characteristics and illustrative examples, never planet-to-profession leaps', () => {
  const result = buildOrchestration({ question: 'Which career fields suit me?', forcedIntent: QUERY_INTENTS.PERSONAL_JYOTISH, personalKundli: context() });
  assert.match(result.promptContext, /Never jump from planet symbolism to a specific profession/);
  assert.match(result.promptContext, /derive work characteristics/);
  assert.match(result.promptContext, /illustrative examples/);
  assert.match(result.promptContext, /evidence-to-characteristic-to-example link/);
});

test('Job vs Business plan preserves Career context and requires an evidence comparison without timing', () => {
  const plan = buildPersonalKundliReasoningPlan({ question: 'Job or business?', recentMessages: [{ role: 'user', content: 'Explain my career' }], context: context() });
  assert.equal(classifyPersonalQuestion('Job या business?'), 'JOB_VS_BUSINESS');
  assert.equal(plan.target, 'CAREER');
  assert.equal(plan.questionType, 'JOB_VS_BUSINESS');
  assert.ok(plan.responseRequirements.some(value => /JOB SIDE and BUSINESS\/INDEPENDENT SIDE/.test(value)));
  assert.ok(plan.responseRequirements.some(value => /hybrid progression/.test(value)));
  assert.ok(plan.responseRequirements.some(value => /Do not.*age, year, Dasha, or transit/i.test(value)));
});

test('Why plan anchors to the previous Job-vs-Business question and asks for its evidence chain', () => {
  const plan = buildPersonalKundliReasoningPlan({ question: 'क्यों?', recentMessages: [
    { role: 'user', content: 'Job या business?' }, { role: 'assistant', content: 'A bounded previous conclusion.' },
  ], context: context() });
  assert.equal(plan.questionType, 'WHY');
  assert.equal(plan.conversationAnchor, 'Job या business?');
  assert.ok(plan.responseRequirements.some(value => /immediately preceding conclusion/.test(value)));
  assert.ok(plan.responseRequirements.some(value => /do not restart/.test(value)));
});

test('Jupiter follow-up selects only supplied Jupiter evidence and rejects textbook astrology', () => {
  const plan = buildPersonalKundliReasoningPlan({ question: 'Jupiter इसमें क्या role निभाता है?', recentMessages: [{ role: 'user', content: 'क्यों?' }], context: context() });
  assert.equal(plan.questionType, 'JUPITER_ROLE');
  assert.ok(plan.primaryEvidence.length > 0);
  assert.ok([...plan.primaryEvidence, ...plan.supportingEvidence].every(item => /jupiter|गुरु|बृहस्पति/iu.test(JSON.stringify(item))));
  assert.ok(plan.responseRequirements.some(value => /preceding conclusion/.test(value)));
  assert.ok(plan.responseRequirements.some(value => /generic textbook description/.test(value)));
});

test('career-fields plan derives work characteristics before a small role-family mapping', () => {
  const plan = buildPersonalKundliReasoningPlan({ question: 'Which career fields suit me?', context: context() });
  assert.equal(plan.questionType, 'CAREER_FIELDS');
  assert.ok(plan.responseRequirements.some(value => /work characteristics first/.test(value)));
  assert.ok(plan.responseRequirements.some(value => /small number of example role families/.test(value)));
});

test('exact-year plan exposes missing timing evidence and forbids invention', () => {
  const plan = buildPersonalKundliReasoningPlan({ question: 'Which exact year will bring career success?', context: context() });
  assert.equal(plan.questionType, 'TIMING');
  assert.ok(plan.unavailableEvidence.includes('DASHA'));
  assert.ok(plan.unavailableEvidence.includes('TRANSITS'));
  assert.ok(plan.responseRequirements.some(value => /does not establish an exact year/.test(value)));
  assert.ok(plan.responseRequirements.some(value => /Do not derive a year, age, Mahadasha, Antardasha, or transit/.test(value)));
});

test('missing Dasha, D9, and Bhava remain explicit hard boundaries', () => {
  const prompt = buildOrchestration({ question: 'Explain my career', forcedIntent: QUERY_INTENTS.PERSONAL_JYOTISH, personalKundli: context() }).promptContext;
  for (const missing of ['DASHA', 'D9', 'BHAVA']) assert.match(prompt, new RegExp(`unavailableEvidence[^]*${missing}`));
  assert.match(PERSONAL_KUNDLI_REASONING_CONTRACT, /availability\.dasha is false/);
  assert.match(PERSONAL_KUNDLI_REASONING_CONTRACT, /availability\.d9 is false/);
  assert.match(PERSONAL_KUNDLI_REASONING_CONTRACT, /availability\.bhava is false/);
});

test('health plan preserves the non-medical contract', () => {
  const plan = buildPersonalKundliReasoningPlan({ question: 'What does this mean for health?', context: context('HEALTH') });
  assert.ok(plan.responseRequirements.some(value => /no diagnosis, disease or medical-risk prediction, or treatment advice/.test(value)));
  assert.match(PERSONAL_KUNDLI_REASONING_CONTRACT, /professional care when relevant/);
});

test('Personal Kundli scripture remains separate and internal placeholders stay hidden', () => {
  const prompt = buildOrchestration({ question: 'Explain my career', forcedIntent: QUERY_INTENTS.PERSONAL_JYOTISH, personalKundli: context() }).promptContext;
  assert.match(prompt, /Exact scripture citations are forbidden/);
  const guarded = enforceCitationPolicy(enforceUnverifiedCitationSafety('Bhagavad Gita 2.47 proves this.', []).text, []);
  assert.doesNotMatch(guarded.text, /\[unverified scripture reference\]|SOURCE NOT VERIFIED/);
  const verified = enforceCitationPolicy(enforceUnverifiedCitationSafety('Bhagavad Gita 2.47', ['Bhagavad Gita 2.47']).text,
    [{ title: 'Bhagavad Gita', chapter: '2', verse: '47' }]);
  assert.equal(verified.citationStatus, 'VALID');
});

test('server grants Personal Jyotish a deeper ceiling without changing provider configuration', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /queryIntent === QUERY_INTENTS\.PERSONAL_JYOTISH \? 1200 : 420/);
  assert.match(server, /chooseOutputBudget\(lastMsg, isFC, queryIntent\)/);
  assert.doesNotMatch(server.slice(server.indexOf('personalAnswerWordLimit') - 100, server.indexOf('personalAnswerWordLimit') + 400), /geminiModel|groqModel/);
});
