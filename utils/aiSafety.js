'use strict';

const INTENT = Object.freeze({ CHECKABLE_CLAIM: 'CHECKABLE_CLAIM', INFORMATION_REQUEST: 'INFORMATION_REQUEST', OPINION: 'OPINION',
  RELIGIOUS_BELIEF_OR_TRADITION: 'RELIGIOUS_BELIEF_OR_TRADITION', PERSONAL_ADVICE: 'PERSONAL_ADVICE', INSUFFICIENT_CONTEXT: 'INSUFFICIENT_CONTEXT' });

function classifyFactCheckIntent(input) {
  const text = String(input || '').normalize('NFC').trim();
  const lower = text.toLocaleLowerCase('en-IN');
  if (!text || /^(?:इसका|उसका|यह|ये|this|that)\s*(?:सच|truth|verify|fact.?check)/iu.test(text)) return INTENT.INSUFFICIENT_CONTEXT;
  if (/(?:मेरे लिए|मुझे क्या|मेरी कुंडली|should i|for me|personal advice)/iu.test(text)) return INTENT.PERSONAL_ADVICE;
  if (/(?:आपके विचार|क्या (?:आपको )?लगता|राय|opinion|do you think)/iu.test(text)) return INTENT.OPINION;
  if (/(?:राम|कृष्ण|शिव|देवी|विष्णु).*(?:भगवान|ईश्वर|अवतार)|religious belief|आस्था|धार्मिक परंपरा/iu.test(text)) return INTENT.RELIGIOUS_BELIEF_OR_TRADITION;
  const question = /[?？]$/.test(text) || /^(?:क्या|कौन|कब|कहाँ|क्यों|कैसे|बताइए|बताएं|समझाइए|what|who|when|where|why|how|tell me|explain)(?:\s|$)/iu.test(text);
  const informational = /(?:महत्व|विधि|के बारे में|क्या कहा|meaning|importance|procedure|about)/iu.test(text);
  if (question || informational) return INTENT.INFORMATION_REQUEST;
  if (text.length < 12 || /^(?:सच|झूठ|true|false)$/iu.test(lower)) return INTENT.INSUFFICIENT_CONTEXT;
  return INTENT.CHECKABLE_CLAIM;
}

function classifyClaimType(input) {
  const text = String(input || '').normalize('NFC');
  if (/(?:patent|पेटेंट|US\s*\d{5,})/iu.test(text)) return 'PATENT';
  if (/(?:rigveda|ऋग्वेद|gita|गीता|manusmriti|मनुस्मृति|upanishad|उपनिषद|ramayana|रामायण)/iu.test(text)) return 'SCRIPTURE';
  if (/(?:study|research|scientific|विज्ञान|वैज्ञानिक|cancer|cure|इलाज)/iu.test(text)) return 'SCIENTIFIC';
  if (/(?:court|law|legal|सरकार|government|कानून)/iu.test(text)) return 'GOVERNMENT_OR_LEGAL';
  if (/(?:history|historical|इतिहास|ऐतिहासिक|archaeolog)/iu.test(text)) return 'HISTORICAL';
  if (/(?:today|latest|current news|आज की खबर|ताज़ा|वर्तमान समाचार)/iu.test(text)) return 'CURRENT_NEWS';
  return 'GENERAL';
}

function normalizeMarkdown(input) {
  return String(input || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/^\s*#{1,6}\s*$/gm, '')
    .replace(/^\s*---+\s*$/gm, '---').replace(/\*\*([^*\n]+)$/gm, '$1').replace(/(^|[^*])\*([^*\n]+)$/gm, '$1$2')
    .replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tableCells(line) {
  return String(line || '').trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function sanitizeMarkdownTables(input) {
  const lines = String(input || '').split('\n');
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const divider = lines[index + 1];
    const isDivider = divider && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(divider);
    if (!header.includes('|') || !isDivider) {
      output.push(header); continue;
    }
    const headings = tableCells(header);
    index += 1;
    let rowCount = 0;
    while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
      const cells = tableCells(lines[index + 1]);
      const parts = cells.map((cell, cellIndex) => headings[cellIndex]
        ? `${headings[cellIndex]}: ${cell}` : cell).filter(Boolean);
      if (parts.length) output.push(`- ${parts.join(' · ')}`);
      rowCount += 1; index += 1;
    }
    if (!rowCount) output.push(headings.filter(Boolean).join(' · '));
  }
  return output.join('\n');
}

function sanitizeDharmaChatOutput(input) {
  const withoutPresentationHtml = String(input || '').normalize('NFC')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<(?:p|div|section|article|h[1-6])(?:\s[^>]*)?>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li)>/giu, '\n')
    .replace(/<li(?:\s[^>]*)?>/giu, '- ')
    .replace(/<\/?(?:span|strong|b|em|i|u|ul|ol)(?:\s[^>]*)?>/giu, '');
  return normalizeMarkdown(sanitizeMarkdownTables(withoutPresentationHtml));
}

const CITATION_PATTERN = /(?:(?:\b(?:Bhagavad\s+Gita|Gita|Rigveda|Rig\s+Veda|Manusmriti|Chandogya\s+Upanishad|Ramayana)|(?:भगवद्गीता|गीता|ऋग्वेद|मनुस्मृति|छान्दोग्य उपनिषद|रामायण))\s+\d+(?:\.\d+){1,2}\b|\bChapter\s+(?:\d+|[IVXLCDM]+)\s*(?:,|:|-)?\s*Verse\s+(?:\d+|[IVXLCDM]+)\b|अध्याय\s+\d+\s*(?:,|:|-)?\s*(?:श्लोक|मंत्र)\s+\d+)/giu;
const findScriptureCitations = text => [...new Set(String(text || '').match(CITATION_PATTERN) || [])];
function enforceUnverifiedCitationSafety(text, verifiedCitations = []) {
  const allowed = new Set(verifiedCitations.map(value => String(value).toLocaleLowerCase('en-IN')));
  const unverified = findScriptureCitations(text).filter(ref => !allowed.has(ref.toLocaleLowerCase('en-IN')));
  if (!unverified.length) return { text: normalizeMarkdown(text), unverified };
  const cleaned = normalizeMarkdown(String(text).replace(CITATION_PATTERN, ref => {
    if (allowed.has(ref.toLocaleLowerCase('en-IN'))) return ref;
    return /[\u0900-\u097F]/u.test(ref) ? 'उल्लेखित शास्त्रीय संदर्भ' : 'the cited scripture reference';
  }));
  return { text: `${cleaned}\n\nइस संदर्भ की पुष्टि उपलब्ध विश्वसनीय स्रोत से नहीं हो सकी।`, unverified };
}

module.exports = { INTENT, classifyFactCheckIntent, classifyClaimType, normalizeMarkdown, sanitizeDharmaChatOutput, findScriptureCitations, enforceUnverifiedCitationSafety };
