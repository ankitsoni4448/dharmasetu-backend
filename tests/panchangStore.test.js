'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPanchangStore } = require('../utils/panchangStore');

function clientFixture(occurrenceOverride) {
  const calls = [];
  const occurrence = occurrenceOverride || { event_id: 'event-1', occurrence_date: '2026-09-11', event_type: 'VRATA', region_code: 'GLOBAL', tradition_code: 'GENERAL',
    importance: 3, source: 'verified-calendar', calendar_version: 'v1', source_metadata: { code: 'EVENT_ONE', name: 'Metadata name', nameHi: 'सत्यापित पर्व', verification_status: 'verified', verified: true } };
  const content = { event_id: 'event-1', language_code: 'hi', name: 'सत्यापित पर्व', description: 'संक्षिप्त विवरण', source: 'verified-content', content_version: 'v1' };
  return {
    calls,
    client: { from(table) {
      const call = { table, methods: [] }; calls.push(call);
      const builder = { select(value) { call.methods.push(['select', value]); return builder; }, gte(...args) { call.methods.push(['gte', ...args]); return builder; },
        lte(...args) { call.methods.push(['lte', ...args]); return builder; }, eq(...args) { call.methods.push(['eq', ...args]); return builder; }, in(...args) { call.methods.push(['in', ...args]); return builder; },
        order(...args) { call.methods.push(['order', ...args]); return builder; },
        then(resolve) { return Promise.resolve(resolve({ data: table === 'panchang_events' ? [occurrence] : [content], error: null })); } };
      return builder;
    } },
  };
}

test('daily event lookup batches occurrence and localized content reads', async () => {
  const fixture = clientFixture(); const store = createPanchangStore(fixture.client);
  const events = await store.getEvents('2026-09-11');
  assert.equal(fixture.calls.length, 2); assert.equal(events.length, 1);
  assert.equal(events[0].code, 'EVENT_ONE'); assert.equal(events[0].names.hi, 'सत्यापित पर्व');
  assert.equal(events[0].type, 'VRATA'); assert.equal(events[0].region, 'GLOBAL'); assert.equal(events[0].verified, true);
});

test('unverified database rows are excluded defensively', async () => {
  const fixture = clientFixture({ event_id: 'unsafe', occurrence_date: '2026-09-11', event_type: 'FESTIVAL', region_code: 'INDIA', tradition_code: 'COMMON',
    source: 'review', calendar_version: 'v1', source_metadata: { verification_status: 'review_required', verified: false } });
  const events = await createPanchangStore(fixture.client).getEvents('2026-09-11');
  assert.deepEqual(events, []); assert.equal(fixture.calls.length, 1);
});

test('month event lookup is one date-range query with no per-day reads', async () => {
  const fixture = clientFixture(); const store = createPanchangStore(fixture.client);
  const events = await store.getEvents('2026-09-01', '2026-09-30', { includeContent: false });
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].table, 'panchang_events');
  assert.deepEqual(fixture.calls[0].methods.filter(row => row[0] === 'gte' || row[0] === 'lte').map(row => row.slice(0, 3)), [
    ['gte', 'occurrence_date', '2026-09-01'], ['lte', 'occurrence_date', '2026-09-30'],
  ]);
  assert.equal(events[0].name, 'Metadata name');
  assert.deepEqual(fixture.calls[0].methods.find(row => row[0] === 'eq'), ['eq', 'source_metadata->>verification_status', 'verified']);
});
