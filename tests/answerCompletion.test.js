'use strict';
const assert = require('node:assert/strict');
const { completeProviderAnswer, mergeWithoutDuplicateOverlap, likelyIncompleteEnding, chooseOutputBudget } = require('../utils/answerCompletion');

(async () => {
  let calls = 0;
  const stopped = await completeProviderAnswer(
    { text: 'Complete answer.', usedApi: 'gemini', finishReason: 'STOP', truncated: false },
    async () => { calls++; return {}; },
  );
  assert.equal(calls, 0);
  assert.equal(stopped.text, 'Complete answer.');

  const completed = await completeProviderAnswer(
    { text: 'एकादशी व्रत में फल और', usedApi: 'gemini', finishReason: 'MAX_TOKENS', truncated: true },
    async () => { calls++; return { text: 'और सात्त्विक आहार लिया जाता है।', usedApi: 'gemini', finishReason: 'STOP' }; },
  );
  assert.equal(calls, 1);
  assert.equal(completed.continuationAttempted, true);
  assert.match(completed.text, /सात्त्विक आहार लिया जाता है।$/);

  assert.equal(mergeWithoutDuplicateOverlap('First sentence. Shared phrase', 'Shared phrase and finish.'), 'First sentence. Shared phrase and finish.');
  assert.equal(likelyIncompleteEnding('अधूरा उत्तर क्योंकि'), true);
  assert.equal(likelyIncompleteEnding('यह उत्तर पूर्ण है।'), false);
  assert.equal(chooseOutputBudget('Rigveda claim', true), 700);
  assert.equal(chooseOutputBudget('शास्त्र के आधार पर विस्तार से समझाएं', false), 1200);

  let failedCalls = 0;
  await assert.rejects(() => completeProviderAnswer(
    { text: 'Short partial:', usedApi: 'groq', finishReason: 'length', truncated: true },
    async () => { failedCalls++; return { text: 'Still...', usedApi: 'groq', finishReason: 'length' }; },
  ), error => error.code === 'AI_INCOMPLETE_RESPONSE');

  const coherent = 'Love in Dharma is expressed through compassion. It asks us to respect another person without possession. It also grows through truth, patience, and responsible action.';
  const recovered = await completeProviderAnswer(
    { text: coherent, usedApi: 'gemini', finishReason: 'MAX_TOKENS', truncated: true },
    async () => { throw Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT' }); },
  );
  assert.equal(recovered.text, coherent);
  assert.equal(recovered.usableOriginal, true);
  assert.equal(failedCalls, 1);

  let timeoutCalls = 0;
  await assert.rejects(() => completeProviderAnswer(
    { text: 'Partial', usedApi: 'gemini', finishReason: 'MAX_TOKENS', truncated: true },
    async () => { timeoutCalls++; const error = new Error('timeout'); error.code = 'AI_TIMEOUT'; throw error; },
  ), error => error.code === 'AI_TIMEOUT');
  assert.equal(timeoutCalls, 1);
  console.log('answerCompletion regression tests: PASS');
})().catch(error => { console.error(error); process.exit(1); });
