// DharmaSetu Backend — PRODUCTION FINAL v4
// Render.com: https://dharmasetu-backend-2c65.onrender.com
// FIXES:
// 1. Katha verse-by-verse generation with SSE live log
// 2. Gemini FIRST → Groq fallback (not reversed)
// 3. Each verse saved immediately after generation
// 4. Admin portal served from file
// 5. No dummy data — all real counts

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DharmaSetu@Admin2025';

// ─── DISK STORAGE ───────────────────────────────────────────────
const DATA_DIR    = '/tmp/dharmasetu';
const KATHA_DIR   = path.join(DATA_DIR, 'katha');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json');

function ensureDirs() {
  [DATA_DIR, KATHA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}
ensureDirs();

function readJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return fallback;
}
function writeJSON(file, data) {
  try { ensureDirs(); fs.writeFileSync(file, JSON.stringify(data)); } catch(e) { console.error('writeJSON error:', e.message); }
}

let CONFIG = readJSON(CONFIG_FILE, {
  premiumPrice: 249, basicPrice: 99, nriPrice: 499,
  freeQuestionsLimit: 3, freeFactCheckLimit: 3,
  maintenanceMode: false,
  kathaVaultEnabled: true, factCheckEnabled: true, debateEnabled: true,
  mantraVerifyEnabled: true, peaceModeEnabled: true, donationEnabled: true,
  bundles: [
    { id:'basic', name:'Basic',  nameHi:'बेसिक', price:99,  features:['30 questions/day','15 fact-checks/day','Mantra Verify','Save answers','No ads'], active:true },
    { id:'pro',   name:'Pro',    nameHi:'प्रो',   price:249, features:['Unlimited questions','Unlimited fact-checks','All Debate levels','Peace Mode','No ads','Priority support'], active:true, popular:true },
    { id:'nri',   name:'NRI',    nameHi:'NRI',    price:499, features:['Everything in Pro','Priority support','USD billing'], active:true },
  ],
  donations: [
    { id:'army',   name:'Army Welfare',    nameHi:'सेना कल्याण',       desc:'Support Indian Army welfare fund',       active:true, goal:100000, raised:0 },
    { id:'temple', name:'Temple Restore',  nameHi:'मंदिर जीर्णोद्धार', desc:'Restore ancient temples across India',   active:true, goal:500000, raised:0 },
    { id:'dharma', name:'Dharma Education',nameHi:'धर्म शिक्षा',       desc:'Educate youth about Sanatan Dharma',     active:true, goal:250000, raised:0 },
  ],
  appVersion: '1.0.0',
  lastUpdated: new Date().toISOString(),
});

let UPLOADS      = readJSON(UPLOADS_FILE, []);
let TRANSACTIONS = [];

// Active SSE clients for live generation log
const sseClients = new Map(); // jobId → res

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

// ─── ADMIN PANEL ─────────────────────────────────────────────────
app.get('/admin-portal', (req, res) => {
  const candidates = ['admin_dashboard.html', 'admin_dashboard_FINAL.html', 'dashboard.html'];
  for (const name of candidates) {
    const htmlPath = path.join(__dirname, name);
    if (fs.existsSync(htmlPath)) { res.sendFile(htmlPath); return; }
  }
  res.status(404).send('<h2>admin_dashboard.html not found in repo root</h2>');
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  const kathaFiles = fs.readdirSync(KATHA_DIR).filter(f => f.endsWith('.json')).length;
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uploads: UPLOADS.filter(u => u.active).length,
    version: CONFIG.appVersion,
    kathaChapters: kathaFiles,
  });
});

app.get('/config', (req, res) => {
  res.json({ success: true, config: {
    premiumPrice: CONFIG.premiumPrice,
    basicPrice:   CONFIG.basicPrice,
    nriPrice:     CONFIG.nriPrice,
    freeQuestionsLimit: CONFIG.freeQuestionsLimit,
    freeFactCheckLimit: CONFIG.freeFactCheckLimit,
    maintenanceMode:    CONFIG.maintenanceMode,
    kathaVaultEnabled:  CONFIG.kathaVaultEnabled,
    factCheckEnabled:   CONFIG.factCheckEnabled,
    debateEnabled:      CONFIG.debateEnabled,
    mantraVerifyEnabled:CONFIG.mantraVerifyEnabled,
    peaceModeEnabled:   CONFIG.peaceModeEnabled,
    donationEnabled:    CONFIG.donationEnabled,
    bundles:   CONFIG.bundles.filter(b => b.active),
    donations: CONFIG.donations.filter(d => d.active),
    appVersion: CONFIG.appVersion,
  }});
});

