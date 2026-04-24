// ════════════════════════════════════════════════════════════════
// DharmaSetu Backend — SUPABASE FINAL v8
// Deploy to: Render.com
// URL: https://dharmasetu-backend-2c65.onrender.com
//
// FIXES IN v8:
// 1. All config (API keys, UPI, Razorpay) permanently in Supabase
// 2. Feedback saves to Supabase + shows in admin dashboard
// 3. Users save correctly from app login
// 4. GitHub Gist REMOVED — Supabase only
// 5. Premium feature flags system added
// 6. All broken routes fixed
// 7. Admin auth strengthened
//
// RENDER ENVIRONMENT VARIABLES (set all of these):
//   ADMIN_PASSWORD       = DharmaSetu@Admin2025
//   SUPABASE_URL         = https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY = eyJ... (service_role key, NOT anon)
// ════════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 10000;

const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD       || 'DharmaSetu@Admin2025';
const SUPABASE_URL         = (process.env.SUPABASE_URL        || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ─── LOCAL /tmp CACHE (fast reads, lost on restart — refills from Supabase) ─
const TMP = '/tmp/ds';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

// ─── IN-MEMORY CONFIG (always loaded fresh from Supabase on start) ─
let CFG = {
  // AI Keys
  geminiKey: '', groqKey: '',
  // Payment
  phonepeUPI: '', razorpayKeyId: '', razorpayKeySecret: '',
  subscriptionPayment: 'upi', donationPayment: 'upi',
  // Prices
  premiumPrice: 249, basicPrice: 99, nriPrice: 499,
  freeQuestionsLimit: 3, freeFactCheckLimit: 3,
  // App
  maintenanceMode: false, appVersion: '1.0.0',
  // Feature flags — which features are premium
  featureFlags: {
    dharmaChat:         { enabled: true, isPremium: false, label: 'DharmaChat AI' },
    factCheck:          { enabled: true, isPremium: false, label: 'Fact Check' },
    myKundli:           { enabled: true, isPremium: false, label: 'My Kundli' },
    mantraLibrary:      { enabled: true, isPremium: false, label: 'Mantra Library' },
    kathaVaultRead:     { enabled: true, isPremium: false, label: 'Katha Vault (Reading)' },
    kathaVaultDownload: { enabled: true, isPremium: true,  label: 'Katha Vault (Download PDF)' },
    saveAnswer:         { enabled: true, isPremium: true,  label: 'Save Answers' },
    debateArena:        { enabled: true, isPremium: false, label: 'Debate Arena (Basic)' },
    debateAdvanced:     { enabled: true, isPremium: true,  label: 'Debate Arena (Advanced)' },
    peaceMode:          { enabled: true, isPremium: true,  label: 'Peace Mode' },
    voicePersona:       { enabled: false, isPremium: true, label: 'Voice Persona' },
    unlimitedQuestions: { enabled: true, isPremium: true,  label: 'Unlimited Questions' },
    shareCards:         { enabled: true, isPremium: false, label: 'Share Cards' },
  },
  bundles: [
    { id:'basic', name:'Basic', nameHi:'बेसिक', price:99, active:true, features:['30 questions/day','15 fact-checks/day','Mantra Verify','Save answers','No ads'] },
    { id:'pro',   name:'Pro',   nameHi:'प्रो',  price:249, active:true, popular:true, features:['Unlimited questions','Unlimited fact-checks','All features','Peace Mode','No ads','Download PDFs'] },
  ],
  donations: [
    { id:'army',   name:'Army Welfare',    nameHi:'सेना कल्याण',       goal:100000, raised:0, active:true, desc:'Support Indian Army welfare' },
    { id:'temple', name:'Temple Restore',  nameHi:'मंदिर जीर्णोद्धार', goal:500000, raised:0, active:true, desc:'Restore ancient temples' },
    { id:'dharma', name:'Dharma Education',nameHi:'धर्म शिक्षा',       goal:250000, raised:0, active:true, desc:'Educate youth about Sanatan Dharma' },
  ],
};

// ════════════════════════════════════════════════════════════════
// SUPABASE REST API — no npm package, pure https
// ════════════════════════════════════════════════════════════════
async function sbRest(method, table, body = null, query = '') {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Supabase not configured — add SUPABASE_URL and SUPABASE_SERVICE_KEY to Render env vars');
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
        try { resolve({ status: res.statusCode, data: JSON.parse(raw || '[]') }); }
        catch { resolve({ status: res.statusCode, data: [] }); }
      });
    });
    req.on('error', e => { console.error('[Supabase]', method, table, e.message); reject(e); });
    if (data) req.write(data);
    req.end();
  });
}

