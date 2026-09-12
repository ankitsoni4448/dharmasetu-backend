'use strict';

const EVENT_TYPES = new Set(['LUNAR_OBSERVANCE', 'VRATA', 'FESTIVAL', 'FESTIVAL_PERIOD', 'SOLAR_OBSERVANCE']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value, year) {
  if (!DATE_PATTERN.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) === year;
}

function validIsoDate(value) {
  if (!DATE_PATTERN.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateDataset(dataset) {
  if (!dataset || !Number.isInteger(dataset.year) || !dataset.datasetVersion || !Array.isArray(dataset.events)) throw new Error('PANCHANG_EVENT_DATASET_INVALID');
  const production = []; const reviewRequired = []; const seen = new Set();
  for (const event of dataset.events) {
    if (!event?.code || !EVENT_TYPES.has(event.type) || !validDate(event.date, dataset.year) ||
        (event.endDate && (!validDate(event.endDate, dataset.year) || event.endDate < event.date)) ||
        !event.names?.en || !event.names?.hi || !event.region || !event.tradition || !event.sourceMethod ||
        !Array.isArray(event.sources) || !event.sources.length) throw new Error(`PANCHANG_EVENT_INVALID:${event?.code || 'unknown'}`);
    const occurrenceKey = [event.code, event.date, event.region, event.tradition, dataset.datasetVersion].join('|');
    if (seen.has(occurrenceKey)) throw new Error(`PANCHANG_EVENT_DUPLICATE:${event.code}:${event.date}`);
    seen.add(occurrenceKey);
    const sourcesValid = event.sources.every(source => source?.title && /^https:\/\//.test(source.url || '') && validIsoDate(source.verifiedAt));
    if (!sourcesValid) throw new Error(`PANCHANG_EVENT_PROVENANCE_INVALID:${event.code}`);
    if (event.verificationStatus === 'verified' && event.verified === true) production.push(event);
    else reviewRequired.push(event);
  }
  return { production, reviewRequired };
}

function rowsForDataset(dataset) {
  const { production, reviewRequired } = validateDataset(dataset);
  const occurrences = production.map(event => ({
    event_id: event.code, occurrence_date: event.date, event_type: event.type,
    region_code: event.region, tradition_code: event.tradition, importance: event.importance ?? null,
    source: event.sources.map(source => source.url).join(' | '), calendar_version: dataset.datasetVersion,
    source_metadata: {
      code: event.code, canonicalName: event.canonicalName || event.names.en, name: event.names.en,
      nameEn: event.names.en, nameHi: event.names.hi, endDate: event.endDate || event.date,
      timezone: dataset.context?.timezone || 'Asia/Kolkata', geographicContext: dataset.context?.region || 'India',
      sourceMethod: event.sourceMethod, verification_status: 'verified', verified: true,
      verifiedAt: event.verifiedAt, sources: event.sources, timing: event.timing || null,
    },
  }));
  const content = production.flatMap(event => [
    { event_id: event.code, language_code: 'en', name: event.names.en, description: event.descriptions?.en || null,
      significance: null, vrat_puja_content: null, source: 'DharmaSetu original summary', content_version: dataset.contentVersion },
    { event_id: event.code, language_code: 'hi', name: event.names.hi, description: event.descriptions?.hi || null,
      significance: null, vrat_puja_content: null, source: 'DharmaSetu original summary', content_version: dataset.contentVersion },
  ]);
  return { occurrences, content, reviewRequired };
}

async function ingestDatasets(client, datasets) {
  if (!client) throw new Error('SUPABASE_CLIENT_REQUIRED');
  const prepared = datasets.map(rowsForDataset);
  const occurrences = prepared.flatMap(value => value.occurrences);
  const allContent = prepared.flatMap(value => value.content);
  const content = [...new Map(allContent.map(row => [[row.event_id, row.language_code, row.content_version].join('|'), row])).values()];
  const reviewRequired = prepared.reduce((sum, value) => sum + value.reviewRequired.length, 0);
  const occurrenceKey = row => [row.event_id, row.occurrence_date, row.region_code, row.tradition_code, row.calendar_version].join('|');
  const contentKey = row => [row.event_id, row.language_code, row.content_version].join('|');
  let existingOccurrences = []; let existingContent = [];
  if (occurrences.length) {
    const result = await client.from('panchang_events').select('event_id,occurrence_date,region_code,tradition_code,calendar_version')
      .in('calendar_version', [...new Set(occurrences.map(row => row.calendar_version))]);
    if (result.error) throw result.error;
    existingOccurrences = result.data || [];
  }
  if (content.length) {
    const result = await client.from('panchang_event_content').select('event_id,language_code,content_version')
      .in('content_version', [...new Set(content.map(row => row.content_version))]);
    if (result.error) throw result.error;
    existingContent = result.data || [];
  }
  const existingOccurrenceKeys = new Set(existingOccurrences.map(occurrenceKey));
  const existingContentKeys = new Set(existingContent.map(contentKey));
  if (occurrences.length) {
    const { error } = await client.from('panchang_events').upsert(occurrences, {
      onConflict: 'event_id,occurrence_date,region_code,tradition_code,calendar_version',
    });
    if (error) throw error;
  }
  if (content.length) {
    const { error } = await client.from('panchang_event_content').upsert(content, {
      onConflict: 'event_id,language_code,content_version',
    });
    if (error) throw error;
  }
  const inserted = occurrences.filter(row => !existingOccurrenceKeys.has(occurrenceKey(row))).length;
  const contentInserted = content.filter(row => !existingContentKeys.has(contentKey(row))).length;
  return { inserted, updated: occurrences.length - inserted, contentInserted, contentUpdated: content.length - contentInserted,
    skipped: 0, reviewRequired };
}

module.exports = { EVENT_TYPES, validDate, validIsoDate, validateDataset, rowsForDataset, ingestDatasets };
