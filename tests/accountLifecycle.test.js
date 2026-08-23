'use strict';
const assert = require('assert');
const { validateOnboarding, isValidIsoDate, formatUtcOffset, birthInputFingerprint } = require('../utils/accountLifecycle');

const valid = { name:'Test User', gender:'prefer_not_to_say', dateOfBirth:'1990-02-28', birthTime:'23:59', birthTimeCertainty:'EXACT', birthplace:'Delhi, India', language:'hindi', birthDataConsent:true };
assert.equal(validateOnboarding(valid, new Date('2026-08-22T00:00:00Z')).valid, true);
assert.equal(isValidIsoDate('2025-02-29', new Date('2026-08-22T00:00:00Z')), false);
assert.equal(isValidIsoDate('2027-01-01', new Date('2026-08-22T00:00:00Z')), false);
assert.equal(validateOnboarding({ ...valid, birthTimeCertainty:'UNKNOWN', birthTime:'' }).valid, true);
assert.equal(validateOnboarding({ ...valid, birthplace:'' }).errors.includes('INVALID_BIRTHPLACE'), true);
assert.equal(formatUtcOffset(330), '+05:30');
assert.equal(birthInputFingerprint({ date_of_birth:'1990-02-28', birth_time:'23:59', birth_time_certainty:'EXACT', latitude:28.6, longitude:77.2, timezone:'Asia/Kolkata' }).length, 64);
console.log('account lifecycle regression tests: PASS');
