'use strict';

function isTokenLimitStop(provider, finishReason) {
  const reason = String(finishReason || '').toUpperCase();
  return provider === 'gemini' ? reason === 'MAX_TOKENS' : reason === 'LENGTH';
}

function likelyIncompleteEnding(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/(?:\.\.\.|…|:|：|[-–—]|\*\*|\*)$/.test(value)) return true;
  if (/(?:और|लेकिन|क्योंकि|तथा|या|and|but|because|or)$/i.test(value)) return true;
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']];
  if (pairs.some(([open, close]) => (value.split(open).length - 1) > (value.split(close).length - 1))) return true;
  if ((value.match(/\*\*/g) || []).length % 2 !== 0) return true;
  const lastLine = value.split('\n').pop().trim();
  if (/^(?:[-•*]|\d+\.)\s*$/.test(lastLine) || /^#{1,6}\s*$/.test(lastLine)) return true;
  return false;
}

function mergeWithoutDuplicateOverlap(firstPart, continuation) {
  const first = String(firstPart || '').trimEnd();
  const next = String(continuation || '').trimStart();
  const max = Math.min(240, first.length, next.length);
  let overlap = 0;
  for (let size = max; size >= 12; size--) {
    if (first.slice(-size).toLocaleLowerCase() === next.slice(0, size).toLocaleLowerCase()) {
      overlap = size;
      break;
    }
  }
  const tail = next.slice(overlap).trimStart();
  const separator = first && tail ? (/[.!?।॥:]$/.test(first) ? '\n\n' : ' ') : '';
  return `${first}${separator}${tail}`.trim();
}

async function completeProviderAnswer(initial, continueOnce) {
  if (!isTokenLimitStop(initial.usedApi, initial.finishReason)) {
    return { ...initial, text: String(initial.text || '').trim(), continuationAttempted: false, continuationMs: 0 };
  }
  const startedAt = Date.now();
  const next = await continueOnce(initial);
  const merged = mergeWithoutDuplicateOverlap(initial.text, next.text);
  if (isTokenLimitStop(next.usedApi, next.finishReason) || likelyIncompleteEnding(merged)) {
    const error = new Error('Automatic continuation did not produce a complete answer');
    error.code = 'AI_INCOMPLETE_RESPONSE';
    throw error;
  }
  return {
    ...initial,
    text: merged,
    finishReason: next.finishReason,
    truncated: false,
    continuationAttempted: true,
    continuationMs: Date.now() - startedAt,
  };
}

function chooseOutputBudget(question, isFactCheck) {
  const text = String(question || '');
  if (isFactCheck) return 700;
  const deep = text.length > 180 || /(विस्तार|शास्त्र|उपनिषद|वेद|मनुस्मृति|रामायण|महाभारत|explain deeply|scripture|philosophy)/i.test(text);
  return deep ? 1200 : 850;
}

module.exports = { isTokenLimitStop, likelyIncompleteEnding, mergeWithoutDuplicateOverlap, completeProviderAnswer, chooseOutputBudget };
