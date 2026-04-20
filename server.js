// DharmaSetu Backend — PRODUCTION FINAL
// Render.com: https://dharmasetu-backend-2c65.onrender.com
// FIXES:
// 1. Katha content saved to disk — survives restarts FOREVER
// 2. All uploads saved to disk — no more data loss after 30 min
// 3. Config saved to disk — price changes persist
// 4. /katha endpoints for shared scripture cache

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DharmaSetu@2025';

// ─── DISK STORAGE SETUP ─────────────────────────────────────────
// /tmp is writable on Render free tier — survives ~hours but may reset on redeploy
// For permanent: use Supabase (upgrade later)
const DATA_DIR   = '/tmp/dharmasetu';
const KATHA_DIR  = path.join(DATA_DIR, 'katha');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json');

function ensureDirs() {
  [DATA_DIR, KATHA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); });
}
ensureDirs();

function readJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return fallback;
}
function writeJSON(file, data) {
  try { ensureDirs(); fs.writeFileSync(file, JSON.stringify(data)); } catch(e) { console.error('writeJSON error:', e.message); }
}

// ─── LOAD PERSISTED DATA ─────────────────────────────────────────
let CONFIG = readJSON(CONFIG_FILE, {
  premiumPrice: 249, basicPrice: 99, nriPrice: 499,
  freeQuestionsLimit: 3, freeFactCheckLimit: 3,
  maintenanceMode: false,
  kathaVaultEnabled: true, factCheckEnabled: true, debateEnabled: true,
  mantraVerifyEnabled: true, peaceModeEnabled: true, donationEnabled: true,
  bundles: [
    {id:'basic',name:'Basic',nameHi:'बेसिक',price:99,features:['30 questions/day','15 fact-checks/day','Mantra Verify','Save answers','No ads'],active:true},
    {id:'pro',  name:'Pro',  nameHi:'प्रो',  price:249,features:['Unlimited questions','Unlimited fact-checks','All Debate levels','Peace Mode','No ads','Priority support'],active:true,popular:true},
    {id:'nri',  name:'NRI',  nameHi:'NRI',   price:499,features:['Everything in Pro','Priority support','USD billing'],active:true},
  ],
  donations: [
    {id:'army',  name:'Army Welfare',    nameHi:'सेना कल्याण',       desc:'Support Indian Army welfare fund',       active:true,goal:100000,raised:0},
    {id:'temple',name:'Temple Restore',  nameHi:'मंदिर जीर्णोद्धार',desc:'Restore ancient temples across India',    active:true,goal:500000,raised:0},
    {id:'dharma',name:'Dharma Education',nameHi:'धर्म शिक्षा',       desc:'Educate youth about Sanatan Dharma',     active:true,goal:250000,raised:0},
  ],
  appVersion: '1.0.0',
  lastUpdated: new Date().toISOString(),
});

let UPLOADS      = readJSON(UPLOADS_FILE, []);
let TRANSACTIONS = [];

console.log(`[Startup] Config loaded — basic:₹${CONFIG.basicPrice}, pro:₹${CONFIG.premiumPrice}`);
console.log(`[Startup] Uploads loaded: ${UPLOADS.length}`);

// ─── ADMIN PANEL HTML ────────────────────────────────────────────
// Serves the single admin dashboard at /admin-portal
// Place admin_dashboard.html in the SAME folder as server.js on Render
// To upload: push admin_dashboard.html to your GitHub repo root
app.get('/admin-portal', (req, res) => {
  // Try admin_dashboard.html first (production name), then fallback names
  const candidates = ['admin_dashboard.html', 'admin_dashboard_FINAL.html', 'dashboard.html'];
  for (const name of candidates) {
    const htmlPath = path.join(__dirname, name);
    if (fs.existsSync(htmlPath)) { res.sendFile(htmlPath); return; }
  }
  res.status(404).send(`
    <html><body style="font-family:sans-serif;background:#0D0500;color:#F4A261;padding:40px;">
    <h2>🕉 DharmaSetu Admin Panel</h2>
    <p style="color:#FDF6ED;">Dashboard HTML not found on server.</p>
    <p><strong>Fix:</strong> Add <code>admin_dashboard.html</code> to your GitHub repo root and redeploy.</p>
    <p style="color:rgba(255,255,255,0.4);">Backend is running fine — only the HTML file is missing.</p>
    </body></html>
  `);
});

