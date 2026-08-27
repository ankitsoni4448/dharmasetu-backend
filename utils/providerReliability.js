'use strict';

const RETRYABLE_PROVIDER_FAILURES = new Set([
  'PROVIDER_TIMEOUT', 'RATE_LIMIT', 'NETWORK_ERROR', 'HTTP_5XX', 'EMPTY_RESPONSE',
  'MODEL_NOT_FOUND', 'MODEL_DEPRECATED', 'INVALID_API_KEY',
]);

function estimatePromptTokens(prompt) {
  return Math.ceil(String(prompt || '').length / 4);
}

function isFastConversationalQuery(question, mode = 'dharma') {
  if (mode === 'factcheck') return false;
  return /^(?:hi+|hello|hey|namaste|namaskar|dhanyavaad|dhanyavad|thanks?|thank you|who are you|नमस्ते|नमस्कार|प्रणाम|धन्यवाद)[?!. ]*$/iu
    .test(String(question || '').normalize('NFC').trim());
}

function providerGenerationLimit(visibleOutputTokens, provider) {
  const requested = Math.max(64, Number(visibleOutputTokens) || 700);
  const reasoningAllowance = provider === 'gemini' ? 1024 : 512;
  return Math.min(4096, requested + reasoningAllowance);
}

function canFallback(category) {
  return RETRYABLE_PROVIDER_FAILURES.has(category);
}

async function runProviderFallback({ geminiKey, groqKey, prompt, options = {}, callGemini, callGroq, models, onFailure = () => {} }) {
  const failures = [];
  const primaryTimeoutMs = options.primaryTimeoutMs ?? options.timeoutMs ?? 20000;
  const fallbackTimeoutMs = options.fallbackTimeoutMs ?? options.timeoutMs ?? 10000;
  const providerOptions = { ...options };
  delete providerOptions.primaryTimeoutMs;
  delete providerOptions.fallbackTimeoutMs;
  delete providerOptions.timeoutMs;

  if (geminiKey) {
    try {
      return { ...await callGemini(geminiKey, prompt, { ...providerOptions, timeoutMs: primaryTimeoutMs }), usedApi: 'gemini' };
    } catch (error) {
      failures.push(error); onFailure(error, models.gemini, primaryTimeoutMs);
      if (!canFallback(error.category)) throw Object.assign(error, { failures });
    }
  }
  if (groqKey) {
    try {
      return { ...await callGroq(groqKey, prompt, { ...providerOptions, timeoutMs: fallbackTimeoutMs }), usedApi: 'groq' };
    } catch (error) {
      failures.push(error); onFailure(error, models.groq, fallbackTimeoutMs);
    }
  }

  const categories = failures.map(error => error.category || 'NETWORK_ERROR');
  const error = new Error('AI provider request failed');
  error.failures = failures.map(failure => ({ provider: failure.provider, category: failure.category || 'NETWORK_ERROR', status: failure.status || 0 }));
  if (!geminiKey && !groqKey || categories.length && categories.every(category => ['INVALID_API_KEY', 'MODEL_NOT_FOUND', 'MODEL_DEPRECATED'].includes(category))) {
    error.code = 'AI_PROVIDER_CONFIGURATION_ERROR';
  } else if (categories.length && categories.every(category => category === 'RATE_LIMIT')) {
    error.code = 'AI_PROVIDER_RATE_LIMIT';
  } else if (categories.length && categories.every(category => category === 'PROVIDER_TIMEOUT')) {
    error.code = 'AI_TIMEOUT';
  } else {
    error.code = 'AI_PROVIDER_UNAVAILABLE';
  }
  throw error;
}

module.exports = { RETRYABLE_PROVIDER_FAILURES, estimatePromptTokens, isFastConversationalQuery,
  providerGenerationLimit, canFallback, runProviderFallback };
