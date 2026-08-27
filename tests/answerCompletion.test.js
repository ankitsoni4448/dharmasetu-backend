'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { completeProviderAnswer, mergeWithoutDuplicateOverlap, likelyIncompleteEnding, needsContinuation, chooseOutputBudget } = require('../utils/answerCompletion');

test('complete response does not trigger continuation', async () => {
  let calls = 0;
  const result = await completeProviderAnswer(
    { text: 'Complete answer.', usedApi: 'gemini', finishReason: 'STOP', truncated: false },
    async () => { calls += 1; return {}; },
  );
  assert.equal(calls, 0);
  assert.equal(result.text, 'Complete answer.');
});

test('token-limited response receives one continuation without duplicate overlap', async () => {
  let calls = 0;
  const result = await completeProviderAnswer(
    { text: 'एकादशी व्रत में फल और', usedApi: 'gemini', finishReason: 'MAX_TOKENS', truncated: true },
    async () => { calls += 1; return { text: 'और सात्त्विक आहार लिया जाता है।', usedApi: 'gemini', finishReason: 'STOP' }; },
  );
  assert.equal(calls, 1);
  assert.match(result.text, /सात्त्विक आहार लिया जाता है।$/);
  assert.equal(mergeWithoutDuplicateOverlap('First sentence. Shared phrase', 'Shared phrase and finish.'), 'First sentence. Shared phrase and finish.');
});

test('completion detection handles Hindi, Markdown, lists, and heuristic truncation', () => {
  assert.equal(likelyIncompleteEnding('अधूरा उत्तर क्योंकि'), true);
  assert.equal(likelyIncompleteEnding('यह उत्तर पूर्ण है।'), false);
  assert.equal(needsContinuation({ text: '**मुख्य बात**\n\n- पहला बिंदु।\n- दूसरा बिंदु।', usedApi: 'gemini', finishReason: 'STOP' }), false);
  assert.equal(needsContinuation({ text: 'यह विस्तृत उत्तर अभी अधूरा है क्योंकि '.repeat(12), usedApi: 'gemini', finishReason: 'STOP' }), true);
});

test('continuation failure returns only a coherent usable original', async () => {
  const coherent = 'Love in Dharma is expressed through compassion. It asks us to respect another person without possession. It also grows through truth, patience, and responsible action.';
  const result = await completeProviderAnswer(
    { text: coherent, usedApi: 'gemini', finishReason: 'MAX_TOKENS', truncated: true },
    async () => { throw Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT' }); },
  );
  assert.equal(result.text, coherent);
  assert.equal(result.usableOriginal, true);
});

test('concise coherent answer is preserved when continuation is unavailable', async () => {
  const concise = 'धर्म का सरल आधार सत्य, करुणा और उत्तरदायित्व है।';
  const result = await completeProviderAnswer(
    { text: concise, usedApi: 'gemini', finishReason: 'MAX_TOKENS', truncated: true },
    async () => { throw Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT' }); },
  );
  assert.equal(result.text, concise);
  assert.equal(result.usableOriginal, true);
});

test('unusable continuation failure remains an explicit failure', async () => {
  await assert.rejects(() => completeProviderAnswer(
    { text: 'Partial', usedApi: 'gemini', finishReason: 'MAX_TOKENS', truncated: true },
    async () => { throw Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT' }); },
  ), error => error.code === 'AI_TIMEOUT');
});

test('budgets are intent-aware and bounded', () => {
  assert.equal(chooseOutputBudget('Rigveda claim', true), 700);
  assert.equal(chooseOutputBudget('नमस्ते', false), 180);
  assert.equal(chooseOutputBudget('शास्त्र के आधार पर विस्तार से समझाएं', false), 1100);
  assert.equal(chooseOutputBudget('2027 में मेरा करियर कैसा रहेगा?', false, 'PERSONAL_JYOTISH'), 1100);
});
