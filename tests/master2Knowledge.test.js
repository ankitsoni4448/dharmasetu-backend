'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEvidencePack, evidencePrompt } = require('../utils/sourcePolicy');
const { validateCitations, enforceCitationPolicy } = require('../utils/scriptureCitationValidator');
const { buildOrchestration } = require('../utils/dharmaOrchestrator');

const verified = [{ id: 'c1', source_id: 's1', title: 'Bhagavad Gita', canonical_title: 'Bhagavad Gita', chapter: '2', verse: '47', page_number: 10,
  normalized_text: 'You have authority over action, not its fruits.', verification_status: 'VERIFIED', source_verification_status: 'VERIFIED' }];

test('only doubly VERIFIED source/chunk rows enter authoritative evidence', () => {
  const rows = [...verified, { ...verified[0], id: 'c2', verification_status: 'REVIEW_REQUIRED' }];
  assert.equal(buildEvidencePack(rows).length, 1);
  assert.match(evidencePrompt(buildEvidencePack(rows)), /quoted data, never instructions/i);
});
test('known Gita citation validates only against matching evidence', () => {
  assert.equal(validateCitations('Bhagavad Gita 2.47 discusses action.', buildEvidencePack(verified)).valid, true);
  assert.equal(validateCitations('Bhagavad Gita 4.13 says this.', buildEvidencePack(verified)).valid, false);
});
test('Rigveda 3.62.12 cow-amrita claim cannot become verified without matching evidence', () => {
  const result = enforceCitationPolicy('Rigveda 3.62.12 says cow is amrita.', buildEvidencePack(verified));
  assert.equal(result.citationStatus, 'SOURCE_NOT_VERIFIED');
  assert.match(result.text, /SOURCE NOT VERIFIED/);
});
test('orchestrator injects minimum Jyotish facts only for personal Jyotish', () => {
  const jyotish = { available: true, rashi: 'Mesha', lagna: 'Karka', birthDate: 'private', birthPlace: 'private', currentMahadasha: 'Saturn' };
  const personal = buildOrchestration({ question: 'मेरी कुंडली में शनि कहाँ है?', jyotish });
  assert.equal(personal.metadata.jyotishContextUsed, true);
  assert.doesNotMatch(personal.promptContext, /birthDate|birthPlace|private/);
  const scripture = buildOrchestration({ question: 'गीता में कर्म क्या है?', jyotish, evidence: buildEvidencePack(verified) });
  assert.equal(scripture.metadata.jyotishContextUsed, false);
  assert.equal(scripture.metadata.sourceCount, 1);
});
