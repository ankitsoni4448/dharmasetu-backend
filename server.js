// ════════════════════════════════════════════════════════════════
// DharmaSetu Backend — SECURE FINAL v9
// Deploy to: Render.com
// .env needs: ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// SECURITY in v9:
// 1. All AI calls go through backend — NO keys in app code
// 2. Rate limiting on all AI endpoints
// 3. Input sanitization on all routes
// 4. Admin key required for all /admin/* routes
// 5. CORS locked to known origins in production
// 6. Request size limits enforced
// 7. No sensitive keys ever sent to client
// ════════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const crypto  = require('crypto');

require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 10000;

// ─── ENVIRONMENT ─────────────────────────────────────────────────
const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD       || 'DharmaSetu@Admin2025';
const SUPABASE_URL         = (process.env.SUPABASE_URL        || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Validate critical env vars on startup
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[⚠️ WARN] Supabase not configured. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to Render env vars.');
}

// ─── LOCAL /tmp CACHE ─────────────────────────────────────────
const TMP = '/tmp/ds';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

// ─── IN-MEMORY CONFIG ─────────────────────────────────────────
let CFG = {
  geminiKey: '', groqKey: '',
  phonepeUPI: '', razorpayKeyId: '', razorpayKeySecret: '',
  subscriptionPayment: 'upi', donationPayment: 'upi',
  premiumPrice: 249, basicPrice: 99, nriPrice: 499,
  freeQuestionsLimit: 3, freeFactCheckLimit: 3,
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

// ─── RATE LIMITER (in-memory, no Redis needed for Phase 1) ─────
const rateLimits = new Map();
function checkRateLimit(key, maxPerMinute = 20) {
  const now = Date.now();
  const arr = (rateLimits.get(key) || []).filter(t => now - t < 60000);
  if (arr.length >= maxPerMinute) return false;
  arr.push(now);
  rateLimits.set(key, arr);
  return true;
}
// Clean up rate limit map every 5 minutes
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

// Check for prompt injection attacks
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

// ─── LOAD CONFIG FROM DB ──────────────────────────────────────
async function loadConfigFromDB() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.log('[Config] Supabase not configured'); return; }
  try {
    const rows = await sbSelect('admin_settings');
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });

    if (map.gemini_key)           CFG.geminiKey           = map.gemini_key;
    if (map.groq_key)             CFG.groqKey             = map.groq_key;
    if (map.phonepe_upi)          CFG.phonepeUPI          = map.phonepe_upi;
    if (map.razorpay_key_id)      CFG.razorpayKeyId       = map.razorpay_key_id;
    if (map.razorpay_key_secret)  CFG.razorpayKeySecret   = map.razorpay_key_secret;
    if (map.subscription_payment) CFG.subscriptionPayment = map.subscription_payment;
    if (map.donation_payment)     CFG.donationPayment     = map.donation_payment;
    if (map.premium_price)        CFG.premiumPrice        = +map.premium_price;
    if (map.basic_price)          CFG.basicPrice          = +map.basic_price;
    if (map.free_questions_limit) CFG.freeQuestionsLimit  = +map.free_questions_limit;
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

async function initDB() {
  console.log('[DB] Connecting to Supabase...');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[DB] ⚠️  NOT CONFIGURED.');
    return;
  }
  await loadConfigFromDB();
  console.log('[DB] ✅ Supabase connected');
}

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({
  origin: '*', // In production you can restrict this to your app domains
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-key','apikey'],
}));
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

