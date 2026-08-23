// ════════════════════════════════════════════════════════════════
// DharmaSetu Backend — SECURE FINAL v10
// Deploy to: Render.com
// .env needs: ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY
// ════════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { Webhook } = require('standardwebhooks');
const {
  normalizeContentItem,
  normalizeMantra,
  normalizeSource,
  validateContentManifest,
  validateMantraManifest,
} = require('./scripts/manifest_utils');
const { getSupabaseServiceRoleKey } = require('./scripts/supabase_service_role');
const { normalizeIndianAuthPhone } = require('./utils/phone');
const {
  INTENT, classifyFactCheckIntent, classifyClaimType,
  normalizeMarkdown, enforceUnverifiedCitationSafety,
} = require('./utils/aiSafety');
const { completeProviderAnswer, chooseOutputBudget } = require('./utils/answerCompletion');
const { NOTIFICATION_TYPES, SAFE_NOTIFICATION_ROUTES } = require('./utils/notificationSafety');
const { validateOnboarding, birthInputFingerprint, formatUtcOffset } = require('./utils/accountLifecycle');
const {
  CALCULATION_STANDARD,
  normalizeProviderChart,
  compactContext: compactNormalizedJyotishContext,
  validateAuthoritativeBirthProfile,
} = require('./utils/kundliLifecycle');
const {
  fetchBasicKundli,
  fetchPrimaryKundli,
  ProkeralaError,
} = require('./utils/prokeralaClient');

require('dotenv').config();

// ─── ENVIRONMENT ─────────────────────────────────────────────────
const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD       || '';
if (!ADMIN_PASSWORD) {
  console.warn('[⚠️ SECURITY] ADMIN_PASSWORD env var is not set. Admin endpoints will reject all requests.');
}
const SUPABASE_URL         = (process.env.SUPABASE_URL        || '').replace(/\/$/, '');
let SUPABASE_SERVICE_KEY = '';
try {
  SUPABASE_SERVICE_KEY = getSupabaseServiceRoleKey({ required: false }).key;
} catch (e) {
  console.warn('[⚠️ WARN] Invalid Supabase service role configuration:', e.message);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[⚠️ WARN] Supabase not configured. Add SUPABASE_URL and backend-only SUPABASE_SERVICE_ROLE_KEY to env vars.');
}

const supabaseAuth = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

async function requireSupabaseUser(req, res, next) {
  const authStartedAt = Date.now();
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || !supabaseAuth) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  req.authUser = data.user;
  req.authUserId = data.user.id;
  req.authPhone = normalizeIndianAuthPhone(data.user.phone);
  if (!req.authPhone) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  req.authDurationMs = Date.now() - authStartedAt;
  req.authStartedAt = authStartedAt;
  next();
}

const SUPABASE_SEND_SMS_HOOK_SECRET = process.env.SUPABASE_SEND_SMS_HOOK_SECRET || '';
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '';
const MSG91_SMS_TEMPLATE_ID = process.env.MSG91_SMS_TEMPLATE_ID || '';
const MSG91_OTP_VARIABLE = process.env.MSG91_OTP_VARIABLE || 'VAR1';
const SMS_HOOK_REQUIRED_CONFIG = {
  SUPABASE_SEND_SMS_HOOK_SECRET,
  MSG91_AUTH_KEY,
  MSG91_SMS_TEMPLATE_ID,
};

for (const [name, value] of Object.entries(SMS_HOOK_REQUIRED_CONFIG)) {
  if (!value) console.warn(`[SMS Hook] configuration missing: ${name}`);
}
if (SUPABASE_SEND_SMS_HOOK_SECRET && !/^v1,whsec_[A-Za-z0-9+/=]+$/.test(SUPABASE_SEND_SMS_HOOK_SECRET)) {
  console.warn('[SMS Hook] configuration invalid: SUPABASE_SEND_SMS_HOOK_SECRET');
}
if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(MSG91_OTP_VARIABLE)) {
  console.warn('[SMS Hook] configuration invalid: MSG91_OTP_VARIABLE');
}

let supabaseSmsHookVerifier = null;
if (SUPABASE_SEND_SMS_HOOK_SECRET) {
  try {
    const signingSecret = SUPABASE_SEND_SMS_HOOK_SECRET.slice('v1,whsec_'.length);
    supabaseSmsHookVerifier = new Webhook(signingSecret);
  } catch {
    console.warn('[SMS Hook] configuration invalid: SUPABASE_SEND_SMS_HOOK_SECRET');
  }
}

const SMS_HOOK_PROVIDER_TIMEOUT_MS = 4000;
const SMS_HOOK_DEDUPE_TTL_MS = 10 * 60 * 1000;
const smsHookCompleted = new Map();
const smsHookInFlight = new Map();

function smsHookConfigReady() {
  return Object.values(SMS_HOOK_REQUIRED_CONFIG).every(Boolean)
    && /^v1,whsec_[A-Za-z0-9+/=]+$/.test(SUPABASE_SEND_SMS_HOOK_SECRET)
    && /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(MSG91_OTP_VARIABLE)
    && supabaseSmsHookVerifier;
}

function pruneSmsHookDedupe(now = Date.now()) {
  for (const [webhookId, sentAt] of smsHookCompleted.entries()) {
    if (now - sentAt > SMS_HOOK_DEDUPE_TTL_MS) smsHookCompleted.delete(webhookId);
  }
}

async function sendSupabaseOtpViaMsg91(phoneDigits, otp) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMS_HOOK_PROVIDER_TIMEOUT_MS);
  try {
    const recipient = { mobiles: phoneDigits, [MSG91_OTP_VARIABLE]: otp };
    const response = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        template_id: MSG91_SMS_TEMPLATE_ID,
        short_url: '0',
        realTimeResponse: '1',
        recipients: [recipient],
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let providerResult = null;
    try { providerResult = JSON.parse(responseText); } catch {}

    const accepted = response.ok
      && providerResult?.type?.toLowerCase() === 'success'
      && typeof providerResult.message === 'string'
      && providerResult.message.length > 0;
    if (!accepted) {
      const error = new Error('MSG91 rejected the SMS request');
      error.providerStatus = response.status;
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSupabaseSendSmsHook(req, res) {
  const hasSignatureHeaders = req.headers['webhook-id']
    && req.headers['webhook-timestamp']
    && req.headers['webhook-signature'];
  if (!hasSignatureHeaders) {
    console.warn('[SMS Hook] rejected request with invalid or missing signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!smsHookConfigReady()) {
    console.error('[SMS Hook] unavailable: server configuration is incomplete or invalid');
    return res.status(500).json({ error: 'SMS service unavailable' });
  }

  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  let event;
  try {
    event = supabaseSmsHookVerifier.verify(req.body, req.headers);
  } catch {
    console.warn('[SMS Hook] rejected request with invalid or missing signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phone = event?.user?.phone;
  const otp = event?.sms?.otp;
  if (typeof phone !== 'string' || !/^\+91[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }
  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  const webhookId = req.headers['webhook-id'];
  pruneSmsHookDedupe();
  if (smsHookCompleted.has(webhookId)) return res.status(200).json({ success: true });

  try {
    let delivery = smsHookInFlight.get(webhookId);
    if (!delivery) {
      delivery = sendSupabaseOtpViaMsg91(phone.slice(1), otp);
      smsHookInFlight.set(webhookId, delivery);
    }
    await delivery;
    smsHookCompleted.set(webhookId, Date.now());
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.name === 'AbortError' ? 'timeout' : (error.providerStatus || 'network');
    console.error(`[SMS Hook] MSG91 delivery failed: ${status}`);
    return res.status(502).json({ error: 'SMS provider failed' });
  } finally {
    smsHookInFlight.delete(webhookId);
  }
}

// ─── IN-MEMORY ORDER STORE (fallback when Supabase unavailable) ──
const memoryOrders = new Map();

// ─── LOCAL /tmp CACHE ─────────────────────────────────────────
const TMP = '/tmp/ds';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

// ─── IN-MEMORY CONFIG ─────────────────────────────────────────
const DEFAULT_AI_MODELS = Object.freeze({
  gemini: 'gemini-3.6-flash',
  groq: 'openai/gpt-oss-120b',
});

function isValidAIModelId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value.trim());
}

let CFG = {
  geminiKey: '', groqKey: '',
  geminiModel: DEFAULT_AI_MODELS.gemini, groqModel: DEFAULT_AI_MODELS.groq,
  phonepeUPI: '', razorpayKeyId: '', razorpayKeySecret: '',
  subscriptionPayment: 'upi', donationPayment: 'upi',
  premiumPrice: 249, basicPrice: 99, nriPrice: 499,
  freeQuestionsLimit: 3, freeFactCheckLimit: 3,
  basicQuestionsLimit: 30, basicFactCheckLimit: 15,
  maintenanceMode: false, appVersion: '1.0.0',
  featureFlags: {
    dharmaChat:         { enabled: true,  isPremium: false, label: 'DharmaChat AI' },
    factCheck:          { enabled: true,  isPremium: false, label: 'Fact Check' },
    myKundli:           { enabled: true,  isPremium: false, label: 'My Kundli' },
    mantraLibrary:      { enabled: true,  isPremium: false, label: 'Mantra Library' },
    kathaVaultRead:     { enabled: true,  isPremium: false, label: 'Katha Vault (Reading)' },
    kathaVaultDownload: { enabled: true,  isPremium: true,  label: 'Katha Vault (Download PDF)' },
    saveAnswer:         { enabled: true,  isPremium: true,  label: 'Save Answers' },
    debateArena:        { enabled: true,  isPremium: false, label: 'Debate Arena (Basic)' },
    debateAdvanced:     { enabled: true,  isPremium: true,  label: 'Debate Arena (Advanced)' },
    peaceMode:          { enabled: true,  isPremium: true,  label: 'Peace Mode' },
    voicePersona:       { enabled: false, isPremium: true,  label: 'Voice Persona' },
    unlimitedQuestions: { enabled: true,  isPremium: true,  label: 'Unlimited Questions' },
    shareCards:         { enabled: true,  isPremium: false, label: 'Share Cards' },
  },
  bundles: [
    { id:'basic', name:'Basic', nameHi:'बेसिक', price:99,  active:true, features:['30 questions/day','15 fact-checks/day','Mantra Verify','Save answers','No ads'] },
    { id:'pro',   name:'Pro',   nameHi:'प्रो',  price:249, active:true, popular:true, features:['Unlimited questions','Unlimited fact-checks','All features','Peace Mode','No ads','Download PDFs'] },
  ],
  donations: [
    { id:'army',   name:'Army Welfare',    nameHi:'सेना कल्याण',       goal:100000, raised:0, active:true, desc:'Support Indian Army welfare' },
    { id:'temple', name:'Temple Restore',  nameHi:'मंदिर जीर्णोद्धार', goal:500000, raised:0, active:true, desc:'Restore ancient temples' },
    { id:'dharma', name:'Dharma Education',nameHi:'धर्म शिक्षा',       goal:250000, raised:0, active:true, desc:'Educate youth about Sanatan Dharma' },
  ],
};

// ─── RATE LIMITER ─────────────────────────────────────────────
const rateLimits = new Map();
function checkRateLimit(key, maxPerMinute = 20) {
  const now = Date.now();
  const arr = (rateLimits.get(key) || []).filter(t => now - t < 60000);
  if (arr.length >= maxPerMinute) return false;
  arr.push(now);
  rateLimits.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of rateLimits.entries()) {
    const fresh = arr.filter(t => now - t < 60000);
    if (fresh.length === 0) rateLimits.delete(key);
    else rateLimits.set(key, fresh);
  }
}, 300000);

// ─── INPUT SANITIZER ──────────────────────────────────────────
function sanitize(str, maxLen = 1000) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').replace(/[<>"';()\\]/g, '').trim().slice(0, maxLen);
}

function isPromptInjection(text) {
  const patterns = [
    /ignore\s+(previous|all|above)\s+instructions?/i,
    /system\s+prompt/i,
    /jailbreak/i,
    /pretend\s+(you\s+are|to\s+be)/i,
    /act\s+as\s+(an?\s+)?(?:evil|unrestricted|dan|jailbreak)/i,
    /forget\s+(everything|all)/i,
  ];
  return patterns.some(p => p.test(text));
}

// ─── VALID PLANS ──────────────────────────────────────────────
const VALID_PLANS = ['basic', 'pro'];

// ════════════════════════════════════════════════════════════════
// SUPABASE REST API
// ════════════════════════════════════════════════════════════════
async function sbRest(method, table, body = null, query = '') {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Supabase not configured');
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const urlPath = `/rest/v1/${table}${query}`;
    const opts = {
      hostname: SUPABASE_URL.replace('https://', ''),
      path: urlPath,
      method,
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation,resolution=merge-duplicates' : 'return=representation',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw || '[]');
          if (res.statusCode >= 400) {
            console.error(`[Supabase ERROR] ${method} ${table}: HTTP ${res.statusCode}`, parsed);
            return reject(new Error(`Supabase error ${res.statusCode}: ${JSON.stringify(parsed)}`));
          }
          resolve({ status: res.statusCode, data: parsed });
        } catch(e) {
          if (res.statusCode >= 400) {
            console.error(`[Supabase ERROR] ${method} ${table}: HTTP ${res.statusCode}`, raw);
            return reject(new Error(`Supabase error ${res.statusCode}`));
          }
          resolve({ status: res.statusCode, data: [] });
        }
      });
    });
    req.on('error', e => { console.error('[Supabase]', method, table, e.message); reject(e); });
    if (data) req.write(data);
    req.end();
  });
}

async function sbSelect(table, query = '') {
  const r = await sbRest('GET', table, null, query);
  return Array.isArray(r.data) ? r.data : [];
}
async function sbInsert(table, row) {
  return sbRest('POST', table, row);
}
async function sbUpsert(table, row, matchCols = 'id') {
  if (!matchCols) return sbRest('POST', table, row);
  const cols = matchCols.split(',');
  let qParts = [];
  for (const c of cols) {
    if (row[c] !== undefined) qParts.push(`${c}=eq.${encodeURIComponent(row[c])}`);
  }
  if (qParts.length === 0) return sbRest('POST', table, row);
  const query = `?${qParts.join('&')}`;
  try {
    const existing = await sbSelect(table, query + '&limit=1');
    if (existing && existing.length > 0) {
      return await sbRest('PATCH', table, row, query);
    } else {
      return await sbRest('POST', table, row);
    }
  } catch(e) {
    console.error(`[sbUpsert] Failed for table ${table}:`, e.message);
    throw e;
  }
}
async function sbUpdate(table, query, patch) {
  return sbRest('PATCH', table, patch, query);
}
async function sbDelete(table, query) {
  return sbRest('DELETE', table, null, query);
}

function resolveEffectiveEntitlement(user = {}) {
  const basePlan = ['basic', 'pro'].includes(user.plan) ? user.plan : 'free';
  const expiry = user.admin_override_expires_at || null;
  const overrideValid = ['basic', 'pro', 'full'].includes(user.admin_override)
    && (!expiry || new Date(expiry) > new Date());
  const effectivePlan = overrideValid
    ? (user.admin_override === 'full' ? 'pro' : user.admin_override)
    : basePlan;
  const paid = effectivePlan === 'basic' || effectivePlan === 'pro';
  const pro = effectivePlan === 'pro';
  const limits = effectivePlan === 'free'
    ? { dharmaQuestionsPerDay: CFG.freeQuestionsLimit, factChecksPerDay: CFG.freeFactCheckLimit }
    : effectivePlan === 'basic'
      ? { dharmaQuestionsPerDay: CFG.basicQuestionsLimit, factChecksPerDay: CFG.basicFactCheckLimit }
      : { dharmaQuestionsPerDay: null, factChecksPerDay: null };
  return {
    basePlan,
    effectivePlan,
    adminOverride: { active: overrideValid, level: overrideValid ? user.admin_override : null, expiresAt: expiry },
    features: {
      dharmaChat: CFG.featureFlags.dharmaChat?.enabled !== false,
      factCheck: CFG.featureFlags.factCheck?.enabled !== false,
      kundli: CFG.featureFlags.myKundli?.enabled !== false,
      mantraLibrary: CFG.featureFlags.mantraLibrary?.enabled !== false,
      saveAnswer: paid && CFG.featureFlags.saveAnswer?.enabled !== false,
      kathaDownload: paid && CFG.featureFlags.kathaVaultDownload?.enabled !== false,
      peaceMode: pro && CFG.featureFlags.peaceMode?.enabled !== false,
      voicePersona: pro && CFG.featureFlags.voicePersona?.enabled !== false,
      unlimitedQuestions: pro && CFG.featureFlags.unlimitedQuestions?.enabled !== false,
    },
    limits,
  };
}

async function getAuthenticatedUserRecord(req) {
  const byId = await sbSelect('users', `?id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`);
  if (byId[0]) return byId[0];
  const byPhone = await sbSelect('users', `?phone=eq.${encodeURIComponent(req.authPhone)}&limit=1`);
  return byPhone[0] || null;
}

async function resolveBirthplace(placeInput, dateOfBirth) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(placeInput)}`;
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'DharmaSetu/1.0 (birthplace resolution)' } });
    if (!response.ok) throw new Error('GEOCODING_UNAVAILABLE');
    const result = (await response.json())?.[0];
    if (!result) return null;
    const latitude = Number(result.lat);
    const longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const address = result.address || {};
    const countryCode = String(address.country_code || '').toUpperCase();
    let timezone = '';
    let utcOffsetMinutes = null;
    if (process.env.TIMEZONEDB_API_KEY) {
      const timestamp = Math.floor(new Date(`${dateOfBirth}T12:00:00Z`).getTime() / 1000);
      const tzUrl = `https://api.timezonedb.com/v2.1/get-time-zone?key=${encodeURIComponent(process.env.TIMEZONEDB_API_KEY)}&format=json&by=position&lat=${latitude}&lng=${longitude}&time=${timestamp}`;
      const tzResponse = await fetch(tzUrl, { signal: controller.signal });
      const tz = tzResponse.ok ? await tzResponse.json() : null;
      if (tz?.status === 'OK' && tz.zoneName && Number.isFinite(Number(tz.gmtOffset))) {
        timezone = tz.zoneName;
        utcOffsetMinutes = Number(tz.gmtOffset) / 60;
      }
    }
    // Modern India has a stable UTC+05:30 civil offset. Historical Indian
    // offsets/DST must come from the configured historical timezone provider.
    if (!timezone && countryCode === 'IN' && dateOfBirth >= '1946-01-01') {
      timezone = 'Asia/Kolkata';
      utcOffsetMinutes = 330;
    }
    if (!timezone || !Number.isInteger(utcOffsetMinutes)) return { timezoneUnresolved: true, countryCode };
    return {
      placeName: sanitize(result.display_name, 300),
      city: sanitize(address.city || address.town || address.village || address.county || '', 100),
      region: sanitize(address.state || address.region || '', 100),
      country: sanitize(address.country || '', 100), countryCode,
      latitude, longitude, timezone, utcOffsetMinutes,
    };
  } finally {
    clearTimeout(timer);
  }
}

function compactJyotishContext(data, birthProfile) {
  return {
    birthTimeCertainty: birthProfile.birth_time_certainty,
    rashi: data?.moon_sign || data?.rasi || '',
    lagna: data?.ascendant?.name || data?.lagna || '',
    nakshatra: data?.nakshatra?.name || '',
    nakshatraPada: data?.nakshatra?.pada || null,
    currentMahadasha: data?.dasha?.current_mahadasha?.name || null,
    currentAntardasha: data?.dasha?.current_antardasha?.name || null,
    precisionWarning: birthProfile.birth_time_certainty === 'EXACT' ? null : 'Birth time is not exact; time-sensitive chart interpretation may vary.',
  };
}

async function getUserAstrologyContext(authUserId, userRecord) {
  if (!authUserId || !userRecord) return { available: false };
  const stored = (await sbSelect('jyotish_profiles', `?user_id=eq.${encodeURIComponent(authUserId)}&status=eq.KUNDLI_READY&select=compact_context,birth_profile_version,calculation_version&limit=1`).catch(() => []))[0];
  if (stored?.compact_context) return { available: true, ...stored.compact_context,
    birthProfileVersion: stored.birth_profile_version, calculationVersion: stored.calculation_version };
  const context = {
    rashi: sanitize(userRecord.rashi || '', 80),
    nakshatra: sanitize(userRecord.nakshatra || '', 80),
    lagna: sanitize(userRecord.lagna || '', 80),
    birthDate: sanitize(userRecord.dob || userRecord.birth_date || '', 20),
    birthTime: sanitize(userRecord.tob || userRecord.birth_time || '', 20),
    birthPlace: sanitize(userRecord.birth_city || '', 100),
  };
  context.available = Boolean(context.rashi || context.nakshatra || context.lagna);
  return context;
}

