'use strict';
/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BirthplaceError } = require('../utils/birthplaceResolver');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function searchHarness(resolveBirthplace) {
  let handler;
  const context = { app: { post: (_path, _auth, fn) => { handler = fn; } }, requireSupabaseUser() {},
    checkRateLimit: () => true, isValidIsoDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value),
    sanitize: (value, limit) => String(value).trim().slice(0, limit), resolveBirthplace, BirthplaceError };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("app.post('/account/birthplace/resolve'"), source.indexOf("app.post('/account/onboarding'")), context);
  return async body => {
    let status = 200; let data;
    await handler({ authUser: { id: 'owner' }, body }, { status(value) { status = value; return this; }, json(value) { data = value; return this; } });
    return { status, data };
  };
}

test('authenticated birthplace search is separate from canonical save', () => {
  const start = source.indexOf("app.post('/account/birthplace/resolve'");
  const end = source.indexOf("app.post('/account/onboarding'", start);
  const route = source.slice(start, end);
  assert.ok(start > -1 && end > start);
  assert.match(route, /requireSupabaseUser/);
  assert.match(route, /resolveBirthplace\(details, dateOfBirth\)/);
  assert.doesNotMatch(route, /sbUpsert|sbInsert|generatePrimary|fetchBasicKundli/);
  assert.match(route, /error instanceof BirthplaceError/);
});

test('confirmed coordinate sources bypass search resolution during save', () => {
  const start = source.indexOf("app.post('/account/onboarding'");
  const end = source.indexOf("app.post('/account/kundli/generate'", start);
  const route = source.slice(start, end);
  assert.match(route, /locationSelection\?\.source === 'MAP_CONFIRMED'/);
  assert.match(route, /\? await resolveMapSelection/);
  assert.match(route, /: await resolveBirthplace/);
});

test('search success returns only validated display context and coordinates', async () => {
  const request = searchHarness(async details => ({ placeName: `${details.villageCity}, India`, city: details.villageCity,
    region: details.state, country: details.country, latitude: 24.1, longitude: 77.2, timezone: 'Asia/Kolkata' }));
  const result = await request({ dateOfBirth: '1990-01-01', birthplaceDetails: {
    villageCity: ' Test Village ', district: 'Test District', state: 'Test State', country: 'India' } });
  assert.equal(result.status, 200); assert.equal(result.data.location.latitude, 24.1);
  assert.equal(result.data.location.city, 'Test Village'); assert.equal(result.data.location.timezone, undefined);
});

test('search not-found and outage remain controlled without persistence', async () => {
  const notFound = searchHarness(async () => { throw new BirthplaceError('BIRTHPLACE_UNRESOLVED', 422); });
  const missing = await notFound({ dateOfBirth: '1990-01-01', birthplaceDetails: {
    villageCity: 'Village', district: '', state: 'State', country: 'India' } });
  assert.equal(missing.status, 422); assert.equal(missing.data.error, 'BIRTHPLACE_UNRESOLVED');
  const outage = searchHarness(async () => { throw new BirthplaceError('BIRTHPLACE_SERVICE_UNAVAILABLE', 503); });
  const unavailable = await outage({ dateOfBirth: '1990-01-01', birthplaceDetails: {
    villageCity: 'Village', district: '', state: 'State', country: 'India' } });
  assert.equal(unavailable.status, 503); assert.equal(unavailable.data.error, 'BIRTHPLACE_SERVICE_UNAVAILABLE');
});
