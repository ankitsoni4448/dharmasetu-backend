'use strict';

const TABLE = 'panchang_daily_records';
const EVENTS_TABLE = 'panchang_events';
const EVENT_CONTENT_TABLE = 'panchang_event_content';

function createPanchangStore(client, logger = console) {
  if (!client) return null;

  async function getDay(identity) {
    const { data, error } = await client.from(TABLE).select('normalized_payload')
      .eq('canonical_key', identity.canonicalKey).maybeSingle();
    if (error) throw error;
    return data?.normalized_payload || null;
  }

  async function saveDay(identity, value) {
    const row = {
      canonical_key: identity.canonicalKey,
      panchang_date: identity.date,
      location_key: identity.locationKey,
      latitude: identity.latitude,
      longitude: identity.longitude,
      timezone: identity.timezone,
      ayanamsa: identity.ayanamsa,
      calendar_convention: identity.calendarConvention,
      provider: identity.provider,
      provider_version: value?.metadata?.providerApiVersion || null,
      calculation_version: identity.calculationVersion,
      normalized_payload: value,
      source_metadata: value?.metadata || {},
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from(TABLE).upsert(row, { onConflict: 'canonical_key' });
    if (error) throw error;
  }

  async function getMonth(identity, startDate, endDate) {
    const { data, error } = await client.from(TABLE).select('panchang_date,normalized_payload')
      .eq('location_key', identity.locationKey)
      .eq('timezone', identity.timezone)
      .eq('ayanamsa', identity.ayanamsa)
      .eq('calendar_convention', identity.calendarConvention)
      .eq('provider', identity.provider)
      .eq('calculation_version', identity.calculationVersion)
      .gte('panchang_date', startDate).lte('panchang_date', endDate)
      .order('panchang_date', { ascending: true });
    if (error) throw error;
    return (data || []).map(row => row.normalized_payload).filter(Boolean);
  }

  async function getEvents(startDate, endDate = startDate, { includeContent = true } = {}) {
    const { data: occurrences, error } = await client.from(EVENTS_TABLE).select(
      'event_id,occurrence_date,event_type,region_code,tradition_code,importance,source,calendar_version,source_metadata'
    ).eq('source_metadata->>verification_status', 'verified')
      .gte('occurrence_date', startDate).lte('occurrence_date', endDate).order('occurrence_date', { ascending: true });
    if (error) throw error;
    const rows = (occurrences || []).filter(row => row.source_metadata?.verification_status === 'verified' && row.source_metadata?.verified === true);
    const eventIds = [...new Set(rows.map(row => row.event_id).filter(Boolean))];
    let content = [];
    if (includeContent && eventIds.length) {
      const result = await client.from(EVENT_CONTENT_TABLE).select(
        'event_id,language_code,name,description,source,content_version,updated_at'
      ).in('event_id', eventIds).order('updated_at', { ascending: false });
      if (result.error) throw result.error;
      content = result.data || [];
    }
    const contentByEvent = new Map();
    for (const row of content) {
      const languages = contentByEvent.get(row.event_id) || new Map();
      if (!languages.has(row.language_code)) languages.set(row.language_code, row);
      contentByEvent.set(row.event_id, languages);
    }
    return rows.map(row => {
      const languages = contentByEvent.get(row.event_id) || new Map();
      const names = Object.fromEntries([...languages].map(([language, value]) => [language, value.name]));
      const preferred = languages.get('en') || languages.get('english') || languages.get('hi') || languages.values().next().value;
      const nameEn = names.en || names.english || row.source_metadata?.nameEn || row.source_metadata?.name || null;
      const nameHi = names.hi || names.hindi || row.source_metadata?.nameHi || null;
      return {
        eventId: row.event_id, code: row.source_metadata?.code || row.event_id, eventType: row.event_type, type: row.event_type,
        date: row.occurrence_date, importance: row.importance, regionCode: row.region_code,
        region: row.region_code, traditionCode: row.tradition_code, tradition: row.tradition_code,
        name: preferred?.name || nameEn || nameHi, nameEn, nameHi, names: { ...names, ...(nameEn ? { en: nameEn } : {}), ...(nameHi ? { hi: nameHi } : {}) },
        shortDescription: preferred?.description || null, source: row.source, sourceMethod: row.source_metadata?.sourceMethod || null,
        verified: true, verificationStatus: 'verified', endDate: row.source_metadata?.endDate || row.occurrence_date,
        timing: row.source_metadata?.timing || null, calendarVersion: row.calendar_version, contentVersion: preferred?.content_version || null,
      };
    });
  }

  return { getDay, saveDay, getMonth, getEvents, logger };
}

module.exports = { TABLE, EVENTS_TABLE, EVENT_CONTENT_TABLE, createPanchangStore };
