'use strict';

function isTokenLimitStop(provider, finishReason) {
  const reason = String(finishReason || '').toUpperCase();
  return provider === 'gemini' ? reason === 'MAX_TOKENS' : reason === 'LENGTH';
}

function likelyIncompleteEnding(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/(?:\.\.\.|…|[-–—]|\*\*|\*)$/.test(value)) return true;
  if (/(?:और|लेकिन|क्योंकि|तथा|या|and|but|because|or)$/iu.test(value)) return true;
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']];
  if (pairs.some(([open, close]) => (value.split(open).length - 1) > (value.split(close).length - 1))) return true;
  if ((value.match(/\*\*/g) || []).length % 2 !== 0) return true;
  const lastLine = value.split('\n').pop().trim();
  return /^(?:[-•*]|\d+\.)\s*$/.test(lastLine) || /^#{1,6}\s*$/.test(lastLine);
}

function bestCoherentPortion(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (!likelyIncompleteEnding(value)) return value;
  const endings = [...value.matchAll(/[.!?\u0964\u0965](?=\s|$)/g)];
  if (!endings.length) return '';
  return value.slice(0, endings[endings.length - 1].index + 1).trim();
}

function needsContinuation(result) {
  const value = String(result?.text || '').trim();
  return isTokenLimitStop(result?.usedApi, result?.finishReason)
    || (value.length >= 240 && likelyIncompleteEnding(value));
}

function isUsableAnswer(text) {
  const value = String(text || '').trim();
  if (value.length < 40 || likelyIncompleteEnding(value)) return false;
  const sentenceCount = (value.match(/[.!?\u0964\u0965](?:\s|$)/g) || []).length;
  return sentenceCount >= 1 || value.length >= 160;
}

function mergeWithoutDuplicateOverlap(firstPart, continuation) {
  const first = String(firstPart || '').trimEnd();
  const next = String(continuation || '').trimStart();
  const max = Math.min(240, first.length, next.length);
  let overlap = 0;
  for (let size = max; size >= 12; size -= 1) {
    if (first.slice(-size).toLocaleLowerCase() === next.slice(0, size).toLocaleLowerCase()) {
      overlap = size;
      break;
    }
  }
  const tail = next.slice(overlap).trimStart();
  const separator = first && tail ? (/[.!?\u0964\u0965:]$/.test(first) ? '\n\n' : ' ') : '';
  return `${first}${separator}${tail}`.trim();
}

async function completeProviderAnswer(initial, continueOnce) {
  if (!needsContinuation(initial)) {
    return { ...initial, text: String(initial.text || '').trim(), continuationAttempted: false, continuationMs: 0 };
  }
  const startedAt = Date.now();
  let next;
  try {
    next = await continueOnce(initial);
  } catch (error) {
    const coherent = bestCoherentPortion(initial.text);
    if (isUsableAnswer(coherent)) {
      return { ...initial, text: coherent, truncated: true, continuationAttempted: true,
        continuationFailed: true, usableOriginal: true, continuationMs: Date.now() - startedAt };
    }
    throw error;
  }
  const merged = mergeWithoutDuplicateOverlap(initial.text, next.text);
  if (needsContinuation({ ...next, text: merged })) {
    const coherent = bestCoherentPortion(merged);
    if (isUsableAnswer(coherent)) {
      return { ...initial, text: coherent, truncated: true, continuationAttempted: true,
        continuationFailed: true, usableOriginal: true, continuationMs: Date.now() - startedAt };
    }
    const error = new Error('Automatic continuation did not produce a coherent answer');
    error.code = 'AI_INCOMPLETE_RESPONSE';
    throw error;
  }
  return { ...initial, text: merged, finishReason: next.finishReason, truncated: false,
    continuationAttempted: true, continuationMs: Date.now() - startedAt };
}

function chooseOutputBudget(question, isFactCheck, intent = '') {
  const text = String(question || '');
  if (isFactCheck) return 700;
  if (/^(?:hi+|hello|hey|namaste|नमस्ते|प्रणाम)[!. ]*$/iu.test(text.trim())) return 180;
  if (intent === 'PERSONAL_JYOTISH') return /(?:विस्तार|गहराई|detail|deep|complete|पूरा)/iu.test(text) ? 1400 : 1100;
  if (intent === 'SCRIPTURE') return 1000;
  const deep = text.length > 180 || /(?:विस्तार|शास्त्र|उपनिषद|वेद|मनुस्मृति|रामायण|महाभारत|explain deeply|scripture|philosophy)/iu.test(text);
  return deep ? 1100 : 700;
}

module.exports = { isTokenLimitStop, likelyIncompleteEnding, bestCoherentPortion, needsContinuation,
  isUsableAnswer, mergeWithoutDuplicateOverlap, completeProviderAnswer, chooseOutputBudget };
