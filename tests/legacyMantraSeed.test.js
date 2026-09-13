const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildLegacyManifest } = require('../scripts/generate_legacy_mantra_seed');
const { normalizeMantra, validateMantraManifest } = require('../scripts/manifest_utils');
const { decodeResponseChunks, planMantraImport } = require('../scripts/ingest_mantra_manifest');

const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'mantra', 'legacy_v2_seed.json'), 'utf8'));

test('generated and committed seed contain the same 29 stable records', () => {
  const generated = buildLegacyManifest();
  assert.equal(generated.items.length, 29);
  assert.equal(committed.items.length, 29);
  assert.equal(JSON.stringify(committed), JSON.stringify(generated));
  assert.equal(new Set(committed.items.map(item => item.id)).size, 29);
});

test('every legacy seed record is review-required, unsourced and has Sanskrit text', () => {
  assert.ok(committed.items.every(item => item.verificationStatus === 'REVIEW_REQUIRED'));
  assert.ok(committed.items.every(item => item.sourceReferences.length === 0));
  assert.ok(committed.items.every(item => item.sanskritText.trim().length > 0));
  assert.equal(committed.items.filter(item => item.verificationStatus === 'VERIFIED').length, 0);
  assert.deepEqual(validateMantraManifest(committed), []);
});

test('legacy practice claims are not imported as practice defaults', () => {
  const fields = ['recommended_counts','mala','time','direction','asana','clothing','place','cleanliness','preparation','sankalpa','dhyana','viniyoga','nyasa','opening','japa','completion','precautions'];
  assert.ok(committed.items.every(item => fields.every(field => item.practice[field] === null)));
  assert.ok(committed.items.every(item => !Object.hasOwn(item, 'legacy_review')));
});

test('import planning inserts once then skips identical records', () => {
  const rows = committed.items.map(normalizeMantra);
  const first = planMantraImport(rows, []);
  assert.deepEqual([first.inserts.length, first.updates.length, first.skipped.length, first.duplicates], [29,0,0,0]);
  const database = rows.map(row => ({ created_at:'ignored', ...row }));
  const second = planMantraImport(rows, database);
  assert.deepEqual([second.inserts.length, second.updates.length, second.skipped.length, second.duplicates], [0,0,29,0]);
  const third = planMantraImport(rows, database);
  assert.deepEqual([third.inserts.length, third.updates.length, third.skipped.length, third.duplicates], [0,0,29,0]);
  assert.equal(database.length, 29);
  assert.equal(new Set(database.map(row => row.id)).size, 29);
  assert.equal(database.filter(row => row.verification_status === 'REVIEW_REQUIRED').length, 29);
  assert.equal(database.filter(row => row.verification_status === 'VERIFIED').length, 0);
  assert.equal(database.filter(row => row.verification_status === 'RESTRICTED').length, 0);
});

test('UTF-8 response chunks are decoded only after concatenation', () => {
  const payload = Buffer.from(JSON.stringify([{ id:'gayatri', sanskrit_text:'ॐ भूर्भुवः स्वः' }]));
  const split = payload.indexOf(Buffer.from('ॐ')) + 1;
  const decoded = decodeResponseChunks([payload.subarray(0, split), payload.subarray(split)]);
  assert.equal(decoded.includes('�'), false);
  assert.equal(JSON.parse(decoded)[0].sanskrit_text, 'ॐ भूर्भुवः स्वः');
});

test('database null/default representations do not cause false updates', () => {
  const row = normalizeMantra(committed.items[0]);
  const database = { ...row, scripture_source:null, audio_url:null, source_references:null, practice:{}, updated_at:'different' };
  const plan = planMantraImport([row], [database]);
  assert.deepEqual([plan.updates.length, plan.skipped.length], [0,1]);
});

test('a changed existing row is updated without duplication', () => {
  const rows = committed.items.map(normalizeMantra);
  const existing = rows.map(row => ({ ...row }));
  existing[0].canonical_name = 'old value';
  const plan = planMantraImport(rows, existing);
  assert.deepEqual([plan.inserts.length, plan.updates.length, plan.skipped.length, plan.duplicates], [0,1,28,0]);
});
