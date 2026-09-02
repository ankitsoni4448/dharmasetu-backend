'use strict';

const TABLE = 'panchang_daily_records';

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

  return { getDay, saveDay, getMonth, logger };
}

module.exports = { TABLE, createPanchangStore };
