'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { authoritativeEvidence, verdictForEvidence } = require('../utils/factSourcePolicy');
const { normalizePages, chunksFromPages } = require('../utils/granthProcessor');
const { normalizeFestivalEvents, unavailableFestivalResult } = require('../utils/festivalService');
const { buildCuratedEvidencePack } = require('../utils/sourcePolicy');
const { providerConfiguration } = require('../utils/authoritativeSourceRegistry');

test('model output alone cannot verify patent, science, or scripture', () => {
  for (const category of ['PATENT','SCIENTIFIC','SCRIPTURE']) assert.equal(verdictForEvidence(category, [{ text: 'model says true' }]).verdict, 'UNVERIFIED');
  assert.equal(authoritativeEvidence('PATENT', [{ verification_status: 'VERIFIED', knowledge_class: 'EDITORIAL_CORRECTION' }]).length, 0);
});

test('authoritative fact providers are server-configured and default closed', () => {
  const empty = providerConfiguration('PATENT', {}); assert.equal(empty.configured, false);
  const configured = providerConfiguration('PATENT', { FACTCHECK_PATENT_PROVIDER_URL: 'https://registry.example/search', FACTCHECK_PATENT_PROVIDER_TOKEN: 'server-only' });
  assert.equal(configured.configured, true); assert.equal(configured.knowledgeClass, 'AUTHORITATIVE_PATENT_REGISTRY');
});

test('editorial correction cannot impersonate primary scripture', () => {
  const pack = buildCuratedEvidencePack([{ id: '1', question: 'q', answer: 'a', knowledge_class: 'EDITORIAL_CORRECTION', verification_status: 'VERIFIED' }]);
  assert.equal(pack[0].knowledgeClass, 'EDITORIAL_CORRECTION');
  assert.equal(authoritativeEvidence('SCRIPTURE', [{ verification_status: 'VERIFIED', knowledge_class: pack[0].knowledgeClass }]).length, 0);
});

test('OCR pages retain provenance and remain review required', () => {
  const pages = normalizePages([{ pageNumber: 4, text: 'ॐ नमः शिवाय। यह मानव समीक्षा के लिए निकाला गया पाठ है।', ocrConfidence: 0.85 }], { tool: 'fixture', version: '1' });
  const chunks = chunksFromPages(pages, { language: 'Sanskrit' });
  assert.equal(chunks[0].page_number, 4); assert.equal(chunks[0].verification_status, 'REVIEW_REQUIRED');
  assert.ok(chunks[0].quality_flags.includes('LOW_OCR_CONFIDENCE'));
});

test('festival events preserve provider, locality, timezone and regional scope', () => {
  const events = normalizeFestivalEvents([{ name: 'Ekadashi', type: 'EKADASHI', start: '10:00', region: 'North India' }],
    { localDate: '2026-08-24', timezone: 'Asia/Kolkata', latitude: 25.66, longitude: 78.46, provider: 'fixture', calculationVersion: 'v1' });
  assert.equal(events[0].provider, 'fixture'); assert.equal(events[0].location.region, 'North India');
  assert.deepEqual(unavailableFestivalResult({ localDate: '2026-08-24', timezone: 'Asia/Kolkata', latitude: 1, longitude: 2 }).events, []);
});

test('Master 2 admin and privacy contracts are server-side', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const route of ['/admin/granth/upload','/admin/granth/sources/:id','/admin/granth/sources/:id/process','/admin/granth/chunks/:id/review']) {
    assert.match(server, new RegExp(route.replace(/[/:]/g, value => value === '/' ? '\\/' : value)));
  }
  assert.doesNotMatch(server, /const u = \{ \.\.\.userProfile,/);
  assert.match(server, /Never merge client-supplied profile or birth data/);
  assert.match(server, /ALL_GRANTH_CHUNKS_MUST_BE_VERIFIED/);
  assert.match(server, /rpc\/replace_granth_extraction/);
  assert.match(server, /method === 'POST' && mergeDuplicates/);
  assert.match(server, /sbRest\('POST', table, row, '', \{ mergeDuplicates: true \}\)/);
  assert.doesNotMatch(server, /'Prefer': method === 'POST' \? 'return=representation,resolution=merge-duplicates'/);
});
