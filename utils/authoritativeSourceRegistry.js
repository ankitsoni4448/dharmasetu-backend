'use strict';

const CONFIG = Object.freeze({
  PATENT: ['FACTCHECK_PATENT_PROVIDER_URL', 'FACTCHECK_PATENT_PROVIDER_TOKEN', 'AUTHORITATIVE_PATENT_REGISTRY'],
  SCIENTIFIC: ['FACTCHECK_SCIENCE_PROVIDER_URL', 'FACTCHECK_SCIENCE_PROVIDER_TOKEN', 'PEER_REVIEWED_SCIENCE'],
  CURRENT_NEWS: ['FACTCHECK_CURRENT_PROVIDER_URL', 'FACTCHECK_CURRENT_PROVIDER_TOKEN', 'AUTHORITATIVE_CURRENT_SOURCE'],
  CURRENT_FACT: ['FACTCHECK_CURRENT_PROVIDER_URL', 'FACTCHECK_CURRENT_PROVIDER_TOKEN', 'AUTHORITATIVE_CURRENT_SOURCE'],
});

function providerConfiguration(category, env = process.env) {
  const row = CONFIG[category]; if (!row) return null;
  const [urlKey, tokenKey, knowledgeClass] = row;
  const url = env[urlKey] || ''; const token = env[tokenKey] || '';
  return { configured: Boolean(url && token), url, token, knowledgeClass, urlKey, tokenKey };
}

async function retrieveAuthoritativeEvidence(category, query, { env = process.env, timeoutMs = 5000 } = {}) {
  const config = providerConfiguration(category, env);
  if (!config?.configured) return { configured: false, evidence: [], status: 'SOURCE_PROVIDER_NOT_CONFIGURED' };
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1000), 10000));
  try {
    const response = await fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ query: String(query).slice(0, 1000), limit: 5 }), signal: controller.signal });
    if (!response.ok) return { configured: true, evidence: [], status: 'SOURCE_PROVIDER_FAILED' };
    const body = await response.json();
    const evidence = (Array.isArray(body.results) ? body.results : []).slice(0, 5).filter(item => item?.title && /^https:\/\//i.test(item?.url || '')).map(item => ({
      title: String(item.title).slice(0, 300), url: String(item.url).slice(0, 1000), excerpt: String(item.excerpt || '').slice(0, 1500),
      publisher: String(item.publisher || '').slice(0, 200) || null, publishedAt: item.publishedAt || null,
      knowledge_class: config.knowledgeClass, verification_status: 'VERIFIED',
    }));
    return { configured: true, evidence, status: evidence.length ? 'EVIDENCE_AVAILABLE' : 'SOURCE_NOT_VERIFIED' };
  } catch (error) { return { configured: true, evidence: [], status: error.name === 'AbortError' ? 'SOURCE_PROVIDER_TIMEOUT' : 'SOURCE_PROVIDER_FAILED' }; }
  finally { clearTimeout(timeout); }
}

module.exports = { CONFIG, providerConfiguration, retrieveAuthoritativeEvidence };
