'use strict';

const CALCULATION = 'dharmasetu-daylight-v1';
const DERIVED_CALCULATION_VERSION = 'dharmasetu-panchang-periods-v1';

// Traditional daylight-octant assignments, indexed Sunday (0) through Saturday (6).
const SEGMENTS = Object.freeze({
  rahuKalam: Object.freeze([8, 2, 7, 5, 6, 4, 3]),
  yamaganda: Object.freeze([5, 4, 3, 2, 1, 7, 6]),
  gulika: Object.freeze([7, 6, 5, 4, 3, 2, 1]),
});

function zonedIso(epochMs, timezone) {
  try {
    const date = new Date(Math.round(epochMs / 1000) * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value;
    const zone = value('timeZoneName');
    const offset = zone === 'GMT' ? '+00:00' : zone?.replace('GMT', '');
    if (!/^[+-]\d{2}:\d{2}$/.test(offset || '')) return null;
    return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}${offset}`;
  } catch { return null; }
}

function period(startMs, endMs, timezone) {
  const start = zonedIso(startMs, timezone); const end = zonedIso(endMs, timezone);
  return start && end ? { start, end, calculation: CALCULATION } : null;
}

function derivePanchangPeriods({ sunrise, sunset, weekday, timezone }) {
  const sunriseMs = typeof sunrise === 'string' ? Date.parse(sunrise) : NaN;
  const sunsetMs = typeof sunset === 'string' ? Date.parse(sunset) : NaN;
  const weekdayNumber = Number(weekday);
  const duration = sunsetMs - sunriseMs;
  if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs) || !Number.isInteger(weekdayNumber) || weekdayNumber < 0 || weekdayNumber > 6 ||
      typeof timezone !== 'string' || duration <= 0 || duration > 24 * 60 * 60 * 1000) {
    return { rahuKalam: null, yamaganda: null, gulika: null, abhijit: null };
  }
  const eighth = duration / 8;
  const selected = name => {
    const segment = SEGMENTS[name][weekdayNumber];
    return period(sunriseMs + (segment - 1) * eighth, sunriseMs + segment * eighth, timezone);
  };
  // Abhijit is the eighth of fifteen equal daytime muhurtas: local solar noon +/- 1/30 daytime.
  const fifteenth = duration / 15;
  return {
    rahuKalam: selected('rahuKalam'),
    yamaganda: selected('yamaganda'),
    gulika: selected('gulika'),
    abhijit: period(sunriseMs + 7 * fifteenth, sunriseMs + 8 * fifteenth, timezone),
  };
}

module.exports = { CALCULATION, DERIVED_CALCULATION_VERSION, SEGMENTS, derivePanchangPeriods };