// Helpers
async function sbSelect(table, query = '') {
  const r = await sbRest('GET', table, null, query);
  return Array.isArray(r.data) ? r.data : [];
}
async function sbInsert(table, row) {
  const r = await sbRest('POST', table, row);
  return r;
}
async function sbUpsert(table, row, onConflict = '') {
  const q = onConflict ? `?on_conflict=${onConflict}` : '';
  const r = await sbRest('POST', table, row, q);
  return r;
}
async function sbUpdate(table, query, patch) {
  const r = await sbRest('PATCH', table, patch, query);
  return r;
}
async function sbDelete(table, query) {
  return sbRest('DELETE', table, null, query);
}

// ─── LOAD ALL CONFIG FROM SUPABASE ───────────────────────────────
async function loadConfigFromDB() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.log('[Config] Supabase not configured — using defaults'); return; }
  try {
    const rows = await sbSelect('admin_settings');
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });

    if (map.gemini_key)            CFG.geminiKey           = map.gemini_key;
    if (map.groq_key)              CFG.groqKey             = map.groq_key;
    if (map.phonepe_upi)           CFG.phonepeUPI          = map.phonepe_upi;
    if (map.razorpay_key_id)       CFG.razorpayKeyId       = map.razorpay_key_id;
    if (map.razorpay_key_secret)   CFG.razorpayKeySecret   = map.razorpay_key_secret;
    if (map.subscription_payment)  CFG.subscriptionPayment = map.subscription_payment;
    if (map.donation_payment)      CFG.donationPayment     = map.donation_payment;
    if (map.premium_price)         CFG.premiumPrice        = +map.premium_price;
    if (map.basic_price)           CFG.basicPrice          = +map.basic_price;
    if (map.free_questions_limit)  CFG.freeQuestionsLimit  = +map.free_questions_limit;
    if (map.maintenance_mode)      CFG.maintenanceMode     = map.maintenance_mode === 'true';
    if (map.app_version)           CFG.appVersion          = map.app_version;
    if (map.feature_flags)         try { CFG.featureFlags  = JSON.parse(map.feature_flags); } catch {}
    if (map.bundles)               try { CFG.bundles       = JSON.parse(map.bundles); } catch {}
    if (map.donations)             try { CFG.donations     = JSON.parse(map.donations); } catch {}

    console.log(`[Config] ✅ Loaded from Supabase — ${rows.length} settings`);
  } catch(e) { console.error('[Config] Load failed:', e.message); }
}

async function saveConfigKey(key, value) {
  try {
    await sbUpsert('admin_settings', { key, value: String(value), updated_at: new Date().toISOString() }, 'key');
  } catch(e) { console.error('[Config] Save failed:', key, e.message); }
}

// ─── DB INIT ─────────────────────────────────────────────────────
async function initDB() {
  console.log('[DB] Connecting to Supabase...');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[DB] ⚠️  NOT CONFIGURED. Add to Render env vars:\n    SUPABASE_URL = https://xxxx.supabase.co\n    SUPABASE_SERVICE_KEY = eyJ...');
    return;
  }
  await loadConfigFromDB();
  console.log('[DB] ✅ Supabase connected');
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-admin-key','apikey'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!key || key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized — wrong admin key' });
  next();
}

