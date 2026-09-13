const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMantra, validateMantraManifest } = require('../scripts/manifest_utils');

const item = (overrides = {}) => ({ id:'m1', canonicalName:'Test', contentType:'MANTRA', sanskritText:'ॐ', verificationStatus:'REVIEW_REQUIRED', ...overrides });
const manifest = (...items) => ({ schemaVersion:2, items });

test('review and restricted records remain distinguishable', () => {
  assert.deepEqual(validateMantraManifest(manifest(item())), []);
  assert.deepEqual(validateMantraManifest(manifest(item({ verificationStatus:'RESTRICTED', practiceLevel:'INITIATION_GUIDANCE' }))), []);
  assert.equal(normalizeMantra(item()).verification_status, 'REVIEW_REQUIRED');
});
test('VERIFIED requires provenance and review attribution', () => {
  assert.match(validateMantraManifest(manifest(item({ verificationStatus:'VERIFIED' }))).join(' '), /provenance/);
  assert.deepEqual(validateMantraManifest(manifest(item({ verificationStatus:'VERIFIED', sourceReferences:[{url:'https://example.org/source'}], reviewedBy:'reviewer', reviewedAt:'2026-09-13' }))), []);
});
test('duplicates, missing Sanskrit and unsupported types are rejected', () => {
  assert.match(validateMantraManifest(manifest(item(), item())).join(' '), /duplicate/);
  assert.match(validateMantraManifest(manifest(item({ sanskritText:'' }))).join(' '), /sanskritText/);
  assert.match(validateMantraManifest(manifest(item({ contentType:'UNKNOWN' }))).join(' '), /unsupported/);
});
test('practice is nullable and no religious defaults are invented', () => {
  assert.deepEqual(validateMantraManifest(manifest(item({ practice:null }))), []);
  const row=normalizeMantra(item({ practice:null }));
  assert.deepEqual(row.practice, {});
  assert.equal(row.scripture_source, '');
  assert.equal(row.requires_initiation, null);
});
