'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildOrchestration } = require('../utils/dharmaOrchestrator');

const readyContext = {
  available: true, preferredName: 'Test User', rashi: 'Mesha', lagna: 'Karka',
  nakshatra: 'Rohini', nakshatraPada: 2, currentMahadasha: 'Guru',
  currentMahadashaEnd: '2029-01-01', birthTimeCertainty: 'EXACT',
  planets: [{ name: 'Saturn', sign: 'Aquarius', house: 8, longitude: 310.2 }],
};

test('only personal Jyotish receives compact personal context', () => {
  const personal = buildOrchestration({ question: 'मेरी कुंडली के अनुसार करियर?', jyotish: readyContext });
  assert.equal(personal.metadata.personalContextUsed, true);
  assert.equal(personal.selected.jyotish.rashi, 'Mesha');
  assert.equal(personal.selected.jyotish.birthDate, undefined);
  const general = buildOrchestration({ question: 'धर्म क्या है?', jyotish: readyContext });
  const scripture = buildOrchestration({ question: 'गीता 2.47 का अर्थ?', jyotish: readyContext });
  assert.equal(general.selected.jyotish, null);
  assert.equal(scripture.selected.jyotish, null);
  assert.doesNotMatch(general.promptContext, /Mesha|Rohini|Test User/);
  assert.doesNotMatch(scripture.promptContext, /Mesha|Rohini|Test User/);
});

test('server resolves Jyotish context from authenticated UUID, never client user id', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /getUserAstrologyContext\(req\.authUser\.id, userRecord\)/);
  assert.match(server, /jyotish_profiles[^\n]+user_id=eq\.\$\{encodeURIComponent\(authUserId\)\}/);
  assert.doesNotMatch(server, /getUserAstrologyContext\(req\.body/);
  assert.match(server, /primaryTimeoutMs:\s*12000/);
  assert.match(server, /fallbackTimeoutMs:\s*10000/);
  assert.match(server, /timeoutMs:\s*8000/);
});

test('timing logs are metadata-only and do not name private birth fields', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const timingLog = server.match(/const logTiming =[\s\S]*?\n\s*\);/)?.[0] || '';
  assert.match(timingLog, /auth=.*profile=.*intent=.*provider=.*total=/s);
  assert.doesNotMatch(timingLog, /phone|dob|birthTime|birthPlace|JWT|prompt/i);
});