// Serve admin dashboard HTML
app.get('/admin-portal', (req, res) => {
  const p = path.join(__dirname, 'admin_dashboard.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).send('<h2>admin_dashboard.html not found in backend folder</h2><p>Make sure admin_dashboard.html is in the same folder as server.js</p>');
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
  if (c) try { c.write(`data: ${JSON.stringify({ msg, type: 'done' })}\n\n`); setTimeout(() => { c.write('data: {"type":"end"}\n\n'); sseClients.delete(jobId); }, 1000); } catch {}
}

// ════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ════════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
  let dbOk = false, tables = {};
  try {
    const rows = await sbSelect('admin_settings', '?limit=1');
    dbOk = true;
    // Count records
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

// App config — what the mobile app fetches on startup
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
    phonepeUPI:          CFG.phonepeUPI || '',
    razorpayKeyId:       CFG.razorpayKeyId || '',
    subscriptionPayment: CFG.subscriptionPayment || 'upi',
    donationPayment:     CFG.donationPayment || 'upi',
    hasRazorpay:         !!(CFG.razorpayKeyId && CFG.razorpayKeySecret),
    featureFlags:        CFG.featureFlags,
  }});
});

// App fetches content uploads for AI context
app.get('/content', async (req, res) => {
  try {
    const rows = await sbSelect('uploads', '?active=eq.true&order=uploaded_at.desc');
    res.json({ success: true, count: rows.length, content: rows.map(u => ({ id: u.id, title: u.title, type: u.type, topics: u.topics, summary: u.summary })) });
  } catch(e) { res.json({ success: true, count: 0, content: [] }); }
});

