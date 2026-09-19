'use strict';
/* global __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { birthInputFingerprint } = require('../utils/accountLifecycle');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const onboarding = server.slice(server.indexOf("app.post('/account/onboarding'"), server.indexOf("app.post('/account/kundli/generate'"));
const generate = server.slice(server.indexOf("app.post('/account/kundli/generate'"), server.indexOf("app.get('/admin/ai/health'"));

test('stored HH:mm:ss and submitted HH:mm share one calculation fingerprint', () => {
  const profile = { date_of_birth: '1990-01-01', birth_time: '12:30', birth_time_certainty: 'EXACT',
    latitude: 25.915, longitude: 78.566, timezone: 'Asia/Kolkata' };
  assert.equal(birthInputFingerprint(profile), birthInputFingerprint({ ...profile, birth_time: '12:30:00' }));
  assert.notEqual(birthInputFingerprint(profile), birthInputFingerprint({ ...profile, birth_time: '12:31' }));
  assert.notEqual(birthInputFingerprint(profile), birthInputFingerprint({ ...profile, date_of_birth: '1990-01-02' }));
  assert.notEqual(birthInputFingerprint(profile), birthInputFingerprint({ ...profile, longitude: 78.567 }));
});

test('onboarding keeps the previous authoritative chart while birth input changes', () => {
  assert.match(onboarding, /birthChanged = !existingBirth \|\| existingBirth\.input_fingerprint !== fingerprint/);
  assert.match(onboarding, /savedReady \? 'KUNDLI_READY'/);
  assert.match(onboarding, /if \(!existingJyotish\) await sbUpsert\('jyotish_profiles'/);
  assert.doesNotMatch(onboarding, /if \(existingJyotish\)[\s\S]{0,300}chart_data: null/);
  assert.match(onboarding, /requiresKundliGeneration: !timeInsufficient && !savedReady/);
});

test('generation validates before activation and does not overwrite a valid chart on failure', () => {
  assert.match(generate, /validateKundliReadiness\(normalized, birth/);
  assert.match(generate, /if \(existing\?\.status !== 'KUNDLI_READY'\) await sbUpsert\('jyotish_profiles'/);
  assert.match(generate, /if \(previous\?\.status !== 'KUNDLI_READY'\) await sbUpdate\('jyotish_profiles'/);
  assert.match(generate, /status: 'KUNDLI_READY'[\s\S]*chart_data: \{ providerModules:/);
  assert.match(generate, /existing\.input_fingerprint === birth\.input_fingerprint/);
  assert.match(generate, /if \(!birth\) return res\.status\(409\)\.json\(\{ error: 'BIRTH_PROFILE_REQUIRED' \}\)/);
});

test('legacy compatibility writes use only columns that exist in production schema', () => {
  assert.doesNotMatch(onboarding, /legacyUser\s*=\s*\{[^}]*firebase_uid/);
  assert.doesNotMatch(generate, /sbUpdate\('users'[^\n]*updated_at/);
});
