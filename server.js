// ════════════════════════════════════════════════════════════════
// DharmaSetu Backend — SUPABASE FINAL v7
// Render.com URL: https://dharmasetu-backend-2c65.onrender.com
//
// DATABASE: Supabase (PostgreSQL) — permanent, never resets
// VERSE ENGINE: 2 verses per batch, 20s gap, resume from where stopped
// PAYMENT: PhonePe UPI + Razorpay, switchable from admin dashboard
// AI: Gemini 2.0 Flash (primary) → Groq LLaMA 70B (fallback)
//
// REQUIRED RENDER ENVIRONMENT VARIABLES:
//   ADMIN_PASSWORD     = DharmaSetu@Admin2025
//   SUPABASE_URL       = https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY = eyJ... (service_role key, NOT anon key)
// ════════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 10000;

const ADMIN_PASSWORD      = process.env.ADMIN_PASSWORD      || 'DharmaSetu@Admin2025';
const SUPABASE_URL        = process.env.SUPABASE_URL        || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ─── LOCAL CACHE (fast reads — refills from Supabase) ─────────────
const TMP = '/tmp/ds';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

// ─── IN-MEMORY CONFIG (loaded from Supabase admin_settings table) ─
let CFG = {
  geminiKey: '', groqKey: '',
  phonepeUPI: '', razorpayKeyId: '', razorpayKeySecret: '',
  subscriptionPayment: 'upi', donationPayment: 'upi',
  premiumPrice: 249, basicPrice: 99, nriPrice: 499,
  freeQuestionsLimit: 3, maintenanceMode: false,
  appVersion: '1.0.0',
  bundles: [
    { id:'basic', name:'Basic', nameHi:'बेसिक', price:99, active:true, features:['30 questions/day','15 fact-checks/day','Mantra Verify','Save answers'] },
    { id:'pro',   name:'Pro',   nameHi:'प्रो',  price:249, active:true, popular:true, features:['Unlimited questions','Unlimited fact-checks','All features','Peace Mode'] },
  ],
  donations: [
    { id:'army',   name:'Army Welfare',    nameHi:'सेना कल्याण',       goal:100000, raised:0, active:true },
    { id:'temple', name:'Temple Restore',  nameHi:'मंदिर जीर्णोद्धार', goal:500000, raised:0, active:true },
    { id:'dharma', name:'Dharma Education',nameHi:'धर्म शिक्षा',       goal:250000, raised:0, active:true },
  ],
};

// ════════════════════════════════════════════════════════════════
// SUPABASE CLIENT — raw HTTP calls (no npm package needed)
// ════════════════════════════════════════════════════════════════
async function sbQuery(sql, params = []) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Supabase not configured');
  const body = JSON.stringify({ query: sql, params });
  return new Promise((resolve, reject) => {
    const url = new URL('/rest/v1/rpc/execute_sql', SUPABASE_URL);
    const opts = {
      hostname: url.hostname, path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': 'return=representation',
      },
    };
    const req = https.request(opts, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve([]); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// Simpler: use Supabase REST API directly (more reliable than RPC)
async function sbRest(method, table, body, query = '') {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Supabase not configured');
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const url = new URL(`/rest/v1/${table}${query}`, SUPABASE_URL);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : 'return=representation',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
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
  return r.data;
}
async function sbUpsert(table, row, conflict) {
  const r = await sbRest('POST', table, row, `?on_conflict=${conflict}`);
  return r.data;
}
async function sbUpdate(table, query, row) {
  const r = await sbRest('PATCH', table, row, query);
  return r.data;
}
async function sbDelete(table, query) {
  const r = await sbRest('DELETE', table, null, query);
  return r.data;
}

// ─── LOAD CONFIG FROM SUPABASE ────────────────────────────────────
async function loadConfig() {
  try {
    const rows = await sbSelect('admin_settings');
    const map = {};
    rows.forEach(r => map[r.key] = r.value);
    if (map.gemini_key)           CFG.geminiKey           = map.gemini_key;
    if (map.groq_key)             CFG.groqKey             = map.groq_key;
    if (map.phonepe_upi)          CFG.phonepeUPI          = map.phonepe_upi;
    if (map.razorpay_key_id)      CFG.razorpayKeyId       = map.razorpay_key_id;
    if (map.razorpay_key_secret)  CFG.razorpayKeySecret   = map.razorpay_key_secret;
    if (map.subscription_payment) CFG.subscriptionPayment = map.subscription_payment;
    if (map.donation_payment)     CFG.donationPayment     = map.donation_payment;
    if (map.premium_price)        CFG.premiumPrice        = +map.premium_price;
    if (map.basic_price)          CFG.basicPrice          = +map.basic_price;
    if (map.app_version)          CFG.appVersion          = map.app_version;
    if (map.maintenance_mode)     CFG.maintenanceMode     = map.maintenance_mode === 'true';
    if (map.bundles)              try { CFG.bundles = JSON.parse(map.bundles); } catch {}
    if (map.donations)            try { CFG.donations = JSON.parse(map.donations); } catch {}
    console.log('[DB] Config loaded from Supabase');
  } catch(e) { console.log('[DB] Config load failed:', e.message, '(using defaults)'); }
}

async function saveConfigKey(key, value) {
  try {
    await sbUpsert('admin_settings', { key, value: String(value), updated_at: new Date().toISOString() }, 'key');
  } catch(e) { console.error('[DB] Save config failed:', e.message); }
}

// ─── DB INIT ─────────────────────────────────────────────────────
async function initDB() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[DB] ⚠️  Supabase not configured! Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Render.');
    return;
  }
  console.log('[DB] Connecting to Supabase...');
  await loadConfig();
  console.log('[DB] ✅ Supabase connected');
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/admin-portal', (req, res) => {
  const p = path.join(__dirname, 'admin_dashboard.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).send('<h2>admin_dashboard.html not found</h2>');
});

