'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimatePromptTokens, isFastConversationalQuery, providerGenerationLimit, canFallback, runProviderFallback } = require('../utils/providerReliability');

const base = { geminiKey: 'configured', groqKey: 'configured', prompt: 'x'.repeat(800),
  models: { gemini: 'gemini-test', groq: 'groq-test' }, onFailure: () => {} };

test('slow-but-successful Gemini does not call Groq', async () => {
  let groqCalls = 0;
  const result = await runProviderFallback({ ...base,
    callGemini: async () => ({ text: 'Complete.', finishReason: 'STOP' }),
    callGroq: async () => { groqCalls += 1; return {}; } });
  assert.equal(result.usedApi, 'gemini'); assert.equal(groqCalls, 0);
});

test('Gemini timeout falls back once to Groq', async () => {
  const result = await runProviderFallback({ ...base,
    callGemini: async () => { throw Object.assign(new Error('timeout'), { provider: 'Gemini', category: 'PROVIDER_TIMEOUT' }); },
    callGroq: async () => ({ text: 'Fallback complete.', finishReason: 'stop' }) });
  assert.equal(result.usedApi, 'groq');
});

test('provider-local Gemini error falls back to Groq', async () => {
  const result = await runProviderFallback({ ...base,
    callGemini: async () => { throw Object.assign(new Error('model'), { provider: 'Gemini', category: 'MODEL_NOT_FOUND', status: 404 }); },
    callGroq: async () => ({ text: 'Fallback complete.', finishReason: 'stop' }) });
  assert.equal(result.usedApi, 'groq');
});

test('safety and context failures do not get resent to another provider', async () => {
  for (const category of ['SAFETY_BLOCK', 'CONTEXT_LIMIT', 'HTTP_4XX']) {
    let groqCalls = 0;
    await assert.rejects(() => runProviderFallback({ ...base,
      callGemini: async () => { throw Object.assign(new Error(category), { provider: 'Gemini', category }); },
      callGroq: async () => { groqCalls += 1; return {}; } }), error => error.category === category);
    assert.equal(groqCalls, 0);
  }
});

test('both-provider failure retains safe categories', async () => {
  await assert.rejects(() => runProviderFallback({ ...base,
    callGemini: async () => { throw Object.assign(new Error('timeout'), { provider: 'Gemini', category: 'PROVIDER_TIMEOUT' }); },
    callGroq: async () => { throw Object.assign(new Error('limited'), { provider: 'Groq', category: 'RATE_LIMIT', status: 429 }); } }), error => {
    assert.equal(error.code, 'AI_PROVIDER_UNAVAILABLE');
    assert.deepEqual(error.failures.map(item => item.category), ['PROVIDER_TIMEOUT', 'RATE_LIMIT']);
    return true;
  });
});

test('fast-path and prompt budgets are bounded', () => {
  assert.equal(isFastConversationalQuery('Namaste'), true);
  assert.equal(isFastConversationalQuery('Who are you?'), true);
  assert.equal(isFastConversationalQuery('गीता में कर्म क्या है?'), false);
  assert.equal(isFastConversationalQuery('Hello', 'factcheck'), false);
  assert.equal(estimatePromptTokens('x'.repeat(801)), 201);
  assert.equal(providerGenerationLimit(700, 'gemini'), 1724);
  assert.equal(providerGenerationLimit(700, 'groq'), 1212);
  assert.equal(canFallback('PROVIDER_TIMEOUT'), true);
  assert.equal(canFallback('SAFETY_BLOCK'), false);
});
