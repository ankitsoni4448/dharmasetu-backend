'use strict';

class BirthplaceError extends Error {
  constructor(code, status = 422, stage = 'PLACE_RESOLUTION') {
    super(code); this.code = code; this.status = status; this.stage = stage;
  }
}
const normalizePlaceText = value => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/(?:,\s*)+/g, ', ').replace(/^, |, $/g, '') : '';
function contextualPlace(input) {
  if (typeof input === 'string') return normalizePlaceText(input);
  return [input?.villageCity, input?.district, input?.state, input?.country]
    .map(normalizePlaceText).filter(Boolean).join(', ');
}
const compare = value => normalizePlaceText(value).toLocaleLowerCase();

async function resolveBirthplace(input, dateOfBirth, { fetchImpl = fetch,
  timezoneKey = process.env.TIMEZONEDB_API_KEY, onStage = () => {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let stage = 'PLACE_RESOLUTION';
  const getJson = async url => {
    const response = await fetchImpl(url, { signal: controller.signal,
      headers: { 'User-Agent': 'DharmaSetu/1.0 (birthplace resolution)', 'Accept-Language': 'en' } });
    if (!response.ok) throw new BirthplaceError('BIRTHPLACE_SERVICE_UNAVAILABLE', 503, stage);
    return response.json();
  };
  try {
    const query = contextualPlace(input);
    const results = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&limit=5&q=${encodeURIComponent(query)}`);
    if (!Array.isArray(results)) throw new BirthplaceError('BIRTHPLACE_SERVICE_UNAVAILABLE', 503);
    if (!results.length) return null;
    // Require the requested locality, not a district/capital returned by a broad match.
    const locality = compare((typeof input === 'string' ? query : input.villageCity).split(',')[0]);
    const candidates = results.filter(result => {
      const a = result.address || {};
      const names = [a.village, a.hamlet, a.town, a.city, a.municipality, a.suburb,
        ...Object.values(result.namedetails || {})];
      const placeType = result.addresstype || result.type;
      if (!['village', 'hamlet', 'town', 'city', 'municipality', 'suburb', 'neighbourhood'].includes(placeType)) return false;
      names.push(result.name);
      if (!names.some(name => compare(name) === locality)) return false;
      if (typeof input !== 'object') {
        const context = query.split(',').slice(1).map(compare).filter(Boolean);
        const addressNames = Object.values(a).map(compare);
        return context.every(part => addressNames.includes(part));
      }
      return (!input.state || [a.state, a.region].some(v => compare(v) === compare(input.state)))
        && (!input.country || [a.country, a.country_code].some(v => compare(v) === compare(input.country)))
        && (!input.district || [a.county, a.state_district, a.district].some(v => compare(v) === compare(input.district)));
    });
    if (!candidates.length) throw new BirthplaceError('BIRTHPLACE_UNRESOLVED');
    const unique = [...new Map(candidates.map(r => [`${r.lat},${r.lon}`, r])).values()];
    if (unique.length > 1) throw new BirthplaceError('BIRTHPLACE_AMBIGUOUS');
    const result = unique[0];
    const latitude = Number(result.lat); const longitude = Number(result.lon);
    if (result.lat == null || result.lon == null || String(result.lat).trim() === '' || String(result.lon).trim() === ''
      || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new BirthplaceError('BIRTHPLACE_SERVICE_UNAVAILABLE', 503);
    }
    onStage('PLACE_RESOLUTION_SUCCEEDED');
    stage = 'TIMEZONE_RESOLUTION';
    const address = result.address || {};
    const countryCode = String(address.country_code || '').toUpperCase();
    let timezone; let utcOffsetMinutes;
    // Existing verified modern-India rule, based on the resolved country (never device locale).
    if (countryCode === 'IN' && dateOfBirth >= '1946-01-01') {
      timezone = 'Asia/Kolkata'; utcOffsetMinutes = 330;
    } else if (timezoneKey) {
      const timestamp = Math.floor(new Date(`${dateOfBirth}T12:00:00Z`).getTime() / 1000);
      const tz = await getJson(`https://api.timezonedb.com/v2.1/get-time-zone?key=${encodeURIComponent(timezoneKey)}&format=json&by=position&lat=${latitude}&lng=${longitude}&time=${timestamp}`);
      if (!tz || tz.status !== 'OK') throw new BirthplaceError('BIRTHPLACE_SERVICE_UNAVAILABLE', 503, stage);
      timezone = tz.zoneName;
      utcOffsetMinutes = tz.gmtOffset == null || tz.gmtOffset === '' ? NaN : Number(tz.gmtOffset) / 60;
    }
    let validZone = false;
    try { if (timezone) { new Intl.DateTimeFormat('en', { timeZone: timezone }); validZone = true; } } catch {}
    if (!validZone || !Number.isInteger(utcOffsetMinutes) || utcOffsetMinutes < -720 || utcOffsetMinutes > 840) {
      throw new BirthplaceError('BIRTHPLACE_TIMEZONE_UNRESOLVED', 422, stage);
    }
    onStage('TIMEZONE_RESOLUTION_SUCCEEDED');
    return { placeName: normalizePlaceText(result.display_name).slice(0, 300),
      city: normalizePlaceText(address.village || address.hamlet || address.town || address.city).slice(0, 100),
      region: normalizePlaceText(address.state || address.region).slice(0, 100),
      country: normalizePlaceText(address.country).slice(0, 100), countryCode,
      latitude, longitude, timezone, utcOffsetMinutes };
  } catch (error) {
    if (error instanceof BirthplaceError) throw error;
    throw new BirthplaceError('BIRTHPLACE_SERVICE_UNAVAILABLE', 503, stage);
  } finally { clearTimeout(timer); }
}

async function resolveMapSelection(selection, dateOfBirth, { fetchImpl = fetch,
  timezoneKey = process.env.TIMEZONEDB_API_KEY, onStage = () => {} } = {}) {
  const latitude = Number(selection?.latitude); const longitude = Number(selection?.longitude);
  const villageCity = normalizePlaceText(selection?.villageCity);
  const district = normalizePlaceText(selection?.district);
  const region = normalizePlaceText(selection?.state);
  const country = normalizePlaceText(selection?.country);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !villageCity || !region || !country) throw new BirthplaceError('BIRTHPLACE_UNRESOLVED');
  onStage('PLACE_RESOLUTION_SUCCEEDED');
  let timezone; let utcOffsetMinutes; let countryCode = '';
  if (country.toLocaleLowerCase() === 'india' && dateOfBirth >= '1946-01-01') {
    timezone = 'Asia/Kolkata'; utcOffsetMinutes = 330; countryCode = 'IN';
  } else {
    if (!timezoneKey) throw new BirthplaceError('BIRTHPLACE_TIMEZONE_UNRESOLVED', 422, 'TIMEZONE_RESOLUTION');
    try {
      const timestamp = Math.floor(new Date(`${dateOfBirth}T12:00:00Z`).getTime() / 1000);
      const url = `https://api.timezonedb.com/v2.1/get-time-zone?key=${encodeURIComponent(timezoneKey)}&format=json&by=position&lat=${latitude}&lng=${longitude}&time=${timestamp}`;
      const response = await fetchImpl(url, { headers: { 'User-Agent': 'DharmaSetu/1.0 (timezone resolution)' } });
      if (!response.ok) throw new Error('SERVICE');
      const tz = await response.json();
      if (tz?.status !== 'OK') throw new Error('SERVICE');
      timezone = tz.zoneName; utcOffsetMinutes = Number(tz.gmtOffset) / 60;
      countryCode = String(tz.countryCode || '').toUpperCase();
    } catch { throw new BirthplaceError('BIRTHPLACE_SERVICE_UNAVAILABLE', 503, 'TIMEZONE_RESOLUTION'); }
  }
  let validZone = false;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); validZone = true; } catch {}
  if (!validZone || !Number.isInteger(utcOffsetMinutes)) throw new BirthplaceError('BIRTHPLACE_TIMEZONE_UNRESOLVED', 422, 'TIMEZONE_RESOLUTION');
  onStage('TIMEZONE_RESOLUTION_SUCCEEDED');
  return { placeName: [villageCity, district, region, country].filter(Boolean).join(', '),
    city: villageCity, region, country, countryCode, latitude, longitude, timezone, utcOffsetMinutes };
}
module.exports = { BirthplaceError, contextualPlace, normalizePlaceText, resolveBirthplace, resolveMapSelection };