// ════════════════════════════════════════════════════════════════
// SSE — Live verse generation log
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
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(ping); } }, 15000);
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
    setTimeout(() => { c.write('data: {"type":"end"}\n\n'); sseClients.delete(jobId); }, 800);
  } catch {}
}

// ════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ════════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
  let dbOk = false;
  try { await sbSelect('admin_settings', '?limit=1'); dbOk = true; } catch {}
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: CFG.appVersion, db: dbOk ? 'supabase' : 'offline', supabaseConfigured: !!SUPABASE_URL });
});

app.get('/config', (req, res) => {
  res.json({ success: true, config: {
    premiumPrice: CFG.premiumPrice, basicPrice: CFG.basicPrice, nriPrice: CFG.nriPrice,
    freeQuestionsLimit: CFG.freeQuestionsLimit, maintenanceMode: CFG.maintenanceMode,
    appVersion: CFG.appVersion,
    bundles: CFG.bundles.filter(b => b.active),
    donations: CFG.donations.filter(d => d.active),
    phonepeUPI: CFG.phonepeUPI || '',
    razorpayKeyId: CFG.razorpayKeyId || '',
    subscriptionPayment: CFG.subscriptionPayment || 'upi',
    donationPayment: CFG.donationPayment || 'upi',
    hasRazorpay: !!(CFG.razorpayKeyId && CFG.razorpayKeySecret),
  }});
});

