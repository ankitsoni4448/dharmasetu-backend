'use strict';

const TRANSIT_CALCULATION_VERSION = 'kundli-k2.5-prokerala-transit-boundary-v1';
const DEFAULT_TTL_MS = 60 * 60 * 1000;

function unavailableTransit(reason = 'AUTHORITATIVE_TRANSIT_REFRESH_DISABLED') {
  return {
    status: 'UNAVAILABLE', calculated_at: null, expires_at: null, timezone: null,
    ayanamsha: 'lahiri', source: 'UNAVAILABLE', calculation_version: TRANSIT_CALCULATION_VERSION,
    planets: [], reason,
  };
}

function createTransitService({ fetchPositions = null, refreshEnabled = false, ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now() } = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function getCurrent({ cacheKey, timezone } = {}) {
    if (!cacheKey || !timezone) return unavailableTransit('TRANSIT_CONTEXT_REQUIRED');
    const cached = cache.get(cacheKey);
    if (cached && Date.parse(cached.expires_at) > now()) return cached;
    if (!refreshEnabled || typeof fetchPositions !== 'function') {
      cache.delete(cacheKey);
      return unavailableTransit();
    }
    if (!inFlight.has(cacheKey)) inFlight.set(cacheKey, (async () => {
      const provider = await fetchPositions();
      if (!provider || !Array.isArray(provider.planets) || !provider.planets.length) {
        return unavailableTransit('PROVIDER_TRANSIT_DATA_INVALID');
      }
      const current = now();
      const value = {
        status: 'AVAILABLE', calculated_at: new Date(current).toISOString(), expires_at: new Date(current + ttlMs).toISOString(),
        timezone, ayanamsha: 'lahiri', source: 'PROVIDER', calculation_version: TRANSIT_CALCULATION_VERSION,
        planets: provider.planets,
      };
      cache.set(cacheKey, value);
      return value;
    })().finally(() => inFlight.delete(cacheKey)));
    return inFlight.get(cacheKey);
  }

  return { getCurrent, clear: () => cache.clear(), size: () => cache.size };
}

module.exports = { TRANSIT_CALCULATION_VERSION, DEFAULT_TTL_MS, unavailableTransit, createTransitService };