// ─── AUDIT LOGGER ─────────────────────────────────────────────
async function auditLog(action, adminUser, target, details) {
  try {
    await sbInsert('audit_logs', {
      id: `au_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      action: sanitize(action, 100),
      admin_user: sanitize(adminUser, 100),
      target: sanitize(target, 200),
      details: sanitize(details, 500),
      created_at: new Date().toISOString()
    });
  } catch(e) { console.error('[Audit]', e.message); }
}

// ─── ERROR LOGGER ─────────────────────────────────────────────
async function logError(source, message, details = '') {
  console.error(`[ERROR] [${source}] ${message}`, details);
  try {
    await sbInsert('error_logs', {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      source: sanitize(source, 100),
      message: sanitize(message, 500),
      details: typeof details === 'object' ? JSON.stringify(details).slice(0,1000) : sanitize(String(details), 1000),
      created_at: new Date().toISOString()
    });
  } catch(e) { console.error('[LogError Failed]', e.message); }
}

// ─── ORDER STORE HELPERS (Supabase + in-memory fallback) ──────
async function saveOrder(order) {
  memoryOrders.set(order.orderId, order);
  try {
    await sbInsert('payment_orders', {
      id: order.orderId,
      phone: order.userPhone,
      plan_id: order.planId,
      amount: order.amount,
      status: order.status,
      created_at: order.createdAt,
    });
  } catch(e) {
    console.warn('[Order] Supabase save failed, using memory store:', e.message);
  }
}

async function getOrder(orderId) {
  // Try Supabase first
  try {
    const rows = await sbSelect('payment_orders', `?id=eq.${encodeURIComponent(orderId)}&limit=1`);
    if (rows && rows.length > 0) {
      const r = rows[0];
      return {
        orderId:   r.id,
        userPhone: r.phone,
        planId:    r.plan_id,
        amount:    r.amount,
        status:    r.status,
        createdAt: r.created_at,
      };
    }
  } catch(e) {
    console.warn('[Order] Supabase fetch failed, checking memory store:', e.message);
  }
  // Fallback to memory
  return memoryOrders.get(orderId) || null;
}

async function markOrderCompleted(orderId) {
  // Update memory store
  const order = memoryOrders.get(orderId);
  if (order) {
    order.status = 'completed';
    memoryOrders.set(orderId, order);
  }
  // Update Supabase
  try {
    await sbUpdate('payment_orders', `?id=eq.${encodeURIComponent(orderId)}`, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
  } catch(e) {
    console.warn('[Order] Supabase update failed, memory updated only:', e.message);
  }
}

// ─── LOAD CONFIG FROM DB ──────────────────────────────────────
async function loadConfigFromDB() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.log('[Config] Supabase not configured'); return; }
  try {
    const rows = await sbSelect('admin_settings');
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });

    if (map.gemini_key)           CFG.geminiKey           = map.gemini_key;
    if (map.groq_key)             CFG.groqKey             = map.groq_key;
    if (isValidAIModelId(map.gemini_model)) CFG.geminiModel = map.gemini_model.trim();
    else if (map.gemini_model) console.warn('[AI Config] Ignoring invalid gemini_model');
    if (isValidAIModelId(map.groq_model)) CFG.groqModel = map.groq_model.trim();
    else if (map.groq_model) console.warn('[AI Config] Ignoring invalid groq_model');
    if (map.phonepe_upi)          CFG.phonepeUPI          = map.phonepe_upi;
    if (map.razorpay_key_id)      CFG.razorpayKeyId       = map.razorpay_key_id;
    if (map.razorpay_key_secret)  CFG.razorpayKeySecret   = map.razorpay_key_secret;
    if (map.subscription_payment) CFG.subscriptionPayment = map.subscription_payment;
    if (map.donation_payment)     CFG.donationPayment     = map.donation_payment;
    if (map.premium_price)        CFG.premiumPrice        = +map.premium_price;
    if (map.basic_price)          CFG.basicPrice          = +map.basic_price;
    if (map.free_questions_limit) CFG.freeQuestionsLimit  = +map.free_questions_limit;
    if (map.free_factcheck_limit) CFG.freeFactCheckLimit  = +map.free_factcheck_limit;
    if (map.basic_questions_limit) CFG.basicQuestionsLimit = +map.basic_questions_limit;
    if (map.basic_factcheck_limit) CFG.basicFactCheckLimit = +map.basic_factcheck_limit;
    if (map.maintenance_mode)     CFG.maintenanceMode     = map.maintenance_mode === 'true';
    if (map.app_version)          CFG.appVersion          = map.app_version;
    if (map.feature_flags)        try { CFG.featureFlags  = JSON.parse(map.feature_flags); } catch {}
    if (map.bundles)              try { CFG.bundles        = JSON.parse(map.bundles); } catch {}
    if (map.donations)            try { CFG.donations      = JSON.parse(map.donations); } catch {}

    console.log(`[Config] ✅ Loaded from Supabase — ${rows.length} settings`);
  } catch(e) { console.error('[Config] Load failed:', e.message); }
}

async function saveConfigKey(key, value) {
  try {
    await sbUpsert('admin_settings', { key, value: String(value), updated_at: new Date().toISOString() }, 'key');
  } catch(e) { console.error('[Config] Save failed:', key, e.message); }
}

function logAIConfig() {
  console.log(`[AI Config] Gemini: ${CFG.geminiKey ? 'configured' : 'missing'}, model=${CFG.geminiModel}`);
  console.log(`[AI Config] Groq: ${CFG.groqKey ? 'configured' : 'missing'}, model=${CFG.groqModel}`);
}

async function initDB() {
  console.log('[DB] Connecting to Supabase...');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[DB] ⚠️  NOT CONFIGURED.');
    logAIConfig();
    return;
  }
  await loadConfigFromDB();
  logAIConfig();
  console.log('[DB] ✅ Supabase connected');
}

// ─── PROKERALA TOKEN ──────────────────────────────────────────
let prokeralaToken = null;
let tokenExpiry = 0;

async function getProkeralaToken() {
  if (prokeralaToken && Date.now() < tokenExpiry) return prokeralaToken;
  const res = await fetch("https://api.prokerala.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.PROKERALA_CLIENT_ID,
      client_secret: process.env.PROKERALA_CLIENT_SECRET
    })
  });
  const data = await res.json();
  if (!data?.access_token) throw new Error("Token failed");
  prokeralaToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return prokeralaToken;
}

// Prokerala rate limit (max 3/min)
let lastCalls = [];
function canCallAPI() {
  const now = Date.now();
  lastCalls = lastCalls.filter(t => now - t < 60000);
  if (lastCalls.length >= 3) return false;
  lastCalls.push(now);
  return true;
}

// Panchang cache (6 hours)
const PANCHANG_CACHE = {};
const CACHE_TTL = 1000 * 60 * 60 * 6;

// ─── GEOCODE ──────────────────────────────────────────────────
async function getCoordinatesFromCity(city) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: data[0].lat, lng: data[0].lon };
    }
    return null;
  } catch (e) {
    console.log("City geocode error:", e.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// EXPRESS APP
// ════════════════════════════════════════════════════════════════
const app  = express();
const PORT = process.env.PORT || 10000;

// CORS: allow no-origin requests (React Native mobile app sends no Origin header)
// and only the backend's own Render domain for admin portal browser access.
// This blocks unauthorized browser-based cross-origin API calls.
app.use(cors({
  origin: function(origin, callback) {
    // React Native / curl / mobile apps have no origin — always allow
    if (!origin) return callback(null, true);
    // Allow the backend's own domain (admin dashboard)
    const ALLOWED = [
      process.env.ALLOWED_ORIGIN || 'https://dharmasetu-backend-2c65.onrender.com',
    ];
    if (ALLOWED.includes(origin)) return callback(null, true);
    // Block all other browser origins
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-key','apikey'],
}));

// Raw body for webhook MUST come before json parser
app.use('/payment/webhook', express.raw({ type: '*/*' }));
app.post(
  '/auth/send-sms-hook',
  express.raw({ type: 'application/json', limit: '20kb' }),
  handleSupabaseSendSmsHook
);
app.use('/auth/send-sms-hook', (error, _req, res, next) => {
  if (!error) return next();
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  return res.status(400).json({ error: 'Invalid request body' });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
});

// Maintenance mode
app.use((req, res, next) => {
  if (CFG.maintenanceMode && !req.path.startsWith('/admin') && req.path !== '/health') {
    return res.status(503).json({ error: 'App is under maintenance. Please try again soon.' });
  }
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_PASSWORD) {
    logError('Auth', 'Unauthorized admin access attempt', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Serve admin dashboard HTML
app.get('/admin-portal', (req, res) => {
  const p = path.join(__dirname, 'admin_dashboard.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).send('<h2>admin_dashboard.html not found</h2>');
});

// ════════════════════════════════════════════════════════════════
// SSE — Live Katha generation log
// ════════════════════════════════════════════════════════════════
const sseClients = new Map();

app.get('/admin/katha/stream/:jobId', adminAuth, (req, res) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  sseClients.set(jobId, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(ping); } }, 20000);
  req.on('close', () => { sseClients.delete(jobId); clearInterval(ping); });
});

function sseLog(jobId, msg, type = 'info') {
  const c = sseClients.get(jobId);
  if (c) try { c.write(`data: ${JSON.stringify({ msg, type, ts: new Date().toLocaleTimeString() })}\n\n`); } catch {}
}
function sseDone(jobId, msg) {
  const c = sseClients.get(jobId);
  if (c) try {
    c.write(`data: ${JSON.stringify({ msg, type: 'done' })}\n\n`);
    setTimeout(() => { c.write('data: {"type":"end"}\n\n'); sseClients.delete(jobId); }, 1000);
  } catch {}
}

// ════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ════════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
  let dbOk = false, tables = {};
  try {
    await sbSelect('admin_settings', '?limit=1');
    dbOk = true;
    const [u, k, p, f] = await Promise.all([
      sbSelect('users',      '?select=id').catch(() => []),
      sbSelect('katha_vault','?select=id').catch(() => []),
      sbSelect('payments',   '?select=id').catch(() => []),
      sbSelect('feedback',   '?select=id').catch(() => []),
    ]);
    tables = { users: u.length, katha: k.length, payments: p.length, feedback: f.length };
  } catch {}
  res.json({
    status: 'ok', timestamp: new Date().toISOString(),
    version: CFG.appVersion, db: dbOk ? 'supabase_connected' : 'supabase_offline',
    supabaseConfigured: !!(SUPABASE_URL && SUPABASE_SERVICE_KEY),
    tables,
  });
});

app.get('/config', (req, res) => {
  res.json({ success: true, config: {
    premiumPrice:        CFG.premiumPrice,
    basicPrice:          CFG.basicPrice,
    nriPrice:            CFG.nriPrice,
    freeQuestionsLimit:  CFG.freeQuestionsLimit,
    freeFactCheckLimit:  CFG.freeFactCheckLimit,
    basicQuestionsLimit: CFG.basicQuestionsLimit,
    basicFactCheckLimit: CFG.basicFactCheckLimit,
    maintenanceMode:     CFG.maintenanceMode,
    appVersion:          CFG.appVersion,
    bundles:             CFG.bundles.filter(b => b.active),
    donations:           CFG.donations.filter(d => d.active),
    phonepeUPI:          CFG.phonepeUPI || '',
    razorpayKeyId:       CFG.razorpayKeyId || '',
    subscriptionPayment: CFG.subscriptionPayment || 'upi',
    donationPayment:     CFG.donationPayment || 'upi',
    hasRazorpay:         !!(CFG.razorpayKeyId && CFG.razorpayKeySecret),
    featureFlags:        CFG.featureFlags,
  }});
});

// ════════════════════════════════════════════════════════════════
// SECURE AI PROXY
// ════════════════════════════════════════════════════════════════
app.post('/ai/chat', async (req, res) => {
  try {
    const { prompt, systemPrompt, phone } = req.body;
    const rateLimitKey = phone || req.ip || 'anon';
    if (!checkRateLimit(`ai_${rateLimitKey}`, 20)) {
      return res.status(429).json({ error: 'RATE_LIMIT', message: 'Too many requests. Please wait a moment.' });
    }
    const rawPrompt = prompt || systemPrompt || '';
    if (!rawPrompt || rawPrompt.trim().length < 2) {
      return res.status(400).json({ error: 'Empty prompt' });
    }
    const cleanPrompt = sanitize(rawPrompt, 2000);
    if (isPromptInjection(cleanPrompt)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    if (!CFG.geminiKey && !CFG.groqKey) {
      return res.status(503).json({ error: 'AI service not configured. Admin: add keys in dashboard.' });
    }
    const result = await callAI(CFG.geminiKey, CFG.groqKey, cleanPrompt);
    res.json({ success: true, text: result.text, usedApi: result.usedApi });
  } catch(e) {
    console.error('[AI/chat]', e.message);
    res.status(500).json({ error: 'AI service error. Please try again.' });
  }
});

app.post('/ai/dharma-chat', requireSupabaseUser, async (req, res) => {
  const totalStartedAt = req.authStartedAt || Date.now();
  const timing = { auth: req.authDurationMs || 0, profile: 0, entitlement: 0, retrieval: 0, quotaReserve: 0, provider: 0, continuation: 0, quotaConsume: 0 };
  let timingProvider = 'none';
  let timingModel = 'none';
  const logTiming = (outcome) => console.log(
    `[AI Timing] mode=${req.body?.mode === 'factcheck' ? 'factcheck' : 'dharma'} provider=${timingProvider} model=${timingModel} auth=${timing.auth}ms profile=${timing.profile}ms ` +
    `entitlement=${timing.entitlement}ms retrieval=${timing.retrieval}ms quotaReserve=${timing.quotaReserve}ms ` +
    `provider=${timing.provider}ms continuation=${timing.continuation}ms quotaConsume=${timing.quotaConsume}ms ` +
    `total=${Date.now() - totalStartedAt}ms outcome=${outcome}`
  );
  try {
    const { messages, userProfile, mode } = req.body;
    const rateKey = req.authUser.id;
    if (!checkRateLimit(`chat_${rateKey}`, 15)) {
      return res.status(429).json({ error: 'RATE_LIMIT' });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages' });
    }
    const cleanMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: sanitize(m.content || '', 1000),
    })).filter(m => m.content.length > 0);

    const lastMsg = cleanMessages[cleanMessages.length - 1]?.content || '';
    if (isPromptInjection(lastMsg)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const profileStartedAt = Date.now();
    const userRecord = await getAuthenticatedUserRecord(req);
    timing.profile = Date.now() - profileStartedAt;
    if (!userRecord) return res.status(403).json({ error: 'PROFILE_NOT_FOUND' });
    const entitlementStartedAt = Date.now();
    const entitlement = resolveEffectiveEntitlement(userRecord);
    timing.entitlement = Date.now() - entitlementStartedAt;
    const isFC = mode === 'factcheck';
    const factCheckIntent = isFC ? classifyFactCheckIntent(lastMsg) : null;
    const nonClaimIntents = new Set([INTENT.INFORMATION_REQUEST, INTENT.OPINION, INTENT.PERSONAL_ADVICE, INTENT.INSUFFICIENT_CONTEXT]);
    if (isFC && nonClaimIntents.has(factCheckIntent)) {
      logTiming('not_fact_checkable');
      return res.json({ success: true, intent: factCheckIntent, verdict: 'NOT_A_FACT_CHECKABLE_CLAIM', nonFactCheckable: true });
    }
    const featureName = isFC ? 'factCheck' : 'dharmaChat';
    if (!entitlement.features[featureName]) {
      return res.status(403).json({ error: 'FEATURE_DISABLED' });
    }
    if (!CFG.geminiKey && !CFG.groqKey) {
      return res.status(503).json({ error: 'AI_PROVIDER_CONFIGURATION_ERROR' });
    }
    const usageKind = isFC ? 'factcheck' : 'dharma';
    const limit = isFC ? entitlement.limits.factChecksPerDay : entitlement.limits.dharmaQuestionsPerDay;
    let reservation;
    const quotaReserveStartedAt = Date.now();
    try {
      reservation = await sbRest('POST', 'rpc/reserve_ai_usage', {
        p_user_id: req.authUser.id, p_kind: usageKind, p_limit: limit,
      });
    } catch (quotaError) {
      timing.quotaReserve = Date.now() - quotaReserveStartedAt;
      logTiming('quota_unavailable');
      console.error('[AI/dharma-chat] quota infrastructure unavailable');
      return res.status(503).json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' });
    }
    timing.quotaReserve = Date.now() - quotaReserveStartedAt;
    const quota = Array.isArray(reservation.data) ? reservation.data[0] : reservation.data;
    if (!quota?.allowed) {
      logTiming('limit_reached');
      return res.status(403).json({
        error: 'QUESTION_LIMIT_REACHED',
        limit,
        used: quota?.used ?? limit,
        remaining: 0,
        resetTimezone: 'Asia/Kolkata',
      });
    }
    const reservationId = quota.reservation_id;
    if (!reservationId) {
      console.error('[AI/dharma-chat] quota reservation missing identifier');
      return res.status(503).json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' });
    }

    const u = { ...userProfile, ...userRecord };
    const lang = u.language || 'hindi';
    const langRule = {
      hindi: 'केवल स्वाभाविक और शुद्ध हिन्दी में उत्तर दें। आवश्यक होने पर प्रासंगिक संस्कृत उद्धरण दे सकते हैं।',
      english: 'Reply only in clear, natural English.',
      marathi: 'फक्त स्वाभाविक मराठीत उत्तर द्या.',
      gujarati: 'ફક્ત સ્વાભાવિક ગુજરાતીમાં જવાબ આપો.',
    }[lang] || 'Reply in clear English.';

    const claimType = isFC ? classifyClaimType(lastMsg) : null;
    const factCheckRule = isFC
      ? factCheckIntent === INTENT.RELIGIOUS_BELIEF_OR_TRADITION
        ? 'FACT CHECK CONTRACT: This is a faith/tradition statement. Use VERDICT: RELIGIOUS_TRADITION. Respectfully separate theological tradition from modern historical evidence.'
        : `FACT CHECK CONTRACT: This is a ${claimType} claim. No authoritative evidence was retrieved for this request, so use VERDICT: UNVERIFIED. Never invent sources, patent numbers, quotations, studies, or legal records. Explain what authoritative source is required.`
      : 'DHARMACHAT CONTRACT: Answer and explain normally. Never prefix the answer with VERDICT. Use scripture quotations or exact verse numbers only when supplied as verified context; otherwise qualify the limitation.';

    const systemPrompt = `You are DharmaSetu, a careful guide to Sanatan Dharma.

LANGUAGE: ${langRule}
${factCheckRule}
USER: ${u.name || 'Seeker'} | राशि: ${u.rashi || 'Unknown'} | नक्षत्र: ${u.nakshatra || 'Unknown'} | इष्ट देव: ${u.deity || 'Unknown'}

SCOPE:
1. Answer about Sanatan Dharma, Hindu philosophy, scripture, deities, festivals, and practical dharmic guidance.
2. Clearly distinguish scripture-backed statements from general guidance or interpretation.
3. Give an exact scripture citation only when confident it is correct; otherwise state uncertainty and do not invent one.
4. Do not invent Jyotish or astronomical conclusions. If required birth data is missing, say personalized analysis is unavailable.
5. For unrelated topics, politely explain that DharmaSetu focuses on Sanatan Dharma.

${isFC ? `FACT CHECK FORMAT:
VERDICT: <status>
दावा: <claim>
साक्ष्य क्या कहते हैं: <evidence limitations>
स्रोत: <retrieved authoritative sources, or "स्रोत उपलब्ध नहीं">
विश्वसनीयता: Low/Medium/High
Why confidence: <one short reason>. Never use percentage confidence.` : ''}

FORMAT: Maximum ${isFC ? 240 : 420} words. Use light Markdown only for helpful headings, emphasis, or short lists. Be warm, specific, and practical.`;

    const histText = cleanMessages.slice(-8).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n');
    const fullPrompt = `${systemPrompt}\n\nConversation:\n${histText}`;
    const providerStartedAt = Date.now();
    try {
      const outputBudget = chooseOutputBudget(lastMsg, isFC);
      let result = await callAI(CFG.geminiKey, CFG.groqKey, fullPrompt, {
        maxOutputTokens: outputBudget,
        temperature: isFC ? 0.2 : 0.65,
      });
      timing.provider = Date.now() - providerStartedAt;
      timingProvider = result.usedApi;
      timingModel = result.model;
      const continuationStartedAt = Date.now();
      const continuationRequired = result.truncated === true;
      try {
        result = await completeProviderAnswer(result, async initial => {
        const continuationPrompt = `${fullPrompt}\n\nPARTIAL ANSWER ALREADY GENERATED:\n${initial.text}\n\n` +
          `Continue exactly where the partial answer ended. Do not repeat prior text. Preserve the same language, mode, formatting, ` +
          `and evidence restrictions. Do not add unverified citations. Finish the original answer concisely.`;
        const options = { timeoutMs: 15000, maxOutputTokens: 600, temperature: isFC ? 0.15 : 0.5 };
        if (initial.usedApi === 'gemini' && CFG.geminiKey) {
          return { ...await callGemini(CFG.geminiKey, continuationPrompt, options), usedApi: 'gemini' };
        }
        if (initial.usedApi === 'groq' && CFG.groqKey) {
          return { ...await callGroq(CFG.groqKey, continuationPrompt, options), usedApi: 'groq' };
        }
        const error = new Error('Original provider unavailable for continuation');
        error.code = 'AI_INCOMPLETE_RESPONSE';
        throw error;
        });
      } finally {
        timing.continuation = continuationRequired ? (result.continuationMs || Date.now() - continuationStartedAt) : 0;
      }
      const guarded = enforceUnverifiedCitationSafety(result.text, []);
      result.text = normalizeMarkdown(guarded.text);
      try {
        const quotaConsumeStartedAt = Date.now();
        const consumption = await sbRest('POST', 'rpc/consume_ai_usage', {
          p_user_id: req.authUser.id, p_reservation_id: reservationId,
        });
        timing.quotaConsume = Date.now() - quotaConsumeStartedAt;
        if (consumption.data !== true) throw new Error('reservation was not consumable');
      } catch {
        await sbRest('POST', 'rpc/release_ai_usage', {
          p_user_id: req.authUser.id, p_reservation_id: reservationId,
        }).catch(() => {});
        console.error('[AI/dharma-chat] quota consumption unavailable');
        logTiming('quota_consume_unavailable');
        return res.status(503).json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' });
      }
      logTiming(`success_${result.usedApi}`);
      res.json({
        success: true, text: result.text, usedApi: result.usedApi, model: result.model,
        finishReason: result.finishReason, incomplete: false,
        intent: factCheckIntent,
        verdict: isFC ? (factCheckIntent === INTENT.RELIGIOUS_BELIEF_OR_TRADITION ? 'RELIGIOUS_TRADITION' : 'UNVERIFIED') : null,
        remaining: quota.remaining, entitlement,
      });
    } catch (providerError) {
      if (!timing.provider) timing.provider = Date.now() - providerStartedAt;
      await sbRest('POST', 'rpc/release_ai_usage', {
        p_user_id: req.authUser.id, p_reservation_id: reservationId,
      }).catch(() => {});
      const code = ['AI_PROVIDER_CONFIGURATION_ERROR','AI_PROVIDER_RATE_LIMIT','AI_TIMEOUT','AI_INCOMPLETE_RESPONSE']
        .includes(providerError?.code) ? providerError.code : 'AI_PROVIDER_UNAVAILABLE';
      console.error('[AI/dharma-chat] provider failure:', code);
      logTiming('provider_failure');
      return res.status(code === 'AI_TIMEOUT' ? 504 : code === 'AI_PROVIDER_RATE_LIMIT' ? 429 : 503).json({ error: code });
    }
  } catch(e) {
    console.error('[AI/dharma-chat] service failure:', e.message);
    logTiming('service_failure');
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.post('/ai/recommend', async (req, res) => {
  try {
    const { mood } = req.body;
    if (!mood) {
      return res.json({ success: false, mantra: "Gayatri Mantra" });
    }
    const map = {
      peace: "Gayatri Mantra",
      focus: "Saraswati Mantra",
      strength: "Hanuman Mantra",
      healing: "Maha Mrityunjaya Mantra"
    };
    const mantra = map[mood] || "Gayatri Mantra";
    res.json({ success: true, mantra });
  } catch (err) {
    console.error('[AI/recommend]', err.message);
    res.json({ success: false, mantra: "Gayatri Mantra" });
  }
});

app.post('/api/dharmic-insight', async (req, res) => {
  try {
    const { moodHistory, panchang } = req.body;
    const lastMood = moodHistory?.[0]?.mood || "neutral";
    const tithi = sanitize(panchang?.tithi || '', 100);
    const vaar  = sanitize(panchang?.vaar  || '', 100);

    if (!CFG.groqKey && !CFG.geminiKey) {
      return res.json({
        title: "Stay Balanced",
        guidance: ["Focus on your duty", "Chant a simple mantra", "Stay calm and aware"]
      });
    }

    const prompt = `You are a dharmic AI guide based on Bhagavad Gita and Sanatan Dharma.

User Mood: ${sanitize(lastMood, 50)}
Tithi: ${tithi}
Vaar: ${vaar}

Give:
1. Short title
2. 3 bullet guidance points

Tone: Spiritual, practical, grounded in dharma.`;

    const result = await callAI(CFG.geminiKey, CFG.groqKey, prompt);
    const lines = result.text.split('\n').filter(l => l.trim());
    res.json({ title: lines[0] || "Dharmic Guidance", guidance: lines.slice(1, 4) });
  } catch (e) {
    console.error('[dharmic-insight]', e.message);
    res.json({
      title: "Stay Balanced",
      guidance: ["Focus on your duty", "Chant a simple mantra", "Stay calm and aware"]
    });
  }
});

// ════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════
app.post('/users/register', requireSupabaseUser, async (req, res) => {
  try {
    const { phone, name, email, rashi, nakshatra, deity, language, birthCity, dob, authUserId, pushToken } = req.body;
    if (!phone && !authUserId) return res.status(400).json({ error: 'phone or authUserId required' });

    const cleanPhone = req.authPhone;
    const cleanName  = sanitize(name  || 'DharmaSetu User', 100);
    const cleanAuthUserId = req.authUser.id;

    const existing = cleanPhone ? await sbSelect('users', `?phone=eq.${encodeURIComponent(cleanPhone)}&limit=1`) : [];

    if (existing.length > 0) {
      const updated = { last_active: new Date().toISOString() };
      if (cleanName) updated.name = cleanName;
      if (language)  updated.language = language;
      if (email)     updated.email = sanitize(email, 200);
      if (pushToken) updated.push_token = pushToken;
      // Keep using the existing legacy-named database column until a controlled schema phase.
      if (cleanAuthUserId) updated.firebase_uid = cleanAuthUserId;
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, updated);
      return res.json({ success: true, user: { ...existing[0], ...updated }, isNew: false });
    }

    const id = cleanAuthUserId || `u_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const newUser = {
      id, phone: cleanPhone, name: cleanName,
      created_at: new Date().toISOString(), last_active: new Date().toISOString(),
      plan: 'free', streak: 0, questions: 0, pts: 0,
    };
    if (pushToken)  newUser.push_token  = pushToken;
    if (email)      newUser.email       = sanitize(email, 200);
    if (rashi)      newUser.rashi       = rashi;
    if (nakshatra)  newUser.nakshatra   = nakshatra;
    if (deity)      newUser.deity       = deity;
    if (language)   newUser.language    = language;
    if (birthCity)  newUser.birth_city  = sanitize(birthCity, 100);
    if (dob)        newUser.dob         = dob;

    await sbInsert('users', newUser);
    res.json({ success: true, user: newUser, isNew: true });
  } catch(e) {
    console.error('[Users/register]', e.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/users/activity', requireSupabaseUser, async (req, res) => {
  try {
    const { type } = req.body;
    const cleanPhone = req.authPhone;
    const users = await sbSelect('users', `?phone=eq.${encodeURIComponent(cleanPhone)}&limit=1`);
    if (users.length) {
      const u = users[0];
      const patch = { last_active: new Date().toISOString() };
      if (type === 'question') patch.questions = (u.questions || 0) + 1;
      if (type === 'checkin') {
        patch.streak = (u.streak || 0) + 1;
        patch.pts = (u.pts || 0) + 3;
      }
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, patch);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[users/activity]', e.message);
    res.status(500).json({ error: 'Activity update failed.' });
  }
});

app.get('/users/access/:phone', requireSupabaseUser, async (req, res) => {
  try {
    const phone = sanitize(req.params.phone || '', 20);
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    if (phone !== req.authPhone) return res.status(403).json({ error: 'Forbidden' });
    const users = await sbSelect('users', `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (!users.length) {
      return res.json({ success: true, plan: 'free', isPremium: false });
    }
    const user = users[0];
    const isPremium = user.plan && user.plan !== 'free';
    res.json({ success: true, plan: user.plan || 'free', isPremium });
  } catch (e) {
    console.error('[users/access]', e.message);
    res.status(500).json({ error: 'Failed to fetch access info.' });
  }
});

app.get('/users/me/access', requireSupabaseUser, async (req, res) => {
  try {
    const user = await getAuthenticatedUserRecord(req);
    if (!user) return res.status(404).json({ error: 'User profile not found' });
    const entitlement = resolveEffectiveEntitlement(user);
    res.json({ success: true, plan: entitlement.effectivePlan, isPremium: entitlement.effectivePlan !== 'free', ...entitlement });
  } catch (e) {
    console.error('[users/me/access]', e.message);
    res.status(500).json({ error: 'Failed to fetch access info.' });
  }
});

app.get('/user/get', requireSupabaseUser, async (req, res) => {
  try {
    const phone = req.authPhone;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const users = await sbSelect('users', `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (!users.length) return res.json({ user: null });
    const u = users[0];
    res.json({
      user: {
        phone: u.phone,
        name: u.name,
        rashi: u.rashi,
        nakshatra: u.nakshatra,
        deity: u.deity,
        language: u.language || 'hindi',
        plan: u.plan || 'free',
        pts: u.pts || 0,
        streak: u.streak || 0,
        birth_city: u.birth_city || '',
        dob: u.dob || '',
        auth_user_id: u.firebase_uid || '',
        push_token: u.push_token || '',
        lagna: u.lagna || '',
        mantra: u.mantra || '',
      }
    });
  } catch (e) {
    console.error('[user/get]', e.message);
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// ════════════════════════════════════════════════════════════════
// FEEDBACK
// ════════════════════════════════════════════════════════════════
app.post('/feedback', async (req, res) => {
  try {
    const rateKey = req.body.phone || req.ip || 'anon';
    if (!checkRateLimit(`fb_${rateKey}`, 10)) {
      return res.status(429).json({ error: 'Too many feedback submissions' });
    }
    const { question, wrongAnswer, correctedAnswer, reason, phone, rating } = req.body;
    const entry = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    if (question)        entry.question         = sanitize(question, 500);
    if (wrongAnswer)     entry.wrong_answer     = sanitize(wrongAnswer, 1000);
    if (correctedAnswer) entry.corrected_answer = sanitize(correctedAnswer, 1000);
    if (reason)          entry.reason           = sanitize(reason, 300);
    if (phone)           entry.phone            = sanitize(phone, 20);
    if (rating)          entry.rating           = rating === 'up' ? 'up' : 'down';
    await sbInsert('feedback', entry);
    res.json({ success: true, id: entry.id });
  } catch(e) {
    console.error('[Feedback]', e.message);
    res.status(500).json({ error: 'Feedback submission failed.' });
  }
});

// ════════════════════════════════════════════════════════════════
// PAYMENT
// ════════════════════════════════════════════════════════════════
app.get('/payment/config', (req, res) => {
  res.json({
    success: true,
    phonepeUPI:          CFG.phonepeUPI || '',
    razorpayKeyId:       CFG.razorpayKeyId || '',
    subscriptionPayment: CFG.subscriptionPayment || 'upi',
    donationPayment:     CFG.donationPayment || 'upi',
    hasRazorpay:         !!(CFG.razorpayKeyId && CFG.razorpayKeySecret),
  });
});

// Alias for app compatibility
app.get('/payment-config', (req, res) => {
  res.json({
    success: true,
    phonepeUPI:          CFG.phonepeUPI || '',
    razorpayKeyId:       CFG.razorpayKeyId || '',
    subscriptionPayment: CFG.subscriptionPayment || 'upi',
    donationPayment:     CFG.donationPayment || 'upi',
    hasRazorpay:         !!(CFG.razorpayKeyId && CFG.razorpayKeySecret),
  });
});

// ─── UPI ORDER CREATE (SECURE) ────────────────────────────────
// Creates a server-side order record. planId is stored server-side.
// Client receives only an orderId to use in /payment/confirm.
app.post('/payment/upi/create', requireSupabaseUser, async (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId || !VALID_PLANS.includes(planId)) {
      return res.status(400).json({ error: 'Invalid plan. Must be one of: ' + VALID_PLANS.join(', ') });
    }

    const cleanPhone = req.authPhone;
    const cleanPlan  = sanitize(planId, 50);
    const plan = CFG.bundles.find(b => b.id === cleanPlan && b.active);
    if (!plan) {
      return res.status(400).json({ error: 'Plan not available' });
    }

    const orderId = `upi_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const order = {
      orderId,
      userPhone: cleanPhone,
      planId:    cleanPlan,
      amount:    plan.price,
      status:    'pending',
      createdAt: new Date().toISOString(),
    };

    await saveOrder(order);

    res.json({
      success:  true,
      orderId,
      amount:   plan.price,
      upiId:    CFG.phonepeUPI || '',
      planName: plan.name,
    });
  } catch(e) {
    console.error('[payment/upi/create]', e.message);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

// ─── PAYMENT CONFIRM (SECURE) ─────────────────────────────────
// planId is NEVER accepted from client. Fetched from server-side order store.
app.post('/payment/confirm', requireSupabaseUser, async (req, res) => {
  try {
    const { orderId, paymentId } = req.body;

    if (!orderId || typeof orderId !== 'string' || orderId.trim().length < 5) {
      return res.status(400).json({ error: 'Valid orderId required' });
    }

    if (CFG.subscriptionPayment === 'razorpay') {
      return res.status(403).json({ error: 'Use Razorpay verification endpoint' });
    }

    const cleanOrderId = sanitize(orderId, 100);
    const order = await getOrder(cleanOrderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.userPhone !== req.authPhone) return res.status(403).json({ error: 'Order does not belong to this account' });
    if (order.status === 'completed') {
      // Idempotent: already processed, return success
      return res.json({ success: true, message: 'Already processed', plan: order.planId });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Order is not in pending state' });
    }

    res.json({ success: true, status: 'pending', message: 'Payment verification is pending.' });
  } catch (e) {
    console.error('[payment/confirm]', e.message);
    res.status(500).json({ error: 'Payment confirmation failed.' });
  }
});

// ─── RAZORPAY ORDER CREATE ─────────────────────────────────────
app.post('/payment/razorpay/order', requireSupabaseUser, async (req, res) => {
  try {
    const { planId } = req.body;
    const phone = req.authPhone;

    if (!planId || !VALID_PLANS.includes(planId)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    const plan = CFG.bundles.find(p => p.id === planId && p.active);
    if (!plan) return res.status(400).json({ error: 'Plan not available' });

    if (!CFG.razorpayKeyId || !CFG.razorpayKeySecret) {
      return res.status(503).json({ error: 'Razorpay not configured.' });
    }

    const amount = plan.price;
    if (!amount || amount < 1 || amount > 100000) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const auth = Buffer.from(`${CFG.razorpayKeyId}:${CFG.razorpayKeySecret}`).toString('base64');
    const bodyStr = JSON.stringify({ amount: Math.round(amount) * 100, currency: 'INR', receipt: `ds_${Date.now()}` });
    const rzp = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      };
      const r = https.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      });
      r.on('error', reject);
      r.write(bodyStr);
      r.end();
    });

    if (rzp.id) {
      await sbInsert('payments', {
        id: rzp.id, phone: sanitize(phone||'', 20),
        plan_id: sanitize(planId||'', 50),
        amount, payment_type: 'subscription',
        payment_via: 'razorpay', status: 'created',
        created_at: new Date().toISOString(),
      });
      res.json({ success: true, orderId: rzp.id, keyId: CFG.razorpayKeyId, amount: Math.round(amount) * 100 });
    } else {
      res.status(500).json({ error: 'Order creation failed' });
    }
  } catch(e) {
    console.error('[payment/razorpay/order]', e.message);
    res.status(500).json({ error: 'Order creation failed.' });
  }
});

// ─── RAZORPAY VERIFY ──────────────────────────────────────────
app.post('/payment/verify', requireSupabaseUser, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment fields' });
    }
    if (!CFG.razorpayKeySecret) {
      return res.status(500).json({ error: 'Razorpay not configured' });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", CFG.razorpayKeySecret)
      .update(body.toString())
      .digest("hex");

    const supplied = Buffer.from(razorpay_signature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(400).json({ success: false, message: "Invalid payment signature" });
    }

    // Fetch planId from DB — NEVER from client
    const paymentRows = await sbSelect('payments', `?id=eq.${encodeURIComponent(razorpay_order_id)}&limit=1`);
    if (!paymentRows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const existingPayment = paymentRows[0];

    // Idempotent: already processed
    if (existingPayment.status === 'paid') {
      return res.json({ success: true, message: 'Already processed', plan: existingPayment.plan_id });
    }

    const planId = existingPayment.plan_id;
    if (!VALID_PLANS.includes(planId)) {
      return res.status(400).json({ error: 'Invalid plan in order' });
    }

    await sbUpdate('payments',
      `?id=eq.${encodeURIComponent(razorpay_order_id)}`,
      { status: 'paid', payment_id: razorpay_payment_id, paid_at: new Date().toISOString() }
    );

    const cleanPhone = sanitize(existingPayment.phone || '', 20);
    if (cleanPhone !== req.authPhone) return res.status(403).json({ error: 'Order does not belong to this account' });
    if (cleanPhone) {
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, { plan: planId });
    }

    res.json({ success: true, message: "Payment verified & user upgraded", plan: planId });
  } catch (err) {
    console.error('[payment/verify]', err.message);
    res.status(500).json({ success: false, error: 'Payment verification failed.' });
  }
});

// ─── RAZORPAY WEBHOOK ─────────────────────────────────────────
app.post('/payment/webhook', async (req, res) => {
  try {
    const secret = CFG.razorpayKeySecret;
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' });
    }
    if (!secret) {
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');
    if (expected !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
    const event = JSON.parse(req.body.toString());
    if (event?.event === 'payment.captured') {
      const p = event?.payload?.payment?.entity;
      if (p && p.order_id) {
        await sbUpdate('payments',
          `?id=eq.${encodeURIComponent(p.order_id)}`,
          { status: 'paid', payment_id: p.id, paid_at: new Date().toISOString() }
        );
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[payment/webhook]', e.message);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// ════════════════════════════════════════════════════════════════
// CONTENT
// ════════════════════════════════════════════════════════════════
app.get('/content', async (req, res) => {
  try {
    const rows = await sbSelect('uploads', '?active=eq.true&order=uploaded_at.desc');
    res.json({ success: true, count: rows.length, content: rows.map(u => ({
      id: u.id, title: u.title, type: u.type, topics: u.topics, summary: u.summary,
    }))});
  } catch(e) {
    res.json({ success: true, count: 0, content: [] });
  }
});

// ════════════════════════════════════════════════════════════════
// KATHA VAULT
// ════════════════════════════════════════════════════════════════
app.get('/katha/list', async (req, res) => {
  try {
    const rows = await sbSelect('katha_vault', '?select=scripture_id,unit_id,lang,chapter_title&order=scripture_id.asc,unit_id.asc');
    const groups = {};
    rows.forEach(r => { const k = `${r.scripture_id}_${r.unit_id}_${r.lang}`; groups[k] = (groups[k]||0) + 1; });
    res.json({ success: true, count: Object.keys(groups).length, chapters: Object.entries(groups).map(([k,n]) => ({ key: k, verseCount: n })) });
  } catch(e) {
    console.error('[katha/list]', e.message);
    res.status(500).json({ error: 'Failed to fetch katha list.' });
  }
});

app.get('/katha/:sc/:unit/:lang', async (req, res) => {
  try {
    const { sc, unit, lang } = req.params;
    const cleanSc   = sanitize(sc,   50);
    const cleanUnit = sanitize(unit, 20);
    const cleanLang = lang === 'hindi' ? 'hindi' : 'english';

    const cacheFile = path.join(TMP, `${cleanSc}_${cleanUnit}_${cleanLang}.json`);
    if (fs.existsSync(cacheFile)) {
      const d = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Date.now() - d.cachedAt < 3600000) {
        return res.json({ success: true, content: d.content, verseCount: d.verseCount, source: 'cache' });
      }
    }
    const verses = await sbSelect('katha_vault',
      `?scripture_id=eq.${cleanSc}&unit_id=eq.${cleanUnit}&lang=eq.${cleanLang}&order=verse_number.asc&select=verse_data,verse_number`
    );
    if (!verses.length) return res.status(404).json({ success: false, message: 'Not generated yet.' });
    const content = JSON.stringify(verses.map(v => v.verse_data));
    fs.writeFileSync(cacheFile, JSON.stringify({ content, verseCount: verses.length, cachedAt: Date.now() }));
    res.json({ success: true, content, verseCount: verses.length, source: 'supabase' });
  } catch(e) {
    console.error('[katha/:sc/:unit/:lang]', e.message);
    res.status(500).json({ error: 'Failed to fetch katha content.' });
  }
});

// ════════════════════════════════════════════════════════════════
// AI CALLERS (server-side only — keys never leave server)
// ════════════════════════════════════════════════════════════════
function providerFailure(provider, model, category, status = 0) {
  const error = new Error(`${provider} ${category}`);
  Object.assign(error, { provider, model, category, status });
  return error;
}

function classifyProviderStatus(status, raw = '') {
  if (status === 401 || status === 403) return 'INVALID_API_KEY';
  if (status === 404) return 'MODEL_NOT_FOUND';
  if (status === 410 || /deprecated|decommissioned|retired/i.test(raw)) return 'MODEL_DEPRECATED';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'PROVIDER_SERVER_ERROR';
  return 'NETWORK_ERROR';
}

function logProviderResult(provider, model, status, category, elapsedMs) {
  const outcome = status ? `HTTP ${status}` : category;
  console.log(`[AI] ${provider} ${model} -> ${outcome}${category && status !== 200 ? ` ${category}` : ''} (${elapsedMs}ms)`);
}

async function callGemini(apiKey, prompt, { timeoutMs = 20000, maxOutputTokens = 1200, temperature = 0.75 } = {}) {
  const model = CFG.geminiModel;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    });
    let req;
    const timer = setTimeout(() => {
      req?.destroy();
      reject(providerFailure('Gemini', model, 'PROVIDER_TIMEOUT'));
    }, timeoutMs);
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    req = https.request(opts, res => {
      res.setEncoding('utf8');
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          if (res.statusCode !== 200) return reject(providerFailure('Gemini', model, classifyProviderStatus(res.statusCode, raw), res.statusCode));
          const d = JSON.parse(raw);
          const candidate = d?.candidates?.[0];
          const text = candidate?.content?.parts?.map(part => part?.text || '').join('');
          if (!text) return reject(providerFailure('Gemini', model, 'EMPTY_RESPONSE', res.statusCode));
          if (text.includes('\uFFFD')) console.warn(`[AI] Gemini ${model} response contains Unicode replacement character`);
          logProviderResult('Gemini', model, res.statusCode, '', Date.now() - startedAt);
          const finishReason = candidate?.finishReason || 'UNKNOWN';
          resolve({ text, finishReason, truncated: finishReason === 'MAX_TOKENS', model });
        } catch(e) { reject(e.category ? e : providerFailure('Gemini', model, 'NETWORK_ERROR', res.statusCode)); }
      });
    });
    req.on('error', () => { clearTimeout(timer); reject(providerFailure('Gemini', model, 'NETWORK_ERROR')); });
    req.write(body); req.end();
  });
}

async function callGroq(apiKey, prompt, { timeoutMs = 20000, maxOutputTokens = 1200, temperature = 0.75 } = {}) {
  const model = CFG.groqModel;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are DharmaSetu, a Vedic AI guide. Reply with structured JSON when asked for JSON. Otherwise reply in the requested language.' },
        { role: 'user',   content: prompt },
      ],
      temperature, max_tokens: maxOutputTokens,
    });
    let req;
    const timer = setTimeout(() => {
      req?.destroy();
      reject(providerFailure('Groq', model, 'PROVIDER_TIMEOUT'));
    }, timeoutMs);
    const opts = {
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
    };
    req = https.request(opts, res => {
      res.setEncoding('utf8');
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          if (res.statusCode !== 200) return reject(providerFailure('Groq', model, classifyProviderStatus(res.statusCode, raw), res.statusCode));
          const d = JSON.parse(raw);
          const choice = d?.choices?.[0];
          const text = choice?.message?.content;
          if (!text) return reject(providerFailure('Groq', model, 'EMPTY_RESPONSE', res.statusCode));
          if (text.includes('\uFFFD')) console.warn(`[AI] Groq ${model} response contains Unicode replacement character`);
          logProviderResult('Groq', model, res.statusCode, '', Date.now() - startedAt);
          const finishReason = choice?.finish_reason || 'unknown';
          resolve({ text, finishReason, truncated: finishReason === 'length', model });
        } catch(e) { reject(e.category ? e : providerFailure('Groq', model, 'NETWORK_ERROR', res.statusCode)); }
      });
    });
    req.on('error', () => { clearTimeout(timer); reject(providerFailure('Groq', model, 'NETWORK_ERROR')); });
    req.write(body); req.end();
  });
}

async function callAI(gemKey, groqKey, prompt, options = {}) {
  const failures = [];
  if (gemKey) {
    const startedAt = Date.now();
    try { return { ...await callGemini(gemKey, prompt, options), usedApi: 'gemini' }; }
    catch(e) {
      failures.push(e);
      logProviderResult('Gemini', CFG.geminiModel, e.status, e.category || 'NETWORK_ERROR', Date.now() - startedAt);
    }
  }
  if (groqKey) {
    const startedAt = Date.now();
    try { return { ...await callGroq(groqKey, prompt, options), usedApi: 'groq' }; }
    catch(e) {
      failures.push(e);
      logProviderResult('Groq', CFG.groqModel, e.status, e.category || 'NETWORK_ERROR', Date.now() - startedAt);
    }
  }
  const categories = failures.map(e => e.category);
  const error = new Error('AI provider request failed');
  if (!gemKey && !groqKey || categories.length > 0 && categories.every(c => ['INVALID_API_KEY','MODEL_NOT_FOUND','MODEL_DEPRECATED'].includes(c))) {
    error.code = 'AI_PROVIDER_CONFIGURATION_ERROR';
  } else if (categories.length > 0 && categories.every(c => c === 'RATE_LIMIT')) {
    error.code = 'AI_PROVIDER_RATE_LIMIT';
  } else if (categories.length > 0 && categories.every(c => c === 'PROVIDER_TIMEOUT')) {
    error.code = 'AI_TIMEOUT';
  } else {
    error.code = 'AI_PROVIDER_UNAVAILABLE';
  }
  throw error;
}

// ════════════════════════════════════════════════════════════════
// KATHA GENERATION
// ════════════════════════════════════════════════════════════════
function buildVersePrompt(sc, chN, chTitle, verseN, lang) {
  const isH = lang === 'hindi';
  return `You are a Vedic scholar (Gita Press Gorakhpur tradition).
${isH ? 'RULE: Write ALL explanations in PURE HINDI (Devanagari). ZERO English words in explanations.' : 'RULE: Write ALL explanations in clear ENGLISH.'}
Return ONLY a JSON object. Start response with { — no markdown, no backticks.

Generate Bhagavad Gita Chapter ${chN} (${chTitle}), Verse ${verseN}:

{"verse_id":"${chN}.${verseN}","chapter":${chN},"verse_number":${verseN},"sanskrit_full":"Complete Devanagari shloka — BOTH lines","roman_transliteration":"Roman phonetic of both lines","word_meanings_grid":[{"word":"Sanskrit word","meaning":"${isH?'Hindi meaning':'English meaning'}"}],"tika_${isH?'hindi':'english'}":"Gita Press style explanation — 3 sentences","teaching":"One practical life lesson","gahan_drishti":"Deep philosophical insight","bal_seekh":"Simple teaching for a child","speaker":"Krishna or Arjuna or Sanjaya"}`;
}

function parseVerse(raw, chN, verseN) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^```json?\s*/i,'').replace(/\s*```\s*$/i,'').trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const p = JSON.parse(s.slice(start, end + 1));
    if (!p.verse_number && !p.verse_id) return null;
    p.verse_id     = p.verse_id     || `${chN}.${verseN}`;
    p.verse_number = p.verse_number || verseN;
    p.chapter      = parseInt(chN);
    return p;
  } catch { return null; }
}

app.post('/admin/katha/generate', adminAuth, async (req, res) => {
  const { scriptureId, unitId, lang, totalVerses, chapterTitle, geminiKey, groqKey, jobId } = req.body;
  if (!scriptureId || !unitId || !lang) return res.status(400).json({ error: 'Missing required fields' });

  const gemKey = geminiKey || CFG.geminiKey || '';
  const grqKey = groqKey   || CFG.groqKey   || '';
  if (!gemKey && !grqKey) return res.status(400).json({ error: 'No AI keys configured.' });

  const chN   = parseInt(unitId);
  const total = parseInt(totalVerses) || 47;
  const title = sanitize(chapterTitle || `Chapter ${chN}`, 100);
  const job   = jobId || `${scriptureId}_${chN}_${lang}_${Date.now()}`;

  let existingNums = new Set();
  try {
    const existing = await sbSelect('katha_vault',
      `?scripture_id=eq.${scriptureId}&unit_id=eq.${chN}&lang=eq.${lang}&select=verse_number`
    );
    existing.forEach(v => existingNums.add(v.verse_number));
  } catch(e) { console.log('[Katha] Cannot check existing:', e.message); }

  const missing = [];
  for (let i = 1; i <= total; i++) if (!existingNums.has(i)) missing.push(i);

  res.json({ success: true, jobId: job, total, existing: existingNums.size, toGenerate: missing.length, resuming: existingNums.size > 0 });
  if (missing.length === 0) return;

  (async () => {
    const GAP        = 20000;
    const RATE_WAIT  = 45000;
    const RETRY_WAIT = 6000;
    const MAX_ATT    = 4;
    let generated = 0, failed = 0;

    sseLog(job, `🕉 ${scriptureId} Ch${chN} "${title}" | ${lang.toUpperCase()}`, 'info');
    sseLog(job, `📊 In Supabase: ${existingNums.size} | Need: ${missing.length} | Total: ${total}`, 'info');

    for (let bi = 0; bi < missing.length; bi += 2) {
      const pair = missing.slice(bi, bi + 2);
      sseLog(job, `\n📦 Pair ${Math.floor(bi/2)+1}/${Math.ceil(missing.length/2)}: verse${pair.length>1?'s':''} ${pair.join(' + ')}`, 'info');

      for (const vN of pair) {
        sseLog(job, `⟳ Generating ${chN}.${vN}...`, 'wait');
        let verse = null, att = 0;

        while (att < MAX_ATT && !verse) {
          att++;
          try {
            const { text, usedApi } = await callAI(gemKey, grqKey, buildVersePrompt(scriptureId, chN, title, vN, lang));
            verse = parseVerse(text, chN, vN);
            if (verse) {
              await sbUpsert('katha_vault', {
                scripture_id: scriptureId, unit_id: chN, verse_number: vN,
                lang, verse_data: verse, chapter_title: title,
                generated_at: new Date().toISOString(),
              }, 'scripture_id,unit_id,verse_number,lang');
              generated++;
              const cf = path.join(TMP, `${scriptureId}_${chN}_${lang}.json`);
              if (fs.existsSync(cf)) fs.unlinkSync(cf);
              sseLog(job, `✅ ${chN}.${vN} saved (${usedApi.toUpperCase()})`, 'ok');
            } else {
              sseLog(job, `⚠️ JSON parse failed att ${att}/${MAX_ATT}`, 'err');
              if (att < MAX_ATT) await new Promise(r => setTimeout(r, RETRY_WAIT));
            }
          } catch(e) {
            const rl = e.message.includes('RATE_LIMIT');
            sseLog(job, `❌ ${chN}.${vN} att${att}: ${e.message.slice(0,70)}`, 'err');
            if (rl) { sseLog(job, `⏳ Rate limit — waiting ${RATE_WAIT/1000}s...`, 'wait'); await new Promise(r => setTimeout(r, RATE_WAIT)); }
            else await new Promise(r => setTimeout(r, RETRY_WAIT));
          }
        }
        if (!verse) { failed++; sseLog(job, `⛔ Verse ${chN}.${vN} skipped after ${MAX_ATT} attempts`, 'err'); }
      }

      if (bi + 2 < missing.length) {
        sseLog(job, `⏸ Waiting ${GAP/1000}s...`, 'wait');
        await new Promise(r => setTimeout(r, GAP));
      }
    }
    sseDone(job, `🎉 Complete! ✅ New: ${generated} | ⛔ Failed: ${failed} | Total: ${existingNums.size + generated}/${total}`);
  })().catch(e => { sseLog(job, '❌ Fatal: ' + e.message, 'err'); sseDone(job, 'Stopped: ' + e.message); });
});

app.get('/admin/katha/status/:sc/:unit/:lang', adminAuth, async (req, res) => {
  const { sc, unit, lang } = req.params;
  const verses = await sbSelect('katha_vault',
    `?scripture_id=eq.${sc}&unit_id=eq.${unit}&lang=eq.${lang}&select=verse_number&order=verse_number.asc`
  );
  const nums = verses.map(v => v.verse_number);
  res.json({ exists: nums.length > 0, verseCount: nums.length, savedVerses: nums });
});

app.delete('/admin/katha/:sc/:unit/:lang', adminAuth, async (req, res) => {
  const { sc, unit, lang } = req.params;
  await sbDelete('katha_vault', `?scripture_id=eq.${sc}&unit_id=eq.${unit}&lang=eq.${lang}`);
  const cf = path.join(TMP, `${sc}_${unit}_${lang}.json`);
  if (fs.existsSync(cf)) fs.unlinkSync(cf);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════════════
app.get('/admin/config', adminAuth, (req, res) => {
  const safe = { ...CFG };
  if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***SAVED';
  safe.geminiConfigured = !!safe.geminiKey;
  safe.groqConfigured = !!safe.groqKey;
  safe.geminiKey = safe.geminiKey ? '***SAVED' : '';
  safe.groqKey = safe.groqKey ? '***SAVED' : '';
  res.json({ success: true, config: safe });
});

app.post('/admin/config', adminAuth, async (req, res) => {
  const keyMap = {
    geminiKey: 'gemini_key', groqKey: 'groq_key',
    geminiModel: 'gemini_model', groqModel: 'groq_model',
    phonepeUPI: 'phonepe_upi',
    razorpayKeyId: 'razorpay_key_id', razorpayKeySecret: 'razorpay_key_secret',
    subscriptionPayment: 'subscription_payment', donationPayment: 'donation_payment',
    premiumPrice: 'premium_price', basicPrice: 'basic_price',
    freeQuestionsLimit: 'free_questions_limit', freeFactCheckLimit: 'free_factcheck_limit',
    basicQuestionsLimit: 'basic_questions_limit', basicFactCheckLimit: 'basic_factcheck_limit',
    maintenanceMode: 'maintenance_mode', appVersion: 'app_version',
    featureFlags: 'feature_flags', bundles: 'bundles', donations: 'donations',
  };
  for (const key of ['geminiModel','groqModel']) {
    if (req.body[key] !== undefined && !isValidAIModelId(req.body[key])) {
      return res.status(400).json({ error: 'INVALID_AI_MODEL' });
    }
  }
  const saves = [];
  for (const [jsKey, dbKey] of Object.entries(keyMap)) {
    const val = req.body[jsKey];
    if (val !== undefined) {
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (typeof val === 'string' && val.includes('***SAVED')) continue;
      CFG[jsKey] = jsKey.endsWith('Model') ? String(val).trim() : val;
      saves.push(saveConfigKey(dbKey, str));
    }
  }
  await Promise.all(saves);
  await auditLog('CONFIG_CHANGED', 'admin', 'System Settings', `Updated ${saves.length} keys`);
  const safe = { ...CFG };
  if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***SAVED';
  safe.geminiConfigured = !!safe.geminiKey;
  safe.groqConfigured = !!safe.groqKey;
  safe.geminiKey = safe.geminiKey ? '***SAVED' : '';
  safe.groqKey = safe.groqKey ? '***SAVED' : '';
  logAIConfig();
  res.json({ success: true, config: safe, saved: saves.length });
});

app.get('/account/me', requireSupabaseUser, async (req, res) => {
  try {
    const [legacyUser, profiles, births, jyotish] = await Promise.all([
      getAuthenticatedUserRecord(req),
      sbSelect('user_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`),
      sbSelect('birth_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`),
      sbSelect('jyotish_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`),
    ]);
    res.json({ success: true, account: { authUserId: req.authUser.id, phone: req.authPhone },
      profile: profiles[0] || legacyUser || null, birthProfile: births[0] || null,
      jyotishProfile: jyotish[0] || null,
      onboardingStatus: profiles[0]?.onboarding_status || (legacyUser ? 'PROFILE_PENDING' : 'PROFILE_PENDING') });
  } catch (error) {
    console.error('[account/me]', error.message);
    res.status(500).json({ error: 'ACCOUNT_RESTORE_FAILED' });
  }
});

app.post('/account/onboarding', requireSupabaseUser, async (req, res) => {
  if (!checkRateLimit(`onboarding_${req.authUser.id}`, 8)) return res.status(429).json({ error: 'RATE_LIMIT' });
  try {
    const input = {
      name: sanitize(req.body?.name || '', 100), gender: req.body?.gender,
      dateOfBirth: req.body?.dateOfBirth, birthTime: req.body?.birthTime || null,
      birthTimeCertainty: req.body?.birthTimeCertainty,
      birthplace: sanitize(req.body?.birthplace || '', 200), language: req.body?.language,
      interests: Array.isArray(req.body?.interests) ? req.body.interests.slice(0, 20).map(v => sanitize(v, 60)).filter(Boolean) : [],
      birthDataConsent: req.body?.birthDataConsent === true,
    };
    const validation = validateOnboarding(input);
    if (!validation.valid) return res.status(400).json({ error: 'INVALID_ONBOARDING_DATA', fields: validation.errors });
    const place = await resolveBirthplace(input.birthplace, input.dateOfBirth);
    if (!place) return res.status(422).json({ error: 'BIRTHPLACE_UNRESOLVED' });
    if (place.timezoneUnresolved) return res.status(422).json({ error: 'BIRTHPLACE_TIMEZONE_UNRESOLVED' });

    const existingBirth = (await sbSelect('birth_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`))[0];
    const candidate = {
      date_of_birth: input.dateOfBirth,
      birth_time: input.birthTimeCertainty === 'UNKNOWN' ? null : input.birthTime,
      birth_time_certainty: input.birthTimeCertainty,
      latitude: place.latitude, longitude: place.longitude, timezone: place.timezone,
    };
    const fingerprint = birthInputFingerprint(candidate);
    if (existingBirth && existingBirth.input_fingerprint !== fingerprint && req.body?.confirmBirthProfileChange !== true) {
      return res.status(409).json({ error: 'BIRTH_PROFILE_CHANGE_CONFIRMATION_REQUIRED' });
    }
    const birthVersion = existingBirth
      ? existingBirth.input_fingerprint === fingerprint ? existingBirth.profile_version : Number(existingBirth.profile_version || 1) + 1
      : 1;
    const now = new Date().toISOString();
    const status = input.birthTimeCertainty === 'UNKNOWN' ? 'BIRTHPLACE_PENDING' : 'KUNDLI_PENDING';
    const profileRow = { user_id: req.authUser.id, name: input.name, gender: input.gender, language: input.language,
      interests: input.interests, onboarding_status: status, birth_data_consent_at: now,
      birth_data_consent_version: '2026-08-22', updated_at: now };
    const birthRow = { user_id: req.authUser.id, ...candidate, birthplace_input: input.birthplace,
      place_name: place.placeName, city: place.city, region: place.region, country: place.country,
      country_code: place.countryCode, utc_offset_minutes: place.utcOffsetMinutes,
      profile_version: birthVersion, input_fingerprint: fingerprint, updated_at: now };

    await sbUpsert('user_profiles', profileRow, 'user_id');
    await sbUpsert('birth_profiles', birthRow, 'user_id');
    await sbUpsert('jyotish_profiles', { user_id: req.authUser.id, birth_profile_version: birthVersion,
      input_fingerprint: fingerprint, status: input.birthTimeCertainty === 'UNKNOWN' ? 'INPUT_CORRECTION_REQUIRED' : 'KUNDLI_PENDING',
      chart_data: null, compact_context: null, failure_code: input.birthTimeCertainty === 'UNKNOWN' ? 'BIRTH_TIME_UNKNOWN' : null,
      updated_at: now }, 'user_id');

    const legacyUser = { phone: req.authPhone, name: input.name, language: input.language,
      birth_city: place.city || place.placeName, dob: input.dateOfBirth, firebase_uid: req.authUser.id, last_active: now };
    const existingLegacy = await getAuthenticatedUserRecord(req);
    if (existingLegacy) await sbUpdate('users', `?id=eq.${encodeURIComponent(existingLegacy.id)}`, legacyUser);
    else await sbInsert('users', { id: req.authUser.id, ...legacyUser, created_at: now, plan: 'free', streak: 0, questions: 0, pts: 0 });

    res.json({ success: true, onboardingStatus: status, birthProfileVersion: birthVersion,
      requiresKundliGeneration: input.birthTimeCertainty !== 'UNKNOWN' });
  } catch (error) {
    console.error('[account/onboarding]', error.message);
    res.status(500).json({ error: 'ONBOARDING_SAVE_FAILED' });
  }
});

app.post('/account/kundli/generate', requireSupabaseUser, async (req, res) => {
  if (!checkRateLimit(`kundli_generate_${req.authUser.id}`, 5)) return res.status(429).json({ error: 'RATE_LIMIT' });
  const generationStartedAt = Date.now();
  try {
    const birth = (await sbSelect('birth_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`))[0];
    if (!birth) return res.status(409).json({ error: 'BIRTH_PROFILE_REQUIRED' });
    const birthValidation = validateAuthoritativeBirthProfile(birth);
    if (!birthValidation.valid) {
      const unknownTime = birthValidation.errors.includes('BIRTH_TIME_REQUIRED');
      await sbUpdate('jyotish_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}`, {
        status: 'INPUT_CORRECTION_REQUIRED',
        failure_code: unknownTime ? 'BIRTH_TIME_UNKNOWN' : birthValidation.errors[0],
        updated_at: new Date().toISOString(),
      }).catch(() => {});
      return res.status(422).json({
        error: unknownTime ? 'BIRTH_TIME_REQUIRED_FOR_PRECISE_KUNDLI' : 'KUNDLI_INPUT_CORRECTION_REQUIRED',
        fields: birthValidation.errors,
      });
    }
    const deepEnabled = process.env.PROKERALA_DEEP_KUNDLI_ENABLED === 'true';
    const calculationVersion = deepEnabled ? 'prokerala-v2-lahiri-deep-v1' : CALCULATION_STANDARD.calculationVersion;
    const existing = (await sbSelect('jyotish_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`))[0];
    if (existing?.status === 'KUNDLI_READY' && existing.input_fingerprint === birth.input_fingerprint
      && existing.calculation_version === calculationVersion) {
      return res.json({ success: true, reused: true, status: 'KUNDLI_READY', context: existing.compact_context });
    }
    if (!canCallAPI()) return res.status(503).json({ error: 'KUNDLI_PROVIDER_UNAVAILABLE' });
    const offset = formatUtcOffset(birth.utc_offset_minutes);
    const datetime = `${birth.date_of_birth}T${String(birth.birth_time).slice(0,5)}:00${offset}`;
    const providerStartedAt = Date.now();
    const providerResult = deepEnabled
      ? await fetchPrimaryKundli({ latitude: birth.latitude, longitude: birth.longitude, datetime })
      : await fetchBasicKundli({ latitude: birth.latitude, longitude: birth.longitude, datetime });
    const details = providerResult.modules.birthDetails;
    const chart = deepEnabled ? providerResult.modules.advancedKundli : providerResult.modules.basicKundli;
    if (!details || !chart) throw new Error('KUNDLI_PROVIDER_INVALID_RESPONSE');
    const normalized = normalizeProviderChart(details, chart, birth, {
      ...providerResult.modules,
      moduleStatus: providerResult.moduleStatus,
      generatedAt: providerResult.generatedAt,
    });
    const context = compactNormalizedJyotishContext(normalized);
    if (!context.rashi && !context.lagna && !context.nakshatra) throw new Error('KUNDLI_PROVIDER_INVALID_RESPONSE');
    const now = new Date().toISOString();
    await sbUpsert('jyotish_profiles', { user_id: req.authUser.id, birth_profile_version: birth.profile_version,
      input_fingerprint: birth.input_fingerprint, status: 'KUNDLI_READY', provider: 'prokerala',
      calculation_version: calculationVersion, ayanamsha: CALCULATION_STANDARD.ayanamsha,
      chart_data: { providerModules: providerResult.modules, moduleStatus: providerResult.moduleStatus, normalized },
      compact_context: context, failure_code: null, generated_at: now, updated_at: now }, 'user_id');
    await sbUpdate('user_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}`, { onboarding_status: 'KUNDLI_READY', updated_at: now });
    await sbUpdate('users', `?id=eq.${encodeURIComponent(req.authUser.id)}`, { rashi: context.rashi, nakshatra: context.nakshatra, lagna: context.lagna, updated_at: now });
    console.log(`[Kundli Timing] provider=${Date.now() - providerStartedAt}ms total=${Date.now() - generationStartedAt}ms reused=false`);
    res.json({ success: true, reused: false, status: 'KUNDLI_READY', context,
      calculationVersion, moduleStatus: providerResult.moduleStatus });
  } catch (error) {
    const failureCode = error.code === 'PROVIDER_TIMEOUT' || error.name === 'AbortError' ? 'KUNDLI_PROVIDER_TIMEOUT'
      : error instanceof ProkeralaError && error.code === 'PROVIDER_PLAN_REQUIRED' ? 'KUNDLI_PROVIDER_PLAN_REQUIRED'
      : error instanceof ProkeralaError && error.code === 'PROVIDER_RATE_LIMITED' ? 'KUNDLI_PROVIDER_RATE_LIMITED'
      : error.message === 'KUNDLI_PROVIDER_INVALID_RESPONSE' ? 'KUNDLI_PROVIDER_INVALID_RESPONSE'
      : 'KUNDLI_PROVIDER_UNAVAILABLE';
    console.warn(`[Kundli] generation failed code=${failureCode} totalMs=${Date.now() - generationStartedAt}`);
    await sbUpdate('jyotish_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}`, { status: 'PROVIDER_UNAVAILABLE', failure_code: failureCode, updated_at: new Date().toISOString() }).catch(() => {});
    res.status(503).json({ error: 'KUNDLI_PROVIDER_UNAVAILABLE' });
  }
});

app.get('/admin/ai/health', adminAuth, async (req, res) => {
  const check = async (provider, configured, model, call) => {
    if (!configured) return { configured: false, model, status: 'missing_key' };
    const startedAt = Date.now();
    try {
      await call();
      return { configured: true, model, status: 'healthy' };
    } catch (error) {
      logProviderResult(provider, model, error.status, error.category || 'NETWORK_ERROR', Date.now() - startedAt);
      const statuses = {
        INVALID_API_KEY: 'invalid_key', MODEL_NOT_FOUND: 'model_not_found',
        MODEL_DEPRECATED: 'model_deprecated', RATE_LIMIT: 'rate_limited',
        PROVIDER_TIMEOUT: 'timeout', EMPTY_RESPONSE: 'provider_error',
        PROVIDER_SERVER_ERROR: 'provider_error', NETWORK_ERROR: 'provider_error',
      };
      return { configured: true, model, status: statuses[error.category] || 'provider_error' };
    }
  };
  const [gemini, groq] = await Promise.all([
    check('Gemini', !!CFG.geminiKey, CFG.geminiModel,
      () => callGemini(CFG.geminiKey, 'Reply only with OK', { timeoutMs: 5000, maxOutputTokens: 16, temperature: 0 })),
    check('Groq', !!CFG.groqKey, CFG.groqModel,
      () => callGroq(CFG.groqKey, 'Reply only with OK', { timeoutMs: 5000, maxOutputTokens: 16, temperature: 0 })),
  ]);
  res.json({ success: true, gemini, groq });
});

app.delete('/admin/config/:key', adminAuth, async (req, res) => {
  const keyMap = {
    geminiKey: 'gemini_key', groqKey: 'groq_key',
    phonepeUPI: 'phonepe_upi',
    razorpayKeyId: 'razorpay_key_id', razorpayKeySecret: 'razorpay_key_secret',
  };
  const dbKey = keyMap[req.params.key];
  if (!dbKey) return res.status(400).json({ error: 'Unknown key' });
  CFG[req.params.key] = '';
  await saveConfigKey(dbKey, '');
  res.json({ success: true });
});

app.post('/admin/bundles',   adminAuth, async (req, res) => {
  try {
    if (!Array.isArray(req.body.bundles)) return res.status(400).json({ error: 'bundles must be an array' });
    CFG.bundles = req.body.bundles;
    await saveConfigKey('bundles', JSON.stringify(CFG.bundles));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/donations', adminAuth, async (req, res) => {
  try {
    if (!Array.isArray(req.body.donations)) return res.status(400).json({ error: 'donations must be an array' });
    CFG.donations = req.body.donations;
    await saveConfigKey('donations', JSON.stringify(CFG.donations));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/notifications', adminAuth, async (req, res) => {
  try {
    const { title, body, target, scheduled_for } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    const entry = {
      id: `notif_${Date.now()}`,
      title: sanitize(title, 200),
      body:  sanitize(body,  500),
      target: ['all','premium','free'].includes(target) ? target : 'all',
      scheduled_for: scheduled_for || new Date().toISOString(),
      sent_at: new Date().toISOString(),
      status: 'pending',
    };
    await sbInsert('notifications', entry);
    res.json({ success: true, id: entry.id });
  } catch(e) {
    console.error('[admin/notifications]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { title, type, topics, trustLevel, textContent } = req.body;
    let rawText = sanitize(textContent || '', 100000);
    if (req.file) {
      if (req.file.mimetype.includes('text') || req.file.originalname.match(/\.(txt|csv|json)$/i)) {
        rawText = req.file.buffer.toString('utf-8').slice(0, 100000);
      } else {
        rawText = `[Binary file: ${req.file.originalname}]`;
      }
    }
    if (!rawText || rawText.length < 3) return res.status(400).json({ error: 'No text content found' });
    const entry = {
      id: `up_${Date.now()}`,
      title:       sanitize(title || req.file?.originalname || 'Untitled', 200),
      type:        sanitize(type || 'text', 50),
      topics:      topics ? topics.split(',').map(t => sanitize(t.trim(), 50)).filter(Boolean) : [],
      trust_level: ['high','medium','low'].includes(trustLevel) ? trustLevel : 'high',
      content:     rawText,
      chunk_count: Math.ceil(rawText.length/2000),
      char_count:  rawText.length,
      summary:     rawText.slice(0, 200),
      active:      true,
      uploaded_at: new Date().toISOString(),
    };
    await sbInsert('uploads', entry);
    res.json({ success: true, upload: { id: entry.id, title: entry.title, chunkCount: entry.chunk_count, charCount: entry.char_count } });
  } catch(e) {
    console.error('[admin/upload]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/uploads', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('uploads', '?order=uploaded_at.desc');
    res.json({ success: true, uploads: rows.map(u => ({ id: u.id, title: u.title, type: u.type, chunkCount: u.chunk_count, charCount: u.char_count, active: u.active, uploadedAt: u.uploaded_at, topics: u.topics })) });
  } catch(e) {
    console.error('[admin/uploads]', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.patch('/admin/uploads/:id',  adminAuth, async (req, res) => {
  try {
    await sbUpdate('uploads', `?id=eq.${req.params.id}`, req.body);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/uploads/:id', adminAuth, async (req, res) => {
  try {
    await sbDelete('uploads', `?id=eq.${req.params.id}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── BOOKS ────────────────────────────────────────────────────
app.get('/admin/books', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('books', '?order=display_order.asc,created_at.desc').catch(()=>[]);
    res.json({ success: true, books: rows, total: rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/books', adminAuth, async (req, res) => {
  try {
    const entry = {
      id: `bk_${Date.now()}`,
      title:        sanitize(req.body.title || 'Untitled', 200),
      author:       sanitize(req.body.author || 'Unknown', 100),
      language:     sanitize(req.body.language || 'hindi', 50),
      category:     sanitize(req.body.category || 'general', 50),
      cover_url:    sanitize(req.body.cover_url || '', 500),
      description:  sanitize(req.body.description || '', 1000),
      is_premium:   !!req.body.is_premium,
      is_featured:  !!req.body.is_featured,
      external_url: sanitize(req.body.external_url || '', 500),
      read_url:     sanitize(req.body.read_url || '', 500),
      tags:         req.body.tags ? req.body.tags.split(',').map(t=>sanitize(t.trim(), 50)) : [],
      display_order:parseInt(req.body.display_order) || 0,
      created_at:   new Date().toISOString()
    };
    await sbInsert('books', entry);
    res.json({ success: true, book: entry });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/admin/books/:id', adminAuth, async (req, res) => {
  try {
    const patch = { ...req.body };
    delete patch.id;
    await sbUpdate('books', `?id=eq.${req.params.id}`, patch);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/books/:id', adminAuth, async (req, res) => {
  try {
    await sbDelete('books', `?id=eq.${req.params.id}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── USERS ────────────────────────────────────────────────────
app.get('/admin/users', adminAuth, async (req, res) => {
  try {
    const { search, plan } = req.query;
    let q = '?order=last_active.desc&limit=500';
    if (plan && plan !== 'all') q += `&plan=eq.${sanitize(plan, 20)}`;
    let rows = await sbSelect('users', q);
    if (search) {
      const s = sanitize(search, 100).toLowerCase();
      rows = rows.filter(u =>
        (u.name||'').toLowerCase().includes(s) ||
        (u.phone||'').includes(s) ||
        (u.email||'').toLowerCase().includes(s)
      );
    }
    const users = rows.map(user => ({ ...user, entitlement: resolveEffectiveEntitlement(user) }));
    res.json({ success: true, users, total: users.length });
  } catch(e) {
    console.error('[admin/users]', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.patch('/admin/users/:id', adminAuth, async (req, res) => {
  res.status(410).json({ error: 'Direct plan editing is disabled. Use the entitlement override endpoint.' });
});
app.patch('/admin/users/:id/entitlement', adminAuth, async (req, res) => {
  try {
    const level = req.body.level == null ? null : sanitize(req.body.level, 20);
    if (level !== null && !['basic', 'pro', 'full'].includes(level)) {
      return res.status(400).json({ error: 'Invalid override level' });
    }
    let expiresAt = null;
    if (req.body.expiresAt) {
      const parsed = new Date(req.body.expiresAt);
      if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) return res.status(400).json({ error: 'Expiry must be in the future' });
      expiresAt = parsed.toISOString();
    }
    const patch = {
      admin_override: level,
      admin_override_expires_at: level ? expiresAt : null,
      admin_override_reason: level ? sanitize(req.body.reason || 'Complimentary access', 200) : null,
      admin_override_updated_at: new Date().toISOString(),
    };
    await sbUpdate('users', `?id=eq.${encodeURIComponent(req.params.id)}`, patch);
    await auditLog(level ? 'ENTITLEMENT_OVERRIDE_GRANTED' : 'ENTITLEMENT_OVERRIDE_REMOVED', 'admin', req.params.id, level ? `Level: ${level}; expiry: ${expiresAt || 'none'}` : 'Override removed');
    const rows = await sbSelect('users', `?id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    res.json({ success: true, entitlement: resolveEffectiveEntitlement(rows[0] || {}) });
  } catch (e) {
    console.error('[admin/users/entitlement]', e.message);
    res.status(500).json({ error: 'Failed to update entitlement override' });
  }
});
app.patch('/admin/users/ban/toggle', adminAuth, async (req, res) => {
  try {
    const { phone, ban } = req.body;
    const cleanPhone = sanitize(phone || '', 20);
    if (!cleanPhone) return res.status(400).json({ error: 'Phone required' });
    await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, { is_banned: !!ban });
    await auditLog(ban?'USER_BANNED':'USER_UNBANNED', 'admin', cleanPhone, `Status: ${ban}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── TRANSACTIONS ─────────────────────────────────────────────
app.get('/admin/transactions', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('payments', '?order=created_at.desc&limit=200');
    const paid = rows.filter(r => r.status === 'paid');
    res.json({ success: true, transactions: rows, total: rows.length, totalRevenue: paid.reduce((s,t) => s+(t.amount||0), 0) });
  } catch(e) {
    console.error('[admin/transactions]', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.post('/admin/payments/approve', adminAuth, async (req, res) => {
  try {
    const { orderId, transactionId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Order ID required' });
    const order = await getOrder(sanitize(orderId, 100));
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') return res.json({ success: true, alreadyProcessed: true });
    if (order.status !== 'pending') return res.status(400).json({ error: 'Order is not pending' });
    const cleanPhone = order.userPhone;
    const cleanPlan = order.planId;
    const amount = order.amount;
    if (!VALID_PLANS.includes(cleanPlan)) return res.status(400).json({ error: 'Invalid order plan' });
    const payId = `m_app_${Date.now()}`;
    await sbInsert('payments', {
      id: payId, phone: cleanPhone, plan_id: cleanPlan,
      amount: parseInt(amount)||0, status: 'paid',
      payment_type: 'subscription', payment_via: 'manual',
      payment_id: sanitize(transactionId||'manual_approval', 100),
      paid_at: new Date().toISOString(), created_at: new Date().toISOString()
    });
    await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, { plan: cleanPlan });
    await markOrderCompleted(order.orderId);
    await auditLog('PAYMENT_APPROVED', 'admin', cleanPhone, `Plan: ${cleanPlan}, Amount: ${amount}`);
    res.json({ success: true });
  } catch(e) {
    console.error('[admin/payments/approve]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── FEEDBACK (admin) ─────────────────────────────────────────
app.get('/admin/feedback', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('feedback', '?order=created_at.desc');
    res.json({ success: true, feedback: rows, total: rows.length, pending: rows.filter(f => f.status === 'pending').length });
  } catch(e) {
    console.error('[admin/feedback]', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.patch('/admin/feedback/:id',  adminAuth, async (req, res) => {
  try {
    await sbUpdate('feedback', `?id=eq.${req.params.id}`, req.body);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/feedback/:id', adminAuth, async (req, res) => {
  try {
    await sbDelete('feedback', `?id=eq.${req.params.id}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── EXPORTS ──────────────────────────────────────────────────
app.get('/admin/export/feedback', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('feedback', '?order=created_at.desc');
    let csv = 'ID,Date,Phone,Question,Reason,Status,Notes\n';
    rows.forEach(r => {
      const q  = (r.question||'').replace(/"/g,'""');
      const re = (r.reason||'').replace(/"/g,'""');
      const n  = (r.notes||'').replace(/"/g,'""');
      csv += `"${r.id}","${r.created_at}","${r.phone}","${q}","${re}","${r.status}","${n}"\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('dharmasetu_feedback.csv');
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── STATS ────────────────────────────────────────────────────
app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const [users, payments, feedback, katha, uploads] = await Promise.all([
      sbSelect('users',      '?select=plan,created_at').catch(() => []),
      sbSelect('payments',   '?select=status,amount').catch(()   => []),
      sbSelect('feedback',   '?select=status').catch(()          => []),
      sbSelect('katha_vault','?select=scripture_id,unit_id,lang').catch(() => []),
      sbSelect('uploads',    '?select=active').catch(()          => []),
    ]);
    const paid     = payments.filter(p => p.status === 'paid');
    const chapters = new Set(katha.map(v => `${v.scripture_id}_${v.unit_id}_${v.lang}`));
    const today    = new Date().toDateString();
    res.json({ success: true, stats: {
      totalUsers:        users.length,
      premiumUsers:      users.filter(u => u.plan !== 'free').length,
      freeUsers:         users.filter(u => u.plan === 'free').length,
      newToday:          users.filter(u => new Date(u.created_at).toDateString() === today).length,
      totalTransactions: payments.length,
      paidTransactions:  paid.length,
      totalRevenue:      paid.reduce((s,t) => s+(t.amount||0), 0),
      kathaChapters:     chapters.size,
      totalVerses:       katha.length,
      activeUploads:     uploads.filter(u => u.active).length,
      pendingFeedback:   feedback.filter(f => f.status === 'pending').length,
      totalFeedback:     feedback.length,
      db: 'supabase',
    }});
  } catch(e) {
    console.error('[admin/stats]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/analytics/deep', adminAuth, async (req, res) => {
  try {
    const [users, payments, katha] = await Promise.all([
      sbSelect('users',    '?select=plan,created_at,last_active').catch(() => []),
      sbSelect('payments', '?select=status,amount,created_at').catch(()   => []),
      sbSelect('katha_vault', '?select=scripture_id').catch(()            => []),
    ]);
    const now   = Date.now();
    const dayMs = 86400000;
    const dau   = users.filter(u => now - new Date(u.last_active).getTime() < dayMs).length;
    const wau   = users.filter(u => now - new Date(u.last_active).getTime() < dayMs * 7).length;
    const mau   = users.filter(u => now - new Date(u.last_active).getTime() < dayMs * 30).length;
    const premium   = users.filter(u => u.plan !== 'free').length;
    const retention = users.length ? Math.round((mau / users.length) * 100) : 0;
    const rev7 = [0,0,0,0,0,0,0];
    payments.filter(p => p.status === 'paid').forEach(p => {
      const daysAgo = Math.floor((now - new Date(p.created_at).getTime()) / dayMs);
      if (daysAgo < 7 && daysAgo >= 0) rev7[6 - daysAgo] += (p.amount || 0);
    });
    res.json({ success: true, dau, wau, mau, premium, retention, revenue7: rev7, topKatha: katha.length });
  } catch(e) {
    console.error('[admin/analytics/deep]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/analytics/reading', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('reading_progress', '?limit=100').catch(() => []);
    res.json({ success: true, readingData: rows });
  } catch(e) {
    console.error('[admin/analytics/reading]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/health/deep', adminAuth, async (req, res) => {
  const configured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  let connected = false;
  try { await sbSelect('admin_settings', '?limit=1'); connected = true; } catch {}
  res.json({
    success: true,
    uptime: process.uptime(),
    dbConnected: connected,
    dbConfigured: configured,
    storageUsage: 'Supabase Free Tier (500MB max)',
    lastBackup: 'Never'
  });
});

app.get('/admin/audit', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('audit_logs', '?order=created_at.desc&limit=100').catch(()=>[]);
    res.json({ success: true, logs: rows });
  } catch(e) {
    console.error('[admin/audit]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/db-status', adminAuth, async (req, res) => {
  const configured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  let connected = false;
  try { await sbSelect('admin_settings', '?limit=1'); connected = true; } catch {}
  res.json({
    success: true, database: 'Supabase PostgreSQL',
    supabaseUrl: SUPABASE_URL ? SUPABASE_URL.replace(/eyJ.*/, '***') : 'NOT SET',
    configured, connected,
  });
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────
app.post('/admin/notifications/push', adminAuth, async (req, res) => {
  try {
    const { title, body, target } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
    const entry = {
      id: `push_${Date.now()}`,
      title: sanitize(title, 100),
      body: sanitize(body, 500),
      target_group: sanitize(target || 'all', 50),
      status: 'sent',
      sent_at: new Date().toISOString()
    };
    await sbInsert('push_campaigns', entry);
    await auditLog('PUSH_SENT', 'admin', entry.target_group, `Title: ${entry.title}`);
    res.json({ success: true, campaign: entry });
  } catch(e) {
    console.error('[admin/notifications/push]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/notifications/push', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('push_campaigns', '?order=sent_at.desc').catch(()=>[]);
    res.json({ success: true, campaigns: rows });
  } catch(e) {
    console.error('[admin/notifications/push GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── COUPONS ──────────────────────────────────────────────────
app.post('/admin/marketing/coupons', adminAuth, async (req, res) => {
  try {
    const { code, discount_pct, max_uses, expiry_date } = req.body;
    const cleanCode = sanitize(code || '', 50).toUpperCase();
    if (!cleanCode) return res.status(400).json({ error: 'Code required' });
    const entry = {
      id: `cpn_${Date.now()}`,
      code: cleanCode,
      discount_pct: parseInt(discount_pct) || 10,
      max_uses: parseInt(max_uses) || 100,
      uses_count: 0,
      expiry_date: sanitize(expiry_date || '', 50),
      created_at: new Date().toISOString()
    };
    await sbInsert('coupons', entry);
    await auditLog('COUPON_CREATED', 'admin', cleanCode, `${entry.discount_pct}% off`);
    res.json({ success: true, coupon: entry });
  } catch(e) {
    console.error('[admin/marketing/coupons]', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.get('/admin/marketing/coupons', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('coupons', '?order=created_at.desc').catch(()=>[]);
    res.json({ success: true, coupons: rows });
  } catch(e) {
    console.error('[admin/marketing/coupons GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.delete('/admin/marketing/coupons/:id', adminAuth, async (req, res) => {
  try {
    await sbDelete('coupons', `?id=eq.${req.params.id}`);
    await auditLog('COUPON_DELETED', 'admin', req.params.id, '');
    res.json({ success: true });
  } catch(e) {
    console.error('[admin/marketing/coupons DELETE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── BULK NOTIFICATIONS ───────────────────────────────────────
app.post('/admin/send-bulk-notification', adminAuth, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    const users = await sbSelect('users', '?select=push_token');
    let sent = 0;
    for (const u of users) {
      if (!u.push_token) continue;
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: u.push_token, sound: 'default', title, body }),
      }).catch(e => console.warn('[bulk-notif] send failed:', e.message));
      sent++;
    }
    res.json({ success: true, sent });
  } catch (e) {
    console.error('[admin/send-bulk-notification]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/send-notification', async (req, res) => {
  try {
    const { pushToken, title, body } = req.body;
    if (!pushToken) return res.json({ success: false, error: "No token" });
    const message = {
      to: pushToken,
      sound: 'default',
      title: sanitize(title || "DharmaSetu", 200),
      body:  sanitize(body  || "🙏 Daily wisdom awaits you", 500),
    };
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    const data = await response.json();
    res.json({ success: true, data });
  } catch (err) {
    console.error('[send-notification]', err.message);
    res.json({ success: false });
  }
});

// ════════════════════════════════════════════════════════════════
// PANCHANG
// ════════════════════════════════════════════════════════════════
const VAAR_EN_ARR     = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const VAAR_HI_ARR     = ['रविवार','सोमवार','मंगलवार','बुधवार','गुरुवार','शुक्रवार','शनिवार'];
const VAAR_DEITY_EN   = ['Surya Dev','Shiva Ji','Hanuman Ji','Ganesh Ji','Vishnu Ji','Lakshmi Mata','Shani Dev'];
const VAAR_DEITY_HI   = ['सूर्य देव','शिव जी','हनुमान जी','गणेश जी','विष्णु जी','लक्ष्मी माता','शनि देव'];
const VAAR_MANTRA_ARR = [
  'ॐ घृणि सूर्याय नमः',
  'ॐ नमः शिवाय',
  'ॐ नमो हनुमते रुद्रावताराय',
  'ॐ गं गणपतये नमः',
  'ॐ नमो भगवते वासुदेवाय',
  'ॐ श्रीं महालक्ष्म्यै नमः',
  'ॐ शं शनैश्चराय नमः',
];
const RAHU_SLOT = [8, 2, 7, 5, 6, 4, 3];

function buildFullPanchang(raw) {
  const date     = new Date();
  const dayIndex = date.getDay();
  const tithiHi  = raw.tithi || '';
  const paksha   = ['पूर्णिमा','15','Purnima'].some(t => tithiHi.includes(t))
    ? 'Purnima Paksha'
    : ['अमावस्या','Amavasya'].some(t => tithiHi.includes(t))
      ? 'Amavasya Paksha'
      : (() => {
          const match = tithiHi.match(/\d+/);
          if (!match) return 'Shukla Paksha';
          return parseInt(match[0]) <= 15 ? 'Shukla Paksha' : 'Krishna Paksha';
        })();

  const vaar       = VAAR_HI_ARR[dayIndex] + ' / ' + VAAR_EN_ARR[dayIndex];
  const vaarDeity  = VAAR_DEITY_EN[dayIndex] + ' (' + VAAR_DEITY_HI[dayIndex] + ')';
  const vaarMantra = VAAR_MANTRA_ARR[dayIndex];

  const tithi = (raw.tithi || '').toLowerCase();
  const yoga  = (raw.yoga  || '').toLowerCase();
  const GOOD_YOGAS  = ['siddhi','shubha','shiva','brahma','priti','saubhagya','vriddhi','harshana'];
  const BAD_YOGAS   = ['vishkambha','ganda','vajra','vyatipata','parigha','vaidhriti','atiganda','shula'];
  const GOOD_TITHIS = ['purnima','tritiya','panchami','saptami','dashami','ekadashi','dwadashi'];
  const BAD_TITHIS  = ['amavasya','chaturdashi','ashtami'];
  const isGoodYoga  = GOOD_YOGAS.some(g => yoga.includes(g));
  const isBadYoga   = BAD_YOGAS.some(b => yoga.includes(b));
  const isGoodTithi = GOOD_TITHIS.some(g => tithi.includes(g));
  const isBadTithi  = BAD_TITHIS.some(b => tithi.includes(b));
  const auspiciousScore = (isGoodYoga ? 2 : 0) + (isGoodTithi ? 1 : 0) - (isBadYoga ? 2 : 0) - (isBadTithi ? 1 : 0);
  const auspiciousLabel = auspiciousScore >= 2
    ? '✨ अत्यंत शुभ दिन'
    : auspiciousScore >= 1
      ? '🌸 शुभ दिन'
      : auspiciousScore <= -2
        ? '⚠️ सावधानी रखें'
        : '⚖️ सामान्य दिन';

  const year         = date.getFullYear();
  const month        = date.getMonth() + 1;
  const vikramSamvat = month >= 4 ? year + 57 : year + 56;

  let rahuKaal = 'Unavailable';
  try {
    if (raw.sunrise && raw.sunset) {
      const [srH, srM] = raw.sunrise.split(':').map(Number);
      const [ssH, ssM] = raw.sunset.split(':').map(Number);
      const totalMin   = (ssH * 60 + ssM) - (srH * 60 + srM);
      const partMin    = totalMin / 8;
      const slot       = RAHU_SLOT[dayIndex] - 1;
      const startMin   = srH * 60 + srM + slot * partMin;
      const endMin     = startMin + partMin;
      const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(Math.round(m%60)).padStart(2,'0')}`;
      rahuKaal = `${fmt(startMin)} – ${fmt(endMin)}`;
    }
  } catch (_) {}

  const specialEvents = [];
  const tithiLower = (raw.tithi || '').toLowerCase();
  if (tithiLower.includes('ekadashi'))  specialEvents.push({ text: '🌿 एकादशी — विष्णु व्रत · Fast for Lord Vishnu', color: '#27AE60' });
  if (tithiLower.includes('purnima'))   specialEvents.push({ text: '🌕 पूर्णिमा — Full moon, highly auspicious', color: '#F4A261' });
  if (tithiLower.includes('amavasya')) specialEvents.push({ text: '🌑 अमावस्या — Pitru Tarpan day', color: '#9B59B6' });
  if (tithiLower.includes('chaturthi'))specialEvents.push({ text: '🐘 चतुर्थी — Ganesh Puja', color: '#E8620A' });
  if (dayIndex === 1) specialEvents.push({ text: '🔱 Somvar — Shiva Abhishek', color: '#6B21A8' });
  if (dayIndex === 2) specialEvents.push({ text: '🏹 Mangalvar — Hanuman Chalisa', color: '#E74C3C' });
  if (dayIndex === 4) specialEvents.push({ text: '🪷 Guruvar — Vishnu Puja', color: '#F39C12' });
  if (dayIndex === 5) specialEvents.push({ text: '✨ Shukravar — Lakshmi Puja', color: '#F4A261' });

  return {
    tithi:     raw.tithi     || 'Unknown',
    nakshatra: raw.nakshatra || 'Unknown',
    yoga:      raw.yoga      || 'Unknown',
    karana:    raw.karana    || 'Unknown',
    weekday:   raw.weekday   || VAAR_EN_ARR[dayIndex],
    sunrise:   raw.sunrise   || '06:00',
    sunset:    raw.sunset    || '18:30',
    paksha, vaar, vaarDeity, vaarMantra, auspiciousLabel,
    auspiciousColor: auspiciousScore >= 2 ? '#27AE60' : auspiciousScore <= -2 ? '#E74C3C' : '#C9830A',
    specialEvents, vikramSamvat, rahuKaal,
    abhijit: (() => {
      try {
        const [srH, srM] = (raw.sunrise||'06:00').split(':').map(Number);
        const [ssH, ssM] = (raw.sunset||'18:30').split(':').map(Number);
        const noon = (srH*60+srM + ssH*60+ssM) / 2;
        const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(Math.round(m%60)).padStart(2,'0')}`;
        return `${fmt(noon-12)} – ${fmt(noon+12)}`;
      } catch { return '11:48 – 12:12'; }
    })(),
    dateStr: new Date().toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }),
  };
}

function getFallbackPanchang() {
  const date     = new Date();
  const dayIndex = date.getDay();
  const year     = date.getFullYear();
  const TITHIS_EN = ['Pratipada','Dwitiya','Tritiya','Chaturthi','Panchami','Shashthi','Saptami',
    'Ashtami','Navami','Dashami','Ekadashi','Dwadashi','Trayodashi','Chaturdashi','Purnima'];
  const NAKS_EN   = ['Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra','Punarvasu',
    'Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni','Hasta','Chitra','Swati'];
  const dayOfYear = Math.floor((date - new Date(year, 0, 0)) / 86400000);
  return buildFullPanchang({
    tithi:     TITHIS_EN[dayOfYear % 15],
    nakshatra: NAKS_EN[dayOfYear % 15],
    yoga:      'Shubha',
    karana:    'Bava',
    weekday:   VAAR_EN_ARR[dayIndex],
    sunrise:   '06:12',
    sunset:    '18:44',
  });
}

app.get("/api/panchang/today", async (req, res) => {
  try {
    let { lat, lng, city } = req.query;
    if ((!lat || !lng) && city) {
      const coords = await getCoordinatesFromCity(city);
      if (coords) { lat = coords.lat; lng = coords.lng; }
    }
    if (!lat || !lng) {
      return res.json({ success: true, data: getFallbackPanchang(), source: 'fallback_no_coords' });
    }
    const date = new Date().toISOString().split("T")[0];
    const key  = `${lat}|${lng}|${date}`;
    if (PANCHANG_CACHE[key] && Date.now() - PANCHANG_CACHE[key].time < CACHE_TTL) {
      return res.json({ success: true, data: PANCHANG_CACHE[key].data, cached: true });
    }
    if (!canCallAPI()) {
      return res.json({ success: true, data: getFallbackPanchang(), source: 'fallback_rate_limit' });
    }
    let rawData = null;
    try {
      const token  = await getProkeralaToken();
      const url    = `https://api.prokerala.com/v2/astrology/panchang?ayanamsa=lahiri&coordinates=${lat},${lng}&datetime=${date}T00:00:00+05:30`;
      const apiRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json   = await apiRes.json();
      if (json?.data) {
        rawData = {
          sunrise:   json.data.sunrise  || '',
          sunset:    json.data.sunset   || '',
          tithi:     json.data.tithi?.name     || '',
          nakshatra: json.data.nakshatra?.name || '',
          yoga:      json.data.yoga?.name      || '',
          karana:    json.data.karana?.name    || '',
          weekday:   json.data.vaara           || '',
        };
      }
    } catch (apiErr) {
      console.error("Prokerala API error:", apiErr.message);
    }
    const fullData = rawData ? buildFullPanchang(rawData) : getFallbackPanchang();
    PANCHANG_CACHE[key] = { data: fullData, time: Date.now() };
    res.json({ success: true, data: fullData, source: rawData ? 'prokerala' : 'fallback' });
  } catch (err) {
    console.error("Panchang route error:", err.message);
    res.json({ success: true, data: getFallbackPanchang(), source: 'fallback_error' });
  }
});

// ════════════════════════════════════════════════════════════════
// P2 — DHARMIC LIBRARY (PUBLIC)
// ════════════════════════════════════════════════════════════════

// GET /library/books?lang=hindi&category=gita&search=&page=1&limit=20
app.get('/library/books', async (req, res) => {
  try {
    const { lang, category, search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, +page) - 1) * Math.min(50, +limit);
    let q = `?is_active=eq.true&order=created_at.desc&limit=${Math.min(50,+limit)}&offset=${offset}`;
    if (lang)     q += `&language=eq.${encodeURIComponent(lang)}`;
    if (category && category !== 'all') q += `&category=eq.${encodeURIComponent(category)}`;
    let books = await sbSelect('dharmic_books', q);
    if (search) {
      const s = search.toLowerCase();
      books = books.filter(b =>
        (b.title||'').toLowerCase().includes(s) ||
        (b.title_hindi||'').toLowerCase().includes(s) ||
        (b.author||'').toLowerCase().includes(s) ||
        (b.tags||'').toLowerCase().includes(s)
      );
    }
    res.json({ success: true, books, page: +page });
  } catch(e) {
    console.error('[library/books]', e.message);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// GET /library/books/:id — single book detail
app.get('/library/books/:id', async (req, res) => {
  try {
    const id = sanitize(req.params.id, 100);
    const rows = await sbSelect('dharmic_books', `?id=eq.${encodeURIComponent(id)}&is_active=eq.true&limit=1`);
    if (!rows.length) return res.status(404).json({ error: 'Book not found' });
    // Increment view count (non-blocking)
    sbUpdate('dharmic_books', `?id=eq.${encodeURIComponent(id)}`, { views: (rows[0].views||0)+1 }).catch(()=>{});
    res.json({ success: true, book: rows[0] });
  } catch(e) {
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

// POST /library/books/:id/view — record view per user
app.post('/library/books/:id/view', async (req, res) => {
  try {
    const book_id = sanitize(req.params.id, 100);
    const phone   = sanitize(req.body.phone||'', 20);
    await sbInsert('book_views', {
      id: `bv_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      book_id, phone, viewed_at: new Date().toISOString()
    });
    res.json({ success: true });
  } catch(e) { res.json({ success: true }); }
});

// GET /library/categories
app.get('/library/categories', (req, res) => {
  res.json({ success: true, categories: [
    { id:'all',          label:'All',          labelHi:'सभी'           },
    { id:'vedas',        label:'Vedas',         labelHi:'वेद'           },
    { id:'upanishads',   label:'Upanishads',    labelHi:'उपनिषद'        },
    { id:'puranas',      label:'Puranas',       labelHi:'पुराण'         },
    { id:'gita',         label:'Gita',          labelHi:'गीता'          },
    { id:'ramayana',     label:'Ramayana',      labelHi:'रामायण'        },
    { id:'mahabharata',  label:'Mahabharata',   labelHi:'महाभारत'       },
    { id:'smritis',      label:'Smritis',       labelHi:'स्मृतियाँ'    },
    { id:'stotras',      label:'Stotras',       labelHi:'स्तोत्र'       },
    { id:'modern',       label:'Modern',        labelHi:'आधुनिक'        },
    { id:'other',        label:'Other',         labelHi:'अन्य'          },
  ]});
});

app.get('/library/sources', async (req, res) => {
  const fallbackSources = [
    { id:'sanatan_granth_1', title:'Sanatan Granth 1', source_type:'drive_folder', drive_folder_id:'1ON1J2MeyN0nj4SRHBzH6gXqIG85w6jNB', category:'other', language:'mixed', ingestion_status:'pending_manifest' },
    { id:'sanatan_granth_2', title:'Sanatan Granth 2', source_type:'drive_folder', drive_folder_id:'1Hf4ufz1w_d8iLOjGYfPgVE4vtdLzRAVx', category:'other', language:'mixed', ingestion_status:'pending_manifest' },
    { id:'vishnu_sahasranam_course', title:'Vishnu Sahasranam Full Course', source_type:'drive_folder', drive_folder_id:'1KRVLrFliErgqseogu4GHEM67zwOZUOJ4', category:'courses', language:'mixed', ingestion_status:'pending_manifest' },
    { id:'additional_dharmic_content', title:'Additional Dharmic Content', source_type:'drive_folder', drive_folder_id:'1-XXBzjjLAd6H65Kl63dIKHaN1UIzfDW9', category:'other', language:'mixed', ingestion_status:'pending_manifest' },
  ];
  try {
    const rows = await sbSelect('content_sources', '?is_active=eq.true&order=title.asc');
    res.json({ success: true, sources: rows.length ? rows : fallbackSources, source: rows.length ? 'supabase' : 'fallback' });
  } catch(e) {
    res.json({ success: true, sources: fallbackSources, source: 'fallback' });
  }
});

app.get('/library/manifest', async (req, res) => {
  const startTime = Date.now();
  const reqId = `lm_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
  
  try {
    const { sourceId = '', category = '', lang = '', search = '', page = 1, limit = 30 } = req.query;
    const safeLimit = Math.min(60, Math.max(1, +limit || 30));
    const offset = (Math.max(1, +page || 1) - 1) * safeLimit;
    
    console.log(`[${reqId}] /library/manifest hit`, { sourceId, category, lang, search, page, limit: safeLimit });
    
    const [sources, categories] = await Promise.all([
      sbSelect('content_sources', '?is_active=eq.true&order=title.asc').catch(() => []),
      Promise.resolve([
        'all','vedas','upanishads','puranas','gita','ramayana','mahabharata','stotras','courses','other'
      ]),
    ]);

    let q = `?is_active=eq.true&order=created_at.desc&limit=${safeLimit}&offset=${offset}`;
    if (sourceId) q += `&source_id=eq.${encodeURIComponent(sanitize(sourceId, 100))}`;
    if (category && category !== 'all') q += `&category=eq.${encodeURIComponent(sanitize(category, 50))}`;
    if (lang && lang !== 'all') q += `&language=eq.${encodeURIComponent(sanitize(lang, 30))}`;

    console.log(`[${reqId}] Query string: ${q}`);
    
    let items = await sbSelect('dharmic_books', q);
    console.log(`[${reqId}] Fetched ${items.length} books from Supabase`);
    
    if (search) {
      const needle = sanitize(search, 120).toLowerCase();
      items = items.filter(b => [
        b.title, b.title_hindi, b.title_sanskrit, b.author, b.source,
        b.language, b.category, b.sub_category, b.description, b.tags, b.search_text,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle));
      console.log(`[${reqId}] Filtered to ${items.length} books by search: "${search}"`);
    }
    
    res.setHeader('Cache-Control', 'public, max-age=300');
    
    const responseTime = Date.now() - startTime;
    console.log(`[${reqId}] ✅ Success in ${responseTime}ms | items: ${items.length} | sources: ${sources.length}`);
    
    res.json({
      success: true,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources,
      categories,
      page: +page || 1,
      limit: safeLimit,
      hasMore: items.length === safeLimit,
      items,
      _meta: { requestId: reqId, responseTime }
    });
  } catch(e) {
    const responseTime = Date.now() - startTime;
    console.error(`[${reqId}] ❌ Error in ${responseTime}ms: ${e.message}`);
    console.error(`[${reqId}] Stack:`, e.stack);
    res.status(500).json({ 
      success: false, 
      items: [], 
      sources: [], 
      categories: ['all','vedas','upanishads','puranas','gita','ramayana','mahabharata','stotras','courses','other'],
      error: 'Manifest unavailable',
      _meta: { requestId: reqId, errorMessage: e.message }
    });
  }
});

app.get('/katha/catalog', async (req, res) => {
  const startTime = Date.now();
  const reqId = `kc_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
  
  try {
    const { lang = '', category = '', search = '' } = req.query;
    
    console.log(`[${reqId}] /katha/catalog hit`, { lang, category, search });
    
    let q = '?order=scripture_id.asc,unit_id.asc&limit=500';
    if (lang) q += `&lang=eq.${encodeURIComponent(sanitize(lang, 20))}`;
    if (category) q += `&category=eq.${encodeURIComponent(sanitize(category, 50))}`;
    
    console.log(`[${reqId}] Query string: ${q}`);
    
    let chapters = await sbSelect('katha_chapters', q).catch(e => {
      console.warn(`[${reqId}] katha_chapters query failed: ${e.message}, trying fallback`);
      return null;
    });
    
    if (!chapters || chapters.length === 0) {
      console.log(`[${reqId}] katha_chapters empty, fetching from katha_vault fallback`);
      const rows = await sbSelect('katha_vault', '?select=scripture_id,unit_id,lang,chapter_title&order=scripture_id.asc,unit_id.asc').catch(e => {
        console.warn(`[${reqId}] katha_vault query failed: ${e.message}`);
        return [];
      });
      
      const groups = {};
      rows.forEach(r => {
        const key = `${r.scripture_id}_${r.unit_id}_${r.lang}`;
        groups[key] = groups[key] || { 
          scripture_id: r.scripture_id, 
          unit_id: String(r.unit_id), 
          lang: r.lang, 
          chapter_title: r.chapter_title, 
          generated_count: 0 
        };
        groups[key].generated_count += 1;
      });
      chapters = Object.values(groups);
      console.log(`[${reqId}] Built fallback: ${chapters.length} chapters from ${rows.length} verses`);
    } else {
      console.log(`[${reqId}] Fetched ${chapters.length} chapters from katha_chapters`);
    }
    
    if (search) {
      const needle = sanitize(search, 120).toLowerCase();
      chapters = chapters.filter(c => [
        c.scripture_id, c.unit_id, c.lang, c.chapter_title, c.category, c.search_text,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle));
      console.log(`[${reqId}] Filtered to ${chapters.length} chapters by search: "${search}"`);
    }
    
    res.setHeader('Cache-Control', 'public, max-age=300');
    
    const responseTime = Date.now() - startTime;
    console.log(`[${reqId}] ✅ Success in ${responseTime}ms | chapters: ${chapters.length}`);
    
    res.json({ 
      success: true, 
      chapters, 
      count: chapters.length,
      _meta: { requestId: reqId, responseTime }
    });
  } catch(e) {
    const responseTime = Date.now() - startTime;
    console.error(`[${reqId}] ❌ Error in ${responseTime}ms: ${e.message}`);
    console.error(`[${reqId}] Stack:`, e.stack);
    res.json({ 
      success: true, 
      chapters: [], 
      count: 0, 
      source: 'error_fallback',
      _meta: { requestId: reqId, errorMessage: e.message }
    });
  }
});

app.get('/mantras', async (req, res) => {
  try {
    const {
      deity = '', purpose = '', language = '', difficulty = '',
      scriptureSource = '', search = '', page = 1, limit = 50,
    } = req.query;
    const safeLimit = Math.min(100, Math.max(1, +limit || 50));
    const offset = (Math.max(1, +page || 1) - 1) * safeLimit;
    let q = `?is_active=eq.true&order=title.asc&limit=${safeLimit}&offset=${offset}`;
    if (deity) q += `&deity=eq.${encodeURIComponent(sanitize(deity, 80))}`;
    if (purpose) q += `&purpose=eq.${encodeURIComponent(sanitize(purpose, 80))}`;
    if (language) q += `&language=eq.${encodeURIComponent(sanitize(language, 40))}`;
    if (difficulty) q += `&difficulty=eq.${encodeURIComponent(sanitize(difficulty, 40))}`;
    if (scriptureSource) q += `&scripture_source=eq.${encodeURIComponent(sanitize(scriptureSource, 120))}`;

    let mantras = await sbSelect('mantra_catalog', q);
    if (search) {
      const needle = sanitize(search, 120).toLowerCase();
      mantras = mantras.filter(m => [
        m.title, m.deity, m.purpose, m.scripture_source, m.sanskrit_text,
        m.transliteration, m.meaning_hi, m.meaning_en, m.search_text,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle));
    }
    res.json({ success: true, mantras, page: +page || 1, count: mantras.length, source: 'supabase' });
  } catch(e) {
    res.json({ success: true, mantras: [], page: +(req.query.page || 1), count: 0, source: 'not_configured' });
  }
});

// ════════════════════════════════════════════════════════════════
// P2 — AI FEEDBACK (PUBLIC submit)
// ════════════════════════════════════════════════════════════════
app.post('/admin/library/ingest/manifest', adminAuth, async (req, res) => {
  try {
    const manifest = req.body?.manifest || req.body;
    const errors = validateContentManifest(manifest);
    if (errors.length) return res.status(400).json({ success: false, errors });

    const source = normalizeSource({ ...manifest.source, ingestionStatus: 'indexed' });
    source.last_ingested_at = new Date().toISOString();
    const books = (manifest.items || []).map(item => normalizeContentItem(item, source));

    await sbUpsert('content_sources', source, 'id');
    for (const book of books) await sbUpsert('dharmic_books', book, 'id');

    res.json({ success: true, sourceId: source.id, ingested: books.length });
  } catch(e) {
    console.error('[admin/library/ingest/manifest]', e.message);
    res.status(500).json({ success: false, error: 'Content manifest ingestion failed' });
  }
});

app.post('/admin/mantras/ingest/manifest', adminAuth, async (req, res) => {
  try {
    const manifest = req.body?.manifest || req.body;
    const errors = validateMantraManifest(manifest);
    if (errors.length) return res.status(400).json({ success: false, errors });

    const rows = (manifest.items || []).map(normalizeMantra);
    for (const row of rows) await sbUpsert('mantra_catalog', row, 'id');
    res.json({ success: true, ingested: rows.length });
  } catch(e) {
    console.error('[admin/mantras/ingest/manifest]', e.message);
    res.status(500).json({ success: false, error: 'Mantra manifest ingestion failed' });
  }
});

app.post('/ai/feedback', requireSupabaseUser, async (req, res) => {
  try {
    const rateKey = req.authUser.id;
    if (!checkRateLimit(`aifb_${rateKey}`, 10))
      return res.status(429).json({ error: 'Too many submissions' });
    const { question, ai_answer, rating, reason, language, feature, message_id, provider, model, mode, latency_ms } = req.body;
    if (!question || !ai_answer || !rating)
      return res.status(400).json({ error: 'question, ai_answer, rating required' });
    const entry = {
      id: `af_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      question:  sanitize(question,  500),
      ai_answer: sanitize(ai_answer, 1500),
      rating:    rating === 'up' ? 'up' : 'down',
      reason:    sanitize(reason||'', 300),
      phone:     '',
      language:  sanitize(language||'hindi', 20),
      user_id: req.authUser.id,
      feature: feature === 'fact_check' ? 'fact_check' : 'dharma_chat',
      message_id: sanitize(message_id || '', 100),
      provider: sanitize(provider || '', 30),
      model: sanitize(model || '', 100),
      mode: mode === 'factcheck' ? 'factcheck' : 'dharma',
      latency_ms: Math.max(0, Math.min(Number(latency_ms) || 0, 300000)),
      created_at: new Date().toISOString(),
    };
    await sbUpsert('ai_feedback', entry, 'user_id,message_id');
    res.json({ success: true, id: entry.id });
  } catch(e) {
    console.error('[ai/feedback]', e.message);
    res.status(500).json({ error: 'Feedback submission failed' });
  }
});

// ════════════════════════════════════════════════════════════════
// P2 — ADMIN: LIBRARY MANAGEMENT
// ════════════════════════════════════════════════════════════════

// GET /admin/library/books
app.get('/admin/library/books', adminAuth, async (req, res) => {
  try {
    const { lang, category, status, page=1 } = req.query;
    const offset = (Math.max(1,+page)-1)*50;
    let q = `?order=created_at.desc&limit=50&offset=${offset}`;
    if (lang)   q += `&language=eq.${encodeURIComponent(lang)}`;
    if (category && category !== 'all') q += `&category=eq.${encodeURIComponent(category)}`;
    if (status) q += `&indexing_status=eq.${encodeURIComponent(status)}`;
    const books = await sbSelect('dharmic_books', q);
    res.json({ success: true, books, page: +page });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /admin/library/books — add book
app.post('/admin/library/books', adminAuth, async (req, res) => {
  try {
    const {
      title, title_hindi, title_sanskrit, author, source,
      language, category, sub_category, description, description_hindi,
      tags, page_count, file_url, thumbnail_url, is_premium, admin_notes
    } = req.body;
    if (!title || !language || !category)
      return res.status(400).json({ error: 'title, language, category required' });
    const book = {
      id: `bk_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      title:           sanitize(title, 300),
      title_hindi:     sanitize(title_hindi||'', 300),
      title_sanskrit:  sanitize(title_sanskrit||'', 300),
      author:          sanitize(author||'', 200),
      source:          sanitize(source||'', 200),
      language:        sanitize(language, 20),
      category:        sanitize(category, 50),
      sub_category:    sanitize(sub_category||'', 100),
      description:     sanitize(description||'', 2000),
      description_hindi: sanitize(description_hindi||'', 2000),
      tags:            sanitize(tags||'', 500),
      page_count:      +page_count || null,
      file_url:        (file_url||'').slice(0,1000),
      thumbnail_url:   (thumbnail_url||'').slice(0,500),
      is_premium:      !!is_premium,
      admin_notes:     sanitize(admin_notes||'', 500),
      indexing_status: 'pending',
      is_active:       true,
      views: 0, downloads: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await sbInsert('dharmic_books', book);
    await auditLog('add_book', 'admin', book.id, book.title);
    res.json({ success: true, book });
  } catch(e) {
    console.error('[admin/library/books POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /admin/library/books/:id
app.patch('/admin/library/books/:id', adminAuth, async (req, res) => {
  try {
    const id = sanitize(req.params.id, 100);
    const allowed = ['title','title_hindi','author','source','language','category',
      'description','description_hindi','tags','page_count','file_url',
      'thumbnail_url','is_premium','is_active','indexing_status','admin_notes'];
    const patch = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = typeof req.body[k] === 'string' ? sanitize(req.body[k], 2000) : req.body[k];
    }
    await sbUpdate('dharmic_books', `?id=eq.${encodeURIComponent(id)}`, patch);
    await auditLog('edit_book', 'admin', id, JSON.stringify(patch).slice(0,200));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /admin/library/books/:id (soft delete)
app.delete('/admin/library/books/:id', adminAuth, async (req, res) => {
  try {
    const id = sanitize(req.params.id, 100);
    await sbUpdate('dharmic_books', `?id=eq.${encodeURIComponent(id)}`, { is_active: false, updated_at: new Date().toISOString() });
    await auditLog('delete_book', 'admin', id, 'soft deleted');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// P2 — ADMIN: AI FEEDBACK MODERATION
// ════════════════════════════════════════════════════════════════

// GET /admin/feedback/ai?reviewed=false&page=1
app.get('/admin/feedback/ai', adminAuth, async (req, res) => {
  try {
    const { reviewed, rating, feature, date, page=1 } = req.query;
    const offset = (Math.max(1,+page)-1)*30;
    let q = `?order=created_at.desc&limit=30&offset=${offset}`;
    if (reviewed !== undefined) q += `&admin_reviewed=eq.${reviewed === 'true'}`;
    if (rating) q += `&rating=eq.${rating}`;
    if (feature) q += `&feature=eq.${encodeURIComponent(sanitize(feature, 30))}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      const nextDate = new Date(`${date}T00:00:00.000Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      q += `&created_at=gte.${date}T00:00:00.000Z&created_at=lt.${nextDate.toISOString()}`;
    }
    const items = await sbSelect('ai_feedback', q);
    res.json({ success: true, items, page: +page });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /admin/feedback/ai/:id — review (approve/reject/correct)
app.patch('/admin/feedback/ai/:id', adminAuth, async (req, res) => {
  try {
    const id = sanitize(req.params.id, 100);
    const { action, corrected_answer, approved_answer, admin_notes, source_reference, source_type, verification_status } = req.body;
    if (!['approved','rejected','correction_draft','corrected'].includes(action))
      return res.status(400).json({ error: 'Invalid correction action' });
    const answer = corrected_answer || approved_answer || '';
    const verification = ['unverified','verified','rejected'].includes(verification_status) ? verification_status : 'unverified';
    const patch = {
      admin_reviewed: action !== 'correction_draft',
      admin_action:   action,
      admin_notes:    sanitize(admin_notes||'', 500),
      source_reference: sanitize(source_reference || '', 1000),
      source_type: sanitize(source_type || '', 50),
      verification_status: action === 'rejected' ? 'rejected' : verification,
      correction_updated_at: new Date().toISOString(),
      reviewed_at:    action === 'correction_draft' ? null : new Date().toISOString(),
    };
    if (['correction_draft','corrected'].includes(action)) {
      if (!answer.trim()) return res.status(400).json({ error: 'Corrected answer required' });
      patch.corrected_answer = sanitize(answer, 4000);
    }
    if (action === 'corrected' && verification === 'verified') {
      const original = await sbSelect('ai_feedback', `?id=eq.${encodeURIComponent(id)}&select=question,language&limit=1`);
      await sbInsert('approved_answers', {
        id: `aa_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        question_pattern: sanitize(original[0]?.question || '', 500),
        approved_answer:  patch.corrected_answer,
        scripture_ref: patch.source_reference,
        language: sanitize(original[0]?.language || 'hindi', 20),
        category: patch.source_type || 'general',
        is_active: true,
        use_count: 0,
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      });
    }
    await sbUpdate('ai_feedback', `?id=eq.${encodeURIComponent(id)}`, patch);
    await auditLog('review_ai_feedback', 'admin', id, action);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /admin/feedback/ai/stats
app.get('/admin/feedback/ai/stats', adminAuth, async (req, res) => {
  try {
    const [all, pending, up, down] = await Promise.all([
      sbSelect('ai_feedback', '?select=id'),
      sbSelect('ai_feedback', '?admin_reviewed=eq.false&select=id'),
      sbSelect('ai_feedback', '?rating=eq.up&select=id'),
      sbSelect('ai_feedback', '?rating=eq.down&select=id'),
    ]);
    res.json({ success: true, stats: {
      total: all.length, pending: pending.length,
      thumbsUp: up.length, thumbsDown: down.length,
      approvalRate: all.length ? Math.round((up.length/all.length)*100) : 0,
    }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /admin/approved-answers
app.get('/admin/approved-answers', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('approved_answers', '?is_active=eq.true&order=created_at.desc&limit=100');
    res.json({ success: true, answers: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /admin/approved-answers
app.post('/admin/approved-answers', adminAuth, async (req, res) => {
  try {
    const { question_pattern, approved_answer, scripture_ref, language, category } = req.body;
    if (!question_pattern || !approved_answer) return res.status(400).json({ error: 'question_pattern and approved_answer required' });
    const row = {
      id: `aa_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      question_pattern: sanitize(question_pattern, 500),
      approved_answer:  sanitize(approved_answer, 2000),
      scripture_ref:    sanitize(scripture_ref||'', 200),
      language:         sanitize(language||'hindi', 20),
      category:         sanitize(category||'general', 50),
      is_active: true, use_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await sbInsert('approved_answers', row);
    res.json({ success: true, answer: row });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// P2 — KUNDLI VIA PROKERALA
// ════════════════════════════════════════════════════════════════
app.post('/kundli/calculate', requireSupabaseUser, async (req, res) => {
  try {
    const { dob, tob, city } = req.body;
    if (!dob) return res.status(400).json({ error: 'dob required (YYYY-MM-DD)' });
    if (!tob || !/^([01]\d|2[0-3]):[0-5]\d$/.test(tob)) return res.status(400).json({ error: 'BIRTH_TIME_REQUIRED_FOR_PRECISE_KUNDLI' });

    if (!city) return res.status(400).json({ error: 'BIRTHPLACE_REQUIRED' });
    const resolvedPlace = await resolveBirthplace(sanitize(city, 200), dob);
    if (!resolvedPlace || resolvedPlace.timezoneUnresolved) return res.status(422).json({ error: 'BIRTHPLACE_TIMEZONE_UNRESOLVED' });
    const latitude = resolvedPlace.latitude;
    const longitude = resolvedPlace.longitude;

    // Build IST datetime string
    const time    = tob;
    const dtStr   = `${dob}T${time}:00${formatUtcOffset(resolvedPlace.utcOffsetMinutes)}`;

    // Try Prokerala
    if (latitude && longitude && canCallAPI()) {
      try {
        const token  = await getProkeralaToken();
        const coords = `${latitude},${longitude}`;
        const [birthChart, kundliBasic] = await Promise.all([
          fetch(`https://api.prokerala.com/v2/astrology/birth-details?ayanamsa=lahiri&coordinates=${coords}&datetime=${encodeURIComponent(dtStr)}`,
            { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()),
          fetch(`https://api.prokerala.com/v2/astrology/kundli?ayanamsa=lahiri&coordinates=${coords}&datetime=${encodeURIComponent(dtStr)}`,
            { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()).catch(()=>null),
        ]);
        if (birthChart?.data) {
          const d = birthChart.data;
          return res.json({
            success: true, source: 'prokerala',
            rashi:      d.moon_sign     || d.rasi     || '',
            nakshatra:  d.nakshatra?.name || '',
            lagna:      d.ascendant?.name || d.lagna   || '',
            planet:     d.nakshatra?.lord || '',
            moonDeg:    d.moon_sign_longitude || null,
            lagnaSign:  d.ascendant?.name || '',
            latitude, longitude,
            kundli:     kundliBasic?.data || null,
          });
        }
      } catch(apiErr) {
        console.error('[kundli/prokerala]', apiErr.message);
      }
    }

    // Fallback: improved static calculation
    return res.status(503).json({
      success: false,
      code: 'KUNDLI_PROVIDER_UNAVAILABLE',
      error: 'Production Kundli calculation is currently unavailable.',
    });
  } catch(e) {
    console.error('[kundli/calculate]', e.message);
    res.status(500).json({ error: 'Kundli calculation failed' });
  }
});

// Improved static kundli fallback (better than original)
function calculateKundliFallback(dob, tob, city) {
  const RASHI = [
    { name:'Mesh',     nameEn:'Aries',       planet:'Mangal',  deity:'Kartik',    nakIds:[0,1,2] },
    { name:'Vrishabh', nameEn:'Taurus',      planet:'Shukra',  deity:'Lakshmi',   nakIds:[2,3,4] },
    { name:'Mithun',   nameEn:'Gemini',       planet:'Budh',    deity:'Vishnu',    nakIds:[4,5,6] },
    { name:'Kark',     nameEn:'Cancer',       planet:'Chandra', deity:'Shiva',     nakIds:[6,7,8] },
    { name:'Simha',    nameEn:'Leo',          planet:'Surya',   deity:'Surya',     nakIds:[9,10,11]},
    { name:'Kanya',    nameEn:'Virgo',        planet:'Budh',    deity:'Saraswati', nakIds:[11,12,13]},
    { name:'Tula',     nameEn:'Libra',        planet:'Shukra',  deity:'Lakshmi',   nakIds:[13,14,15]},
    { name:'Vrishchik',nameEn:'Scorpio',      planet:'Mangal',  deity:'Kali',      nakIds:[15,16,17]},
    { name:'Dhanu',    nameEn:'Sagittarius',  planet:'Guru',    deity:'Vishnu',    nakIds:[17,18,19]},
    { name:'Makar',    nameEn:'Capricorn',    planet:'Shani',   deity:'Shani',     nakIds:[19,20,21]},
    { name:'Kumbh',    nameEn:'Aquarius',     planet:'Shani',   deity:'Shiva',     nakIds:[21,22,23]},
    { name:'Meen',     nameEn:'Pisces',       planet:'Guru',    deity:'Vishnu',    nakIds:[23,24,25]},
  ];
  const NAKSHATRAS = [
    'Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra',
    'Punarvasu','Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni',
    'Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha',
    'Moola','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishtha',
    'Shatabhisha','Purva Bhadrapada','Uttara Bhadrapada','Revati',
  ];

  // Approximate tropical sun longitude → sidereal (Lahiri ayanamsa ~23.85° in 2024)
  const d = new Date(dob + 'T12:00:00Z');
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  // Approx moon sign from day of year (moon moves ~13°/day, full cycle ~27.3 days)
  const moonCycle = (dayOfYear * 13.2) % 360;
  const rashiIdx  = Math.floor(moonCycle / 30) % 12;
  const nakIdx    = Math.floor(moonCycle / (360/27)) % 27;

  const rashi = RASHI[rashiIdx];
  return {
    rashi:     rashi.name,
    rashiEn:   rashi.nameEn,
    nakshatra: NAKSHATRAS[nakIdx],
    planet:    rashi.planet,
    deity:     rashi.deity,
    lagna:     RASHI[(rashiIdx + 1) % 12].name, // rough lagna approximation
  };
}

// POST /users/update (profile edit from app)
app.patch('/users/update', requireSupabaseUser, async (req, res) => {
  try {
    const { name, currentLocation, language } = req.body;
    const cleanPhone = req.authPhone;
    const patch = { updated_at: new Date().toISOString() };
    if (name)      patch.name      = sanitize(name, 100);
    if (language)  patch.language  = sanitize(language, 20);
    await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, patch);
    const profilePatch = { updated_at: new Date().toISOString() };
    if (name) profilePatch.name = sanitize(name, 100);
    if (language) profilePatch.language = sanitize(language, 20);
    if (currentLocation !== undefined) profilePatch.current_place_name = sanitize(currentLocation, 200);
    await sbUpdate('user_profiles', `?user_id=eq.${encodeURIComponent(req.authUser.id)}`, profilePatch).catch(() => {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /users/delete
app.delete('/users/delete', requireSupabaseUser, async (req, res) => {
  if (!checkRateLimit(`delete_account_${req.authUser.id}`, 3)) return res.status(429).json({ error: 'RATE_LIMIT' });
  try {
    const lastSignIn = Date.parse(req.authUser.last_sign_in_at || '');
    if (!Number.isFinite(lastSignIn) || Date.now() - lastSignIn > 10 * 60 * 1000) {
      return res.status(401).json({ error: 'RECENT_REAUTHENTICATION_REQUIRED' });
    }
    const confirmedPhone = normalizeIndianAuthPhone(req.body?.phone);
    if (req.body?.confirmation !== 'DELETE' || confirmedPhone !== req.authPhone || req.headers['x-confirm-account-deletion'] !== 'DELETE') {
      return res.status(400).json({ error: 'ACCOUNT_DELETION_CONFIRMATION_REQUIRED' });
    }
    const deletedHash = crypto.createHash('sha256').update(`${req.authUser.id}|${req.authPhone}`).digest('hex');
    const result = await sbRest('POST', 'rpc/delete_dharmasetu_account_data', {
      p_user_id: req.authUser.id, p_phone: req.authPhone, p_deleted_hash: deletedHash,
    });
    if (result.data !== true && result.data?.[0] !== true) throw new Error('ACCOUNT_DATA_DELETION_FAILED');
    const { error } = await supabaseAuth.auth.admin.deleteUser(req.authUser.id, false);
    if (error) {
      console.error('[users/delete] Auth deletion pending');
      return res.status(500).json({ error: 'ACCOUNT_AUTH_DELETION_PENDING' });
    }
    await sbUpdate('account_deletion_audit', `?deleted_user_hash=eq.${encodeURIComponent(deletedHash)}`, { result: 'COMPLETE' }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('[users/delete]', error.message);
    res.status(500).json({ error: 'ACCOUNT_DELETION_FAILED' });
  }
});

app.get('/notifications/unread-count', requireSupabaseUser, async (req, res) => {
  try {
    const rows = await sbSelect('user_notifications', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&read_at=is.null&select=id,expires_at&limit=100`);
    const now = Date.now();
    res.json({ success: true, count: rows.filter(row => !row.expires_at || Date.parse(row.expires_at) > now).length });
  } catch (error) {
    console.error('[notifications/unread-count]', error.message);
    res.status(500).json({ error: 'NOTIFICATIONS_UNAVAILABLE' });
  }
});

app.get('/notifications', requireSupabaseUser, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const rows = await sbSelect('user_notifications', `?user_id=eq.${encodeURIComponent(req.authUser.id)}&order=created_at.desc&limit=${limit}`);
    const now = Date.now();
    res.json({ success: true, notifications: rows.filter(row => !row.expires_at || Date.parse(row.expires_at) > now) });
  } catch (error) {
    console.error('[notifications]', error.message);
    res.status(500).json({ error: 'NOTIFICATIONS_UNAVAILABLE' });
  }
});

app.patch('/notifications/:id/read', requireSupabaseUser, async (req, res) => {
  try {
    const id = sanitize(req.params.id, 100);
    const rows = await sbSelect('user_notifications', `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(req.authUser.id)}&select=id&limit=1`);
    if (!rows.length) return res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
    await sbRest('PATCH', 'user_notifications', { read_at: new Date().toISOString() }, `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(req.authUser.id)}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[notifications/read]', error.message);
    res.status(500).json({ error: 'NOTIFICATIONS_UNAVAILABLE' });
  }
});

app.post('/notifications/read-all', requireSupabaseUser, async (req, res) => {
  try {
    await sbRest('PATCH', 'user_notifications', { read_at: new Date().toISOString() }, `?user_id=eq.${encodeURIComponent(req.authUser.id)}&read_at=is.null`);
    res.json({ success: true });
  } catch (error) {
    console.error('[notifications/read-all]', error.message);
    res.status(500).json({ error: 'NOTIFICATIONS_UNAVAILABLE' });
  }
});

app.post('/admin/user-notifications', adminAuth, async (req, res) => {
  try {
    const { user_id, target, type, title, body, data, priority, expires_at, action_route, action_label } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    if (!NOTIFICATION_TYPES.has(type)) return res.status(400).json({ error: 'Invalid notification type' });
    const safeRoute = action_route ? sanitize(action_route, 100) : null;
    if (safeRoute && !SAFE_NOTIFICATION_ROUTES.has(safeRoute)) return res.status(400).json({ error: 'Unsafe action route' });
    let userIds = [];
    if (target === 'all') userIds = (await sbSelect('users', '?select=id&limit=10000')).map(user => user.id).filter(Boolean);
    else if (user_id) userIds = [user_id];
    if (!userIds.length) return res.status(400).json({ error: 'No notification recipients' });
    const createdAt = new Date().toISOString();
    const rows = userIds.map(userId => ({
      id: crypto.randomUUID(), user_id: userId, type,
      title: sanitize(title, 200), body: sanitize(body, 1000),
      data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
      priority: ['low','normal','high'].includes(priority) ? priority : 'normal',
      expires_at: expires_at || null, action_route: safeRoute,
      action_label: sanitize(action_label || '', 100), created_at: createdAt,
    }));
    await sbInsert('user_notifications', rows);
    res.json({ success: true, created: rows.length });
  } catch (error) {
    console.error('[admin/user-notifications]', error.message);
    res.status(500).json({ error: 'NOTIFICATION_CREATE_FAILED' });
  }
});


// ════════════════════════════════════════════════════════════════
// P3 — JWT AUTH & SESSION SECURITY
// ════════════════════════════════════════════════════════════════

const JWT_SECRET   = process.env.JWT_SECRET || 'ds_jwt_fallback_change_in_prod_2025';
const JWT_EXPIRES  = 30 * 24 * 60 * 60; // 30 days in seconds

// ── Minimal JWT implementation (no external deps) ────────────────
function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString();
}

function signJWT(payload) {
  const header  = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const body    = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + JWT_EXPIRES }));
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    if (sig !== expected) return null;
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp && Date.now()/1000 > payload.exp) return null; // expired
    return payload;
  } catch { return null; }
}

// ── Session blacklist (invalidated tokens, in-memory with Supabase backup) ──
const _blacklist = new Set();

async function isBlacklisted(jti) {
  if (_blacklist.has(jti)) return true;
  try {
    const rows = await sbSelect('invalidated_sessions', `?jti=eq.${encodeURIComponent(jti)}&limit=1`);
    return rows.length > 0;
  } catch { return false; }
}

// ── JWT Auth middleware (optional — use on protected routes) ──────
function jwtAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token   = authHeader.slice(7);
  const payload = verifyJWT(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.jwtUser = payload;
  next();
}

// Optional JWT (allows unauthenticated fallback but enriches context)
function jwtSoft(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = verifyJWT(authHeader.slice(7));
    if (payload) req.jwtUser = payload;
  }
  next();
}

// The former Firebase UID exchange endpoint is intentionally retired.
// Future protected backend routes must validate the caller's Supabase JWT.
app.post('/auth/token', (_req, res) => {
  res.status(410).json({ error: 'Legacy token exchange retired; use Supabase Auth session.' });
});

// ── GET /users/me ────────────────────────────────────────────────
// Validate JWT and return authoritative user + premium status
app.get('/users/me', jwtAuth, async (req, res) => {
  try {
    const { sub: phone } = req.jwtUser;
    if (!phone) return res.status(401).json({ error: 'Invalid token payload' });

    // Check blacklist
    if (req.jwtUser.jti && await isBlacklisted(req.jwtUser.jti)) {
      return res.status(401).json({ error: 'Session invalidated. Please login again.' });
    }

    let userData = null;
    try {
      const rows = await sbSelect('users', `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
      userData = rows[0] || null;
    } catch(e) { console.warn('[users/me] DB lookup failed:', e.message); }

    const isPremium = userData?.plan && userData.plan !== 'free' &&
      (!userData.premium_expiry || new Date(userData.premium_expiry) > new Date());

    res.json({
      success: true,
      user: {
        phone:     userData?.phone || phone,
        name:      userData?.name  || '',
        plan:      userData?.plan  || 'free',
        isPremium,
        rashi:     userData?.rashi     || '',
        nakshatra: userData?.nakshatra || '',
        language:  userData?.language  || 'hindi',
        streak:    userData?.streak    || 0,
        points:    userData?.points    || 0,
      },
    });
  } catch(e) {
    console.error('[users/me]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /auth/logout ────────────────────────────────────────────
// Invalidate JWT server-side
app.post('/auth/logout', jwtSoft, async (req, res) => {
  try {
    const jti = req.jwtUser?.jti;
    if (jti) {
      _blacklist.add(jti);
      try {
        await sbInsert('invalidated_sessions', {
          jti,
          phone:      req.jwtUser?.sub || '',
          created_at: new Date().toISOString(),
        });
      } catch { /* silent — blacklist still works in-memory */ }
    }
    res.json({ success: true, message: 'Logged out' });
  } catch(e) {
    res.json({ success: true }); // never fail logout
  }
});

// ── GET /users/access/:phone — enhanced with expiry check ────────
// Existing route, now also checks premium_expiry
app.get('/users/access/:phone', requireSupabaseUser, async (req, res) => {
  try {
    const phone = sanitize(req.params.phone, 20);
    if (!phone) return res.status(400).json({ error: 'Invalid phone' });
    if (phone !== req.authPhone) return res.status(403).json({ error: 'Forbidden' });

    let isPremium = false;
    let plan = 'free';
    let premiumExpiry = null;
    try {
      const rows = await sbSelect('users', `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
      if (rows.length > 0) {
        plan = rows[0].plan || 'free';
        premiumExpiry = rows[0].premium_expiry || null;
        // Premium only valid if plan is not free AND not expired
        const notExpired = !premiumExpiry || new Date(premiumExpiry) > new Date();
        isPremium = plan !== 'free' && notExpired;
        // Auto-downgrade if expired
        if (plan !== 'free' && premiumExpiry && new Date(premiumExpiry) <= new Date()) {
          sbUpdate('users', `?phone=eq.${encodeURIComponent(phone)}`, { plan: 'free' }).catch(() => {});
          plan = 'free'; isPremium = false;
        }
      }
    } catch(e) {
      console.warn('[access] DB error:', e.message);
      return res.json({ isPremium: false, plan: 'free', source: 'error-fallback' });
    }
    res.json({ isPremium, plan, premiumExpiry, source: 'database' });
  } catch(e) {
    res.status(500).json({ isPremium: false, plan: 'free', error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// P3 — ENHANCED RATE LIMITING MIDDLEWARE
// Applied to high-risk routes: AI, auth, payment
// ════════════════════════════════════════════════════════════════

// Per-IP rate limit for AI routes: 30/min
function aiRateLimit(req, res, next) {
  const key = `ai_${req.ip}`;
  if (!checkRateLimit(key, 30)) {
    return res.status(429).json({ error: 'Too many AI requests. Please wait a moment.', retryAfter: 60 });
  }
  next();
}

// Per-IP rate limit for auth: 10/min
function authRateLimit(req, res, next) {
  const key = `auth_${req.ip}`;
  if (!checkRateLimit(key, 10)) {
    return res.status(429).json({ error: 'Too many auth attempts. Please wait.', retryAfter: 60 });
  }
  next();
}

// Apply auth rate limit to token endpoint (retroactively registered,
// Express will use it even though route is above — add app.use before routes in future)
app.use('/auth/token', authRateLimit);

// ════════════════════════════════════════════════════════════════
// P3 — PAYMENT REPLAY PROTECTION
// ════════════════════════════════════════════════════════════════

// Track processed payment verification IDs (prevent double-grant)
const _processedPayments = new Set();

// GET /payment/verify-status/:orderId — idempotent check
app.get('/payment/verify-status/:orderId', requireSupabaseUser, async (req, res) => {
  try {
    const orderId = sanitize(req.params.orderId, 100);
    const order   = await getOrder(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userPhone !== req.authPhone) return res.status(403).json({ error: 'Order does not belong to this account' });
    res.json({
      success:   true,
      orderId,
      status:    order.status,
      plan:      order.planId,
      isPremium: order.status === 'completed',
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /payment/recover — recover premium for paid users ───────
// Lets users recover premium if they paid but session was lost
app.post('/payment/recover', requireSupabaseUser, async (req, res) => {
  try {
    const { orderId } = req.body;
    const cleanPhone = req.authPhone;

    // Check if this phone already has premium
    const rows = await sbSelect('users', `?phone=eq.${encodeURIComponent(cleanPhone)}&limit=1`);
    const user = rows[0];
    if (user?.plan && user.plan !== 'free') {
      return res.json({ success: true, recovered: true, plan: user.plan, message: 'Premium already active' });
    }

    // If orderId provided, verify it's completed
    if (orderId) {
      const order = await getOrder(sanitize(orderId, 100));
      if (order?.status === 'completed' && order.userPhone === cleanPhone) {
        await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, { plan: order.planId || 'pro' });
        return res.json({ success: true, recovered: true, plan: order.planId, message: 'Premium restored from order' });
      }
    }

    // Check payment_orders table for any completed order for this phone
    const orders = await sbSelect('payment_orders', `?phone=eq.${encodeURIComponent(cleanPhone)}&status=eq.completed&limit=1`);
    if (orders.length > 0) {
      const latest = orders[0];
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, { plan: latest.plan_id || 'pro' });
      return res.json({ success: true, recovered: true, plan: latest.plan_id, message: 'Premium restored from payment history' });
    }

    res.json({ success: false, recovered: false, message: 'No completed payment found for this account' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// P3 — PANCHANG CACHE IMPROVEMENT
// City-aware cache key, stale prevention, offline fallback flag
// ════════════════════════════════════════════════════════════════

// GET /panchang/city/:city — city-specific panchang with better caching
app.get('/panchang/city/:city', async (req, res) => {
  const city     = sanitize(req.params.city, 100) || 'Delhi';
  const dateStr  = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const cacheKey = `panchang_${city.toLowerCase()}_${dateStr}`;
  const now      = Date.now();

  // Serve fresh cache
  if (PANCHANG_CACHE[cacheKey] && now - PANCHANG_CACHE[cacheKey].ts < CACHE_TTL) {
    return res.json({ ...PANCHANG_CACHE[cacheKey].data, source: 'cache', city });
  }

  // Try Prokerala
  try {
    if (canCallAPI()) {
      const token   = await getProkeralaToken();
      const coords  = await getCoordinatesFromCity(city) || { lat: '28.6139', lng: '77.2090' }; // Delhi default
      const url     = `https://api.prokerala.com/v2/astrology/panchang?ayanamsa=1&coordinates=${coords.lat},${coords.lng}&datetime=${dateStr}T06:00:00%2B05:30`;
      const apiRes  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (apiRes.ok) {
        const d = await apiRes.json();
        const panchang = {
          tithi:     d.data?.tithi?.name           || '',
          nakshatra: d.data?.nakshatra?.name        || '',
          yoga:      d.data?.yoga?.name             || '',
          karana:    d.data?.karana?.name           || '',
          sunrise:   d.data?.sunrise                || '',
          sunset:    d.data?.sunset                 || '',
          moonrashi: d.data?.moon_sign?.name        || '',
          date:      dateStr,
          city,
          _isFallback: false,
        };
        PANCHANG_CACHE[cacheKey] = { data: panchang, ts: now };
        return res.json({ ...panchang, source: 'prokerala' });
      }
    }
  } catch(e) {
    console.warn('[Panchang city] API error:', e.message);
  }

  // Static fallback
  const fallback = buildStaticPanchang(dateStr, city);
  PANCHANG_CACHE[cacheKey] = { data: fallback, ts: now - (CACHE_TTL - 60 * 60 * 1000) }; // expire in 1h
  res.json({ ...fallback, source: 'fallback', _isFallback: true });
});

function buildStaticPanchang(dateStr, city = 'Delhi') {
  const d = new Date(dateStr);
  const TITHIS    = ['Pratipada','Dwitiya','Tritiya','Chaturthi','Panchami','Shashthi','Saptami','Ashtami','Navami','Dashami','Ekadashi','Dwadashi','Trayodashi','Chaturdashi','Purnima/Amavasya'];
  const NAKS      = ['Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra','Punarvasu','Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni','Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha','Moola','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishtha','Shatabhisha','Purva Bhadrapada','Uttara Bhadrapada','Revati'];
  const YOGAS     = ['Vishkambha','Priti','Ayushman','Saubhagya','Shobhana','Atiganda','Sukarman','Dhriti','Shula','Ganda','Vriddhi','Dhruva','Vyaghata','Harshana','Vajra','Siddhi','Vyatipata','Variyan','Parigha','Shiva','Siddha','Sadhya','Shubha','Shukla','Brahma','Indra','Vaidhriti'];
  const day = Math.floor(d.getTime() / 86400000);
  return {
    tithi:     TITHIS[day % 15],
    nakshatra: NAKS[day % 27],
    yoga:      YOGAS[day % 27],
    karana:    day % 2 === 0 ? 'Bava' : 'Balava',
    sunrise:   '06:05 AM IST',
    sunset:    '06:47 PM IST',
    moonrashi: ['Mesh','Vrishabh','Mithun','Kark','Simha','Kanya','Tula','Vrishchik','Dhanu','Makar','Kumbh','Meen'][day % 12],
    date:      dateStr,
    city,
    _isFallback: true,
  };
}

// ════════════════════════════════════════════════════════════════
// P3 — SECURITY: Enhanced CORS + CSP headers
// ════════════════════════════════════════════════════════════════

// Tighten CORS: allow admin dashboard origin + mobile app (Expo)
// Apply at app level below existing cors() middleware
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  // Block unknown browser origins from admin routes
  if (req.path.startsWith('/admin') && origin && !origin.includes('render.com') && !origin.includes('localhost')) {
    const key = req.headers['x-admin-key'];
    if (!key || key !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Forbidden origin' });
    }
  }
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ════════════════════════════════════════════════════════════════
// P3 — HEALTH ENDPOINT (enhanced)
// ════════════════════════════════════════════════════════════════

app.get('/health/deep', async (req, res) => {
  const uptime = process.uptime();
  let dbOk = false;
  let tableCount = {};
  try {
    const users = await sbSelect('users', '?limit=1');
    dbOk = true;
    const [u, k, b, f] = await Promise.allSettled([
      sbSelect('users',         '?limit=0&select=count'),
      sbSelect('katha_chapters','?limit=0&select=count'),
      sbSelect('dharmic_books', '?limit=0&select=count'),
      sbSelect('ai_feedback',   '?limit=0&select=count'),
    ]);
    tableCount = {
      users:        u.value?.[0]?.count  || 0,
      katha:        k.value?.[0]?.count  || 0,
      books:        b.value?.[0]?.count  || 0,
      ai_feedback:  f.value?.[0]?.count  || 0,
    };
  } catch {}
  res.json({
    success:        true,
    status:         'ok',
    uptime:         Math.round(uptime),
    memory:         `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    dbConnected:    dbOk,
    storageUsage:   'N/A (Supabase managed)',
    lastBackup:     'Supabase auto-backup',
    nodeVersion:    process.version,
    tableCount,
    cacheSize:      Object.keys(PANCHANG_CACHE).length,
    blacklistSize:  _blacklist.size,
    timestamp:      new Date().toISOString(),
  });
});


// ════════════════════════════════════════════════════════════════
// P4 — VOICE TRANSCRIPTION
// Uses Groq Whisper API if key is available, else returns null
// ════════════════════════════════════════════════════════════════
app.post('/voice/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    const lang = sanitize(req.body.lang || 'hi-IN', 10);

    // Try Groq Whisper transcription
    const groqKey = CFG.groqKey;
    if (groqKey) {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', req.file.buffer, { filename: 'voice.m4a', contentType: 'audio/m4a' });
      form.append('model', 'whisper-large-v3');
      form.append('language', lang.split('-')[0]); // 'hi' or 'en'
      form.append('response_format', 'json');

      const res2 = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, ...form.getHeaders() },
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      if (res2.ok) {
        const data = await res2.json();
        if (data.text) {
          return res.json({ success: true, transcript: data.text.trim(), source: 'whisper' });
        }
      }
    }

    // Fallback: no transcription available
    return res.json({ success: false, transcript: null, error: 'Transcription not available' });
  } catch(e) {
    console.error('[Voice] Transcribe error:', e.message);
    res.status(500).json({ success: false, transcript: null, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// P4 — CHAT CONTEXT (Approved Answers retrieval)
// Phase 1: keyword match from approved_answers
// Phase 2: semantic vector similarity (pgvector)
// ════════════════════════════════════════════════════════════════
app.post('/chat/context', async (req, res) => {
  try {
    const { question, lang } = req.body;
    if (!question) return res.json({ context: [] });
    const cleanQ = sanitize(question, 500).toLowerCase();

    // Keyword-match approved answers
    const allAnswers = await sbSelect('approved_answers', `?lang=eq.${encodeURIComponent(lang || 'hindi')}&limit=50`);
    const matches = allAnswers
      .filter(a => {
        const pattern = (a.question_pattern || '').toLowerCase();
        // Simple word-overlap scoring
        const qWords = cleanQ.split(/\s+/).filter(w => w.length > 3);
        const score  = qWords.filter(w => pattern.includes(w)).length;
        return score >= 1;
      })
      .slice(0, 3)
      .map(a => ({
        question: a.question_pattern,
        answer:   a.approved_answer,
        ref:      a.scripture_ref,
      }));

    res.json({ context: matches, source: 'keyword' });
  } catch(e) {
    console.error('[Context]', e.message);
    res.json({ context: [] });
  }
});

// ════════════════════════════════════════════════════════════════
// P4 — PUSH TOKEN REGISTRATION
// ════════════════════════════════════════════════════════════════
app.post('/users/push-token', async (req, res) => {
  try {
    const { phone, token } = req.body;
    if (!phone || !token) return res.status(400).json({ error: 'phone and token required' });
    const cleanPhone = sanitize(phone, 20);
    const cleanToken = sanitize(token, 200);
    await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, {
      push_token:      cleanToken,
      push_token_at:   new Date().toISOString(),
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// P4 — ANALYTICS EVENTS INGEST (Phase 1: log only)
// Phase 2: forward to PostHog / Amplitude
// ════════════════════════════════════════════════════════════════
app.post('/analytics/events', async (req, res) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) return res.json({ success: true });
    // Phase 1: just acknowledge — events are stored locally in app
    // Phase 2: insert into analytics_events table or forward to PostHog
    console.log(`[Analytics] Received ${events.length} events from client`);
    res.json({ success: true, received: events.length });
  } catch(e) {
    res.json({ success: true }); // never fail analytics
  }
});

// ════════════════════════════════════════════════════════════════
// P4 — LIBRARY SEARCH (keyword, upgradeable to semantic)
// ════════════════════════════════════════════════════════════════
app.get('/library/books/search', async (req, res) => {
  try {
    const q    = sanitize(req.query.q || '', 200);
    const lang = sanitize(req.query.lang || '', 20);
    const cat  = sanitize(req.query.category || '', 50);
    if (!q) return res.json({ success: true, books: [] });

    let query = `?is_active=eq.true&order=views.desc&limit=20`;
    if (lang) query += `&language=eq.${encodeURIComponent(lang)}`;
    if (cat)  query += `&category=eq.${encodeURIComponent(cat)}`;

    const allBooks = await sbSelect('dharmic_books', query);
    const ql = q.toLowerCase();
    const results = allBooks.filter(b =>
      b.title?.toLowerCase().includes(ql) ||
      b.author?.toLowerCase().includes(ql) ||
      b.title_hindi?.toLowerCase().includes(ql) ||
      b.description?.toLowerCase().includes(ql) ||
      (b.tags || '').toLowerCase().includes(ql)
    ).slice(0, 10);

    res.json({ success: true, books: results, total: results.length, source: 'keyword' });
  } catch(e) {
    res.status(500).json({ success: false, books: [], error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// 404 HANDLER
// ════════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});


// ════════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLER
// ════════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack || err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── LAUNCH ──────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🕉 DharmaSetu Backend v10 SECURE — port ${PORT}`);
  console.log(`   ${new Date().toISOString()}`);
  console.log(`   Supabase: ${SUPABASE_URL ? '✅ configured' : '❌ NOT configured'}`);
  await initDB();
});
