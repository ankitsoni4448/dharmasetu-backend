'use strict';

const BASE_URL = 'https://api.prokerala.com/v2';
const TOKEN_URL = 'https://api.prokerala.com/token';
const LAHIRI_AYANAMSA = 1;
const MODULE_STATE = Object.freeze({ READY: 'READY', UNAVAILABLE: 'UNAVAILABLE', FAILED: 'FAILED', RATE_LIMITED: 'RATE_LIMITED', NOT_APPLICABLE: 'NOT_APPLICABLE', NOT_REQUESTED: 'NOT_REQUESTED' });

const MODULES = Object.freeze({
  panchang: { path: '/astrology/panchang', credits: 10, required: true, type: 'json' },
  panchangAdvanced: { path: '/astrology/panchang/advanced', credits: 100, required: true, type: 'json' },
  birthDetails: { path: '/astrology/birth-details', credits: 50, required: true, type: 'json' },
  basicKundli: { path: '/astrology/kundli', credits: 50, required: true, type: 'json', deep: false },
  advancedKundli: { path: '/astrology/kundli/advanced', credits: 300, required: true, type: 'json' },
  planetPosition: { path: '/astrology/planet-position', credits: 30, required: true, type: 'json',
    query: { planets: '0,1,2,3,4,5,6,100,101,102' } },
  d1: { path: '/astrology/chart', credits: 50, required: true, type: 'svg', chartType: 'rasi' },
  d9: { path: '/astrology/chart', credits: 50, required: false, type: 'svg', chartType: 'navamsa' },
  bhava: { path: '/astrology/chart', credits: 50, required: false, type: 'svg', chartType: 'bhava' },
  kaalSarpDosha: { path: '/astrology/kaal-sarp-dosha', credits: 30, required: false, type: 'json' },
});
const DEEP_MODULE_NAMES = Object.freeze([
  'birthDetails', 'advancedKundli', 'planetPosition', 'd1', 'd9', 'bhava', 'kaalSarpDosha',
]);

class ProkeralaError extends Error {
  constructor(code, status = 0) { super(code); this.name = 'ProkeralaError'; this.code = code; this.status = status; }
}

let tokenCache = { value: null, expiresAt: 0 };
let tokenRequest = null;

function configured(env = process.env) {
  return Boolean(env.PROKERALA_CLIENT_ID && env.PROKERALA_CLIENT_SECRET);
}

function capabilityMap(env = process.env) {
  const state = !configured(env) ? 'UNAVAILABLE'
    : env.PROKERALA_DEEP_KUNDLI_ENABLED === 'true' ? 'LIVE_CAPABILITY_TEST_REQUIRED' : 'LIVE_CAPABILITY_TEST_REQUIRED';
  return Object.fromEntries(Object.keys(MODULES).map(key => [key, state]));
}

function classifyStatus(status) {
  if (status === 401) return 'PROVIDER_AUTH_FAILED';
  if (status === 402 || status === 403) return 'PROVIDER_PLAN_REQUIRED';
  if (status === 429) return 'PROVIDER_RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'MODULE_UNAVAILABLE';
}