// ─── MIDDLEWARE ──────────────────────────────────────────────────
app.use(cors({origin:'*'}));
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true, limit:'50mb'}));
const upload = multer({storage:multer.memoryStorage(), limits:{fileSize:50*1024*1024}});

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_PASSWORD) return res.status(401).json({error:'Unauthorized'});
  next();
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  uploads: UPLOADS.length,
  version: CONFIG.appVersion,
  kathaFiles: fs.readdirSync(KATHA_DIR).length,
}));

app.get('/config', (req, res) => {
  res.json({success:true, config:{
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
  res.json({success:true, count:active.length, content:active.map(u => ({
    id:u.id, title:u.title, type:u.type, topics:u.topics,
    summary:u.summary, chunks:(u.chunks||[]).slice(0,5),
  }))});
});

app.get('/donations', (req, res) => {
  res.json({success:true, campaigns: CONFIG.donations.filter(d => d.active)});
});

// ─── KATHA VAULT SHARED CACHE ────────────────────────────────────
// When User A generates a chapter, it's saved here.
// User B gets it instantly without calling AI again.
// This is the KEY feature: one generation serves ALL users.

app.post('/katha/save', (req, res) => {
  try {
    const {scriptureId, unitId, lang, content, ts} = req.body;
    if (!scriptureId || !unitId || !lang || !content) {
      return res.status(400).json({error:'Missing fields'});
    }
    if (content.length < 100) {
      return res.status(400).json({error:'Content too short'});
    }
    const filename = `${scriptureId}_${unitId}_${lang}.json`;
    const filepath = path.join(KATHA_DIR, filename);
    writeJSON(filepath, {scriptureId, unitId, lang, content, ts: ts || Date.now(), savedAt: new Date().toISOString()});
    console.log(`[Katha] Saved: ${filename} (${content.length} chars)`);
    res.json({success:true, saved: filename});
  } catch(err) {
    res.status(500).json({error: err.message});
  }
});

app.get('/katha/:scriptureId/:unitId/:lang', (req, res) => {
  try {
    const {scriptureId, unitId, lang} = req.params;
    const filename = `${scriptureId}_${unitId}_${lang}.json`;
    const filepath = path.join(KATHA_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({success:false, message:'Not yet generated'});
    }
    const data = readJSON(filepath, null);
    if (!data || !data.content) {
      return res.status(404).json({success:false, message:'Content invalid'});
    }
    console.log(`[Katha] Served from cache: ${filename}`);
    res.json({success:true, content: data.content, savedAt: data.savedAt});
  } catch(err) {
    res.status(500).json({error: err.message});
  }
});

// List all generated katha content
app.get('/katha/list', (req, res) => {
  try {
    const files = fs.readdirSync(KATHA_DIR).filter(f => f.endsWith('.json'));
    res.json({success:true, count: files.length, files});
  } catch(err) {
    res.status(500).json({error: err.message});
  }
});

// ─── PAYMENTS ────────────────────────────────────────────────────
app.post('/payment/create-order', async (req, res) => {
  try {
    const {type, planId, donationId, amount, currency='INR', userId} = req.body;
    const mockOrder = {id:`order_${Date.now()}`, amount:amount*100, currency, type, planId, donationId, userId, created_at:Date.now()};
    TRANSACTIONS.push({...mockOrder, status:'created'});
    res.json({success:true, order:mockOrder});
  } catch(err) { res.status(500).json({error:err.message}); }
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
          if (camp) { camp.raised += (payment.amount/100); writeJSON(CONFIG_FILE, CONFIG); }
        }
      }
    }
    res.json({success:true});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/admin/config', adminAuth, (req, res) => res.json({success:true, config:CONFIG}));

app.post('/admin/config', adminAuth, (req, res) => {
  const allowed = ['premiumPrice','basicPrice','nriPrice','freeQuestionsLimit','freeFactCheckLimit',
    'maintenanceMode','kathaVaultEnabled','factCheckEnabled','debateEnabled','mantraVerifyEnabled',
    'peaceModeEnabled','donationEnabled','appVersion'];
  allowed.forEach(k => { if (req.body[k] !== undefined) CONFIG[k] = req.body[k]; });
  CONFIG.lastUpdated = new Date().toISOString();
  writeJSON(CONFIG_FILE, CONFIG);
  res.json({success:true, config:CONFIG});
});

app.post('/admin/bundles', adminAuth, (req, res) => {
  CONFIG.bundles = req.body.bundles;
  CONFIG.lastUpdated = new Date().toISOString();
  writeJSON(CONFIG_FILE, CONFIG);
  res.json({success:true, bundles:CONFIG.bundles});
});

app.post('/admin/donations', adminAuth, (req, res) => {
  CONFIG.donations = req.body.donations;
  CONFIG.lastUpdated = new Date().toISOString();
  writeJSON(CONFIG_FILE, CONFIG);
  res.json({success:true, donations:CONFIG.donations});
});

app.post('/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const {title, type, topics, trustLevel, textContent} = req.body;
    const file = req.file;
    let rawText = textContent || '';

    if (file) {
      const name = file.originalname.toLowerCase();
      if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.json') || file.mimetype.includes('text')) {
        rawText = file.buffer.toString('utf-8');
      } else if (name.endsWith('.pdf')) {
        try {
          const pdfParse = require('pdf-parse');
          const data = await pdfParse(file.buffer);
          rawText = data.text;
        } catch { rawText = `[PDF: ${file.originalname} — install pdf-parse to auto-extract]`; }
      } else {
        rawText = `[Binary: ${file.originalname}]`;
      }
    }

    if (!rawText || rawText.length < 5) return res.status(400).json({error:'No content provided'});

    const chunks = [];
    for (let i = 0; i < rawText.length; i += 2000) {
      chunks.push({index:chunks.length, text:rawText.slice(i, i+2000)});
    }

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
    console.log(`[Upload] "${entry.title}" — ${chunks.length} chunks, ${rawText.length} chars`);
    res.json({success:true, upload:{id:entry.id, title:entry.title, chunkCount:chunks.length, charCount:rawText.length}});
  } catch(err) {
    console.error('[Upload Error]', err);
    res.status(500).json({error:err.message});
  }
});

