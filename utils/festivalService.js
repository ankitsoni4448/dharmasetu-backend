'use strict';

const EVENT_TYPES = Object.freeze(['EKADASHI','PURNIMA','AMAVASYA','SANKRANTI','MAJOR_FESTIVAL','VRAT','SHRAVAN_MONDAY']);

function normalizeFestivalEvents(events, context) {
  if (!context?.localDate || !context?.timezone || !Number.isFinite(context?.latitude) || !Number.isFinite(context?.longitude) || !context?.provider || !context?.calculationVersion) {
    throw Object.assign(new Error('FESTIVAL_CONTEXT_INCOMPLETE'), { code: 'FESTIVAL_CONTEXT_INCOMPLETE' });
  }
  return (Array.isArray(events) ? events : []).filter(event => EVENT_TYPES.includes(event?.type) && event?.name).map(event => ({
    name: String(event.name).trim(), type: event.type, localDate: event.localDate || context.localDate,
    start: event.start || null, end: event.end || null, timezone: context.timezone,
    location: { latitude: context.latitude, longitude: context.longitude, region: event.region || context.region || null },
    provider: context.provider, calculationVersion: context.calculationVersion,
    regionalApplicability: event.regionalApplicability || 'PROVIDER_DEFINED', verified: true,
  }));
}

function unavailableFestivalResult(context, reason = 'AUTHORITATIVE_EVENT_DATA_UNAVAILABLE') {
  return { available: false, events: [], reason, context: context ? { localDate: context.localDate, timezone: context.timezone,
    latitude: context.latitude, longitude: context.longitude, provider: context.provider || null } : null };
}

module.exports = { EVENT_TYPES, normalizeFestivalEvents, unavailableFestivalResult };
