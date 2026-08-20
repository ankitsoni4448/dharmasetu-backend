'use strict';

const NOTIFICATION_TYPES = new Set(['system','account','payment','subscription','festival','panchang','kundli','mantra','content','announcement','security']);
const SAFE_NOTIFICATION_ROUTES = new Set(['/payment','/profile','/katha_vault','/mantra_library','/kundli','/panchang']);

function isSafeNotificationRoute(route) {
  return !route || SAFE_NOTIFICATION_ROUTES.has(route);
}

function ownsNotification(notification, authUserId) {
  return Boolean(notification && authUserId && notification.user_id === authUserId);
}

module.exports = { NOTIFICATION_TYPES, SAFE_NOTIFICATION_ROUTES, isSafeNotificationRoute, ownsNotification };
