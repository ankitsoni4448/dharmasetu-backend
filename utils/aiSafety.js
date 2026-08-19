'use strict';

const INTENT = Object.freeze({
  CHECKABLE_CLAIM: 'CHECKABLE_CLAIM',
  INFORMATION_REQUEST: 'INFORMATION_REQUEST',
  OPINION: 'OPINION',
  RELIGIOUS_BELIEF_OR_TRADITION: 'RELIGIOUS_BELIEF_OR_TRADITION',
  PERSONAL_ADVICE: 'PERSONAL_ADVICE',
  INSUFFICIENT_CONTEXT: 'INSUFFICIENT_CONTEXT',
});

function classifyFactCheckIntent(input) {
  const text = String(input || '').trim();
  const lower = text.toLowerCase();
  if (!text || /^(इसका|उसका|यह|ये|this|that)\s*(सच|truth|verify|fact.?check)/i.test(text)) return INTENT.INSUFFICIENT_CONTEXT;
  if (/(मेरे लिए|मुझे क्या|मेरी कुंडली|should i|for me|personal advice)/i.test(text)) return INTENT.PERSONAL_ADVICE;
  if (/(आपके विचार|क्या (?:आपको )?लगता|राय|opinion|do you think)/i.test(text)) return INTENT.OPINION;
  if (/^(राम|कृष्ण|शिव|देवी|विष्णु).*(भगवान|ईश्वर|अवतार)|religious belief|आस्था|परंपरा/i.test(text)) return INTENT.RELIGIOUS_BELIEF_OR_TRADITION;
  const question = /[?？]$/.test(text) || /^(क्या|कौन|कब|कहाँ|क्यों|कैसे|बताइए|बताएं|समझाइए|what|who|when|where|why|how|tell me|explain)\b/i.test(text);
  const informational = /(महत्व|विधि|के बारे में|क्या कहा|meaning|importance|procedure|about)/i.test(text);
  if (question || informational) return INTENT.INFORMATION_REQUEST;
  if (text.length < 12 || /^(सच|झूठ|true|false)$/i.test(lower)) return INTENT.INSUFFICIENT_CONTEXT;
  return INTENT.CHECKABLE_CLAIM;
}

function classifyClaimType(input) {
  const text = String(input || '');
  if (/(patent|पेटेंट|US\s*\d{5,})/i.test(text)) return 'PATENT';
  if (/(rigveda|ऋग्वेद|gita|गीता|manusmriti|मनुस्मृति|upanishad|उपनिषद|ramayana|रामायण)/i.test(text)) return 'SCRIPTURE';
  if (/(study|research|scientific|विज्ञान|cancer|cure|इलाज)/i.test(text)) return 'SCIENTIFIC';
  if (/(court|law|legal|सरकार|government|कानून)/i.test(text)) return 'GOVERNMENT_OR_LEGAL';
  if (/(history|historical|इतिहास|ऐतिहासिक|archaeolog)/i.test(text)) return 'HISTORICAL';
  if (/(today|latest|current news|आज की खबर|ताज़ा|वर्तमान समाचार)/i.test(text)) return 'CURRENT_NEWS';
  return 'GENERAL';
}

function normalizeMarkdown(input) {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*#{1,6}\s*$/gm, '')
    .replace(/^\s*---+\s*$/gm, '---')
    .replace(/\*\*([^*\n]+)$/gm, '$1')
    .replace(/(^|[^*])\*([^*\n]+)$/gm, '$1$2')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CITATION_PATTERN = /(?:\b(?:Bhagavad\s+Gita|Gita|Rigveda|Manusmriti|Chandogya\s+Upanishad|Ramayana)|(?:भगवद्गीता|गीता|ऋग्वेद|मनुस्मृति|छान्दोग्य उपनिषद|रामायण))\s+\d+(?:\.\d+){1,2}\b/gi;

function findScriptureCitations(text) {
  return [...new Set(String(text || '').match(CITATION_PATTERN) || [])];
}

function enforceUnverifiedCitationSafety(text, verifiedCitations = []) {
  const allowed = new Set(verifiedCitations.map(v => v.toLowerCase()));
  const unverified = findScriptureCitations(text).filter(ref => !allowed.has(ref.toLowerCase()));
  if (!unverified.length) return { text: normalizeMarkdown(text), unverified };
  const cleaned = normalizeMarkdown(String(text).replace(CITATION_PATTERN, '[unverified scripture reference]'));
  return {
    text: `${cleaned}\n\nइस संदर्भ की पुष्टि उपलब्ध विश्वसनीय स्रोत से नहीं हो सकी।`,
    unverified,
  };
}

module.exports = { INTENT, classifyFactCheckIntent, classifyClaimType, normalizeMarkdown, findScriptureCitations, enforceUnverifiedCitationSafety };