app.get('/content', (req, res) => {
  const active = UPLOADS.filter(u => u.active && u.processed);
  res.json({ success: true, count: active.length, content: active.map(u => ({
    id: u.id, title: u.title, type: u.type, topics: u.topics,
    summary: u.summary, chunks: (u.chunks || []).slice(0, 5),
  }))});
});

app.get('/donations', (req, res) => {
  res.json({ success: true, campaigns: CONFIG.donations.filter(d => d.active) });
});

// ─── KATHA ENDPOINTS ─────────────────────────────────────────────

// GET chapter from cache
app.get('/katha/:scriptureId/:unitId/:lang', (req, res) => {
  try {
    const { scriptureId, unitId, lang } = req.params;
    const filename = `${scriptureId}_${unitId}_${lang}.json`;
    const filepath = path.join(KATHA_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: 'Not yet generated' });
    const data = readJSON(filepath, null);
    if (!data || !data.content) return res.status(404).json({ success: false, message: 'Content invalid' });
    res.json({ success: true, content: data.content, savedAt: data.savedAt, verseCount: data.verseCount || 0 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// LIST all cached katha
app.get('/katha/list', (req, res) => {
  try {
    const files = fs.readdirSync(KATHA_DIR).filter(f => f.endsWith('.json'));
    const items = files.map(f => {
      try {
        const d = readJSON(path.join(KATHA_DIR, f), {});
        return { file: f, verseCount: d.verseCount || 0, savedAt: d.savedAt };
      } catch { return { file: f }; }
    });
    res.json({ success: true, count: files.length, files: items });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// SAVE verses (from admin generator in dashboard)
app.post('/katha/save', (req, res) => {
  try {
    const { scriptureId, unitId, lang, content, ts } = req.body;
    if (!scriptureId || !unitId || !lang || !content) return res.status(400).json({ error: 'Missing fields' });
    if (content.length < 10) return res.status(400).json({ error: 'Content too short' });
    const filename = `${scriptureId}_${unitId}_${lang}.json`;
    const filepath = path.join(KATHA_DIR, filename);

    let verseCount = 0;
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      verseCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {}

    writeJSON(filepath, { scriptureId, unitId, lang, content, verseCount, ts: ts || Date.now(), savedAt: new Date().toISOString() });
    console.log(`[Katha] Saved: ${filename} (${verseCount} verses)`);
    res.json({ success: true, saved: filename, verseCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── SSE: LIVE GENERATION LOG ─────────────────────────────────────
// Admin dashboard connects here to get real-time verse-by-verse logs
app.get('/admin/katha/stream/:jobId', adminAuth, (req, res) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.set(jobId, res);
  console.log(`[SSE] Client connected for job: ${jobId}`);

  req.on('close', () => {
    sseClients.delete(jobId);
    console.log(`[SSE] Client disconnected: ${jobId}`);
  });
});

function sseLog(jobId, msg, type = 'info') {
  const client = sseClients.get(jobId);
  if (client) {
    try { client.write(`data: ${JSON.stringify({ msg, type, ts: new Date().toLocaleTimeString() })}\n\n`); } catch {}
  }
}

function sseDone(jobId, summary) {
  const client = sseClients.get(jobId);
  if (client) {
    try {
      client.write(`data: ${JSON.stringify({ msg: summary, type: 'done', ts: new Date().toLocaleTimeString() })}\n\n`);
      client.write('data: {"type":"end"}\n\n');
      setTimeout(() => { sseClients.delete(jobId); }, 2000);
    } catch {}
  }
}

// ─── VERSE-BY-VERSE AI GENERATION ────────────────────────────────
// Called by admin dashboard. Generates 1 verse at a time, saves immediately.
// Priority: Gemini FIRST → Groq FALLBACK

async function callGeminiVerse(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
      }),
    });
    clearTimeout(timer);
    if (res.status === 429) throw new Error('RATE_LIMIT_429');
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const d = await res.json();
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini empty response');
    return text;
  } catch(e) { clearTimeout(timer); throw e; }
}

async function callGroqVerse(apiKey, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1, max_tokens: 2000,
      }),
    });
    clearTimeout(timer);
    if (res.status === 429) throw new Error('RATE_LIMIT_429');
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    const d = await res.json();
    const text = d?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq empty response');
    return text;
  } catch(e) { clearTimeout(timer); throw e; }
}

// Try Gemini first, Groq fallback
async function callAI(geminiKey, groqKey, prompt) {
  // GEMINI FIRST
  if (geminiKey) {
    try {
      const text = await callGeminiVerse(geminiKey, prompt);
      return { text, usedApi: 'gemini' };
    } catch(e) {
      if (e.message.includes('RATE_LIMIT')) {
        console.log('[AI] Gemini rate limited — waiting 15s before Groq');
        await new Promise(r => setTimeout(r, 15000));
      }
      console.log('[AI] Gemini failed:', e.message, '→ trying Groq');
    }
  }
  // GROQ FALLBACK
  if (groqKey) {
    try {
      const text = await callGroqVerse(groqKey, prompt);
      return { text, usedApi: 'groq' };
    } catch(e) {
      throw new Error('Both APIs failed. Last error: ' + e.message);
    }
  }
  throw new Error('No API keys provided');
}

function buildVersePrompt(scriptureId, chN, chTitle, verseN, lang) {
  const isH = lang === 'hindi';
  const langRule = isH
    ? 'ALL explanation fields must be in PURE HINDI (Devanagari). Sanskrit stays in Devanagari. ZERO English words in explanations.'
    : 'ALL explanation fields must be in CLEAR ENGLISH. Sanskrit stays in Devanagari script.';

  return `You are a Vedic scholar following Gita Press Gorakhpur tradition.
${langRule}
CRITICAL: Return ONLY a single valid JSON object. No markdown. No extra text. Start with { end with }

Generate Bhagavad Gita Chapter ${chN} (${chTitle}), Verse ${verseN}.

The JSON object MUST have EXACTLY these fields:
{
  "verse_id": "${chN}.${verseN}",
  "chapter": ${chN},
  "verse_number": ${verseN},
  "sanskrit_full": "Complete Devanagari Sanskrit — BOTH lines of the shloka — never truncate",
  "roman_transliteration": "Both lines in Roman script with diacritics",
  "word_meanings_grid": [{"word": "Sanskrit word", "meaning": "${isH ? 'Hindi' : 'English'} meaning", "significance": "brief context"}],
  "tika_${isH ? 'hindi' : 'english'}": "3-4 sentences Gita Press style meaning in ${isH ? 'Hindi' : 'English'}",
  "teaching": "1 practical ${isH ? 'Hindi' : 'English'} sentence connecting to daily life today",
  "gahan_drishti": "Rishi speaks warmly to the reader in ${isH ? 'Hindi' : 'English'} — 2-3 sentences of deep insight",
  "bal_seekh": "2-line simple ${isH ? 'Hindi' : 'English'} moral for a 10-year-old",
  "speaker": "Krishna or Sanjaya or Arjuna",
  "chapter_context": "1 sentence explaining where this verse falls in the chapter narrative"
}

Return ONLY the JSON object for verse ${chN}.${verseN}. Start with {`;
}

function parseVerseJSON(raw, chN, verseN) {
  let cleaned = raw.trim()
    .replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
    .replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    // Ensure required fields
    if (!parsed.verse_id) parsed.verse_id = `${chN}.${verseN}`;
    if (!parsed.verse_number) parsed.verse_number = verseN;
    if (!parsed.chapter) parsed.chapter = chN;
    return parsed;
  } catch { return null; }
}

