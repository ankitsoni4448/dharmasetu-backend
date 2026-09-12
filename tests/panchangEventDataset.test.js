'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dataset2026 = require('../data/panchang/events/2026.json');
const dataset2027 = require('../data/panchang/events/2027.json');
const { EVENT_TYPES, validateDataset, rowsForDataset, ingestDatasets } = require('../utils/panchangEventDataset');

test('2026 fixture separates Holika Dahan from civil Holi and contains sourced v1 coverage', () => {
  const byCode = new Map(dataset2026.events.map(event => [event.code, event]));
  for (const [code, date] of [
    ['KRISHNA_JANMASHTAMI', '2026-09-04'], ['MAHA_SHIVARATRI', '2026-02-15'],
    ['HOLIKA_DAHAN', '2026-03-03'], ['HOLI', '2026-03-04'], ['RAMA_NAVAMI', '2026-03-26'],
    ['DIWALI', '2026-11-08'], ['AJA_EKADASHI', '2026-09-07'],
    ['PRADOSHA_2026_06_12', '2026-06-12'], ['AMAVASYA_2026_06_15', '2026-06-15'], ['PURNIMA_2026_06_29', '2026-06-29'],
  ]) {
    assert.equal(byCode.get(code)?.date, date); assert.equal(byCode.get(code)?.verificationStatus, 'verified');
  }
  const validated = validateDataset(dataset2026);
  assert.equal(validated.production.length, 25); assert.equal(validated.reviewRequired.length, 0);
});

test('2027 fixture contains government major dates and institutional recurring examples', () => {
  const byCode = new Map(dataset2027.events.map(event => [event.code, event]));
  for (const [code, date] of [
    ['MAHA_SHIVARATRI', '2027-03-06'], ['HOLI', '2027-03-23'], ['RAMA_NAVAMI', '2027-04-15'],
    ['KRISHNA_JANMASHTAMI', '2027-08-25'], ['DIWALI', '2027-10-29'],
    ['EKADASHI_2027_01_03', '2027-01-03'], ['PRADOSHA_2027_01_05', '2027-01-05'],
    ['AMAVASYA_2027_01_07', '2027-01-07'], ['PURNIMA_2027_01_22', '2027-01-22'],
  ]) {
    assert.equal(byCode.get(code)?.date, date); assert.equal(byCode.get(code)?.verificationStatus, 'verified');
  }
  const validated = validateDataset(dataset2027);
  assert.equal(validated.production.length, 11); assert.equal(validated.reviewRequired.length, 0);
});

test('event model supports each v1 classification without collapsing all events into festivals', () => {
  assert.deepEqual([...EVENT_TYPES].sort(), ['FESTIVAL', 'FESTIVAL_PERIOD', 'LUNAR_OBSERVANCE', 'SOLAR_OBSERVANCE', 'VRATA']);
  const types = new Set(validateDataset(dataset2026).production.map(event => event.type));
  assert.ok(types.has('FESTIVAL')); assert.ok(types.has('VRATA')); assert.ok(types.has('LUNAR_OBSERVANCE'));
});

test('unverified events cannot produce production database rows', () => {
  const reviewEvent = { ...dataset2026.events[0], code: 'REVIEW_ONLY_TEST', verified: false, verificationStatus: 'review_required' };
  const rows = rowsForDataset({ ...dataset2026, events: [...dataset2026.events, reviewEvent] });
  assert.equal(rows.occurrences.length, 25); assert.equal(rows.reviewRequired.length, 1);
  assert.ok(rows.occurrences.every(row => row.source_metadata.verification_status === 'verified'));
  assert.ok(rows.occurrences.every(row => row.source_metadata.verified === true));
  assert.ok(!rows.occurrences.some(row => row.event_id === 'REVIEW_ONLY_TEST'));
});

test('duplicate canonical occurrences are rejected before upsert', () => {
  const duplicate = { ...dataset2026, events: [dataset2026.events[0], { ...dataset2026.events[0] }] };
  assert.throws(() => validateDataset(duplicate), /PANCHANG_EVENT_DUPLICATE/);
});

test('importer is idempotent through canonical occurrence and content upserts', async () => {
  const occurrences = new Map(); const content = new Map(); const calls = [];
  const client = { from(table) {
    const target = table === 'panchang_events' ? occurrences : content;
    return {
      select() { return { async in() { return { data: [...target.values()], error: null }; } }; },
      async upsert(rows, options) {
        calls.push({ table, options });
        for (const row of rows) {
          const key = table === 'panchang_events'
            ? [row.event_id, row.occurrence_date, row.region_code, row.tradition_code, row.calendar_version].join('|')
            : [row.event_id, row.language_code, row.content_version].join('|');
          target.set(key, row);
        }
        return { error: null };
      },
    };
  } };
  const first = await ingestDatasets(client, [dataset2026, dataset2027]);
  const sizes = [occurrences.size, content.size];
  const second = await ingestDatasets(client, [dataset2026, dataset2027]);
  assert.deepEqual([occurrences.size, content.size], sizes); assert.equal(first.inserted, 36); assert.equal(first.updated, 0);
  assert.equal(second.inserted, 0); assert.equal(second.updated, 36); assert.equal(second.contentInserted, 0);
  assert.equal(calls[0].options.onConflict, 'event_id,occurrence_date,region_code,tradition_code,calendar_version');
});