// ─── AI PROXY — keys stored in Supabase, never in app ────────────
app.post('/ai/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!CFG.geminiKey && !CFG.groqKey) return res.status(503).json({ error: 'AI keys not configured. Set in admin dashboard.' });
    const result = await callAI(CFG.geminiKey, CFG.groqKey, prompt || '');
    res.json({ success: true, text: result.text, usedApi: result.usedApi });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── USERS ────────────────────────────────────────────────────────
app.post('/users/register', async (req, res) => {
  try {
    const { phone, name, rashi, nakshatra, deity, language, birthCity, dob } = req.body;
    if (!phone || !name) return res.status(400).json({ error: 'phone and name required' });
    // Check existing
    const existing = await sbSelect('users', `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (existing.length) {
      await sbUpdate('users', `?phone=eq.${encodeURIComponent(phone)}`, { last_active: new Date().toISOString() });
      return res.json({ success: true, user: existing[0], isNew: false });
    }
    const id = `u_${Date.now()}`;
    const user = { id, phone, name, rashi: rashi||'Mesh', nakshatra: nakshatra||'Ashwini', deity: deity||'Hanuman', language: language||'hindi', birth_city: birthCity||'', dob: dob||'', plan:'free', streak:0, questions:0, pts:0 };
    const r = await sbInsert('users', user);
    res.json({ success: true, user: Array.isArray(r) ? r[0] : user, isNew: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

// ─── FEEDBACK ─────────────────────────────────────────────────────
app.post('/feedback', async (req, res) => {
  try {
    const { question, wrongAnswer, correctedAnswer, reason, phone } = req.body;
    const entry = { id: `fb_${Date.now()}`, question: question||'', wrong_answer: wrongAnswer||'', corrected_answer: correctedAnswer||'', reason: reason||'', phone: phone||'', status: 'pending' };
    await sbInsert('feedback', entry);
    res.json({ success: true, id: entry.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── PAYMENT ─────────────────────────────────────────────────────
app.get('/payment/config', (req, res) => {
  res.json({ success: true, phonepeUPI: CFG.phonepeUPI||'', razorpayKeyId: CFG.razorpayKeyId||'', subscriptionPayment: CFG.subscriptionPayment||'upi', donationPayment: CFG.donationPayment||'upi', hasRazorpay: !!(CFG.razorpayKeyId && CFG.razorpayKeySecret) });
});

app.post('/payment/razorpay/order', async (req, res) => {
  try {
    const { amount, type, planId, phone } = req.body;
    if (!CFG.razorpayKeyId || !CFG.razorpayKeySecret) return res.status(503).json({ error: 'Razorpay not configured.' });
    const auth = Buffer.from(`${CFG.razorpayKeyId}:${CFG.razorpayKeySecret}`).toString('base64');
    const body = JSON.stringify({ amount: amount * 100, currency: 'INR', receipt: `ds_${Date.now()}` });
    const rzp = await new Promise((resolve, reject) => {
      const opts = { hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
      r.on('error', reject); r.write(body); r.end();
    });
    if (rzp.id) {
      await sbInsert('payments', { id: rzp.id, phone: phone||'', plan_id: planId||'', amount, payment_type: type||'subscription', payment_via: 'razorpay', status: 'created' });
      res.json({ success: true, orderId: rzp.id, keyId: CFG.razorpayKeyId, amount: amount * 100 });
    } else { res.status(500).json({ error: 'Razorpay failed', details: rzp }); }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/payment/confirm', async (req, res) => {
  try {
    const { orderId, phone, planId, paymentId } = req.body;
    const existing = await sbSelect('payments', `?id=eq.${encodeURIComponent(orderId||'x')}&limit=1`);
    if (existing.length) {
      await sbUpdate('payments', `?id=eq.${encodeURIComponent(orderId)}`, { status: 'paid', payment_id: paymentId||'manual', paid_at: new Date().toISOString() });
    } else {
      await sbInsert('payments', { id: orderId || `m_${Date.now()}`, phone: phone||'', plan_id: planId||'', amount: 0, status: 'paid', paid_at: new Date().toISOString() });
    }
    if (phone && planId) await sbUpdate('users', `?phone=eq.${encodeURIComponent(phone)}`, { plan: planId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// KATHA VAULT — Supabase storage, 2 verses per batch, resume support
// ════════════════════════════════════════════════════════════════

// Fetch one chapter — all verses
app.get('/katha/:sc/:unit/:lang', async (req, res) => {
  try {
    const { sc, unit, lang } = req.params;
    const key = `${sc}_${unit}_${lang}`;
    // Check local disk cache first (fast)
    const cacheFile = path.join(TMP, `${key}.json`);
    if (fs.existsSync(cacheFile)) {
      const d = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Date.now() - d.cachedAt < 3600000) { // 1 hour cache
        return res.json({ success: true, content: d.content, verseCount: d.verseCount, source: 'cache' });
      }
    }
    // Load from Supabase
    const verses = await sbSelect('katha_vault',
      `?scripture_id=eq.${sc}&unit_id=eq.${unit}&lang=eq.${lang}&order=verse_number.asc&select=verse_data,verse_number`);
    if (!verses.length) return res.status(404).json({ success: false, message: 'Not generated yet' });
    const content = JSON.stringify(verses.map(v => v.verse_data));
    // Cache locally
    fs.writeFileSync(cacheFile, JSON.stringify({ content, verseCount: verses.length, cachedAt: Date.now() }));
    res.json({ success: true, content, verseCount: verses.length, source: 'supabase' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Katha list
app.get('/katha/list', async (req, res) => {
  try {
    const rows = await sbSelect('katha_vault', '?select=scripture_id,unit_id,lang&order=scripture_id.asc');
    const groups = {};
    rows.forEach(r => {
      const k = `${r.scripture_id}_${r.unit_id}_${r.lang}`;
      groups[k] = (groups[k] || 0) + 1;
    });
    res.json({ success: true, count: Object.keys(groups).length, chapters: Object.entries(groups).map(([k, n]) => ({ key: k, verseCount: n })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Status of one chapter
app.get('/admin/katha/status/:sc/:unit/:lang', adminAuth, async (req, res) => {
  try {
    const { sc, unit, lang } = req.params;
    const verses = await sbSelect('katha_vault', `?scripture_id=eq.${sc}&unit_id=eq.${unit}&lang=eq.${lang}&select=verse_number&order=verse_number.asc`);
    const nums = verses.map(v => v.verse_number);
    res.json({ exists: nums.length > 0, verseCount: nums.length, savedVerses: nums });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/admin/katha/:sc/:unit/:lang', adminAuth, async (req, res) => {
  const { sc, unit, lang } = req.params;
  await sbDelete('katha_vault', `?scripture_id=eq.${sc}&unit_id=eq.${unit}&lang=eq.${lang}`);
  // Clear cache
  const cacheFile = path.join(TMP, `${sc}_${unit}_${lang}.json`);
  if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  res.json({ success: true });
});

// ─── AI HELPERS ───────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const r = await fetch(url, { method:'POST', signal:controller.signal, headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.1,maxOutputTokens:1200},
        safetySettings:[{category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_NONE'},{category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_NONE'},{category:'HARM_CATEGORY_DANGEROUS_CONTENT',threshold:'BLOCK_NONE'}] }) });
    clearTimeout(timer);
    if (r.status === 429) throw new Error('RATE_LIMIT');
    if (r.status === 404) throw new Error('MODEL_NOT_FOUND');
    if (!r.ok) { const t = await r.text(); throw new Error(`Gemini ${r.status}: ${t.slice(0,80)}`); }
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Gemini empty — ${d?.candidates?.[0]?.finishReason||'unknown'}`);
    return text;
  } catch(e) { clearTimeout(timer); throw e; }
}

async function callGroq(apiKey, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method:'POST', signal:controller.signal,
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
      body: JSON.stringify({ model:'llama-3.3-70b-versatile', messages:[{role:'system',content:'Return ONLY valid JSON. No markdown, no backticks. Start response with {.'},{role:'user',content:prompt}], temperature:0.1, max_tokens:1200, response_format:{type:'json_object'} }) });
    clearTimeout(timer);
    if (r.status === 429) throw new Error('RATE_LIMIT');
    if (!r.ok) { const t = await r.text(); throw new Error(`Groq ${r.status}: ${t.slice(0,80)}`); }
    const d = await r.json();
    const text = d?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq empty response');
    return text;
  } catch(e) { clearTimeout(timer); throw e; }
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
        await new Promise(r => setTimeout(r, 40000));
        try { return { text: await callGemini(gemKey, prompt), usedApi: 'gemini-retry' }; } catch {}
      }
      throw new Error('All AI failed: ' + e.message.slice(0,60));
    }
  }
  if (gemKey) { return { text: await callGemini(gemKey, prompt), usedApi: 'gemini-only' }; }
  throw new Error('No AI keys configured');
}

