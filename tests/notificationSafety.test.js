'use strict';
const assert = require('node:assert/strict');
const { isSafeNotificationRoute, ownsNotification } = require('../utils/notificationSafety');

assert.equal(isSafeNotificationRoute('/payment'), true);
assert.equal(isSafeNotificationRoute('https://evil.example'), false);
assert.equal(isSafeNotificationRoute('/unknown'), false);
assert.equal(ownsNotification({ user_id: 'user-a' }, 'user-a'), true);
assert.equal(ownsNotification({ user_id: 'user-b' }, 'user-a'), false);
console.log('notificationSafety regression tests: PASS');
