'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { resolveBirthplace, resolveMapSelection, contextualPlace, BirthplaceError } = require('../utils/birthplaceResolver');
const lifecycle = require('../utils/accountLifecycle');
const { legacyAccountBirth } = require('../utils/legacyAccountBirth');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
const input = { name: 'Private Name', gender: 'other', dateOfBirth: '1990-01-02',
  birthTime: '09:05', birthTimeCertainty: 'EXACT', birthplace: 'Test Village, Test District, Test State, India',
  language: 'english', birthDataConsent: true };
const candidate = { lat: '25.1', lon: '78.1', addresstype: 'village', display_name: input.birthplace,
  address: { village: 'Test Village', county: 'Test District', state: 'Test State', country: 'India', country_code: 'in' } };
const response = value => ({ ok: true, json: async () => value });
const resolved = { placeName: input.birthplace, city: 'Test Village', region: 'Test State', country: 'India',
  countryCode: 'IN', latitude: 25.1, longitude: 78.1, timezone: 'Asia/Kolkata', utcOffsetMinutes: 330 };

test('public status route is dependency-free and exposes only safe service health', () => {
  let handler;
  const context = { app: { get: (path, fn) => { if (path === '/status') handler = fn; } } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("app.get('/status'"), source.indexOf("app.get('/health'")), context);
  let body;
  handler({}, { json: value => { body = value; } });
  assert.deepEqual(JSON.parse(JSON.stringify(body)), {
    success: true, service: 'dharmasetu-backend', status: 'ok',
  });
});