async function getToken({ env = process.env, fetchImpl = fetch, signal } = {}) {
  if (!configured(env)) throw new ProkeralaError('PROVIDER_AUTH_FAILED');
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  if (!tokenRequest) tokenRequest = (async () => {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.PROKERALA_CLIENT_ID, client_secret: env.PROKERALA_CLIENT_SECRET }).toString(),
    }).catch(error => { throw new ProkeralaError(error.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE'); });
    if (!response.ok) throw new ProkeralaError(classifyStatus(response.status), response.status);
    const data = await response.json().catch(() => { throw new ProkeralaError('PROVIDER_MALFORMED_RESPONSE', response.status); });
    if (!data.access_token || !Number.isFinite(Number(data.expires_in))) throw new ProkeralaError('PROVIDER_MALFORMED_RESPONSE', response.status);
    tokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    return tokenCache.value;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}

function sanitizeSvg(svg) {
  if (typeof svg !== 'string' || !/^\s*<\?xml|^\s*<svg/i.test(svg) || svg.length > 500_000) throw new ProkeralaError('PROVIDER_MALFORMED_RESPONSE');
  if (/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<(?:iframe|object|embed)\b|\son[a-z]+\s*=|javascript:|data:text\/html|(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|\/\/)|url\(\s*https?:|@import/i.test(svg)) {
    throw new ProkeralaError('PROVIDER_MALFORMED_RESPONSE');
  }
  return svg;
}

function commonParams(input) {
  return {
    ayanamsa: String(LAHIRI_AYANAMSA), coordinates: `${input.latitude},${input.longitude}`,
    datetime: input.datetime, la: 'en',
  };
}

async function requestModule(name, input, options = {}) {
  const module = MODULES[name];
  if (!module) throw new ProkeralaError('MODULE_UNAVAILABLE');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12_000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const token = await getToken({ env: options.env, fetchImpl: options.fetchImpl, signal: controller.signal });
    const params = new URLSearchParams(commonParams(input));
    for (const [key, value] of Object.entries(module.query || {})) params.set(key, value);
    if (module.chartType) {
      params.set('chart_type', module.chartType); params.set('chart_style', 'north-indian'); params.set('format', 'svg');
    }
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(`${BASE_URL}${module.path}?${params}`, {
      signal: controller.signal, headers: { Authorization: `Bearer ${token}`, Accept: module.type === 'svg' ? 'image/svg+xml' : 'application/json' },
    }).catch(error => { throw new ProkeralaError(error.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE'); });
    if (!response.ok) throw new ProkeralaError(classifyStatus(response.status), response.status);
    if (module.type === 'svg') return { format: 'svg', content: sanitizeSvg(await response.text()) };
    const payload = await response.json().catch(() => { throw new ProkeralaError('PROVIDER_MALFORMED_RESPONSE', response.status); });
    if (payload?.status !== 'ok' || payload.data == null) throw new ProkeralaError('PROVIDER_MALFORMED_RESPONSE', response.status);
    return payload.data;
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', abort);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length); let next = 0;
  async function run() { while (next < items.length) { const index = next++; results[index] = await worker(items[index], index); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fetchPrimaryKundli(input, options = {}) {
  const env = options.env || process.env;
  if (env.PROKERALA_DEEP_KUNDLI_ENABLED !== 'true') {
    throw new ProkeralaError('PROVIDER_PLAN_REQUIRED');
  }
  const overall = new AbortController();
  const timer = setTimeout(() => overall.abort(), options.overallTimeoutMs || 30_000);
  const names = DEEP_MODULE_NAMES;
  const moduleStatus = Object.fromEntries(names.map(name => [name, MODULE_STATE.NOT_REQUESTED]));
  const modules = {};
  let rateLimited = false;
  try {
    await mapLimit(names, options.concurrency || 3, async name => {
      if (rateLimited) return;
      try {
        modules[name] = await requestModule(name, input, { ...options, signal: overall.signal });
        moduleStatus[name] = MODULE_STATE.READY;
      } catch (error) {
        if (error.code === 'PROVIDER_RATE_LIMITED') rateLimited = true;
        moduleStatus[name] = error.code === 'PROVIDER_RATE_LIMITED' ? MODULE_STATE.RATE_LIMITED
          : error.code === 'MODULE_UNAVAILABLE' || error.code === 'PROVIDER_PLAN_REQUIRED' ? MODULE_STATE.UNAVAILABLE : MODULE_STATE.FAILED;
        modules[name] = null;
        if (MODULES[name].required) { overall.abort(); throw error; }
      }
    });
    return { modules, moduleStatus, generatedAt: new Date().toISOString(), provider: 'prokerala', providerApiVersion: 'v2' };
  } finally { clearTimeout(timer); }
}

async function fetchBasicKundli(input, options = {}) {
  const [birthDetails, basicKundli, planetPosition, d1] = await Promise.all([
    requestModule('birthDetails', input, options),
    requestModule('basicKundli', input, options),
    requestModule('planetPosition', input, options),
    requestModule('d1', input, options),
  ]);
  return {
    modules: { birthDetails, basicKundli, planetPosition, d1 },
    moduleStatus: { birthDetails: MODULE_STATE.READY, basicKundli: MODULE_STATE.READY,
      planetPosition: MODULE_STATE.READY, d1: MODULE_STATE.READY },
    generatedAt: new Date().toISOString(), provider: 'prokerala', providerApiVersion: 'v2',
  };
}

function expectedCredits({ language = 'en' } = {}) {
  const english = DEEP_MODULE_NAMES.reduce((sum, name) => sum + MODULES[name].credits, 0);
  return { english, nonEnglish: english * 2, requestedLanguage: language, requestedTotal: language === 'en' ? english : english * 2 };
}

function resetTokenCacheForTests() { tokenCache = { value: null, expiresAt: 0 }; tokenRequest = null; }

module.exports = { BASE_URL, TOKEN_URL, LAHIRI_AYANAMSA, MODULES, DEEP_MODULE_NAMES, MODULE_STATE, ProkeralaError,
  configured, capabilityMap, classifyStatus, sanitizeSvg, commonParams, getToken, requestModule, fetchPrimaryKundli,
  fetchBasicKundli, expectedCredits, resetTokenCacheForTests };
