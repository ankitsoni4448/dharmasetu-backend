'use strict';

const { requestModule, ProkeralaError, LAHIRI_AYANAMSA } = require('./prokeralaClient');
const { localDateInTimezone, localDateTimeWithOffset, canonicalLocation } = require('./panchangService');
const { DERIVED_CALCULATION_VERSION, derivePanchangPeriods } = require('./panchangPeriods');

const PROVIDER = 'prokerala';
const CALCULATION_VERSION = 'prokerala-v2-lahiri-20260827';
const DAILY_TTL_MS = 6 * 60 * 60 * 1000;
const RANGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MONTH_DAYS = 31;
const dailyCache = new Map();
const monthCache = new Map();
const inFlight = new Map();
let sharedStore = null;
const CALENDAR_CONVENTION = 'nirayana-sidereal';

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateLocation(input) {
  const { latitude, longitude, locationKey } = canonicalLocation(input.latitude, input.longitude);
  const timezone = String(input.timezone || '');
  localDateInTimezone(new Date(), timezone);
  return { latitude, longitude, locationKey, timezone, label: String(input.locationLabel || '').slice(0, 100) || null };
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

function calculationIdentity(date, location) {
  return { date, locationKey: location.locationKey, latitude: location.latitude, longitude: location.longitude,
    timezone: location.timezone, ayanamsa: String(LAHIRI_AYANAMSA), calendarConvention: CALENDAR_CONVENTION,
    provider: PROVIDER, calculationVersion: CALCULATION_VERSION,
    canonicalKey: [date, location.locationKey, location.timezone, LAHIRI_AYANAMSA, CALENDAR_CONVENTION, PROVIDER, CALCULATION_VERSION].join('|') };
}

function configurePanchangStore(store) { sharedStore = store || null; }
function storeFor(options) { return Object.prototype.hasOwnProperty.call(options, 'store') ? options.store : sharedStore; }
function cacheValue(cacheKey, value) { dailyCache.set(cacheKey, { value, storedAt: Date.now() }); }
function storedValue(value) { return { ...value, metadata: { ...value.metadata, cached: true, cacheLayer: 'shared' } }; }
function warnCache(action, error, options) { (options.logger || console).warn(`[Panchang] shared cache ${action} failed: ${error?.message || 'unknown error'}`); }

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

function hasPeriod(value) { return Boolean(value?.periods?.length || (value?.start && value?.end)); }

function weekdayInTimezone(date, timezone) {
  const instant = new Date(localDateTimeWithOffset(date, '12:00:00', timezone));
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(instant);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

function enrichDerivedPeriods(value) {
  if (!value || typeof value !== 'object') return { value, changed: false };
  const date = value.modernDate?.isoDate || value.date;
  const timezone = value.modernDate?.timezone || value.timezone;
  let weekday;
  try { weekday = weekdayInTimezone(date, timezone); } catch { weekday = -1; }
  const derived = derivePanchangPeriods({
    sunrise: value.sunMoon?.sunrise || value.sunrise, sunset: value.sunMoon?.sunset || value.sunset, weekday, timezone,
  });
  const existingMuh = value.muhurta || {};
  const existingAvoid = value.avoidPeriods || {};
  const abhijit = hasPeriod(existingMuh.abhijit) ? existingMuh.abhijit : derived.abhijit;
  const rahuKalam = hasPeriod(existingAvoid.rahuKalam) ? existingAvoid.rahuKalam : derived.rahuKalam;
  const yamaganda = hasPeriod(existingAvoid.yamaganda) ? existingAvoid.yamaganda : derived.yamaganda;
  const gulika = hasPeriod(existingAvoid.gulika) ? existingAvoid.gulika : derived.gulika;
  const changed = abhijit !== existingMuh.abhijit || rahuKalam !== existingAvoid.rahuKalam ||
    yamaganda !== existingAvoid.yamaganda || gulika !== existingAvoid.gulika;
  if (!changed) return { value, changed: false };
  const supportedMuh = [...(Array.isArray(existingMuh.supported) ? existingMuh.supported : [])];
  const supportedAvoid = [...(Array.isArray(existingAvoid.supported) ? existingAvoid.supported : [])];
  if (!hasPeriod(existingMuh.abhijit) && abhijit) supportedMuh.push({ name: 'Abhijit Muhurta', ...abhijit });
  if (!hasPeriod(existingAvoid.rahuKalam) && rahuKalam) supportedAvoid.push({ name: 'Rahu Kalam', ...rahuKalam });
  if (!hasPeriod(existingAvoid.yamaganda) && yamaganda) supportedAvoid.push({ name: 'Yamaganda', ...yamaganda });
  if (!hasPeriod(existingAvoid.gulika) && gulika) supportedAvoid.push({ name: 'Gulika Kalam', ...gulika });
  const enriched = {
    ...value,
    muhurta: { ...existingMuh, abhijit, supported: supportedMuh },
    avoidPeriods: { ...existingAvoid, rahuKalam, yamaganda, gulika, supported: supportedAvoid },
    metadata: { ...value.metadata, derivedCalculationVersion: DERIVED_CALCULATION_VERSION },
    derivedCalculationVersion: DERIVED_CALCULATION_VERSION,
    rahuKalam, yamaganda, gulika, abhijitMuhurta: abhijit,
  };
  return { value: enriched, changed: true };
}

function mergeEvents(value, storedEvents) {
  const events = []; const seen = new Set();
  for (const event of [...(Array.isArray(value?.events) ? value.events : []), ...(storedEvents || [])]) {
    const id = event?.eventId ? `id:${event.eventId}:${event.date || ''}` : `name:${event?.name || ''}:${event?.type || ''}`;
    if (!event || seen.has(id)) continue;
    seen.add(id); events.push(event);
  }
  return { ...value, events, festivals: events };
}

async function eventsFor(store, startDate, endDate, options, includeContent = true) {
  if (!store?.getEvents) return [];
  try { return await store.getEvents(startDate, endDate, { includeContent }); }
  catch (error) { warnCache('event read', error, options); return []; }
}

function normalizeProviderPanchang(raw, context) {
  if (!raw || typeof raw !== 'object') throw new ProkeralaError('PANCHANG_NORMALIZATION_FAILED');
  const tithi = activeEntry(raw.tithi, context.datetime);
  const nakshatra = activeEntry(raw.nakshatra, context.datetime);
  const yoga = activeEntry(raw.yoga, context.datetime);
  const karana = activeEntry(raw.karana, context.datetime);
  if (![tithi, nakshatra, yoga, karana].every(Boolean) || !raw.vaara) throw new ProkeralaError('PANCHANG_CORE_INCOMPLETE');
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
    sunMoon: { sunrise: raw.sunrise || null, sunset: raw.sunset || null, moonrise: raw.moonrise || null, moonset: raw.moonset || null },
    muhurta: { abhijit: findPeriod(auspicious, /abhijit/i), brahma: findPeriod(auspicious, /brahma/i), supported: auspicious.map(period) },
    avoidPeriods: { rahuKalam: findPeriod(inauspicious, /rahu/i), yamaganda: findPeriod(inauspicious, /yamaganda/i), gulika: findPeriod(inauspicious, /gulika/i), supported: inauspicious.map(period) },
    events: [...explicitEvents, ...lunarObservances],
    metadata: { provider: PROVIDER, providerApiVersion: 'v2', ayanamsa: { id: LAHIRI_AYANAMSA, name: 'Lahiri/Chitrapaksha' },
      calculationConvention: 'Nirayana/sidereal; location and timezone aware', calculationVersion: CALCULATION_VERSION,
      generatedAt: new Date().toISOString(), cached: false, detail: context.detail },
  };
  const enriched = enrichDerivedPeriods(result).value;
  return Object.assign(enriched, { date: enriched.modernDate.isoDate, weekday: enriched.panchang.vara, tithi: enriched.panchang.tithi.name,
    nakshatra: enriched.panchang.nakshatra.name, yoga: enriched.panchang.yoga.name, karana: enriched.panchang.karana.name,
    paksha: enriched.traditionalDate.paksha, lunarMonth: enriched.traditionalDate.masa, sunrise: enriched.sunMoon.sunrise, sunset: enriched.sunMoon.sunset,
    moonrise: enriched.sunMoon.moonrise, moonset: enriched.sunMoon.moonset, rahuKalam: enriched.avoidPeriods.rahuKalam,
    yamaganda: enriched.avoidPeriods.yamaganda, gulika: enriched.avoidPeriods.gulika, abhijitMuhurta: enriched.muhurta.abhijit,
    festivals: enriched.events, location: enriched.modernDate.location, timezone: enriched.modernDate.timezone,
    provider: PROVIDER, calculationVersion: CALCULATION_VERSION, generatedAt: enriched.metadata.generatedAt });
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
  const detail = 'basic';
  const cacheKey = key('day', date, location, detail);
  const cached = cacheGet(dailyCache, cacheKey, DAILY_TTL_MS);
  const store = storeFor(options);
  if (cached) return mergeEvents(cached, await eventsFor(store, date, date, options));
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const task = (async () => {
    const identity = calculationIdentity(date, location);
    if (store) {
      try { const found = await store.getDay(identity); if (found) {
        const enriched = enrichDerivedPeriods(found);
        if (enriched.changed) try { await store.saveDay(identity, enriched.value); } catch (error) { warnCache('enrichment write', error, options); }
        const value = storedValue(enriched.value); cacheValue(cacheKey, value);
        return mergeEvents(value, await eventsFor(store, date, date, options));
      } }
      catch (error) { warnCache('read', error, options); }
    }
    const datetime = localDateTimeWithOffset(date, '06:00:00', location.timezone);
    try {
      const raw = await requestModule('panchang', { ...location, datetime }, options);
      const value = normalizeProviderPanchang(raw, { date, datetime, location, detail });
      if (store) try { await store.saveDay(identity, value); } catch (error) { warnCache('write', error, options); }
      cacheValue(cacheKey, value);
      return mergeEvents(value, await eventsFor(store, date, date, options));
    } catch (error) { throw sanitizedFailure(error); }
  })();
  inFlight.set(cacheKey, task);
  try { return await task; } finally { if (inFlight.get(cacheKey) === task) inFlight.delete(cacheKey); }
}

function monthDates(year, month) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw Object.assign(new Error('PANCHANG_MONTH_INVALID'), { code: 'PANCHANG_MONTH_INVALID' });
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`);
}

async function getMonthlyPanchang(input, options = {}) {
  const location = validateLocation(input); const year = Number(input.year); const month = Number(input.month);
  const dates = monthDates(year, month); if (dates.length > MAX_MONTH_DAYS) throw new Error('PANCHANG_RANGE_TOO_LARGE');
  const store = storeFor(options); let shared = []; let storedEvents = [];
  if (store) {
    const results = await Promise.all([
      store.getMonth(calculationIdentity(dates[0], location), dates[0], dates[dates.length - 1]).catch(error => { warnCache('month read', error, options); return []; }),
      eventsFor(store, dates[0], dates[dates.length - 1], options, false),
    ]);
    [shared, storedEvents] = results;
  }
  for (const original of shared) {
    const value = enrichDerivedPeriods(original).value;
    if (value?.date) cacheValue(key('day', value.date, location, 'basic'), storedValue(value));
  }
  const days = dates.flatMap(date => {
    const cached = cacheGet(dailyCache, key('day', date, location, 'basic'), DAILY_TTL_MS);
    return cached ? [{ date, available: true, weekday: cached.weekday, tithi: cached.tithi, paksha: cached.paksha,
      nakshatra: cached.nakshatra, events: cached.events }] : [];
  });
  const astronomicalEvents = days.flatMap(day => (day.events || []).map(event => ({ ...event, date: day.date })));
  return { available: true, year, month, days,
    events: mergeEvents({ events: astronomicalEvents }, storedEvents).events,
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

module.exports = { PROVIDER, CALCULATION_VERSION, CALENDAR_CONVENTION, MAX_MONTH_DAYS, validDate, validateLocation, calculationIdentity,
  normalizeProviderPanchang, enrichDerivedPeriods, mergeEvents, sanitizedFailure, configurePanchangStore, getDailyPanchang, getMonthlyPanchang, getYearOverview,
  _dailyCache: dailyCache, _monthCache: monthCache, _inFlight: inFlight };