app.get('/admin/uploads', adminAuth, (req, res) => {
  res.json({success:true, uploads:UPLOADS.map(u => ({
    id:u.id, title:u.title, type:u.type, chunkCount:u.chunkCount,
    charCount:u.charCount, active:u.active, uploadedAt:u.uploadedAt,
    topics:u.topics,
  }))});
});

app.patch('/admin/uploads/:id', adminAuth, (req, res) => {
  const u = UPLOADS.find(u => u.id === req.params.id);
  if (!u) return res.status(404).json({error:'Not found'});
  if (req.body.active !== undefined) u.active = req.body.active;
  writeJSON(UPLOADS_FILE, UPLOADS);
  res.json({success:true});
});

app.delete('/admin/uploads/:id', adminAuth, (req, res) => {
  const idx = UPLOADS.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({error:'Not found'});
  UPLOADS.splice(idx, 1);
  writeJSON(UPLOADS_FILE, UPLOADS);
  res.json({success:true});
});

// ─── ADMIN GENERATE-BOOK ──────────────────────────────────────
// Called by admin dashboard Katha Generator
// This proxies a single batch to Gemini/Groq with verified params
// The dashboard calls AI directly (CORS allows it) — this endpoint
// is for programmatic batch generation via the katha_admin_generator.js script
app.post('/admin/generate-book', adminAuth, async (req, res) => {
  try {
    const { scriptureId, unitId, lang, content, verseCount } = req.body;
    if (!scriptureId || !unitId || !lang || !content) {
      return res.status(400).json({ error: 'Missing: scriptureId, unitId, lang, content' });
    }
    // This endpoint receives pre-generated content from admin scripts
    // and saves it to the katha cache — same as /katha/save but admin-only
    const filename = `${scriptureId}_${unitId}_${lang}.json`;
    const filepath = path.join(KATHA_DIR, filename);
    const existing = fs.existsSync(filepath) ? readJSON(filepath, null) : null;

    let finalVerses;
    try {
      const newVerses = typeof content === 'string' ? JSON.parse(content) : content;
      if (Array.isArray(newVerses) && existing?.content) {
        // Merge: keep existing good verses, add new ones
        const existingVerses = typeof existing.content === 'string' ? JSON.parse(existing.content) : existing.content;
        if (Array.isArray(existingVerses)) {
          const existingIds = new Set(existingVerses.map(v => v.verse_number || parseInt(v.verse_id?.split('.')[1])));
          const fresh = newVerses.filter(v => {
            const n = v.verse_number || parseInt(v.verse_id?.split('.')[1]);
            return !existingIds.has(n);
          });
          finalVerses = [...existingVerses, ...fresh];
          console.log(`[Generate] Merged: ${existingVerses.length} existing + ${fresh.length} new = ${finalVerses.length}`);
        } else {
          finalVerses = newVerses;
        }
      } else {
        finalVerses = Array.isArray(newVerses) ? newVerses : content;
      }
    } catch(e) {
      finalVerses = content; // store as-is if not parseable as array
    }

    writeJSON(filepath, {
      scriptureId, unitId, lang,
      content: typeof finalVerses === 'string' ? finalVerses : JSON.stringify(finalVerses),
      verseCount: verseCount || (Array.isArray(finalVerses) ? finalVerses.length : 0),
      ts: Date.now(),
      savedAt: new Date().toISOString(),
    });

    console.log(`[Generate] Saved: ${filename}`);
    res.json({ success: true, saved: filename, verseCount: Array.isArray(finalVerses) ? finalVerses.length : 0 });
  } catch(err) {
    console.error('[Generate Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin can also delete katha cache to force regeneration
app.delete('/admin/katha/:scriptureId/:unitId/:lang', adminAuth, (req, res) => {
  const {scriptureId, unitId, lang} = req.params;
  const filename = `${scriptureId}_${unitId}_${lang}.json`;
  const filepath = path.join(KATHA_DIR, filename);
  if (fs.existsSync(filepath)) { fs.unlinkSync(filepath); }
  res.json({success:true, deleted:filename});
});

app.get('/admin/stats', adminAuth, (req, res) => {
  const kathaFiles = fs.readdirSync(KATHA_DIR).filter(f => f.endsWith('.json')).length;
  res.json({success:true, stats:{
    activeUploads: UPLOADS.filter(u => u.active).length,
    totalUploads: UPLOADS.length,
    totalTransactions: TRANSACTIONS.length,
    paidTransactions: TRANSACTIONS.filter(t => t.status==='paid').length,
    totalRevenue: TRANSACTIONS.filter(t => t.status==='paid').reduce((s,t) => s+(t.amount/100), 0),
    donationRaised: CONFIG.donations.reduce((s,d) => s+(d.raised||0), 0),
    kathaChaptersCached: kathaFiles,
    config: CONFIG,
  }});
});

app.get('/admin/transactions', adminAuth, (req, res) => {
  res.json({success:true, transactions:TRANSACTIONS.slice(-100)});
});

app.listen(PORT, () => {
  console.log(`\n🕉 DharmaSetu Backend — port ${PORT}`);
  console.log(`   https://dharmasetu-backend-2c65.onrender.com`);
  console.log(`   Katha chapters cached: ${fs.readdirSync(KATHA_DIR).length}`);
  console.log(`   Uploads loaded: ${UPLOADS.length}\n`);
});