function buildVersePrompt(sc, chN, chTitle, verseN, lang) {
  const isH = lang === 'hindi';
  return `Vedic scholar (Gita Press tradition). ${isH ? 'All explanations in PURE HINDI (Devanagari). Zero English words.' : 'All explanations in clear ENGLISH.'}
Return ONLY a JSON object. No markdown, no backticks. Start with {

Bhagavad Gita Chapter ${chN} (${chTitle}), Verse ${verseN}:
{"verse_id":"${chN}.${verseN}","chapter":${chN},"verse_number":${verseN},"sanskrit_full":"Complete Devanagari shloka — BOTH lines, never truncate","roman_transliteration":"Roman transliteration of both lines","word_meanings_grid":[{"word":"Sanskrit word","meaning":"${isH?'Hindi':'English'} meaning"}],"tika_${isH?'hindi':'english'}":"2-3 sentence Gita Press style commentary in ${isH?'HINDI':'ENGLISH'}","teaching":"One practical life lesson in ${isH?'Hindi':'English'}","gahan_drishti":"1-2 sentences deep philosophical insight in ${isH?'Hindi':'English'}","bal_seekh":"Simple moral for a child in ${isH?'Hindi':'English'}","speaker":"Krishna or Sanjaya or Arjuna"}`;
}

