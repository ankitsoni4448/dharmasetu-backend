'use strict';

const CLAIM_CATEGORIES = Object.freeze(['SCRIPTURE', 'PATENT', 'SCIENTIFIC', 'CURRENT_NEWS', 'CURRENT_FACT', 'GENERAL_DHARMA']);
const TRUSTED_CLASSES = Object.freeze({
  SCRIPTURE: new Set(['PRIMARY_SCRIPTURE']),
  PATENT: new Set(['AUTHORITATIVE_PATENT_REGISTRY']),
  SCIENTIFIC: new Set(['PEER_REVIEWED_SCIENCE', 'AUTHORITATIVE_SCIENTIFIC_BODY']),
  CURRENT_NEWS: new Set(['AUTHORITATIVE_CURRENT_SOURCE', 'REPUTABLE_NEWS_SOURCE']),
  CURRENT_FACT: new Set(['AUTHORITATIVE_CURRENT_SOURCE']),
  GENERAL_DHARMA: new Set(['PRIMARY_SCRIPTURE', 'TRADITIONAL_COMMENTARY', 'CURATED_EXPLANATION']),
});

function authoritativeEvidence(category, rows, limit = 6) {
  const allowed = TRUSTED_CLASSES[category] || new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row?.verification_status === 'VERIFIED' && allowed.has(row?.knowledge_class))
    .slice(0, Math.max(0, Math.min(Number(limit) || 6, 10)));
}

function verdictForEvidence(category, rows) {
  const evidence = authoritativeEvidence(category, rows);
  return { verdict: evidence.length ? 'EVIDENCE_AVAILABLE' : 'UNVERIFIED', evidence };
}

module.exports = { CLAIM_CATEGORIES, TRUSTED_CLASSES, authoritativeEvidence, verdictForEvidence };
