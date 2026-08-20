'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'admin_dashboard.html'), 'utf8');

assert.match(server, /app\.post\('\/ai\/feedback', requireSupabaseUser/);
assert.match(server, /sbUpsert\('ai_feedback', entry, 'user_id,message_id'\)/);
assert.doesNotMatch(server, /patch\.ai_answer\s*=/);
assert.match(server, /'correction_draft','corrected'/);
assert.match(server, /verification === 'verified'/);
assert.match(dashboard, /id="correction-modal"/);
assert.doesNotMatch(dashboard, /prompt\('Enter the approved correct answer/);
assert.match(dashboard, /User Rating:/);

assert.match(server, /app\.get\('\/notifications', requireSupabaseUser/);
assert.match(server, /app\.get\('\/notifications\/unread-count', requireSupabaseUser/);
assert.match(server, /app\.patch\('\/notifications\/:id\/read', requireSupabaseUser/);
assert.match(server, /app\.post\('\/notifications\/read-all', requireSupabaseUser/);
assert.match(server, /user_id=eq\.\$\{encodeURIComponent\(req\.authUser\.id\)\}/);
assert.match(server, /SAFE_NOTIFICATION_ROUTES\.has\(safeRoute\)/);
assert.ok(server.indexOf('completeProviderAnswer(result') < server.indexOf("rpc/consume_ai_usage"), 'completion must finish before quota consumption');
assert.equal((server.match(/rpc\/reserve_ai_usage/g) || []).length, 1, 'chat route must reserve quota only once');
console.log('backend contract tests: PASS');