function parseVerse(raw, chN, verseN) {
  if (!raw) return null;
  let s = raw.trim().replace(/^```json?\s*/i,'').replace(/\s*```$/i,'');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const p = JSON.parse(s.slice(start, end + 1));
    p.verse_id = p.verse_id || `${chN}.${verseN}`;
    p.verse_number = p.verse_number || verseN;
    p.chapter = parseInt(chN);
    return p;
  } catch { return null; }
}

// ─── GENERATION — 2 verses at a time, resume from last saved ─────
app.post('/admin/katha/generate', adminAuth, async (req, res) => {
  const { scriptureId, unitId, lang, totalVerses, chapterTitle, geminiKey, groqKey, jobId } = req.body;
  if (!scriptureId || !unitId || !lang) return res.status(400).json({ error: 'Missing: scriptureId, unitId, lang' });

  const gemKey = geminiKey || CFG.geminiKey || '';
  const grqKey = groqKey   || CFG.groqKey   || '';
  if (!gemKey && !grqKey) return res.status(400).json({ error: 'No AI keys. Set Gemini/Groq in admin dashboard → API Keys.' });

  const chN   = parseInt(unitId);
  const total = parseInt(totalVerses) || 47;
  const title = chapterTitle || `Chapter ${chN}`;
  const job   = jobId || `${scriptureId}_${chN}_${lang}_${Date.now()}`;

  // Find which verses already exist in Supabase (RESUME support)
  let existingNums = new Set();
  try {
    const existing = await sbSelect('katha_vault', `?scripture_id=eq.${scriptureId}&unit_id=eq.${chN}&lang=eq.${lang}&select=verse_number`);
    existing.forEach(v => existingNums.add(v.verse_number));
  } catch(e) { console.log('[Katha] Cant check existing:', e.message); }

  const missing = [];
  for (let i = 1; i <= total; i++) if (!existingNums.has(i)) missing.push(i);

  res.json({ success: true, jobId: job, total, existing: existingNums.size, toGenerate: missing.length, resuming: existingNums.size > 0 });
  if (missing.length === 0) return;

  // ASYNC generation
  (async () => {
    const GAP        = 20000;  // 20s between pairs (as Gemini recommends)
    const RATE_WAIT  = 45000;  // 45s on rate limit
    const RETRY_WAIT = 6000;   // 6s on other errors
    const MAX_ATT    = 4;
    let generated = 0, failed = 0;

    sseLog(job, `🕉 ${scriptureId} Ch${chN} "${title}" | Lang: ${lang}`, 'info');
    sseLog(job, `📊 Already in Supabase: ${existingNums.size} | To generate: ${missing.length} | Total: ${total}`, 'info');
    sseLog(job, `📡 API: ${gemKey ? 'Gemini 2.0 Flash →' : ''} ${grqKey ? 'Groq LLaMA 70B' : ''}`, 'info');
    sseLog(job, `⚙️ 2 verses/batch · ${GAP/1000}s gap · Auto-retry · Saves to Supabase immediately`, 'info');
    sseLog(job, existingNums.size > 0 ? `▶️ RESUMING from verse after ${Math.max(...existingNums)}` : '🆕 Fresh start', existingNums.size > 0 ? 'ok' : 'info');

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
              // Save to Supabase immediately
              await sbUpsert('katha_vault', {
                scripture_id: scriptureId, unit_id: chN, verse_number: vN, lang,
                verse_data: verse, chapter_title: title,
              }, 'scripture_id,unit_id,verse_number,lang');
              generated++;
              // Clear local cache so next app fetch gets fresh data
              const cacheFile = path.join(TMP, `${scriptureId}_${chN}_${lang}.json`);
              if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
              sseLog(job, `✅ ${chN}.${vN} saved to Supabase (${usedApi.toUpperCase()})`, 'ok');
            } else {
              sseLog(job, `⚠️ JSON parse failed — attempt ${att}/${MAX_ATT}`, 'err');
              if (att < MAX_ATT) await new Promise(r => setTimeout(r, RETRY_WAIT));
            }
          } catch(e) {
            const rl = e.message.includes('RATE_LIMIT');
            sseLog(job, `❌ ${chN}.${vN} att${att}: ${e.message.slice(0,60)}`, 'err');
            if (rl) { sseLog(job, `⏳ Rate limited — waiting ${RATE_WAIT/1000}s then retrying...`, 'wait'); await new Promise(r => setTimeout(r, RATE_WAIT)); }
            else { await new Promise(r => setTimeout(r, RETRY_WAIT)); }
          }
        }
        if (!verse) { failed++; sseLog(job, `⛔ Skipped ${chN}.${vN} — click Generate again to retry`, 'err'); }
      }

      if (bi + 2 < missing.length) {
        sseLog(job, `⏸ Pair done. Waiting ${GAP/1000}s...`, 'wait');
        await new Promise(r => setTimeout(r, GAP));
      }
    }

    const pct = missing.length > 0 ? Math.round((generated / missing.length) * 100) : 100;
    sseDone(job, `🎉 Done! ✅ ${generated} new | ⛔ ${failed} failed | 📚 ${existingNums.size + generated}/${total} in Supabase${failed > 0 ? ' — Click Generate again to fill gaps' : ''}`);
  })().catch(e => { sseLog(job, '❌ Fatal: ' + e.message, 'err'); sseDone(job, 'Stopped: ' + e.message); });
});

