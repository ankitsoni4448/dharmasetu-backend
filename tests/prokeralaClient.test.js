'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LAHIRI_AYANAMSA, ProkeralaError, commonParams, sanitizeSvg, classifyStatus,
  expectedCredits, requestModule, fetchBasicKundli, fetchPrimaryKundli, resetTokenCacheForTests,
} = require('../utils/prokeralaClient');

const env = { PROKERALA_CLIENT_ID: 'test-id', PROKERALA_CLIENT_SECRET: 'test-secret' };
const input = { latitude: 28.6139, longitude: 77.209, datetime: '1990-02-28T23:59:00+05:30' };

function response({ ok = true, status = 200, json, text }) {
  return { ok, status, json: async () => json, text: async () => text };
}

test.beforeEach(() => resetTokenCacheForTests());

test('uses documented Lahiri ayanamsa and fixed English provider language', () => {
  assert.equal(LAHIRI_AYANAMSA, 1);
  assert.deepEqual(commonParams(input), {
    ayanamsa: '1', coordinates: '28.6139,77.209', datetime: input.datetime, la: 'en',
  });
});

test('deep module cost is explicit and language multiplier is reported', () => {
  assert.deepEqual(expectedCredits({ language: 'en' }), { english: 560, nonEnglish: 1120, requestedLanguage: 'en', requestedTotal: 560 });
  assert.equal(expectedCredits({ language: 'hi' }).requestedTotal, 1120);
});

test('SVG sanitizer permits the standard namespace but rejects active/external content', () => {
  const safe = '<svg xmlns="http://www.w3.org/2000/svg"><text>राम</text></svg>';
  assert.equal(sanitizeSvg(safe), safe);
  assert.throws(() => sanitizeSvg('<svg><script>alert(1)</script></svg>'), /PROVIDER_MALFORMED_RESPONSE/);
  assert.throws(() => sanitizeSvg('<svg><image href="https://example.com/a.png"/></svg>'), /PROVIDER_MALFORMED_RESPONSE/);
});

test('provider HTTP failures are safely classified', () => {
  assert.equal(classifyStatus(401), 'PROVIDER_AUTH_FAILED');
  assert.equal(classifyStatus(403), 'PROVIDER_PLAN_REQUIRED');
  assert.equal(classifyStatus(429), 'PROVIDER_RATE_LIMITED');
  assert.equal(classifyStatus(503), 'PROVIDER_UNAVAILABLE');
});

test('basic generation reuses one token and fetches the two legacy modules', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(String(url));
    if (String(url).endsWith('/token')) return response({ json: { access_token: 'token', expires_in: 3600 } });
    return response({ json: { status: 'ok', data: { source: String(url) } } });
  };
  const result = await fetchBasicKundli(input, { env, fetchImpl });
  assert.equal(urls.filter(url => url.endsWith('/token')).length, 1);
  assert.match(result.modules.birthDetails.source, /birth-details/);
  assert.match(result.modules.basicKundli.source, /\/kundli\?/);
});

test('deep generation is disabled unless backend configuration explicitly enables it', async () => {
  await assert.rejects(fetchPrimaryKundli(input, { env }), error => error instanceof ProkeralaError && error.code === 'PROVIDER_PLAN_REQUIRED');
});

test('malformed token response is rejected without exposing provider content', async () => {
  const fetchImpl = async () => response({ json: { expires_in: 3600 } });
  await assert.rejects(fetchBasicKundli(input, { env, fetchImpl }), error => error.code === 'PROVIDER_MALFORMED_RESPONSE');
});

function deepFetch({ failPattern, failStatus = 403 } = {}) {
  return async (url, options = {}) => {
    const value = String(url);
    if (value.endsWith('/token')) return response({ json: { access_token: 'token', expires_in: 3600 } });
    if (failPattern?.test(value)) return response({ ok: false, status: failStatus });
    if (/\/chart\?/.test(value)) return response({ text: '<svg xmlns="http://www.w3.org/2000/svg" />' });
    return response({ json: { status: 'ok', data: { endpoint: value } } });
  };
}

test('optional deep module failure is recorded without destroying core results', async () => {
  const result = await fetchPrimaryKundli(input, {
    env: { ...env, PROKERALA_DEEP_KUNDLI_ENABLED: 'true' }, fetchImpl: deepFetch({ failPattern: /kaal-sarp-dosha/ }),
  });
  assert.equal(result.moduleStatus.birthDetails, 'READY');
  assert.equal(result.moduleStatus.d1, 'READY');
  assert.equal(result.moduleStatus.kaalSarpDosha, 'UNAVAILABLE');
  assert.equal(result.modules.kaalSarpDosha, null);
});

test('missing required deep module rejects KUNDLI_READY generation', async () => {
  await assert.rejects(fetchPrimaryKundli(input, {
    env: { ...env, PROKERALA_DEEP_KUNDLI_ENABLED: 'true' }, fetchImpl: deepFetch({ failPattern: /kundli\/advanced/ }),
  }), error => error.code === 'PROVIDER_PLAN_REQUIRED');
});

test('module timeout is classified without returning a fabricated result', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/token')) return response({ json: { access_token: 'token', expires_in: 3600 } });
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
  };
  await assert.rejects(requestModule('birthDetails', input, { env, fetchImpl, timeoutMs: 5 }), error => error.code === 'PROVIDER_TIMEOUT');
});
