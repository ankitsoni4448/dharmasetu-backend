'use strict';
const { isValidIsoDate, GENDERS, LANGUAGES } = require('./accountLifecycle');

// The caller supplies only the record obtained for this authenticated account.
// Phone-linked older records may prefill inputs; automatic migration requires UUID ownership.
function legacyAccountBirth(legacy, profile, authUserId) {
  if (!legacy && !profile) return null;
  const source = legacy || {};
  const canonical = profile || {};
  const text = value => typeof value === 'string' ? value.trim() : '';
  const dob = source.date_of_birth || source.dob;
  const certainty = source.birth_time_certainty || source.birthTimeCertainty;
  const rawTime = source.timeMode === 'slot' || source.timeSlot ? '' : source.birth_time || source.birthTime;
  const time = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(String(rawTime || '')) ? rawTime.slice(0, 5) : null;
  const draft = {
    name: text(canonical.name || source.name).slice(0, 100),
    gender: GENDERS.has(canonical.gender || source.gender) ? canonical.gender || source.gender : '',
    dateOfBirth: isValidIsoDate(dob) ? dob : '',
    birthTime: time,
    birthTimeCertainty: time && ['EXACT', 'APPROXIMATE', 'UNCERTAIN'].includes(certainty) ? certainty : '',
    birthplace: text(source.birthplace_input || source.birth_city || source.birthCity).slice(0, 200),
    language: LANGUAGES.has(canonical.language || source.language) ? canonical.language || source.language : 'english',
    interests: [],
    birthDataConsent: Boolean(canonical.birth_data_consent_at && canonical.birth_data_consent_version)
      || source.birthDataConsent === true,
  };
  return { ...draft, automaticMigrationAllowed: source.id === authUserId && draft.birthDataConsent
    && Boolean(draft.name && draft.gender && draft.dateOfBirth && draft.birthTime
      && draft.birthTimeCertainty && draft.birthplace) };
}
module.exports = { legacyAccountBirth };
