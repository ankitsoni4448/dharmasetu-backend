'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf("app.get('/mantras'");
const end = source.indexOf("app.get('/mantras/:id'", start);
const route = source.slice(start, end > start ? end : start + 5000);

test('Mantra catalog route reads active Supabase catalog records', () => {
  assert.match(route, /sbSelect\('mantra_catalog'/);
  assert.match(route, /is_active=eq\.true/);
  assert.match(route, /id=eq\./);
  assert.match(route, /const fetchedCount = mantras\.length/);
  assert.match(route, /has_more: fetchedCount === safeLimit/);
  assert.match(route, /Math\.min\(100,/);
});

test('Mantra catalog route reports backend failure instead of a successful empty catalog', () => {
  assert.match(route, /status\(503\)\.json\(\{ success: false, error: 'MANTRA_CATALOG_UNAVAILABLE' \}\)/);
  assert.doesNotMatch(route, /source: 'not_configured'/);
});
