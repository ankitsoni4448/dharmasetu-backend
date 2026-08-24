'use strict';

function localDateInTimezone(instant, timezone) {
  if (!timezone || typeof timezone !== 'string') throw Object.assign(new Error('PANCHANG_TIMEZONE_REQUIRED'), { code: 'PANCHANG_TIMEZONE_REQUIRED' });
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
  } catch { throw Object.assign(new Error('PANCHANG_INVALID_TIMEZONE'), { code: 'PANCHANG_INVALID_TIMEZONE' }); }
}

function localDateTimeWithOffset(date, time, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}:\d{2}$/.test(String(time))) throw new Error('PANCHANG_LOCAL_DATETIME_INVALID');
  try {
    const sample = new Date(`${date}T12:00:00Z`);
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(sample).find(part => part.type === 'timeZoneName')?.value;
    const offset = zone === 'GMT' ? '+00:00' : zone?.replace('GMT', '');
    if (!/^[+-]\d{2}:\d{2}$/.test(offset || '')) throw new Error('offset unavailable');
    return `${date}T${time}${offset}`;
  } catch { throw Object.assign(new Error('PANCHANG_INVALID_TIMEZONE'), { code: 'PANCHANG_INVALID_TIMEZONE' }); }
}

function normalizeCoordinate(value, min, max) {
  const number = Number(value); if (!Number.isFinite(number) || number < min || number > max) return null;
  return Number(number.toFixed(3));
}

function cacheKey({ date, latitude, longitude, timezone, provider = 'prokerala', version = 'v2' }) {
  const lat = normalizeCoordinate(latitude, -90, 90); const lng = normalizeCoordinate(longitude, -180, 180);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || lat == null || lng == null || !timezone) throw Object.assign(new Error('PANCHANG_CONTEXT_INVALID'), { code: 'PANCHANG_CONTEXT_INVALID' });
  return `${provider}|${version}|${date}|${lat}|${lng}|${timezone}`;
}

function normalizeAuthoritativePanchang(raw, context) {
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('PANCHANG_PROVIDER_MALFORMED'), { code: 'PANCHANG_PROVIDER_MALFORMED' });
  const pickName = value => String(value?.name || value || '').normalize('NFC').trim() || null;
  const result = { available: true, date: context.date, weekday: pickName(raw.weekday), tithi: pickName(raw.tithi),
    nakshatra: pickName(raw.nakshatra), yoga: pickName(raw.yoga), karana: pickName(raw.karana), paksha: pickName(raw.paksha),
    lunarMonth: pickName(raw.lunar_month || raw.lunarMonth), vikramSamvat: raw.vikram_samvat || raw.vikramSamvat || null,
    sunrise: raw.sunrise || null, sunset: raw.sunset || null, moonrise: raw.moonrise || null, moonset: raw.moonset || null,
    rahuKalam: raw.rahu_kalam || raw.rahuKalam || null, yamaganda: raw.yamaganda || null, gulika: raw.gulika || null,
    abhijitMuhurta: raw.abhijit_muhurta || raw.abhijitMuhurta || null,
    festivals: Array.isArray(raw.festivals) ? raw.festivals : [], location: { latitude: context.latitude, longitude: context.longitude, label: context.locationLabel || null },
    timezone: context.timezone, provider: context.provider || 'prokerala', calculationVersion: context.version || 'v2', generatedAt: context.generatedAt || new Date().toISOString() };
  for (const field of ['date', 'weekday', 'tithi', 'nakshatra', 'yoga', 'karana', 'sunrise', 'sunset']) {
    if (!result[field] || /^(unknown|n\/a|approx)/i.test(String(result[field]))) throw Object.assign(new Error('PANCHANG_PROVIDER_MALFORMED'), { code: 'PANCHANG_PROVIDER_MALFORMED', field });
  }
  return result;
}

class PanchangCache {
  constructor(ttlMs = 6 * 60 * 60 * 1000) { this.ttlMs = ttlMs; this.rows = new Map(); }
  get(key, now = Date.now()) { const row = this.rows.get(key); if (!row || now - row.storedAt > this.ttlMs) { this.rows.delete(key); return null; } return { ...row.value, cached: true }; }
  set(key, value, now = Date.now()) { if (!value?.available || !value?.provider || !value?.generatedAt) throw new Error('PANCHANG_CACHE_REJECTED'); this.rows.set(key, { value: { ...value, cached: false }, storedAt: now }); }
}

module.exports = { localDateInTimezone, localDateTimeWithOffset, normalizeCoordinate, cacheKey, normalizeAuthoritativePanchang, PanchangCache };