// ─── MAIN GENERATION ENDPOINT ────────────────────────────────────
// Verse-by-verse, saves each immediately, streams logs via SSE
app.post('/admin/katha/generate', adminAuth, async (req, res) => {
  const { scriptureId, unitId, lang, totalVerses, chapterTitle, geminiKey, groqKey, mode, jobId } = req.body;

  if (!scriptureId || !unitId || !lang) return res.status(400).json({ error: 'Missing fields' });
  if (!geminiKey && !groqKey) return res.status(400).json({ error: 'Need at least one API key' });

  const chN   = parseInt(unitId);
  const total = parseInt(totalVerses) || 47;
  const title = chapterTitle || `Chapter ${chN}`;
  const job   = jobId || `${scriptureId}_${chN}_${lang}_${Date.now()}`;

  // Load existing verses
  const filename = `${scriptureId}_${unitId}_${lang}.json`;
  const filepath = path.join(KATHA_DIR, filename);
  let existingVerses = [];
  const existingIds  = new Set();

  if (fs.existsSync(filepath)) {
    try {
      const stored = readJSON(filepath, null);
      if (stored?.content) {
        const parsed = typeof stored.content === 'string' ? JSON.parse(stored.content) : stored.content;
        if (Array.isArray(parsed)) {
          existingVerses = parsed;
          parsed.forEach(v => {
            const n = v.verse_number || parseInt((v.verse_id || '0.0').split('.')[1]);
            if (n) existingIds.add(n);
          });
        }
      }
    } catch {}
  }

  // Which verses need generating?
  const missing = [];
  for (let i = 1; i <= total; i++) {
    if (!existingIds.has(i)) missing.push(i);
  }

  // Respond immediately — generation runs async
  res.json({
    success: true,
    jobId: job,
    total,
    existing: existingVerses.length,
    toGenerate: missing.length,
    message: missing.length === 0
      ? 'All verses already generated!'
      : `Starting generation of ${missing.length} verses. Connect to /admin/katha/stream/${job} for live log.`,
  });

  if (missing.length === 0) return;

  // ── ASYNC GENERATION ──────────────────────────────────────────
  (async () => {
    let allVerses = [...existingVerses];
    let generated = 0, failed = 0;

    sseLog(job, `Starting: ${scriptureId} Ch${chN} (${title}) | ${missing.length} verses | Lang: ${lang}`, 'info');
    sseLog(job, `API Priority: ${geminiKey ? 'Gemini FIRST' : ''} ${groqKey ? '→ Groq fallback' : ''}`, 'info');

    for (let idx = 0; idx < missing.length; idx++) {
      const verseN = missing[idx];
      sseLog(job, `Generating verse ${chN}.${verseN} (${idx + 1}/${missing.length})...`, 'info');

      let attempts = 0;
      let verse = null;

      while (attempts < 3 && !verse) {
        attempts++;
        try {
          const prompt  = buildVersePrompt(scriptureId, chN, title, verseN, lang);
          const { text, usedApi } = await callAI(geminiKey, groqKey, prompt);
          verse = parseVerseJSON(text, chN, verseN);

          if (verse) {
            sseLog(job, `✅ ${chN}.${verseN} saved via ${usedApi.toUpperCase()}`, 'ok');
            // Add to array and IMMEDIATELY save to disk
            allVerses = allVerses.filter(v => {
              const n = v.verse_number || parseInt((v.verse_id || '').split('.')[1]);
              return n !== verseN;
            });
            allVerses.push(verse);
            allVerses.sort((a, b) => {
              const na = a.verse_number || parseInt((a.verse_id || '').split('.')[1]) || 0;
              const nb = b.verse_number || parseInt((b.verse_id || '').split('.')[1]) || 0;
              return na - nb;
            });
            writeJSON(filepath, {
              scriptureId, unitId: chN, lang,
              content: JSON.stringify(allVerses),
              verseCount: allVerses.length,
              ts: Date.now(),
              savedAt: new Date().toISOString(),
            });
            generated++;
          } else {
            sseLog(job, `Parse failed for ${chN}.${verseN}, attempt ${attempts}`, 'err');
            if (attempts < 3) await new Promise(r => setTimeout(r, 3000));
          }
        } catch (e) {
          sseLog(job, `Error verse ${chN}.${verseN} (attempt ${attempts}): ${e.message}`, 'err');
          if (e.message.includes('429') || e.message.includes('RATE_LIMIT')) {
            sseLog(job, 'Rate limited — waiting 30s...', 'wait');
            await new Promise(r => setTimeout(r, 30000));
          } else {
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      }

      if (!verse) {
        failed++;
        sseLog(job, `⚠️ Skipping verse ${chN}.${verseN} after 3 failed attempts`, 'err');
      }

      // Gap between verses to avoid rate limits (only if not last)
      if (idx < missing.length - 1 && verse) {
        sseLog(job, `Waiting 8s before next verse...`, 'wait');
        await new Promise(r => setTimeout(r, 8000));
      }
    }

    const summary = `Complete! Generated: ${generated}/${missing.length} | Failed: ${failed} | Total cached: ${allVerses.length}/${total}`;
    console.log(`[Katha] ${summary}`);
    sseDone(job, summary);
  })().catch(e => {
    console.error('[Katha Gen Error]', e);
    sseLog(job, 'Fatal error: ' + e.message, 'err');
    sseDone(job, 'Generation stopped due to error: ' + e.message);
  });
});

// ─── CHECK STATUS ─────────────────────────────────────────────────
app.get('/admin/katha/status/:scriptureId/:unitId/:lang', adminAuth, (req, res) => {
  const { scriptureId, unitId, lang } = req.params;
  const filename = `${scriptureId}_${unitId}_${lang}.json`;
  const filepath = path.join(KATHA_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.json({ exists: false, verseCount: 0 });
  }
  const data = readJSON(filepath, {});
  let verseCount = data.verseCount || 0;
  if (!verseCount && data.content) {
    try {
      const arr = typeof data.content === 'string' ? JSON.parse(data.content) : data.content;
      verseCount = Array.isArray(arr) ? arr.length : 0;
    } catch {}
  }
  res.json({ exists: true, verseCount, savedAt: data.savedAt });
});

// ─── ADMIN DELETE KATHA ────────────────────────────────────────────
app.delete('/admin/katha/:scriptureId/:unitId/:lang', adminAuth, (req, res) => {
  const { scriptureId, unitId, lang } = req.params;
  const filename = `${scriptureId}_${unitId}_${lang}.json`;
  const filepath = path.join(KATHA_DIR, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  res.json({ success: true, deleted: filename });
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════
app.post('/payment/create-order', async (req, res) => {
  try {
    const { type, planId, donationId, amount, currency = 'INR', userId } = req.body;
    const mockOrder = { id: `order_${Date.now()}`, amount: amount * 100, currency, type, planId, donationId, userId, created_at: Date.now() };
    TRANSACTIONS.push({ ...mockOrder, status: 'created' });
    res.json({ success: true, order: mockOrder });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/payment/webhook', (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const txn = TRANSACTIONS.find(t => t.id === payment.order_id);
      if (txn) {
        txn.status = 'paid'; txn.paymentId = payment.id; txn.paidAt = new Date().toISOString();
        if (txn.type === 'donation' && txn.donationId) {
          const camp = CONFIG.donations.find(d => d.id === txn.donationId);
          if (camp) { camp.raised += (payment.amount / 100); writeJSON(CONFIG_FILE, CONFIG); }
        }
      }
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════
app.get('/admin/config', adminAuth, (req, res) => res.json({ success: true, config: CONFIG }));

app.post('/admin/config', adminAuth, (req, res) => {
  const allowed = ['premiumPrice','basicPrice','nriPrice','freeQuestionsLimit','freeFactCheckLimit',
    'maintenanceMode','kathaVaultEnabled','factCheckEnabled','debateEnabled','mantraVerifyEnabled',
    'peaceModeEnabled','donationEnabled','appVersion'];
  allowed.forEach(k => { if (req.body[k] !== undefined) CONFIG[k] = req.body[k]; });
  CONFIG.lastUpdated = new Date().toISOString();
  writeJSON(CONFIG_FILE, CONFIG);
  res.json({ success: true, config: CONFIG });
});

app.post('/admin/bundles', adminAuth, (req, res) => {
  CONFIG.bundles = req.body.bundles;
  CONFIG.lastUpdated = new Date().toISOString();
  writeJSON(CONFIG_FILE, CONFIG);
  res.json({ success: true, bundles: CONFIG.bundles });
});

app.post('/admin/donations', adminAuth, (req, res) => {
  CONFIG.donations = req.body.donations;
  CONFIG.lastUpdated = new Date().toISOString();
  writeJSON(CONFIG_FILE, CONFIG);
  res.json({ success: true, donations: CONFIG.donations });
});

app.post('/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { title, type, topics, trustLevel, textContent } = req.body;
    const file = req.file;
    let rawText = textContent || '';

    if (file) {
      const name = file.originalname.toLowerCase();
      if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.json') || file.mimetype.includes('text')) {
        rawText = file.buffer.toString('utf-8');
      } else {
        rawText = `[Binary file: ${file.originalname}]`;
      }
    }

    if (!rawText || rawText.length < 5) return res.status(400).json({ error: 'No content provided' });

    const chunks = [];
    for (let i = 0; i < rawText.length; i += 2000) chunks.push({ index: chunks.length, text: rawText.slice(i, i + 2000) });

    const entry = {
      id: `upload_${Date.now()}`,
      title: title || file?.originalname || 'Untitled',
      type: type || 'text',
      topics: topics ? topics.split(',').map(t => t.trim()).filter(Boolean) : [],
      trustLevel: trustLevel || 'high',
      chunks, chunkCount: chunks.length,
      summary: rawText.slice(0, 300) + (rawText.length > 300 ? '...' : ''),
      charCount: rawText.length,
      active: true, processed: true,
      uploadedAt: new Date().toISOString(),
    };

    UPLOADS.push(entry);
    writeJSON(UPLOADS_FILE, UPLOADS);
    res.json({ success: true, upload: { id: entry.id, title: entry.title, chunkCount: chunks.length, charCount: rawText.length } });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/uploads', adminAuth, (req, res) => {
  res.json({ success: true, uploads: UPLOADS.map(u => ({
    id: u.id, title: u.title, type: u.type, chunkCount: u.chunkCount,
    charCount: u.charCount, active: u.active, uploadedAt: u.uploadedAt, topics: u.topics,
  }))});
});

app.patch('/admin/uploads/:id', adminAuth, (req, res) => {
  const u = UPLOADS.find(u => u.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.body.active !== undefined) u.active = req.body.active;
  writeJSON(UPLOADS_FILE, UPLOADS);
  res.json({ success: true });
});

app.delete('/admin/uploads/:id', adminAuth, (req, res) => {
  const idx = UPLOADS.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  UPLOADS.splice(idx, 1);
  writeJSON(UPLOADS_FILE, UPLOADS);
  res.json({ success: true });
});

app.get('/admin/stats', adminAuth, (req, res) => {
  const kathaFiles = fs.readdirSync(KATHA_DIR).filter(f => f.endsWith('.json')).length;
  res.json({ success: true, stats: {
    activeUploads: UPLOADS.filter(u => u.active).length,
    totalUploads: UPLOADS.length,
    totalTransactions: TRANSACTIONS.length,
    paidTransactions: TRANSACTIONS.filter(t => t.status === 'paid').length,
    totalRevenue: TRANSACTIONS.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount / 100), 0),
    donationRaised: CONFIG.donations.reduce((s, d) => s + (d.raised || 0), 0),
    kathaChaptersCached: kathaFiles,
    config: CONFIG,
  }});
});

app.get('/admin/transactions', adminAuth, (req, res) => {
  res.json({ success: true, transactions: TRANSACTIONS.slice(-100) });
});

app.listen(PORT, () => {
  console.log(`\n🕉 DharmaSetu Backend v4 — port ${PORT}`);
  console.log(`   https://dharmasetu-backend-2c65.onrender.com`);
  console.log(`   Katha chapters cached: ${fs.readdirSync(KATHA_DIR).length}`);
  console.log(`   Uploads: ${UPLOADS.length}\n`);
});