'use strict';
const crypto = require('crypto');

const GENDERS = new Set(['male', 'female', 'other', 'prefer_not_to_say']);
const TIME_CERTAINTY = new Set(['EXACT', 'APPROXIMATE', 'UNCERTAIN', 'UNKNOWN']);
const LANGUAGES = new Set(['hindi', 'english']);

function isValidIsoDate(value, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const earliest = Date.UTC(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate());
  return date.getTime() <= today && date.getTime() >= earliest;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function validateOnboarding(input, now = new Date()) {
  const errors = [];
  if (!String(input.name || '').trim() || String(input.name).trim().length > 100) errors.push('INVALID_NAME');
  if (!GENDERS.has(input.gender)) errors.push('INVALID_GENDER');
  if (!isValidIsoDate(input.dateOfBirth, now)) errors.push('INVALID_DATE_OF_BIRTH');
  if (!TIME_CERTAINTY.has(input.birthTimeCertainty)) errors.push('INVALID_BIRTH_TIME_CERTAINTY');
  if (input.birthTimeCertainty !== 'UNKNOWN' && !isValidTime(input.birthTime)) errors.push('INVALID_BIRTH_TIME');
  if (!String(input.birthplace || '').trim()) errors.push('INVALID_BIRTHPLACE');
  if (!LANGUAGES.has(input.language)) errors.push('INVALID_LANGUAGE');
  if (input.birthDataConsent !== true) errors.push('BIRTH_DATA_CONSENT_REQUIRED');
  return { valid: errors.length === 0, errors };
}

function birthInputFingerprint(profile) {
  const canonical = [profile.date_of_birth, profile.birth_time || '', profile.birth_time_certainty,
    Number(profile.latitude).toFixed(6), Number(profile.longitude).toFixed(6), profile.timezone].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function formatUtcOffset(minutes) {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < -720 || value > 840) throw new Error('Invalid UTC offset');
  const sign = value >= 0 ? '+' : '-';
  const absolute = Math.abs(value);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

module.exports = { GENDERS, TIME_CERTAINTY, LANGUAGES, isValidIsoDate, isValidTime, validateOnboarding, birthInputFingerprint, formatUtcOffset };