function harness({ resolve = async () => resolved, failTable, births = [], charts = [] } = {}) {
  let handler; const logs = []; const tables = { birth_profiles: births, jyotish_profiles: charts, user_profiles: [], users: [] };
  const write = async (table, row) => {
    if (table === failTable) throw Object.assign(new Error('PRIVATE ROW CONTENT'), { dbCode: '23502' });
    tables[table] = [structuredClone(row)];
  };
  const context = { ...lifecycle, contextualPlace, BirthplaceError, resolveBirthplace: resolve, resolveMapSelection,
    app: { post: (_path, _auth, fn) => { handler = fn; } }, requireSupabaseUser: () => {},
    checkRateLimit: () => true, sanitize: (v, n) => String(v).slice(0, n),
    sbSelect: async table => tables[table], sbUpsert: write, sbInsert: write, sbUpdate: write,
    getAuthenticatedUserRecord: async () => null, validateKundliReadiness: () => ({ valid: true }),
    process: { env: {} }, console: { log: v => logs.push(v), warn: v => logs.push(v), error: v => logs.push(v) } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function safeAccountDbCode('), source.indexOf("app.get('/account/me'")), context);
  vm.runInContext(source.slice(source.indexOf("app.post('/account/onboarding'"), source.indexOf("app.post('/account/kundli/generate'")), context);
  return { tables, logs, async request(body = input) {
    let status = 200; let data;
    await handler({ authUser: { id: 'owner-uuid' }, authPhone: 'private-phone', body },
      { status(value) { status = value; return this; }, json(value) { data = value; return this; } });
    return { status, data };
  } };
}

test('new account saves canonical inputs, pending chart and generation contract, with safe stages', async () => {
  const h = harness(); const result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.data.requiresKundliGeneration, true);
  assert.equal(h.tables.birth_profiles[0].birth_time, '09:05');
  assert.equal(h.tables.user_profiles[0].user_id, 'owner-uuid');
  assert.equal(h.tables.jyotish_profiles[0].chart_data, null);
  for (const stage of ['AUTHENTICATED','VALIDATED','PLACE_RESOLUTION_STARTED','EXISTING_PROFILE_READ',
    'USER_PROFILE_SAVED','BIRTH_PROFILE_SAVED','JYOTISH_TRANSITION_SAVED','LEGACY_COMPATIBILITY_SAVED','RESPONSE_READY']) {
    assert.ok(h.logs.includes(`[account/onboarding] stage=${stage}`));
  }
  assert.doesNotMatch(h.logs.join('\n'), /Private|1990|09:05|Village|25\.1|Kolkata|owner-uuid|private-phone/);
});
test('database failure logs only allowlisted code and exact failed stage', async () => {
  const h = harness({ failTable: 'birth_profiles' }); const r = await h.request();
  assert.equal(r.status, 500); assert.equal(r.data.error, 'ONBOARDING_SAVE_FAILED');
  assert.ok(h.logs.includes('[account/onboarding] failed stage=BIRTH_PROFILE_SAVED db_code=23502'));
  assert.doesNotMatch(h.logs.join(' '), /PRIVATE ROW CONTENT|Private Name/);
});
test('compatibility failure cannot undo canonical success', async () => {
  const h = harness({ failTable: 'users' }); const r = await h.request();
  assert.equal(r.status, 200); assert.equal(r.data.compatibilityPending, true);
  assert.ok(h.tables.birth_profiles[0]);
});
test('unknown time stays null and never requests generation', async () => {
  const h = harness(); const r = await h.request({ ...input, birthTimeCertainty: 'UNKNOWN', birthTime: null });
  assert.equal(r.data.requiresKundliGeneration, false); assert.equal(h.tables.birth_profiles[0].birth_time, null);
});
test('period-only time is stored truthfully and never requests generation', async () => {
  const h = harness(); const r = await h.request({ ...input, birthTimeCertainty: 'PERIOD_ONLY', birthTime: null, birthTimePeriod: 'MORNING' });
  assert.equal(r.status, 200); assert.equal(r.data.requiresKundliGeneration, false);
  assert.equal(h.tables.birth_profiles[0].birth_time, null);
  assert.equal(h.tables.birth_profiles[0].birth_time_period, 'MORNING');
  assert.equal(h.tables.jyotish_profiles[0].status, 'INPUT_CORRECTION_REQUIRED');
});
test('map-confirmed India selection preserves the user coordinates', async () => {
  const h = harness({ resolve: async () => { throw new Error('search resolver must not run'); } });
  const r = await h.request({ ...input, birthplaceDetails: { villageCity: 'Test Village', district: 'Test District', state: 'Test State', country: 'India' },
    locationSelection: { source: 'MAP_CONFIRMED', latitude: 24.123456, longitude: 77.654321 } });
  assert.equal(r.status, 200);
  assert.equal(h.tables.birth_profiles[0].latitude, 24.123456);
  assert.equal(h.tables.birth_profiles[0].longitude, 77.654321);
});
test('invalid map coordinates are rejected without persistence', async () => {
  const h = harness();
  const r = await h.request({ ...input, birthplaceDetails: { villageCity: 'Test Village', district: '', state: 'Test State', country: 'India' },
    locationSelection: { source: 'MAP_CONFIRMED', latitude: 95, longitude: 77 } });
  assert.equal(r.status, 422); assert.equal(r.data.error, 'BIRTHPLACE_UNRESOLVED');
  assert.equal(h.tables.birth_profiles.length, 0);
});
test('changed birth profile preserves previous validated chart', async () => {
  const old = { status: 'KUNDLI_READY', input_fingerprint: 'old', chart_data: { normalized: { saved: true } } };
  const h = harness({ births: [{ input_fingerprint: 'old', profile_version: 1 }], charts: [old] });
  const r = await h.request({ ...input, confirmBirthProfileChange: true });
  assert.equal(r.data.requiresKundliGeneration, true); assert.deepEqual(h.tables.jyotish_profiles, [old]);
});
test('structured rural query retains locality and geographic context', async () => {
  let url; const stages = [];
  const r = await resolveBirthplace({ villageCity: ' Test  Village ', district: 'Test District', state: 'Test State', country: 'India' }, input.dateOfBirth,
    { fetchImpl: async value => { url = value; return response([candidate]); }, onStage: v => stages.push(v) });
  assert.equal(new URL(url).searchParams.get('q'), input.birthplace);
  assert.equal(r.city, 'Test Village'); assert.equal(r.latitude, 25.1);
  assert.deepEqual(stages, ['PLACE_RESOLUTION_SUCCEEDED', 'TIMEZONE_RESOLUTION_SUCCEEDED']);
});
test('zero-result place returns controlled 422 with no persistence', async () => {
  const h = harness({ resolve: () => resolveBirthplace(input.birthplace, input.dateOfBirth, { fetchImpl: async () => response([]) }) });
  const r = await h.request(); assert.equal(r.status, 422); assert.equal(r.data.error, 'BIRTHPLACE_UNRESOLVED');
  assert.equal(h.tables.birth_profiles.length, 0);
});
for (const [label, fetchImpl] of [
  ['transport', async () => { throw new Error('private URL'); }],
  ['timeout', async () => { throw Object.assign(new Error('private URL'), { name: 'AbortError' }); }],
  ['HTTP', async () => ({ ok: false })],
  ['parsing', async () => ({ ok: true, json: async () => { throw new SyntaxError('private payload'); } })],
]) test(`${label} failure is controlled 503, never generic 500`, async () => {
  const h = harness({ resolve: () => resolveBirthplace(input.birthplace, input.dateOfBirth, { fetchImpl }) });
  const r = await h.request(); assert.equal(r.status, 503); assert.equal(r.data.error, 'BIRTHPLACE_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(h.logs.join(' '), /private URL|private payload/);
});
test('timezone unresolved differs from timezone service outage', async () => {
  const overseas = { ...candidate, address: { ...candidate.address, country_code: 'us' } };
  await assert.rejects(resolveBirthplace(input.birthplace, input.dateOfBirth, { timezoneKey: '', fetchImpl: async () => response([overseas]) }),
    { code: 'BIRTHPLACE_TIMEZONE_UNRESOLVED', status: 422 });
  let calls = 0;
  await assert.rejects(resolveBirthplace(input.birthplace, input.dateOfBirth, { timezoneKey: 'fixture', fetchImpl: async () => {
    if (++calls === 1) return response([overseas]); throw new Error('outage');
  } }), { code: 'BIRTHPLACE_SERVICE_UNAVAILABLE', status: 503, stage: 'TIMEZONE_RESOLUTION' });
});
test('ambiguous candidates require detail; district fallback and invalid coordinates are rejected', async () => {
  await assert.rejects(resolveBirthplace(input.birthplace, input.dateOfBirth, { fetchImpl: async () => response([candidate, { ...candidate, lat: '26.1' }]) }), { code: 'BIRTHPLACE_AMBIGUOUS' });
  await assert.rejects(resolveBirthplace('Missing Village, India', input.dateOfBirth, { fetchImpl: async () => response([candidate]) }), { code: 'BIRTHPLACE_UNRESOLVED' });
  await assert.rejects(resolveBirthplace(input.birthplace, input.dateOfBirth, { fetchImpl: async () => response([{ ...candidate, lat: '' }]) }), { code: 'BIRTHPLACE_SERVICE_UNAVAILABLE' });
});

test('a POI inside the village and a conflicting geographic context are not birthplace matches', async () => {
  await assert.rejects(resolveBirthplace(input.birthplace, input.dateOfBirth, { fetchImpl: async () => response([{ ...candidate, addresstype: 'hospital' }]) }), { code: 'BIRTHPLACE_UNRESOLVED' });
  await assert.rejects(resolveBirthplace('Test Village, Wrong State, India', input.dateOfBirth, { fetchImpl: async () => response([candidate]) }), { code: 'BIRTHPLACE_UNRESOLVED' });
});
test('complete trusted legacy inputs migrate, never legacy astrology', async () => {
  const legacy = { id: 'owner-uuid', name: input.name, gender: input.gender, dob: input.dateOfBirth,
    birth_time: input.birthTime, birth_time_certainty: 'EXACT', birth_city: input.birthplace,
    language: 'english', birthDataConsent: true, rashi: 'OLD', nakshatra: 'OLD' };
  const draft = legacyAccountBirth(legacy, null, 'owner-uuid');
  assert.equal(draft.automaticMigrationAllowed, true); assert.equal(draft.rashi, undefined);
  const h = harness(); assert.equal((await h.request(draft)).status, 200);
  assert.equal(h.tables.jyotish_profiles[0].chart_data, null);
  assert.equal(legacyAccountBirth({ ...legacy, id: 'other' }, null, 'owner-uuid').automaticMigrationAllowed, false);
  assert.equal(legacyAccountBirth({ ...legacy, birthDataConsent: false }, null, 'owner-uuid').automaticMigrationAllowed, false);
  const partial = legacyAccountBirth({ ...legacy, birth_time: null, timeSlot: 'morning' }, null, 'owner-uuid');
  assert.equal(partial.birthTime, null); assert.equal(partial.dateOfBirth, input.dateOfBirth);
  assert.equal(partial.automaticMigrationAllowed, false);
});
test('DharmaChat remains an authenticated canonical chart consumer', () => {
  const code = source.slice(source.indexOf('async function getUserAstrologyContext'), source.indexOf('//', source.indexOf('async function getUserAstrologyContext')));
  assert.match(code, /sbSelect\('jyotish_profiles'/); assert.match(code, /status=eq.KUNDLI_READY/);
  assert.doesNotMatch(code, /userRecord\.rashi|userRecord\.nakshatra/);
});

for (const hasPrevious of [false, true]) test(`generation outage preserves birth profile and previous chart=${hasPrevious}`, async () => {
  const birth = { user_id: 'owner', date_of_birth: input.dateOfBirth, birth_time: input.birthTime,
    utc_offset_minutes: 330, latitude: 25.1, longitude: 78.1, input_fingerprint: 'new', profile_version: 2 };
  const oldChart = { status: 'KUNDLI_READY', input_fingerprint: 'old', chart_data: { normalized: { retained: true } } };
  const tables = { birth_profiles: [birth], jyotish_profiles: hasPrevious ? [oldChart] : [{ status: 'KUNDLI_PENDING' }] };
  let handler;
  const context = { app: { post: (_path, _auth, fn) => { handler = fn; } }, requireSupabaseUser: () => {},
    checkRateLimit: () => true, process: { env: {} }, canCallAPI: () => true,
    CALCULATION_STANDARD: { calculationVersion: 'fixture' }, formatUtcOffset: lifecycle.formatUtcOffset,
    validateAuthoritativeBirthProfile: () => ({ valid: true }),
    sbSelect: async table => tables[table], sbUpdate: async (table, _query, patch) => { tables[table] = [{ ...tables[table][0], ...patch }]; },
    fetchBasicKundli: async () => { throw new Error('fixture outage'); }, ProkeralaError: class extends Error {},
    console: { warn() {} } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("app.post('/account/kundli/generate'"), source.indexOf("app.get('/admin/ai/health'")), context);
  let status;
  await handler({ authUser: { id: 'owner' } }, { status(value) { status = value; return this; }, json() {} });
  assert.equal(status, 503); assert.deepEqual(tables.birth_profiles, [birth]);
  if (hasPrevious) assert.deepEqual(tables.jyotish_profiles, [oldChart]);
  else assert.equal(tables.jyotish_profiles[0].status, 'PROVIDER_UNAVAILABLE');
});
