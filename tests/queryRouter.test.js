'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { QUERY_INTENTS, classifyDharmaQuery } = require('../utils/queryRouter');

const cases = [
  ['गीता में कर्म क्या है?', QUERY_INTENTS.SCRIPTURE],
  ['मेरी कुंडली में शनि कहाँ है?', QUERY_INTENTS.PERSONAL_JYOTISH],
  ['आज का पंचांग बताओ', QUERY_INTENTS.PANCHANG],
  ['एकादशी इस साल कब है?', QUERY_INTENTS.FESTIVAL_CALENDAR],
  ['महामृत्युंजय मंत्र का अर्थ?', QUERY_INTENTS.MANTRA],
  ['गृह प्रवेश की पूजा कैसे करें?', QUERY_INTENTS.RITUAL_PUJA],
  ['America patented cow urine.', QUERY_INTENTS.FACT_CHECK],
  ['तिलक लगाने का वैज्ञानिक कारण क्या है?', QUERY_INTENTS.SCIENCE_AND_DHARMA],
  ['मन अशांत है, क्या करूँ?', QUERY_INTENTS.SPIRITUAL_GUIDANCE],
  ['राम भगवान हैं', QUERY_INTENTS.GENERAL_DHARMA],
];
for (const [question, expected] of cases) test(`${question} -> ${expected}`, () => assert.equal(classifyDharmaQuery(question), expected));

test('new explicit question is not forced into previous intent', () => {
  assert.equal(classifyDharmaQuery('आज का पंचांग बताओ', [{ role: 'user', content: 'गीता 2.47 समझाओ' }]), QUERY_INTENTS.PANCHANG);
});
test('short referential follow-up may inherit the previous user intent', () => {
  assert.equal(classifyDharmaQuery('और इसका अर्थ?', [{ role: 'user', content: 'गीता 2.47 समझाओ' }]), QUERY_INTENTS.SCRIPTURE);
});
test('terse career follow-up retains personal Jyotish context', () => {
  assert.equal(classifyDharmaQuery('करियर?', [{ role: 'user', content: 'मेरी कुंडली में शनि कहाँ है?' }]), QUERY_INTENTS.PERSONAL_JYOTISH);
});
test('year follow-up retains personal Jyotish context', () => {
  assert.equal(classifyDharmaQuery('2027 कैसा रहेगा?', [{ role: 'user', content: 'मेरी कुंडली के अनुसार करियर बताएं' }]), QUERY_INTENTS.PERSONAL_JYOTISH);
});
test('explicit scripture question overrides personal Jyotish history', () => {
  assert.equal(classifyDharmaQuery('गीता 2.47 का अर्थ?', [{ role: 'user', content: 'मेरी कुंडली के अनुसार करियर बताएं' }]), QUERY_INTENTS.SCRIPTURE);
});
