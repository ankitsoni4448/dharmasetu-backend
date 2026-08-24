'use strict';

const CITATION_PATTERN = /\b(Bhagavad\s+Gita|Gita|Rigveda|Rig\s+Veda|Manusmriti|Chandogya\s+Upanishad)\s+(\d+)\.(\d+)(?:\.(\d+))?/giu;
function canonicalWork(value) {
  const key = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (key === 'gita' || key === 'bhagavad gita') return 'bhagavad gita';
  if (key === 'rig veda' || key === 'rigveda') return 'rigveda';
  return key;
}
function extractCitations(text) {
  return [...String(text || '').matchAll(CITATION_PATTERN)].map(match => ({ raw: match[0], work: canonicalWork(match[1]), chapter: match[2], verse: match[4] ? `${match[3]}.${match[4]}` : match[3] }));
}
const citationKey = value => `${canonicalWork(value.title)}|${String(value.chapter || '')}|${String(value.verse || '')}`;
function validateCitations(answer, evidence = []) {
  const citations = extractCitations(answer); const allowed = new Set(evidence.map(citationKey));
  const invalid = citations.filter(item => !allowed.has(citationKey({ title: item.work, chapter: item.chapter, verse: item.verse })));
  return { valid: invalid.length === 0, citations, invalid };
}
function enforceCitationPolicy(answer, evidence = []) {
  const result = validateCitations(answer, evidence);
  if (result.valid) return { text: String(answer || ''), citations: result.citations, citationStatus: 'VALID' };
  let text = String(answer || '');
  for (const item of result.invalid) text = text.replaceAll(item.raw, `${item.raw} (SOURCE NOT VERIFIED)`);
  return { text, citations: result.citations.filter(item => !result.invalid.includes(item)), citationStatus: 'SOURCE_NOT_VERIFIED' };
}
module.exports = { CITATION_PATTERN, canonicalWork, extractCitations, validateCitations, enforceCitationPolicy };
