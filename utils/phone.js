'use strict';

function normalizeIndianAuthPhone(value) {
  let phone = String(value ?? '').trim().replace(/[\s\-()]/g, '');
  if (phone.startsWith('+')) phone = phone.slice(1);
  if (/^91\d{10}$/.test(phone)) phone = phone.slice(2);
  return /^[6-9]\d{9}$/.test(phone) ? phone : '';
}

module.exports = { normalizeIndianAuthPhone };
