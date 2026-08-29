'use strict';

const { requestModule, ProkeralaError, LAHIRI_AYANAMSA } = require('./prokeralaClient');
const { localDateInTimezone, localDateTimeWithOffset, normalizeCoordinate } = require('./panchangService');

const PROVIDER = 'prokerala';
const CALCULATION_VERSION = 'prokerala-v2-lahiri-20260827';
const DAILY_TTL_MS = 6 * 60 * 60 * 1000;
const RANGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MONTH_DAYS = 31;
const dailyCache = new Map();
const monthCache = new Map();

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateLocation(input) {
  const latitude = normalizeCoordinate(input.latitude, -90, 90);
  const longitude = normalizeCoordinate(input.longitude, -180, 180);
  if (latitude == null || longitude == null) throw Object.assign(new Error('PANCHANG_LOCATION_INVALID'), { code: 'PANCHANG_LOCATION_INVALID' });
  const timezone = String(input.timezone || '');
  localDateInTimezone(new Date(), timezone);
  return { latitude, longitude, timezone, label: String(input.locationLabel || '').slice(0, 100) || null };
}

function validateDate(date) {
  if (!validDate(date)) throw Object.assign(new Error('PANCHANG_DATE_INVALID'), { code: 'PANCHANG_DATE_INVALID' });
  const year = Number(date.slice(0, 4));
  if (year < 1900 || year > 2100) throw Object.assign(new Error('PANCHANG_DATE_OUT_OF_RANGE'), { code: 'PANCHANG_DATE_OUT_OF_RANGE' });
  return date;
}

function key(scope, value, location, detail = 'basic') {
  return [scope, value, location.latitude, location.longitude, location.timezone, LAHIRI_AYANAMSA, PROVIDER, CALCULATION_VERSION, detail].join('|');
}

function cacheGet(store, cacheKey, ttl) {
  const row = store.get(cacheKey);
  if (!row || Date.now() - row.storedAt > ttl) { store.delete(cacheKey); return null; }
  return { ...row.value, metadata: { ...row.value.metadata, cached: true, cacheStoredAt: new Date(row.storedAt).toISOString() } };
}

function period(value) {
  if (!value) return null;
  if (Array.isArray(value.period)) return { name: value.name || null, periods: value.period.map(p => ({ start: p.start || null, end: p.end || null })) };
  return { name: value.name || null, start: value.start || null, end: value.end || null };
}

function activeEntry(values, instant) {
  if (!Array.isArray(values) || !values.length) return null;
  const at = Date.parse(instant);
  return values.find(item => Date.parse(item.start) <= at && at < Date.parse(item.end)) || values[0];
}

function findPeriod(values, matcher) {
  return period((Array.isArray(values) ? values : []).find(item => matcher.test(String(item.name || ''))));
}