// ════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════════════

app.get('/admin/config', adminAuth, (req, res) => {
  const safe = { ...CFG };
  if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***';
  res.json({ success: true, config: safe });
});

app.post('/admin/config', adminAuth, async (req, res) => {
  const keyMap = {
    geminiKey: 'gemini_key', groqKey: 'groq_key',
    phonepeUPI: 'phonepe_upi', razorpayKeyId: 'razorpay_key_id', razorpayKeySecret: 'razorpay_key_secret',
    subscriptionPayment: 'subscription_payment', donationPayment: 'donation_payment',
    premiumPrice: 'premium_price', basicPrice: 'basic_price', nriPrice: 'nri_price',
    freeQuestionsLimit: 'free_questions_limit', appVersion: 'app_version', maintenanceMode: 'maintenance_mode',
    bundles: 'bundles', donations: 'donations',
  };
  const saves = [];
  for (const [jsKey, dbKey] of Object.entries(keyMap)) {
    if (req.body[jsKey] !== undefined) {
      const val = typeof req.body[jsKey] === 'object' ? JSON.stringify(req.body[jsKey]) : String(req.body[jsKey]);
      CFG[jsKey] = req.body[jsKey];
      saves.push(saveConfigKey(dbKey, val));
    }
  }
  await Promise.all(saves);
  const safe = { ...CFG }; if (safe.razorpayKeySecret?.length > 4) safe.razorpayKeySecret = safe.razorpayKeySecret.slice(0,4) + '***';
  res.json({ success: true, config: safe });
});

app.post('/admin/bundles', adminAuth, async (req, res) => { CFG.bundles = req.body.bundles; await saveConfigKey('bundles', JSON.stringify(CFG.bundles)); res.json({ success: true }); });
app.post('/admin/donations', adminAuth, async (req, res) => { CFG.donations = req.body.donations; await saveConfigKey('donations', JSON.stringify(CFG.donations)); res.json({ success: true }); });