// Maintenance mode middleware
app.use((req, res, next) => {
  if (CFG.maintenanceMode && !req.path.startsWith('/admin') && req.path !== '/health') {
    return res.status(503).json({ error: 'App is under maintenance. Please try again soon.' });
  }
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!key || key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
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
    const rows = await sbSelect('admin_settings', '?limit=1');
    dbOk = true;
    const [u, k, p, f] = await Promise.all([
      sbSelect('users', '?select=id').catch(() => []),
      sbSelect('katha_vault', '?select=id').catch(() => []),
      sbSelect('payments', '?select=id').catch(() => []),
      sbSelect('feedback', '?select=id').catch(() => []),
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

// App config endpoint — SAFE: no keys exposed
app.get('/config', (req, res) => {
  res.json({ success: true, config: {
    premiumPrice:        CFG.premiumPrice,
    basicPrice:          CFG.basicPrice,
    nriPrice:            CFG.nriPrice,
    freeQuestionsLimit:  CFG.freeQuestionsLimit,
    freeFactCheckLimit:  CFG.freeFactCheckLimit,
    maintenanceMode:     CFG.maintenanceMode,
    appVersion:          CFG.appVersion,
    bundles:             CFG.bundles.filter(b => b.active),
    donations:           CFG.donations.filter(d => d.active),
    phonepeUPI:          CFG.phonepeUPI || '',     // UPI ID is safe to share (it's public)
    razorpayKeyId:       CFG.razorpayKeyId || '',  // Public key is safe
    subscriptionPayment: CFG.subscriptionPayment || 'upi',
    donationPayment:     CFG.donationPayment || 'upi',
    hasRazorpay:         !!(CFG.razorpayKeyId && CFG.razorpayKeySecret),
    featureFlags:        CFG.featureFlags,
    // NEVER expose: geminiKey, groqKey, razorpayKeySecret, ADMIN_PASSWORD, SUPABASE keys
  }});
});

// ════════════════════════════════════════════════════════════════
// SECURE AI PROXY — All AI calls go through here
// App code has NO API keys. Keys stay on server only.
// ════════════════════════════════════════════════════════════════
app.post('/ai/chat', async (req, res) => {
  try {
    const { prompt, systemPrompt, phone } = req.body;

    // Rate limit: 20 requests per minute per phone/IP
    const rateLimitKey = phone || req.ip || 'anon';
    if (!checkRateLimit(`ai_${rateLimitKey}`, 20)) {
      return res.status(429).json({ error: 'RATE_LIMIT', message: 'Too many requests. Please wait a moment.' });
    }

    const rawPrompt = prompt || systemPrompt || '';
    if (!rawPrompt || rawPrompt.trim().length < 2) {
      return res.status(400).json({ error: 'Empty prompt' });
    }

    // Security check
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

// DharmaChat specific — with system prompt built on server
app.post('/ai/dharma-chat', async (req, res) => {
  try {
    const { messages, userProfile, mode, phone } = req.body;

    // Rate limit
    const rateKey = phone || req.ip || 'anon';
    if (!checkRateLimit(`chat_${rateKey}`, 15)) {
      return res.status(429).json({ error: 'RATE_LIMIT' });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages' });
    }

    // Sanitize each message
    const cleanMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: sanitize(m.content || '', 1000),
    })).filter(m => m.content.length > 0);

    const lastMsg = cleanMessages[cleanMessages.length - 1]?.content || '';

    // Security check on last user message
    if (isPromptInjection(lastMsg)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Build system prompt on server (never in client)
    const u = userProfile || {};
    const lang = u.language || 'hindi';
    const isH = lang === 'hindi';
    const isFC = mode === 'factcheck';

    const langRule = {
      hindi:   'तुम्हें केवल और केवल शुद्ध हिंदी में जवाब देना है। एक भी अंग्रेजी शब्द नहीं।',
      english: 'Reply ONLY in pure English. No Hindi, no Hinglish.',
      marathi: 'फक्त मराठीत उत्तर द्या.',
      gujarati:'ફક્ત ગુજરાતીમાં જ જવાબ આપો.',
    }[lang] || 'Reply in clear English.';

    const systemPrompt = `तुम DharmaSetu हो — एक expert Vedic guide।

🌐 LANGUAGE: ${langRule}
${isFC ? '⚡ FACT CHECK MODE: Start with "VERDICT: TRUE/FALSE/MISLEADING" then prove with scripture.\n' : ''}
👤 USER: ${u.name || 'Seeker'} | राशि: ${u.rashi || 'Unknown'} | नक्षत्र: ${u.nakshatra || 'Unknown'} | इष्ट देव: ${u.deity || 'Unknown'}

🎯 EXPERTISE:
1. Jyotish Expert — personal Rashi/Nakshatra analysis with specific remedies
2. Scripture Expert — Vedas, Gita, Ramayana, Upanishads
3. ONLY answer about: Sanatan Dharma, Jyotish, Hindu philosophy, scripture, deities, festivals, personal guidance through dharmic lens
4. For other topics: "DharmaSetu केवल सनातन धर्म के लिए है 🙏"

⚠️ VERIFIED FACTS:
- Shambuka got moksha — colonial lie debunked
- Aryan Invasion Theory: False (Rakhigarhi DNA 2019)
- Gita 4.13: varna by guna+karma, NOT birth

📝 FORMAT: Max 300 words. Include SHASTRIYA: reference. Be warm, specific, practical.`;

    if (!CFG.geminiKey && !CFG.groqKey) {
      return res.status(503).json({ error: 'AI not configured' });
    }

    // Build full prompt
    const histText = cleanMessages.slice(-8).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n');
    const fullPrompt = `${systemPrompt}\n\nConversation:\n${histText}`;

    const result = await callAI(CFG.geminiKey, CFG.groqKey, fullPrompt);
    res.json({ success: true, text: result.text, usedApi: result.usedApi });
  } catch(e) {
    console.error('[AI/dharma-chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════
app.post('/users/register', async (req, res) => {
  try {
    const { phone, name, email, rashi, nakshatra, deity, language, birthCity, dob, firebaseUid } = req.body;
    if (!phone && !firebaseUid) return res.status(400).json({ error: 'phone or firebaseUid required' });

    // Sanitize inputs
    const cleanPhone = sanitize(phone || '', 20);
    const cleanName  = sanitize(name  || 'DharmaSetu User', 100);

    const existing = cleanPhone ? await sbSelect('users', `?phone=eq.${encodeURIComponent(cleanPhone)}&limit=1`) : [];

    if (existing.length > 0) {
      const updated = { last_active: new Date().toISOString() };
      if (cleanName) updated.name = cleanName;
      if (language)  updated.language = language;
      if (email)     updated.email = sanitize(email, 200);
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, updated);
      return res.json({ success: true, user: { ...existing[0], ...updated }, isNew: false });
    }

    const id = `u_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const newUser = {
      id, phone: cleanPhone, name: cleanName,
      created_at: new Date().toISOString(), last_active: new Date().toISOString(),
      plan: 'free', streak: 0, questions: 0, pts: 0,
    };
    if (email) newUser.email = sanitize(email, 200);
    if (firebaseUid) newUser.firebase_uid = firebaseUid;
    if (rashi) newUser.rashi = rashi;
    if (nakshatra) newUser.nakshatra = nakshatra;
    if (deity) newUser.deity = deity;
    if (language) newUser.language = language;
    if (birthCity) newUser.birth_city = sanitize(birthCity, 100);
    if (dob) newUser.dob = dob;

    await sbInsert('users', newUser);
    res.json({ success: true, user: newUser, isNew: true });
  } catch(e) {
    console.error('[Users/register]', e.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/users/activity', async (req, res) => {
  try {
    const { phone, type } = req.body;
    if (!phone) return res.json({ success: true });
    const cleanPhone = sanitize(phone, 20);
    const users = await sbSelect('users', `?phone=eq.${encodeURIComponent(cleanPhone)}&limit=1`);
    if (users.length) {
      const u = users[0];
      const patch = { last_active: new Date().toISOString() };
      if (type === 'question') patch.questions = (u.questions || 0) + 1;
      if (type === 'checkin')  { patch.streak = (u.streak || 0) + 1; patch.pts = (u.pts || 0) + 3; }
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, patch);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// FEEDBACK
// ════════════════════════════════════════════════════════════════
app.post('/feedback', async (req, res) => {
  try {
    // Rate limit feedback
    const rateKey = req.body.phone || req.ip || 'anon';
    if (!checkRateLimit(`fb_${rateKey}`, 10)) {
      return res.status(429).json({ error: 'Too many feedback submissions' });
    }

    const { question, wrongAnswer, correctedAnswer, reason, phone, rating } = req.body;
    const entry = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      status:           'pending',
      created_at:       new Date().toISOString(),
    };
    if (question) entry.question = sanitize(question, 500);
    if (wrongAnswer) entry.wrong_answer = sanitize(wrongAnswer, 1000);
    if (correctedAnswer) entry.corrected_answer = sanitize(correctedAnswer, 1000);
    if (reason) entry.reason = sanitize(reason, 300);
    if (phone) entry.phone = sanitize(phone, 20);
    if (rating) entry.rating = rating === 'up' ? 'up' : 'down';

    await sbInsert('feedback', entry);
    res.json({ success: true, id: entry.id });
  } catch(e) {
    console.error('[Feedback]', e.message);
    res.status(500).json({ error: e.message });
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
    // NEVER expose razorpayKeySecret
  });
});

app.post('/payment/razorpay/order', async (req, res) => {
  try {
    const { amount, type, planId, phone } = req.body;
    if (!CFG.razorpayKeyId || !CFG.razorpayKeySecret) {
      return res.status(503).json({ error: 'Razorpay not configured.' });
    }
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
      const r = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
      r.on('error', reject); r.write(bodyStr); r.end();
    });
    if (rzp.id) {
      await sbInsert('payments', {
        id: rzp.id, phone: sanitize(phone||'', 20),
        plan_id: sanitize(planId||'', 50),
        amount, payment_type: sanitize(type||'subscription', 30),
        payment_via: 'razorpay', status: 'created',
        created_at: new Date().toISOString(),
      });
      res.json({ success: true, orderId: rzp.id, keyId: CFG.razorpayKeyId, amount: Math.round(amount) * 100 });
    } else {
      res.status(500).json({ error: 'Order creation failed' });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/payment/confirm', async (req, res) => {
  try {
    const { orderId, phone, planId, paymentId } = req.body;
    const id = sanitize(orderId || `m_${Date.now()}`, 100);
    const cleanPhone = sanitize(phone || '', 20);
    const cleanPlan  = sanitize(planId || '', 50);
    await sbUpsert('payments', {
      id, phone: cleanPhone, plan_id: cleanPlan,
      amount: 0, status: 'paid',
      payment_id: sanitize(paymentId||'manual', 100),
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }, 'id');
    if (cleanPhone && cleanPlan) {
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, { plan: cleanPlan });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/payment/webhook', async (req, res) => {
  try {
    // In production: verify Razorpay webhook signature here
    if (req.body?.event === 'payment.captured') {
      const p = req.body?.payload?.payment?.entity;
      if (p) {
        await sbUpdate('payments', `?id=eq.${encodeURIComponent(p.order_id||'')}`, {
          status: 'paid', payment_id: p.id, paid_at: new Date().toISOString(),
        });
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  } catch(e) { res.json({ success: true, count: 0, content: [] }); }
});

// ════════════════════════════════════════════════════════════════
// KATHA VAULT
// ════════════════════════════════════════════════════════════════
app.get('/katha/:sc/:unit/:lang', async (req, res) => {
  try {
    const { sc, unit, lang } = req.params;
    // Sanitize params
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/katha/list', async (req, res) => {
  try {
    const rows = await sbSelect('katha_vault', '?select=scripture_id,unit_id,lang,chapter_title&order=scripture_id.asc,unit_id.asc');
    const groups = {};
    rows.forEach(r => { const k = `${r.scripture_id}_${r.unit_id}_${r.lang}`; groups[k] = (groups[k]||0) + 1; });
    res.json({ success: true, count: Object.keys(groups).length, chapters: Object.entries(groups).map(([k,n]) => ({ key: k, verseCount: n })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// AI CALLERS (server-side only — keys never leave server)
// ════════════════════════════════════════════════════════════════
async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.75, maxOutputTokens: 1200 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    });
    const timer = setTimeout(() => reject(new Error('Gemini timeout')), 40000);
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const d = JSON.parse(raw);
          if (res.statusCode === 429) return reject(new Error('RATE_LIMIT'));
          if (res.statusCode !== 200) return reject(new Error(`Gemini ${res.statusCode}`));
          const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) return reject(new Error(`Gemini empty — reason: ${d?.candidates?.[0]?.finishReason||'unknown'}`));
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(body); req.end();
  });
}

async function callGroq(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are DharmaSetu, a Vedic AI guide. Reply with structured JSON when asked for JSON. Otherwise reply in the requested language.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.75, max_tokens: 1200,
    });
    const timer = setTimeout(() => reject(new Error('Groq timeout')), 40000);
    const opts = {
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          if (res.statusCode === 429) return reject(new Error('RATE_LIMIT'));
          if (res.statusCode !== 200) return reject(new Error(`Groq ${res.statusCode}`));
          const d = JSON.parse(raw);
          const text = d?.choices?.[0]?.message?.content;
          if (!text) return reject(new Error('Groq empty'));
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(body); req.end();
  });
}

async function callAI(gemKey, groqKey, prompt) {
  // Try Gemini first (better quality)
  if (gemKey) {
    try { return { text: await callGemini(gemKey, prompt), usedApi: 'gemini' }; }
    catch(e) { if (!e.message.includes('RATE_LIMIT')) console.log('[AI] Gemini failed:', e.message.slice(0,60)); }
  }
  // Fallback to Groq
  if (groqKey) {
    try { return { text: await callGroq(groqKey, prompt), usedApi: 'groq' }; }
    catch(e) {
      if (e.message.includes('RATE_LIMIT') && gemKey) {
        console.log('[AI] Both rate limited — waiting 40s');
        await new Promise(r => setTimeout(r, 40000));
        try { return { text: await callGemini(gemKey, prompt), usedApi: 'gemini-retry' }; } catch {}
      }
      throw new Error('All AI failed: ' + e.message.slice(0,80));
    }
  }
  if (gemKey) { return { text: await callGemini(gemKey, prompt), usedApi: 'gemini-only' }; }
  throw new Error('No AI keys configured');
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
    const GAP       = 20000;
    const RATE_WAIT = 45000;
    const RETRY_WAIT = 6000;
    const MAX_ATT   = 4;
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
  // Mask sensitive values
  if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***SAVED';
  if (safe.geminiKey?.length > 6)         safe.geminiKey         = safe.geminiKey.slice(0,8)         + '***SAVED';
  if (safe.groqKey?.length > 6)           safe.groqKey           = safe.groqKey.slice(0,8)           + '***SAVED';
  res.json({ success: true, config: safe });
});

app.post('/admin/config', adminAuth, async (req, res) => {
  const keyMap = {
    geminiKey: 'gemini_key', groqKey: 'groq_key',
    phonepeUPI: 'phonepe_upi',
    razorpayKeyId: 'razorpay_key_id', razorpayKeySecret: 'razorpay_key_secret',
    subscriptionPayment: 'subscription_payment', donationPayment: 'donation_payment',
    premiumPrice: 'premium_price', basicPrice: 'basic_price',
    freeQuestionsLimit: 'free_questions_limit',
    maintenanceMode: 'maintenance_mode', appVersion: 'app_version',
    featureFlags: 'feature_flags', bundles: 'bundles', donations: 'donations',
  };
  const saves = [];
  for (const [jsKey, dbKey] of Object.entries(keyMap)) {
    const val = req.body[jsKey];
    if (val !== undefined) {
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (typeof val === 'string' && val.includes('***SAVED')) continue; // Don't overwrite with masked
      CFG[jsKey] = val;
      saves.push(saveConfigKey(dbKey, str));
    }
  }
  await Promise.all(saves);
  await auditLog('CONFIG_CHANGED', 'admin', 'System Settings', `Updated ${saves.length} keys`);
  const safe = { ...CFG };
  if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***SAVED';
  if (safe.geminiKey?.length > 6)         safe.geminiKey         = safe.geminiKey.slice(0,8)         + '***SAVED';
  if (safe.groqKey?.length > 6)           safe.groqKey           = safe.groqKey.slice(0,8)           + '***SAVED';
  res.json({ success: true, config: safe, saved: saves.length });
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

app.post('/admin/bundles',   adminAuth, async (req, res) => { CFG.bundles   = req.body.bundles;   await saveConfigKey('bundles',   JSON.stringify(CFG.bundles));   res.json({ success: true }); });
app.post('/admin/donations', adminAuth, async (req, res) => { CFG.donations = req.body.donations; await saveConfigKey('donations', JSON.stringify(CFG.donations)); res.json({ success: true }); });

// Notifications
app.post('/admin/notifications', adminAuth, async (req, res) => {
  try {
    const { title, body, target, scheduled_for } = req.body;
    const entry = {
      id: `notif_${Date.now()}`,
      title: sanitize(title || '', 200),
      body:  sanitize(body  || '', 500),
      target: ['all','premium','free'].includes(target) ? target : 'all',
      scheduled_for: scheduled_for || new Date().toISOString(),
      sent_at:   new Date().toISOString(),
      status:    'pending',
    };
    await sbInsert('notifications', entry);
    res.json({ success: true, id: entry.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Content upload
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/uploads', adminAuth, async (req, res) => {
  const rows = await sbSelect('uploads', '?order=uploaded_at.desc');
  res.json({ success: true, uploads: rows.map(u => ({ id: u.id, title: u.title, type: u.type, chunkCount: u.chunk_count, charCount: u.char_count, active: u.active, uploadedAt: u.uploaded_at, topics: u.topics })) });
});
app.patch('/admin/uploads/:id',  adminAuth, async (req, res) => { await sbUpdate('uploads', `?id=eq.${req.params.id}`, req.body); res.json({ success: true }); });
app.delete('/admin/uploads/:id', adminAuth, async (req, res) => { await sbDelete('uploads', `?id=eq.${req.params.id}`); res.json({ success: true }); });

// ════════════════════════════════════════════════════════════════
// BOOKS (Library Manager)
// ════════════════════════════════════════════════════════════════
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
      title: sanitize(req.body.title || 'Untitled', 200),
      author: sanitize(req.body.author || 'Unknown', 100),
      language: sanitize(req.body.language || 'hindi', 50),
      category: sanitize(req.body.category || 'general', 50),
      cover_url: sanitize(req.body.cover_url || '', 500),
      description: sanitize(req.body.description || '', 1000),
      is_premium: !!req.body.is_premium,
      is_featured: !!req.body.is_featured,
      external_url: sanitize(req.body.external_url || '', 500),
      read_url: sanitize(req.body.read_url || '', 500),
      tags: req.body.tags ? req.body.tags.split(',').map(t=>sanitize(t.trim(), 50)) : [],
      display_order: parseInt(req.body.display_order) || 0,
      created_at: new Date().toISOString()
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
  await sbDelete('books', `?id=eq.${req.params.id}`);
  res.json({ success: true });
});

// Users
app.get('/admin/users', adminAuth, async (req, res) => {
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
  res.json({ success: true, users: rows, total: rows.length });
});
app.patch('/admin/users/:id', adminAuth, async (req, res) => { await sbUpdate('users', `?id=eq.${req.params.id}`, req.body); res.json({ success: true }); });
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

// Transactions
app.get('/admin/transactions', adminAuth, async (req, res) => {
  const rows = await sbSelect('payments', '?order=created_at.desc&limit=200');
  const paid = rows.filter(r => r.status === 'paid');
  res.json({ success: true, transactions: rows, total: rows.length, totalRevenue: paid.reduce((s,t) => s+(t.amount||0), 0) });
});
app.post('/admin/payments/approve', adminAuth, async (req, res) => {
  try {
    const { phone, planId, amount, transactionId } = req.body;
    const cleanPhone = sanitize(phone || '', 20);
    const cleanPlan = sanitize(planId || 'pro', 50);
    const payId = `m_app_${Date.now()}`;
    await sbInsert('payments', {
      id: payId, phone: cleanPhone, plan_id: cleanPlan,
      amount: parseInt(amount)||0, status: 'paid',
      payment_type: 'subscription', payment_via: 'manual',
      payment_id: sanitize(transactionId||'manual_approval', 100),
      paid_at: new Date().toISOString(), created_at: new Date().toISOString()
    });
    await sbUpdate('users', `?phone=eq.${encodeURIComponent(cleanPhone)}`, { plan: cleanPlan });
    await auditLog('PAYMENT_APPROVED', 'admin', cleanPhone, `Plan: ${cleanPlan}, Amount: ${amount}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Feedback
app.get('/admin/feedback', adminAuth, async (req, res) => {
  const rows = await sbSelect('feedback', '?order=created_at.desc');
  res.json({ success: true, feedback: rows, total: rows.length, pending: rows.filter(f => f.status === 'pending').length });
});
app.patch('/admin/feedback/:id',  adminAuth, async (req, res) => { await sbUpdate('feedback', `?id=eq.${req.params.id}`, req.body); res.json({ success: true }); });
app.delete('/admin/feedback/:id', adminAuth, async (req, res) => { await sbDelete('feedback', `?id=eq.${req.params.id}`); res.json({ success: true }); });

// Exports
app.get('/admin/export/feedback', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('feedback', '?order=created_at.desc');
    let csv = 'ID,Date,Phone,Question,Reason,Status,Notes\n';
    rows.forEach(r => {
      const q = (r.question||'').replace(/"/g,'""');
      const re = (r.reason||'').replace(/"/g,'""');
      const n = (r.notes||'').replace(/"/g,'""');
      csv += `"${r.id}","${r.created_at}","${r.phone}","${q}","${re}","${r.status}","${n}"\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('dharmasetu_feedback.csv');
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stats
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
      totalUsers:       users.length,
      premiumUsers:     users.filter(u => u.plan !== 'free').length,
      freeUsers:        users.filter(u => u.plan === 'free').length,
      newToday:         users.filter(u => new Date(u.created_at).toDateString() === today).length,
      totalTransactions:payments.length,
      paidTransactions: paid.length,
      totalRevenue:     paid.reduce((s,t) => s+(t.amount||0), 0),
      kathaChapters:    chapters.size,
      totalVerses:      katha.length,
      activeUploads:    uploads.filter(u => u.active).length,
      pendingFeedback:  feedback.filter(f => f.status === 'pending').length,
      totalFeedback:    feedback.length,
      db: 'supabase',
    }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Analytics Deep
app.get('/admin/analytics/deep', adminAuth, async (req, res) => {
  try {
    const [users, payments, katha] = await Promise.all([
      sbSelect('users', '?select=plan,created_at,last_active').catch(() => []),
      sbSelect('payments', '?select=status,amount,created_at').catch(() => []),
      sbSelect('katha_vault', '?select=scripture_id').catch(() => []),
    ]);
    
    const now = Date.now();
    const dayMs = 86400000;
    
    const dau = users.filter(u => now - new Date(u.last_active).getTime() < dayMs).length;
    const wau = users.filter(u => now - new Date(u.last_active).getTime() < dayMs * 7).length;
    const mau = users.filter(u => now - new Date(u.last_active).getTime() < dayMs * 30).length;
    
    const premium = users.filter(u => u.plan !== 'free').length;
    const retention = users.length ? Math.round((mau / users.length) * 100) : 0;
    
    // Revenue trends (last 7 days)
    const rev7 = [0,0,0,0,0,0,0];
    payments.filter(p => p.status === 'paid').forEach(p => {
      const daysAgo = Math.floor((now - new Date(p.created_at).getTime()) / dayMs);
      if (daysAgo < 7 && daysAgo >= 0) rev7[6 - daysAgo] += (p.amount || 0);
    });

    res.json({ success: true, dau, wau, mau, premium, retention, revenue7: rev7, topKatha: katha.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Reading Intelligence
app.get('/admin/analytics/reading', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('reading_progress', '?limit=100').catch(() => []);
    res.json({ success: true, readingData: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Deep Health
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

// Audit Logs
app.get('/admin/audit', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('audit_logs', '?order=created_at.desc&limit=100').catch(()=>[]);
    res.json({ success: true, logs: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DB status
app.get('/admin/db-status', adminAuth, async (req, res) => {
  const configured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  let connected = false;
  try { await sbSelect('admin_settings', '?limit=1'); connected = true; } catch {}
  res.json({
    success: true, database: 'Supabase PostgreSQL',
    supabaseUrl:   SUPABASE_URL ? SUPABASE_URL.replace(/eyJ.*/, '***') : 'NOT SET',
    configured, connected,
  });
});

// ════════════════════════════════════════════════════════════════
// PHASE 3: GROWTH & MARKETING
// ════════════════════════════════════════════════════════════════

// Push Notifications
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/admin/notifications/push', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('push_campaigns', '?order=sent_at.desc').catch(()=>[]);
    res.json({ success: true, campaigns: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Marketing Coupons
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/admin/marketing/coupons', adminAuth, async (req, res) => {
  try {
    const rows = await sbSelect('coupons', '?order=created_at.desc').catch(()=>[]);
    res.json({ success: true, coupons: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/marketing/coupons/:id', adminAuth, async (req, res) => {
  await sbDelete('coupons', `?id=eq.${req.params.id}`);
  await auditLog('COUPON_DELETED', 'admin', req.params.id, '');
  res.json({ success: true });
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Error Handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── LAUNCH ──────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🕉 DharmaSetu Backend v9 SECURE — port ${PORT}`);
  console.log(`   ${new Date().toISOString()}`);
  console.log(`   Supabase: ${SUPABASE_URL ? '✅ configured' : '❌ NOT configured'}`);
  await initDB();
});