// AI proxy — keeps keys out of app code
app.post('/ai/chat', async (req, res) => {
  try {
    const { prompt, systemPrompt } = req.body;
    if (!CFG.geminiKey && !CFG.groqKey) return res.status(503).json({ error: 'AI keys not set. Admin: add Gemini + Groq keys in dashboard.' });
    const result = await callAI(CFG.geminiKey, CFG.groqKey, prompt || systemPrompt || '');
    res.json({ success: true, text: result.text, usedApi: result.usedApi });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// USERS — saves from app, shows in admin
// ════════════════════════════════════════════════════════════════
app.post('/users/register', async (req, res) => {
  try {
    const { phone, name, email, rashi, nakshatra, deity, language, birthCity, dob, firebaseUid } = req.body;
    if (!phone && !firebaseUid) return res.status(400).json({ error: 'phone or firebaseUid required' });

    const searchPhone = phone || '';
    const existing = searchPhone ? await sbSelect('users', `?phone=eq.${encodeURIComponent(searchPhone)}&limit=1`) : [];

    if (existing.length > 0) {
      // Update existing user — keep their plan, update last_active
      const updated = { last_active: new Date().toISOString() };
      if (name)      updated.name       = name;
      if (email)     updated.email      = email;
      if (language)  updated.language   = language;
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(searchPhone)}`, updated);
      return res.json({ success: true, user: { ...existing[0], ...updated }, isNew: false });
    }

    // New user
    const id = `u_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const newUser = {
      id, phone: searchPhone, name: name || 'DharmaSetu User',
      email: email || '', firebase_uid: firebaseUid || '',
      rashi: rashi || 'Mesh', nakshatra: nakshatra || 'Ashwini',
      deity: deity || 'Hanuman', language: language || 'hindi',
      birth_city: birthCity || '', dob: dob || '',
      plan: 'free', streak: 0, questions: 0, pts: 0,
      created_at: new Date().toISOString(), last_active: new Date().toISOString(),
    };
    await sbInsert('users', newUser);
    res.json({ success: true, user: newUser, isNew: true });
  } catch(e) {
    console.error('[Users/register]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/users/activity', async (req, res) => {
  try {
    const { phone, type } = req.body;
    if (!phone) return res.json({ success: true });
    const users = await sbSelect('users', `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (users.length) {
      const u = users[0];
      const patch = { last_active: new Date().toISOString() };
      if (type === 'question') patch.questions = (u.questions || 0) + 1;
      if (type === 'checkin')  { patch.streak = (u.streak || 0) + 1; patch.pts = (u.pts || 0) + 3; }
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(phone)}`, patch);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// FEEDBACK — saves to Supabase, shows in admin dashboard
// ════════════════════════════════════════════════════════════════
app.post('/feedback', async (req, res) => {
  try {
    const { question, wrongAnswer, correctedAnswer, reason, phone, rating } = req.body;
    const entry = {
      id:               `fb_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      question:         question         || '',
      wrong_answer:     wrongAnswer      || '',
      corrected_answer: correctedAnswer  || '',
      reason:           reason           || '',
      phone:            phone            || '',
      rating:           rating           || 'down',
      status:           'pending',
      created_at:       new Date().toISOString(),
    };
    const r = await sbInsert('feedback', entry);
    console.log('[Feedback] Saved:', entry.id, '| Phone:', entry.phone || 'anon');
    res.json({ success: true, id: entry.id });
  } catch(e) {
    console.error('[Feedback] Save failed:', e.message);
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
  });
});

app.post('/payment/razorpay/order', async (req, res) => {
  try {
    const { amount, type, planId, phone } = req.body;
    if (!CFG.razorpayKeyId || !CFG.razorpayKeySecret) return res.status(503).json({ error: 'Razorpay not configured in admin dashboard.' });
    const auth = Buffer.from(`${CFG.razorpayKeyId}:${CFG.razorpayKeySecret}`).toString('base64');
    const bodyStr = JSON.stringify({ amount: amount * 100, currency: 'INR', receipt: `ds_${Date.now()}` });
    const rzp = await new Promise((resolve, reject) => {
      const opts = { hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } };
      const r = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
      r.on('error', reject); r.write(bodyStr); r.end();
    });
    if (rzp.id) {
      await sbInsert('payments', { id: rzp.id, phone: phone||'', plan_id: planId||'', amount, payment_type: type||'subscription', payment_via: 'razorpay', status: 'created', created_at: new Date().toISOString() });
      res.json({ success: true, orderId: rzp.id, keyId: CFG.razorpayKeyId, amount: amount * 100 });
    } else { res.status(500).json({ error: 'Razorpay order failed', details: rzp }); }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/payment/confirm', async (req, res) => {
  try {
    const { orderId, phone, planId, paymentId } = req.body;
    const id = orderId || `m_${Date.now()}`;
    await sbUpsert('payments', { id, phone: phone||'', plan_id: planId||'', amount: 0, status: 'paid', payment_id: paymentId||'manual', paid_at: new Date().toISOString(), created_at: new Date().toISOString() }, 'id');
    if (phone && planId) await sbUpdate('users', `?phone=eq.${encodeURIComponent(phone)}`, { plan: planId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/payment/webhook', async (req, res) => {
  try {
    if (req.body?.event === 'payment.captured') {
      const p = req.body?.payload?.payment?.entity;
      if (p) await sbUpdate('payments', `?id=eq.${encodeURIComponent(p.order_id||'')}`, { status: 'paid', payment_id: p.id, paid_at: new Date().toISOString() });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// KATHA VAULT
// ════════════════════════════════════════════════════════════════
app.get('/katha/:sc/:unit/:lang', async (req, res) => {
  try {
    const { sc, unit, lang } = req.params;
    const cacheFile = path.join(TMP, `${sc}_${unit}_${lang}.json`);
    // Try local cache (fast)
    if (fs.existsSync(cacheFile)) {
      const d = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Date.now() - d.cachedAt < 3600000) {
        return res.json({ success: true, content: d.content, verseCount: d.verseCount, source: 'cache' });
      }
    }
    // Load from Supabase
    const verses = await sbSelect('katha_vault', `?scripture_id=eq.${sc}&unit_id=eq.${unit}&lang=eq.${lang}&order=verse_number.asc&select=verse_data,verse_number`);
    if (!verses.length) return res.status(404).json({ success: false, message: 'Not generated yet. Go to admin → Katha Generator.' });
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

app.get('/admin/katha/status/:sc/:unit/:lang', adminAuth, async (req, res) => {
  const { sc, unit, lang } = req.params;
  const verses = await sbSelect('katha_vault', `?scripture_id=eq.${sc}&unit_id=eq.${unit}&lang=eq.${lang}&select=verse_number&order=verse_number.asc`);
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

// ─── AI CALLERS ───────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.1,maxOutputTokens:1200}, safetySettings:[{category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_NONE'},{category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_NONE'},{category:'HARM_CATEGORY_DANGEROUS_CONTENT',threshold:'BLOCK_NONE'}] });
    const timer = setTimeout(() => reject(new Error('Gemini timeout')), 40000);
    const opts = { hostname:'generativelanguage.googleapis.com', path:`/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} };
    const req = https.request(opts, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const d = JSON.parse(raw);
          if (res.statusCode === 429) return reject(new Error('RATE_LIMIT'));
          if (res.statusCode === 404) return reject(new Error('MODEL_NOT_FOUND — check gemini-2.0-flash'));
          if (res.statusCode !== 200) return reject(new Error(`Gemini ${res.statusCode}: ${raw.slice(0,80)}`));
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
    const body = JSON.stringify({ model:'llama-3.3-70b-versatile', messages:[{role:'system',content:'Return ONLY valid JSON starting with {. No markdown, no backticks, no explanation.'},{role:'user',content:prompt}], temperature:0.1, max_tokens:1200, response_format:{type:'json_object'} });
    const timer = setTimeout(() => reject(new Error('Groq timeout')), 40000);
    const opts = { hostname:'api.groq.com', path:'/openai/v1/chat/completions', method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`,'Content-Length':Buffer.byteLength(body)} };
    const req = https.request(opts, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          if (res.statusCode === 429) return reject(new Error('RATE_LIMIT'));
          if (res.statusCode !== 200) return reject(new Error(`Groq ${res.statusCode}: ${raw.slice(0,80)}`));
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
  if (gemKey) {
    try { return { text: await callGemini(gemKey, prompt), usedApi: 'gemini' }; }
    catch(e) { if (!e.message.includes('RATE_LIMIT')) console.log('[AI] Gemini failed:', e.message.slice(0,60)); }
  }
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
  throw new Error('No AI keys configured in admin dashboard');
}

function buildVersePrompt(sc, chN, chTitle, verseN, lang) {
  const isH = lang === 'hindi';
  return `You are a Vedic scholar (Gita Press Gorakhpur tradition).
${isH ? 'RULE: Write ALL explanations in PURE HINDI (Devanagari script). ZERO English words in explanations.' : 'RULE: Write ALL explanations in clear ENGLISH.'}
Return ONLY a JSON object. Start response with { — no markdown, no backticks, no explanation before or after JSON.

Generate Bhagavad Gita Chapter ${chN} (${chTitle}), Verse ${verseN}:

{"verse_id":"${chN}.${verseN}","chapter":${chN},"verse_number":${verseN},"sanskrit_full":"Complete Devanagari shloka — BOTH lines, never truncate or abbreviate","roman_transliteration":"Roman phonetic of both lines","word_meanings_grid":[{"word":"Sanskrit word","meaning":"${isH?'Hindi meaning':'English meaning'}"}],"tika_${isH?'hindi':'english'}":"Gita Press style explanation — 3 sentences in ${isH?'HINDI':'ENGLISH'}","teaching":"One practical life lesson today — ${isH?'Hindi':'English'}","gahan_drishti":"Deep philosophical insight — ${isH?'Hindi':'English'}","bal_seekh":"Simple teaching for a child — ${isH?'Hindi':'English'}","speaker":"${verseN<=2?'Dhritarashtra or Sanjaya':'Krishna or Arjuna or Sanjaya'}"}`;
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

// ─── GENERATION — 2 verses at a time, 20s gap, resume support ────
app.post('/admin/katha/generate', adminAuth, async (req, res) => {
  const { scriptureId, unitId, lang, totalVerses, chapterTitle, geminiKey, groqKey, jobId } = req.body;
  if (!scriptureId || !unitId || !lang) return res.status(400).json({ error: 'Missing: scriptureId, unitId, lang' });

  const gemKey = geminiKey || CFG.geminiKey || '';
  const grqKey = groqKey   || CFG.groqKey   || '';
  if (!gemKey && !grqKey) return res.status(400).json({ error: 'No AI keys. Go to admin dashboard → API Keys tab → enter Gemini + Groq keys → Save.' });

  const chN   = parseInt(unitId);
  const total = parseInt(totalVerses) || 47;
  const title = chapterTitle || `Chapter ${chN}`;
  const job   = jobId || `${scriptureId}_${chN}_${lang}_${Date.now()}`;

  // Find existing verses in Supabase (resume from where stopped)
  let existingNums = new Set();
  try {
    const existing = await sbSelect('katha_vault', `?scripture_id=eq.${scriptureId}&unit_id=eq.${chN}&lang=eq.${lang}&select=verse_number`);
    existing.forEach(v => existingNums.add(v.verse_number));
  } catch(e) { console.log('[Katha] Cannot check existing:', e.message); }

  const missing = [];
  for (let i = 1; i <= total; i++) if (!existingNums.has(i)) missing.push(i);

  res.json({ success: true, jobId: job, total, existing: existingNums.size, toGenerate: missing.length, resuming: existingNums.size > 0 });
  if (missing.length === 0) return;

  // ASYNC — 2 at a time
  (async () => {
    const GAP        = 20000; // 20 seconds between pairs
    const RATE_WAIT  = 45000;
    const RETRY_WAIT = 6000;
    const MAX_ATT    = 4;
    let generated = 0, failed = 0;

    sseLog(job, `🕉 ${scriptureId} Ch${chN} "${title}" | ${lang.toUpperCase()}`, 'info');
    sseLog(job, `📊 In Supabase: ${existingNums.size} | Need: ${missing.length} | Total: ${total}`, 'info');
    sseLog(job, `📡 AI: ${gemKey?'✅ Gemini 2.0 Flash':'❌ No Gemini'} | ${grqKey?'✅ Groq LLaMA 70B':'❌ No Groq'}`, 'info');
    sseLog(job, existingNums.size > 0 ? `▶️ RESUMING — missing: ${missing.slice(0,5).join(',')}${missing.length>5?'...':''}` : '🆕 Starting fresh', existingNums.size > 0 ? 'ok' : 'info');

    for (let bi = 0; bi < missing.length; bi += 2) {
      const pair = missing.slice(bi, bi + 2);
      const pairNum = Math.floor(bi/2) + 1;
      const pairTotal = Math.ceil(missing.length / 2);
      sseLog(job, `\n📦 Pair ${pairNum}/${pairTotal}: verse${pair.length>1?'s':''} ${pair.join(' + ')}`, 'info');

      for (const vN of pair) {
        sseLog(job, `⟳ Generating ${chN}.${vN}...`, 'wait');
        let verse = null, att = 0;

        while (att < MAX_ATT && !verse) {
          att++;
          try {
            const { text, usedApi } = await callAI(gemKey, grqKey, buildVersePrompt(scriptureId, chN, title, vN, lang));
            verse = parseVerse(text, chN, vN);
            if (verse) {
              await sbUpsert('katha_vault', { scripture_id: scriptureId, unit_id: chN, verse_number: vN, lang, verse_data: verse, chapter_title: title, generated_at: new Date().toISOString() }, 'scripture_id,unit_id,verse_number,lang');
              generated++;
              // Clear local cache
              const cf = path.join(TMP, `${scriptureId}_${chN}_${lang}.json`);
              if (fs.existsSync(cf)) fs.unlinkSync(cf);
              sseLog(job, `✅ ${chN}.${vN} saved to Supabase (${usedApi.toUpperCase()})`, 'ok');
            } else {
              sseLog(job, `⚠️ JSON parse failed attempt ${att}/${MAX_ATT}`, 'err');
              if (att < MAX_ATT) await new Promise(r => setTimeout(r, RETRY_WAIT));
            }
          } catch(e) {
            const rl = e.message.includes('RATE_LIMIT');
            sseLog(job, `❌ ${chN}.${vN} att${att}: ${e.message.slice(0,70)}`, 'err');
            if (rl) { sseLog(job, `⏳ Rate limit — waiting ${RATE_WAIT/1000}s...`, 'wait'); await new Promise(r => setTimeout(r, RATE_WAIT)); }
            else await new Promise(r => setTimeout(r, RETRY_WAIT));
          }
        }
        if (!verse) { failed++; sseLog(job, `⛔ Verse ${chN}.${vN} skipped after ${MAX_ATT} attempts — click Generate again to retry`, 'err'); }
      }

      if (bi + 2 < missing.length) {
        sseLog(job, `⏸ Pair done. Waiting ${GAP/1000}s before next pair...`, 'wait');
        await new Promise(r => setTimeout(r, GAP));
      }
    }

    const pct = Math.round((generated / missing.length) * 100);
    sseDone(job, `🎉 Complete! ✅ New: ${generated} | ⛔ Failed: ${failed} | 📚 Total in Supabase: ${existingNums.size + generated}/${total}${failed > 0 ? ' | Click Generate again to retry failed' : ''}`);
  })().catch(e => { sseLog(job, '❌ Fatal error: ' + e.message, 'err'); sseDone(job, 'Stopped: ' + e.message); });
});

// ════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════════════

// GET config
app.get('/admin/config', adminAuth, (req, res) => {
  const safe = { ...CFG };
  if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***SAVED';
  if (safe.geminiKey?.length > 6) safe.geminiKey = safe.geminiKey.slice(0,8) + '***SAVED';
  if (safe.groqKey?.length > 6) safe.groqKey = safe.groqKey.slice(0,8) + '***SAVED';
  res.json({ success: true, config: safe });
});

// SAVE config — permanently in Supabase
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
      // Don't overwrite keys with masked values
      if (typeof val === 'string' && val.includes('***SAVED')) continue;
      CFG[jsKey] = val;
      saves.push(saveConfigKey(dbKey, str));
    }
  }
  await Promise.all(saves);
  const safe = { ...CFG };
  if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***SAVED';
  if (safe.geminiKey?.length > 6) safe.geminiKey = safe.geminiKey.slice(0,8) + '***SAVED';
  if (safe.groqKey?.length > 6) safe.groqKey = safe.groqKey.slice(0,8) + '***SAVED';
  res.json({ success: true, config: safe, saved: saves.length });
});

// DELETE a specific config key
app.delete('/admin/config/:key', adminAuth, async (req, res) => {
  const keyMap = { geminiKey:'gemini_key', groqKey:'groq_key', phonepeUPI:'phonepe_upi', razorpayKeyId:'razorpay_key_id', razorpayKeySecret:'razorpay_key_secret' };
  const dbKey = keyMap[req.params.key];
  if (!dbKey) return res.status(400).json({ error: 'Unknown key' });
  CFG[req.params.key] = '';
  await saveConfigKey(dbKey, '');
  res.json({ success: true });
});

app.post('/admin/bundles', adminAuth, async (req, res) => { CFG.bundles = req.body.bundles; await saveConfigKey('bundles', JSON.stringify(CFG.bundles)); res.json({ success: true }); });
app.post('/admin/donations', adminAuth, async (req, res) => { CFG.donations = req.body.donations; await saveConfigKey('donations', JSON.stringify(CFG.donations)); res.json({ success: true }); });

// Content upload
app.post('/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { title, type, topics, trustLevel, textContent } = req.body;
    let rawText = textContent || '';
    if (req.file) {
      if (req.file.mimetype.includes('text') || req.file.originalname.match(/\.(txt|csv|json)$/i)) rawText = req.file.buffer.toString('utf-8');
      else rawText = `[Binary file: ${req.file.originalname}]`;
    }
    if (!rawText || rawText.length < 3) return res.status(400).json({ error: 'No text content found' });
    const entry = { id:`up_${Date.now()}`, title:title||req.file?.originalname||'Untitled', type:type||'text', topics:topics?topics.split(',').map(t=>t.trim()).filter(Boolean):[], trust_level:trustLevel||'high', content:rawText, chunk_count:Math.ceil(rawText.length/2000), char_count:rawText.length, summary:rawText.slice(0,200), active:true, uploaded_at:new Date().toISOString() };
    await sbInsert('uploads', entry);
    res.json({ success:true, upload:{ id:entry.id, title:entry.title, chunkCount:entry.chunk_count, charCount:entry.char_count } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/uploads', adminAuth, async (req, res) => {
  const rows = await sbSelect('uploads', '?order=uploaded_at.desc');
  res.json({ success:true, uploads: rows.map(u => ({ id:u.id, title:u.title, type:u.type, chunkCount:u.chunk_count, charCount:u.char_count, active:u.active, uploadedAt:u.uploaded_at, topics:u.topics })) });
});
app.patch('/admin/uploads/:id', adminAuth, async (req, res) => { await sbUpdate('uploads',`?id=eq.${req.params.id}`,req.body); res.json({success:true}); });
app.delete('/admin/uploads/:id', adminAuth, async (req, res) => { await sbDelete('uploads',`?id=eq.${req.params.id}`); res.json({success:true}); });

// Users
app.get('/admin/users', adminAuth, async (req, res) => {
  const { search, plan } = req.query;
  let q = '?order=last_active.desc&limit=500';
  if (plan && plan !== 'all') q += `&plan=eq.${plan}`;
  let rows = await sbSelect('users', q);
  if (search) rows = rows.filter(u => (u.name||'').toLowerCase().includes(search.toLowerCase()) || (u.phone||'').includes(search) || (u.email||'').toLowerCase().includes(search.toLowerCase()) || (u.birth_city||'').toLowerCase().includes(search.toLowerCase()));
  res.json({ success:true, users:rows, total:rows.length });
});
app.patch('/admin/users/:id', adminAuth, async (req, res) => { await sbUpdate('users',`?id=eq.${req.params.id}`,req.body); res.json({success:true}); });

// Transactions
app.get('/admin/transactions', adminAuth, async (req, res) => {
  const rows = await sbSelect('payments', '?order=created_at.desc&limit=200');
  const paid = rows.filter(r=>r.status==='paid');
  res.json({ success:true, transactions:rows, total:rows.length, totalRevenue:paid.reduce((s,t)=>s+(t.amount||0),0) });
});

// Feedback — all entries
app.get('/admin/feedback', adminAuth, async (req, res) => {
  const rows = await sbSelect('feedback', '?order=created_at.desc');
  res.json({ success:true, feedback:rows, total:rows.length, pending:rows.filter(f=>f.status==='pending').length });
});
app.patch('/admin/feedback/:id', adminAuth, async (req, res) => { await sbUpdate('feedback',`?id=eq.${req.params.id}`,req.body); res.json({success:true}); });
app.delete('/admin/feedback/:id', adminAuth, async (req, res) => { await sbDelete('feedback',`?id=eq.${req.params.id}`); res.json({success:true}); });

// Stats overview
app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const [users, payments, feedback, katha, uploads] = await Promise.all([
      sbSelect('users','?select=plan,created_at').catch(()=>[]),
      sbSelect('payments','?select=status,amount').catch(()=>[]),
      sbSelect('feedback','?select=status').catch(()=>[]),
      sbSelect('katha_vault','?select=scripture_id,unit_id,lang').catch(()=>[]),
      sbSelect('uploads','?select=active').catch(()=>[]),
    ]);
    const paid = payments.filter(p=>p.status==='paid');
    const chapters = new Set(katha.map(v=>`${v.scripture_id}_${v.unit_id}_${v.lang}`));
    const today = new Date().toDateString();
    res.json({ success:true, stats:{
      totalUsers: users.length,
      premiumUsers: users.filter(u=>u.plan!=='free').length,
      newToday: users.filter(u=>new Date(u.created_at).toDateString()===today).length,
      totalTransactions: payments.length,
      paidTransactions: paid.length,
      totalRevenue: paid.reduce((s,t)=>s+(t.amount||0),0),
      kathaChapters: chapters.size,
      totalVerses: katha.length,
      activeUploads: uploads.filter(u=>u.active).length,
      pendingFeedback: feedback.filter(f=>f.status==='pending').length,
      totalFeedback: feedback.length,
      db: 'supabase',
    }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DB status
app.get('/admin/db-status', adminAuth, async (req, res) => {
  const configured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  let connected = false;
  try { await sbSelect('admin_settings','?limit=1'); connected = true; } catch {}
  res.json({
    success:true, database:'Supabase PostgreSQL',
    supabaseUrl: SUPABASE_URL || 'NOT SET',
    configured, connected,
    githubGist: 'REMOVED — using Supabase only',
    instructions: !configured ? ['1. Go to supabase.com → your project → Settings → API','2. Copy Project URL → add to Render as SUPABASE_URL','3. Copy service_role key (NOT anon) → add to Render as SUPABASE_SERVICE_KEY','4. Run SQL schema in Supabase → SQL Editor → New Query','5. Click Redeploy in Render'] : (connected ? ['✅ Supabase fully connected!','All data saves permanently.'] : ['⚠️ Check your SUPABASE_SERVICE_KEY — must be service_role, NOT anon key']),
  });
});

// ─── LAUNCH ──────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🕉 DharmaSetu Backend v8 — port ${PORT}`);
  console.log(`   ${new Date().toISOString()}`);
  await initDB();
});