// Content upload — stored in Supabase uploads table
app.post('/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { title, type, topics, trustLevel, textContent } = req.body;
    let rawText = textContent || '';
    if (req.file) {
      const name = req.file.originalname.toLowerCase();
      if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.json') || req.file.mimetype.includes('text')) rawText = req.file.buffer.toString('utf-8');
      else rawText = `[Binary: ${req.file.originalname}]`;
    }
    if (!rawText || rawText.length < 3) return res.status(400).json({ error: 'No content' });
    const entry = {
      id: `up_${Date.now()}`,
      title: title || req.file?.originalname || 'Untitled',
      type: type || 'text',
      topics: topics ? topics.split(',').map(t => t.trim()).filter(Boolean) : [],
      trust_level: trustLevel || 'high',
      content: rawText,
      chunk_count: Math.ceil(rawText.length / 2000),
      char_count: rawText.length,
      summary: rawText.slice(0, 200),
      active: true,
    };
    await sbInsert('uploads', entry);
    res.json({ success: true, upload: { id: entry.id, title: entry.title, chunkCount: entry.chunk_count, charCount: entry.char_count } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/uploads', adminAuth, async (req, res) => {
  const rows = await sbSelect('uploads', '?order=uploaded_at.desc');
  res.json({ success: true, uploads: rows.map(u => ({ id: u.id, title: u.title, type: u.type, chunkCount: u.chunk_count, charCount: u.char_count, active: u.active, uploadedAt: u.uploaded_at, topics: u.topics })) });
});

app.patch('/admin/uploads/:id', adminAuth, async (req, res) => { await sbUpdate('uploads', `?id=eq.${req.params.id}`, req.body.active !== undefined ? { active: req.body.active } : {}); res.json({ success: true }); });
app.delete('/admin/uploads/:id', adminAuth, async (req, res) => { await sbDelete('uploads', `?id=eq.${req.params.id}`); res.json({ success: true }); });

app.get('/admin/users', adminAuth, async (req, res) => {
  const { search, plan } = req.query;
  let query = '?order=last_active.desc&limit=200';
  if (plan && plan !== 'all') query += `&plan=eq.${plan}`;
  let rows = await sbSelect('users', query);
  if (search) rows = rows.filter(u => u.name?.toLowerCase().includes(search.toLowerCase()) || u.phone?.includes(search) || u.birth_city?.toLowerCase().includes(search.toLowerCase()));
  res.json({ success: true, users: rows, total: rows.length });
});

app.patch('/admin/users/:id', adminAuth, async (req, res) => { await sbUpdate('users', `?id=eq.${req.params.id}`, req.body); res.json({ success: true }); });

app.get('/admin/transactions', adminAuth, async (req, res) => {
  const rows = await sbSelect('payments', '?order=created_at.desc&limit=100');
  res.json({ success: true, transactions: rows, total: rows.length });
});

app.get('/admin/feedback', adminAuth, async (req, res) => {
  const rows = await sbSelect('feedback', '?order=created_at.desc');
  res.json({ success: true, feedback: rows, total: rows.length, pending: rows.filter(f => f.status === 'pending').length });
});

app.patch('/admin/feedback/:id', adminAuth, async (req, res) => { await sbUpdate('feedback', `?id=eq.${req.params.id}`, req.body); res.json({ success: true }); });

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const [users, payments, feedback, katha] = await Promise.all([
      sbSelect('users', '?select=plan'),
      sbSelect('payments', '?select=status,amount'),
      sbSelect('feedback', '?select=status'),
      sbSelect('katha_vault', '?select=scripture_id,unit_id,lang'),
    ]);
    const paid = payments.filter(p => p.status === 'paid');
    const chapters = new Set(katha.map(v => `${v.scripture_id}_${v.unit_id}_${v.lang}`));
    res.json({ success: true, stats: {
      totalUsers: users.length,
      premiumUsers: users.filter(u => u.plan !== 'free').length,
      totalTransactions: payments.length,
      paidTransactions: paid.length,
      totalRevenue: paid.reduce((s, t) => s + (t.amount || 0), 0),
      kathaChapters: chapters.size,
      totalVerses: katha.length,
      pendingFeedback: feedback.filter(f => f.status === 'pending').length,
      db: 'supabase',
    }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/db-status', adminAuth, async (req, res) => {
  const hasConfig = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  let connected = false;
  try { await sbSelect('admin_settings', '?limit=1'); connected = true; } catch {}
  res.json({
    success: true,
    database: 'Supabase PostgreSQL',
    supabaseUrl: SUPABASE_URL ? SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0] + '.supabase.co' : 'NOT SET',
    configured: hasConfig, connected,
    instructions: !SUPABASE_URL ? [
      '1. Go to supabase.com → your project → Settings → API',
      '2. Copy "Project URL" → add to Render as SUPABASE_URL',
      '3. Copy "service_role" key (not anon) → add to Render as SUPABASE_SERVICE_KEY',
      '4. Run the SQL schema in Supabase → SQL Editor',
      '5. Redeploy Render',
    ] : connected ? ['✅ Supabase fully connected and working!'] : ['Check your SUPABASE_SERVICE_KEY — use service_role, not anon key'],
  });
});

// ─── LAUNCH ──────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🕉 DharmaSetu Backend SUPABASE v7 — port ${PORT}`);
  await initDB();
  console.log(`   DB: ${SUPABASE_URL ? 'Supabase configured' : '⚠️ Supabase NOT configured'}\n`);
});