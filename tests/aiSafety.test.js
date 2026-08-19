'use strict';
const assert = require('node:assert/strict');
const { INTENT, classifyFactCheckIntent, classifyClaimType, normalizeMarkdown, enforceUnverifiedCitationSafety } = require('../utils/aiSafety');

const cases = [
  ['America patented cow urine.', INTENT.CHECKABLE_CLAIM],
  ['एकादशी व्रत का महत्व बताएं', INTENT.INFORMATION_REQUEST],
  ['राम भगवान हैं', INTENT.RELIGIOUS_BELIEF_OR_TRADITION],
  ['Tell me about Lord Rama', INTENT.INFORMATION_REQUEST],
  ['मेरे लिए कौन सा व्रत उचित है?', INTENT.PERSONAL_ADVICE],
  ['क्या आपको लगता है कि यह सही है?', INTENT.OPINION],
  ['इसका सच बताओ', INTENT.INSUFFICIENT_CONTEXT],
  ['Rigveda 3.62.12 says cow is amrita', INTENT.CHECKABLE_CLAIM],
  ['Bhagavad Gita 4.13 says caste is purely birth based', INTENT.CHECKABLE_CLAIM],
  ['Manusmriti says Hindus should eat meat', INTENT.CHECKABLE_CLAIM],
  ['US99999999 proves cow urine cures cancer', INTENT.CHECKABLE_CLAIM],
];
for (const [input, expected] of cases) assert.equal(classifyFactCheckIntent(input), expected, input);
assert.equal(classifyClaimType('US99999999 proves cow urine cures cancer'), 'PATENT');
assert.equal(classifyClaimType('Rigveda 3.62.12 says cow is amrita'), 'SCRIPTURE');
assert.equal(classifyClaimType('Manusmriti says Hindus should eat meat'), 'SCRIPTURE');
assert.equal(classifyClaimType('historical evidence about Rama'), 'HISTORICAL');
assert.equal(classifyClaimType('आज की खबर क्या है'), 'CURRENT_NEWS');
for (const value of Object.values(INTENT)) assert.match(value, /^(CHECKABLE_CLAIM|INFORMATION_REQUEST|OPINION|RELIGIOUS_BELIEF_OR_TRADITION|PERSONAL_ADVICE|INSUFFICIENT_CONTEXT)$/);
assert.equal(normalizeMarkdown('###\n\n\n**open'), 'open');
const guarded = enforceUnverifiedCitationSafety('Rigveda 3.62.12 supports this claim.');
assert.equal(guarded.unverified[0], 'Rigveda 3.62.12');
assert.match(guarded.text, /पुष्टि उपलब्ध विश्वसनीय स्रोत से नहीं हो सकी/);
console.log('aiSafety regression tests: PASS');