function normalizeProviderPanchang(raw, context) {
  if (!raw || typeof raw !== 'object') throw new ProkeralaError('PANCHANG_NORMALIZATION_FAILED');
  const tithi = activeEntry(raw.tithi, context.datetime);
  const nakshatra = activeEntry(raw.nakshatra, context.datetime);
  const yoga = activeEntry(raw.yoga, context.datetime);
  const karana = activeEntry(raw.karana, context.datetime);
  if (![tithi, nakshatra, yoga, karana].every(Boolean) || !raw.vaara || !raw.sunrise || !raw.sunset) throw new ProkeralaError('PANCHANG_CORE_INCOMPLETE');
  const auspicious = raw.auspicious_period || [];
  const inauspicious = raw.inauspicious_period || [];
  const explicitEvents = [...(Array.isArray(raw.events) ? raw.events : []), ...(Array.isArray(raw.festivals) ? raw.festivals : [])]
    .map(event => typeof event === 'string' ? { name: event } : event).filter(event => event?.name);
  const lunarObservances = /ekadashi|purnima|amavasya/i.test(tithi.name) ? [{ name: tithi.name, type: 'LUNAR_OBSERVANCE', providerDerived: true }] : [];
  const formattedDate = new Intl.DateTimeFormat('en-IN', { timeZone: context.location.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(context.datetime));
  const result = {
    available: true,
    modernDate: { isoDate: context.date, formattedLocalDate: formattedDate, weekday: raw.vaara, timezone: context.location.timezone,
      location: { latitude: context.location.latitude, longitude: context.location.longitude, label: context.location.label } },
    traditionalDate: { system: 'Nirayana/Lahiri baseline', year: null, samvat: null, masa: null, paksha: tithi.paksha || null, tithi: tithi.name, regionalCalendar: null },
    panchang: {
      vara: raw.vaara,
      tithi: { name: tithi.name, start: tithi.start || null, end: tithi.end || null },
      nakshatra: { name: nakshatra.name, start: nakshatra.start || null, end: nakshatra.end || null },
      yoga: { name: yoga.name, start: yoga.start || null, end: yoga.end || null },
      karana: { name: karana.name, start: karana.start || null, end: karana.end || null },
    },
    sunMoon: { sunrise: raw.sunrise, sunset: raw.sunset, moonrise: raw.moonrise || null, moonset: raw.moonset || null },
    muhurta: { abhijit: findPeriod(auspicious, /abhijit/i), brahma: findPeriod(auspicious, /brahma/i), supported: auspicious.map(period) },
    avoidPeriods: { rahuKalam: findPeriod(inauspicious, /rahu/i), yamaganda: findPeriod(inauspicious, /yamaganda/i), gulika: findPeriod(inauspicious, /gulika/i), supported: inauspicious.map(period) },
    events: [...explicitEvents, ...lunarObservances],
    metadata: { provider: PROVIDER, providerApiVersion: 'v2', ayanamsa: { id: LAHIRI_AYANAMSA, name: 'Lahiri/Chitrapaksha' },
      calculationConvention: 'Nirayana/sidereal; location and timezone aware', calculationVersion: CALCULATION_VERSION,
      generatedAt: new Date().toISOString(), cached: false, detail: context.detail },
  };
  return Object.assign(result, { date: result.modernDate.isoDate, weekday: result.panchang.vara, tithi: result.panchang.tithi.name,
    nakshatra: result.panchang.nakshatra.name, yoga: result.panchang.yoga.name, karana: result.panchang.karana.name,
    paksha: result.traditionalDate.paksha, lunarMonth: result.traditionalDate.masa, sunrise: result.sunMoon.sunrise, sunset: result.sunMoon.sunset,
    moonrise: result.sunMoon.moonrise, moonset: result.sunMoon.moonset, rahuKalam: result.avoidPeriods.rahuKalam,
    yamaganda: result.avoidPeriods.yamaganda, gulika: result.avoidPeriods.gulika, abhijitMuhurta: result.muhurta.abhijit,
    festivals: result.events, location: result.modernDate.location, timezone: result.modernDate.timezone,
    provider: PROVIDER, calculationVersion: CALCULATION_VERSION, generatedAt: result.metadata.generatedAt });
}

function sanitizedFailure(error) {
  const mapped = {
    PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
    PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
    PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_ERROR',
    PROVIDER_PLAN_REQUIRED: 'PROVIDER_PLAN_OR_QUOTA',
    PROVIDER_MALFORMED_RESPONSE: 'PROVIDER_BAD_RESPONSE',
    PROVIDER_UNAVAILABLE: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
    PANCHANG_NORMALIZATION_FAILED: 'PANCHANG_NORMALIZATION_FAILED',
    PANCHANG_CORE_INCOMPLETE: 'PANCHANG_CORE_INCOMPLETE',
  };
  const code = mapped[error?.code];
  if (!code || code === error.code) return error;
  return Object.assign(new Error(code), { code, status: error.status || 0, cause: error });
}

async function getDailyPanchang(input, options = {}) {
  const location = validateLocation(input);
  const date = validateDate(input.date || localDateInTimezone(new Date(), location.timezone));
  const detail = options.detail === 'advanced' ? 'advanced' : 'basic';
  const cacheKey = key('day', date, location, detail);
  const cached = cacheGet(dailyCache, cacheKey, DAILY_TTL_MS);
  if (cached) return cached;
  const datetime = localDateTimeWithOffset(date, '06:00:00', location.timezone);
  try {
    const raw = await requestModule(detail === 'advanced' ? 'panchangAdvanced' : 'panchang', { ...location, datetime }, options);
    const value = normalizeProviderPanchang(raw, { date, datetime, location, detail });
    dailyCache.set(cacheKey, { value, storedAt: Date.now() });
    return value;
  } catch (error) { throw sanitizedFailure(error); }
}

function monthDates(year, month) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw Object.assign(new Error('PANCHANG_MONTH_INVALID'), { code: 'PANCHANG_MONTH_INVALID' });
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`);
}

async function getMonthlyPanchang(input, options = {}) {
  const location = validateLocation(input); const year = Number(input.year); const month = Number(input.month);
  const dates = monthDates(year, month); if (dates.length > MAX_MONTH_DAYS) throw new Error('PANCHANG_RANGE_TOO_LARGE');
  const days = dates.flatMap(date => {
    const cached = cacheGet(dailyCache, key('day', date, location, 'basic'), DAILY_TTL_MS);
    return cached ? [{ date, available: true, weekday: cached.weekday, tithi: cached.tithi, paksha: cached.paksha,
      nakshatra: cached.nakshatra, events: cached.events }] : [];
  });
  return { available: true, year, month, days,
    events: days.flatMap(day => (day.events || []).map(event => ({ ...event, date: day.date }))),
    partial: days.length < dates.length, location, timezone: location.timezone,
    metadata: { provider: PROVIDER, calculationVersion: CALCULATION_VERSION, generatedAt: new Date().toISOString(), cached: true,
      strategy: 'cache-only-month-shell; zero provider fan-out' } };
}

function getYearOverview(input) {
  const location = validateLocation(input); const year = Number(input.year);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw Object.assign(new Error('PANCHANG_YEAR_INVALID'), { code: 'PANCHANG_YEAR_INVALID' });
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1; const cached = cacheGet(monthCache, key('month', `${year}-${month}`, location, 'basic'), RANGE_TTL_MS);
    return { month, status: cached ? (cached.partial ? 'PARTIAL' : 'AVAILABLE') : 'LOAD_MONTH_ON_DEMAND', events: cached?.events || [] };
  });
  return { available: true, year, months, events: months.flatMap(row => row.events), location, timezone: location.timezone,
    metadata: { provider: PROVIDER, calculationVersion: CALCULATION_VERSION, generatedAt: new Date().toISOString(), cached: true,
      strategy: 'year-index-from-authoritative-month-cache; no 365-call fan-out' } };
}

module.exports = { PROVIDER, CALCULATION_VERSION, MAX_MONTH_DAYS, validDate, validateLocation, normalizeProviderPanchang, sanitizedFailure,
  getDailyPanchang, getMonthlyPanchang, getYearOverview, _dailyCache: dailyCache, _monthCache: monthCache };
