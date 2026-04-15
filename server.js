// DharmaSetu Backend — Render.com
// URL: https://dharmasetu-backend-2c65.onrender.com
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DharmaSetu@2025';

// ── PERSISTENT STORAGE (in-memory, survives restarts via init)
// In production: swap these with a real DB like Supabase
let CONFIG = {
  // Pricing
  premiumPrice: 249,
  basicPrice: 99,
  nriPrice: 499,
  // Feature flags
  freeQuestionsLimit: 3,
  freeFactCheckLimit: 3,
  maintenanceMode: false,
  kathaVaultEnabled: true,
  factCheckEnabled: true,
  debateEnabled: true,
  mantraVerifyEnabled: true,
  peaceModeEnabled: true,
  donationEnabled: true,
  // Subscription bundles
  bundles: [
    { id:'basic', name:'Basic', nameHi:'बेसिक', price:99, features:['30 questions/day','15 fact-checks/day','Mantra Verify','Save answers'], active:true },
    { id:'pro',   name:'Pro',   nameHi:'प्रो',   price:249, features:['Unlimited questions','Unlimited fact-checks','All Debate levels','Peace Mode','Voice Persona (coming)'], active:true },
    { id:'nri',   name:'NRI',   nameHi:'NRI',    price:499, features:['Everything in Pro','Priority support','USD billing'], active:true },
  ],
  // Donation campaigns
  donations: [
    { id:'army',    name:'Army Welfare',    nameHi:'सेना कल्याण',       desc:'Support Indian Army welfare fund', active:true,  goal:100000, raised:0 },
    { id:'temple',  name:'Temple Restore',  nameHi:'मंदिर जीर्णोद्धार', desc:'Restore ancient temples in India', active:true,  goal:500000, raised:0 },
    { id:'dharma',  name:'Dharma Education',nameHi:'धर्म शिक्षा',        desc:'Educate youth about Sanatan Dharma',active:true, goal:250000, raised:0 },
  ],
  appVersion: '1.0.0',
  lastUpdated: new Date().toISOString(),
};

let UPLOADS = [];
let TRANSACTIONS = [];

// ── MIDDLEWARE
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — App reads these on startup
// ════════════════════════════════════════════════════

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// App startup config fetch
app.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      premiumPrice: CONFIG.premiumPrice,
      basicPrice: CONFIG.basicPrice,
      nriPrice: CONFIG.nriPrice,
      freeQuestionsLimit: CONFIG.freeQuestionsLimit,
      freeFactCheckLimit: CONFIG.freeFactCheckLimit,
      maintenanceMode: CONFIG.maintenanceMode,
      kathaVaultEnabled: CONFIG.kathaVaultEnabled,
      factCheckEnabled: CONFIG.factCheckEnabled,
      debateEnabled: CONFIG.debateEnabled,
      mantraVerifyEnabled: CONFIG.mantraVerifyEnabled,
      peaceModeEnabled: CONFIG.peaceModeEnabled,
      donationEnabled: CONFIG.donationEnabled,
      bundles: CONFIG.bundles.filter(b => b.active),
      donations: CONFIG.donations.filter(d => d.active),
      appVersion: CONFIG.appVersion,
    }
  });
});

// App fetches uploaded knowledge content
app.get('/content', (req, res) => {
  const active = UPLOADS.filter(u => u.active && u.processed);
  res.json({
    success: true,
    count: active.length,
    content: active.map(u => ({
      id: u.id, title: u.title, type: u.type,
      topics: u.topics, summary: u.summary, chunks: u.chunks,
    }))
  });
});

// Get donation campaigns for app display
app.get('/donations', (req, res) => {
  res.json({ success: true, campaigns: CONFIG.donations.filter(d => d.active) });
});

// ════════════════════════════════════════════════════
// PAYMENT ENDPOINTS
// ════════════════════════════════════════════════════

