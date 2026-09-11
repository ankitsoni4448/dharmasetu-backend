'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CALCULATION, SEGMENTS, derivePanchangPeriods } = require('../utils/panchangPeriods');

const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const expected = {
  rahuKalam: [8, 2, 7, 5, 6, 4, 3],
  yamaganda: [5, 4, 3, 2, 1, 7, 6],
  gulika: [7, 6, 5, 4, 3, 2, 1],
};

test('daylight is divided into eight equal segments with all weekday mappings', () => {
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const result = derivePanchangPeriods({ sunrise: '2026-09-06T06:00:00Z', sunset: '2026-09-06T18:00:00Z', weekday, timezone: 'UTC' });
    for (const field of Object.keys(expected)) {
      assert.equal(SEGMENTS[field][weekday], expected[field][weekday], `${names[weekday]} ${field}`);
      const startHour = 6 + (expected[field][weekday] - 1) * 1.5;
      assert.equal(Date.parse(result[field].end) - Date.parse(result[field].start), 90 * 60 * 1000);
      assert.equal(Date.parse(result[field].start), Date.parse('2026-09-06T06:00:00Z') + startHour * 60 * 60 * 1000 - 6 * 60 * 60 * 1000);
      assert.equal(result[field].calculation, CALCULATION);
    }
  }
});

test('Abhijit uses the eighth of fifteen local daylight muhurtas, not fixed clock time', () => {
  const result = derivePanchangPeriods({ sunrise: '2026-06-01T07:00:00+05:30', sunset: '2026-06-01T19:00:00+05:30', weekday: 1, timezone: 'Asia/Kolkata' });
  assert.equal(result.abhijit.start, '2026-06-01T12:36:00+05:30');
  assert.equal(result.abhijit.end, '2026-06-01T13:24:00+05:30');
});

test('derived timestamps retain the requested timezone, including DST offsets', () => {
  const result = derivePanchangPeriods({ sunrise: '2026-07-06T05:00:00-04:00', sunset: '2026-07-06T21:00:00-04:00', weekday: 1, timezone: 'America/New_York' });
  assert.match(result.rahuKalam.start, /-04:00$/);
  assert.equal(result.rahuKalam.start, '2026-07-06T07:00:00-04:00');
});

test('missing, malformed, reversed, and impossible daylight inputs return null safely', () => {
  for (const input of [
    { sunrise: null, sunset: null },
    { sunrise: 'bad', sunset: '2026-01-01T18:00:00Z' },
    { sunrise: '2026-01-01T18:00:00Z', sunset: '2026-01-01T06:00:00Z' },
    { sunrise: '2026-01-01T00:00:00Z', sunset: '2026-01-03T00:00:00Z' },
  ]) assert.deepEqual(derivePanchangPeriods({ ...input, weekday: 4, timezone: 'UTC' }), { rahuKalam: null, yamaganda: null, gulika: null, abhijit: null });
});
