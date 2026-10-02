'use strict';

// Detection only: sacred text is never decoded, rewritten or guessed here.
function corruptionTypes(value) {
  if (typeof value !== 'string') return [];
  const types = [];
  if (/\uFFFD/.test(value)) types.push('REPLACEMENT_CHARACTER');
  if (/ï¿½|Ã¯Â¿Â½/.test(value)) types.push('ENCODED_REPLACEMENT');
  if (/[àá][¤¥¦§]|â[€™œž“”–—€¦]|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]/u.test(value)) types.push('MOJIBAKE');
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) types.push('UNPAIRED_SURROGATE');
  if (/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/iu.test(value)) types.push('HTML_ENTITY');
  if (/\r(?!\n)|[\t\u00A0]| {2,}/u.test(value)) types.push('INVALID_WHITESPACE');
  return types;
}
function sacredTextFindings(value) {
  const types=corruptionTypes(value);
  if(typeof value!=='string'||!value.trim())types.push('EMPTY_SACRED_TEXT');
  else {
    if(value!==value.normalize('NFC'))types.push('NON_NFC_NORMALIZATION');
    if(/[\u0900-\u097F]/u.test(value)&&/[\u0980-\u0DFF]/u.test(value))types.push('MIXED_INDIC_SCRIPTS');
  }
  return [...new Set(types)];
}
const hasReplacementCorruption = value => corruptionTypes(value).length > 0;
function qualityFindings(records) {
  const findings = [];
  for (const record of records) {
    const walk = (value, field) => {
      if (typeof value === 'string') {
        for (const type of corruptionTypes(value)) findings.push({record_id:record.id, field, corruption_type:type,
          original_value:value, safe_action:/sanskrit|sanskritText/.test(field) ? 'WITHHOLD_SACRED_TEXT_HUMAN_SOURCE_REVIEW_NO_AUTO_REPAIR' : 'WITHHOLD_FIELD_CONTENT_REVIEW'});
      } else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => walk(child, field ? `${field}.${key}` : key));
    };
    walk(record, '');
  }
  return findings;
}
module.exports = { corruptionTypes, sacredTextFindings, hasReplacementCorruption, qualityFindings };