// Razorpay order creation (called from app when user taps Subscribe/Donate)
app.post('/payment/create-order', async (req, res) => {
  try {
    const { type, planId, donationId, amount, currency = 'INR', userId } = req.body;

    // In production: call Razorpay API here
    // const Razorpay = require('razorpay');
    // const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    // const order = await razorpay.orders.create({ amount: amount * 100, currency, receipt: `receipt_${Date.now()}` });

    // For now — mock order (replace with real Razorpay call before launch)
    const mockOrder = {
      id: `order_${Date.now()}`,
      amount: amount * 100, // paise
      currency,
      type, // 'subscription' or 'donation'
      planId, donationId, userId,
      created_at: Date.now(),
    };

    // Log transaction
    TRANSACTIONS.push({ ...mockOrder, status: 'created' });

    res.json({ success: true, order: mockOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment verification webhook (Razorpay calls this after payment)
app.post('/payment/webhook', (req, res) => {
  try {
    const event = req.body;
    console.log('[Payment webhook]', event.event, event.payload?.payment?.entity?.id);

    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const txn = TRANSACTIONS.find(t => t.id === payment.order_id);
      if (txn) {
        txn.status = 'paid';
        txn.paymentId = payment.id;
        txn.paidAt = new Date().toISOString();
        // If donation — update raised amount
        if (txn.type === 'donation' && txn.donationId) {
          const camp = CONFIG.donations.find(d => d.id === txn.donationId);
          if (camp) camp.raised += (payment.amount / 100);
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════
// ADMIN ENDPOINTS — Protected
// ════════════════════════════════════════════════════

// Get full config
app.get('/admin/config', adminAuth, (req, res) => res.json({ success: true, config: CONFIG }));

// Update config (admin dashboard saves here)
app.post('/admin/config', adminAuth, (req, res) => {
  const allowed = ['premiumPrice','basicPrice','nriPrice','freeQuestionsLimit','freeFactCheckLimit',
    'maintenanceMode','kathaVaultEnabled','factCheckEnabled','debateEnabled','mantraVerifyEnabled',
    'peaceModeEnabled','donationEnabled','appVersion'];
  allowed.forEach(key => { if (req.body[key] !== undefined) CONFIG[key] = req.body[key]; });
  CONFIG.lastUpdated = new Date().toISOString();
  res.json({ success: true, config: CONFIG });
});

// Manage subscription bundles
app.post('/admin/bundles', adminAuth, (req, res) => {
  CONFIG.bundles = req.body.bundles;
  CONFIG.lastUpdated = new Date().toISOString();
  res.json({ success: true, bundles: CONFIG.bundles });
});

// Manage donation campaigns
app.post('/admin/donations', adminAuth, (req, res) => {
  CONFIG.donations = req.body.donations;
  CONFIG.lastUpdated = new Date().toISOString();
  res.json({ success: true, donations: CONFIG.donations });
});

// Upload content (PDF text, CSV, audio transcript, text)
app.post('/admin/upload', adminAuth, upload.single('file'), (req, res) => {
  try {
    const { title, type, topics, trustLevel, textContent } = req.body;
    const file = req.file;
    let rawText = textContent || '';

    if (file) {
      const name = file.originalname.toLowerCase();
      if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.json') || file.mimetype.includes('text')) {
        rawText = file.buffer.toString('utf-8');
      } else {
        rawText = `[Binary file: ${file.originalname}, size: ${file.size} bytes — process separately with pdf-parse/Whisper]`;
      }
    }

    if (!rawText) return res.status(400).json({ error: 'No content provided' });

    // Chunk into 2000-char pieces for AI context
    const chunks = [];
    for (let i = 0; i < rawText.length; i += 2000) {
      chunks.push({ index: chunks.length, text: rawText.slice(i, i + 2000) });
    }

    const entry = {
      id: `upload_${Date.now()}`,
      title: title || file?.originalname || 'Untitled',
      type: type || 'text',
      topics: topics ? topics.split(',').map(t => t.trim()) : [],
      trustLevel: trustLevel || 'high',
      chunks, chunkCount: chunks.length,
      summary: rawText.slice(0, 300) + (rawText.length > 300 ? '...' : ''),
      active: true, processed: true,
      uploadedAt: new Date().toISOString(),
    };

    UPLOADS.push(entry);
    res.json({ success: true, upload: { id: entry.id, title: entry.title, chunkCount: chunks.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List uploads
app.get('/admin/uploads', adminAuth, (req, res) => {
  res.json({ success: true, uploads: UPLOADS.map(u => ({ id: u.id, title: u.title, type: u.type, chunkCount: u.chunkCount, active: u.active, uploadedAt: u.uploadedAt })) });
});

// Toggle upload
app.patch('/admin/uploads/:id', adminAuth, (req, res) => {
  const u = UPLOADS.find(u => u.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.body.active !== undefined) u.active = req.body.active;
  res.json({ success: true });
});

// Delete upload
app.delete('/admin/uploads/:id', adminAuth, (req, res) => {
  const idx = UPLOADS.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  UPLOADS.splice(idx, 1);
  res.json({ success: true });
});

// Stats
app.get('/admin/stats', adminAuth, (req, res) => {
  res.json({
    success: true,
    stats: {
      activeUploads: UPLOADS.filter(u => u.active).length,
      totalTransactions: TRANSACTIONS.length,
      paidTransactions: TRANSACTIONS.filter(t => t.status === 'paid').length,
      totalRevenue: TRANSACTIONS.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount / 100), 0),
      donationRaised: CONFIG.donations.reduce((s, d) => s + d.raised, 0),
      config: CONFIG,
    }
  });
});

// All transactions
app.get('/admin/transactions', adminAuth, (req, res) => {
  res.json({ success: true, transactions: TRANSACTIONS.slice(-100) }); // last 100
});

app.listen(PORT, () => {
  console.log(`\n🕉 DharmaSetu Backend running on port ${PORT}`);
  console.log(`   URL: https://dharmasetu-backend-2c65.onrender.com\n`);
});