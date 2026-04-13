// DharmaSetu — Railway Backend
// Connects Admin Dashboard ↔ App
// Deploy at: https://railway.app (free tier)
// URL becomes: https://dharmasetu-backend.up.railway.app
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory config store (use Railway's Redis or a JSON file for persistence)
// For production add a real database — for launch this works perfectly
let CONFIG = {
  premiumPrice: 249,
  freeQuestionsLimit: 3,
  maintenanceMode: false,
  kathaVaultEnabled: true,
  factCheckEnabled: true,
  sevaEnabled: true,
  aiModel: 'llama-3.3-70b-versatile',
  appVersion: '1.0.0',
  lastUpdated: new Date().toISOString(),
};

// Uploaded content store (in-memory for now, add Supabase later)
let UPLOADS = [];
let USERS = []; // will be populated from Firebase in production

// ── MIDDLEWARE ──────────────────────────────────────
app.use(cors({ origin: '*' })); // allow app and admin dashboard
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// File upload setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Simple admin auth (change this password before launch!)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DharmaSetu@2025';
function adminAuth(req, res, next) {
  const auth = req.headers['x-admin-key'] || req.query.key;
  if (auth !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── PUBLIC ENDPOINTS (app reads these) ─────────────

// App fetches config on startup
app.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      premiumPrice: CONFIG.premiumPrice,
      freeQuestionsLimit: CONFIG.freeQuestionsLimit,
      maintenanceMode: CONFIG.maintenanceMode,
      kathaVaultEnabled: CONFIG.kathaVaultEnabled,
      factCheckEnabled: CONFIG.factCheckEnabled,
      sevaEnabled: CONFIG.sevaEnabled,
      appVersion: CONFIG.appVersion,
    }
  });
});

// App fetches uploaded content (PDFs, books processed for AI)
app.get('/content', (req, res) => {
  const active = UPLOADS.filter(u => u.active && u.processed);
  res.json({
    success: true,
    content: active.map(u => ({
      id: u.id,
      title: u.title,
      type: u.type,
      topics: u.topics,
      summary: u.summary, // AI-processed summary
      chunks: u.chunks,   // Text chunks for AI context
    }))
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── ADMIN ENDPOINTS (protected) ────────────────────

// Get all config
app.get('/admin/config', adminAuth, (req, res) => {
  res.json({ success: true, config: CONFIG });
});

// Update config (admin dashboard saves here)
app.post('/admin/config', adminAuth, (req, res) => {
  const updates = req.body;
  CONFIG = { ...CONFIG, ...updates, lastUpdated: new Date().toISOString() };
  console.log('[Admin] Config updated:', updates);
  res.json({ success: true, config: CONFIG });
});

// Upload content (PDF, audio transcript, text, CSV)
app.post('/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { title, type, topics, trustLevel } = req.body;
    const file = req.file;

    if (!file && !req.body.textContent) {
      return res.status(400).json({ error: 'No file or text content provided' });
    }

    let rawText = '';
    if (req.body.textContent) {
      rawText = req.body.textContent;
    } else if (file) {
      // For text files and transcripts
      if (file.mimetype.includes('text') || file.originalname.endsWith('.txt') || file.originalname.endsWith('.csv')) {
        rawText = file.buffer.toString('utf-8');
      } else if (file.originalname.endsWith('.json')) {
        rawText = JSON.stringify(JSON.parse(file.buffer.toString('utf-8')), null, 2);
      } else {
        // PDF and audio — in production use pdf-parse and Whisper
        // For now, store as base64 and process later
        rawText = `[File: ${file.originalname} — ${file.size} bytes. Process with pdf-parse or Whisper AI.]`;
      }
    }

    // Split into chunks for AI context (500 tokens ≈ 2000 chars)
    const chunks = [];
    const chunkSize = 2000;
    for (let i = 0; i < rawText.length; i += chunkSize) {
      chunks.push(rawText.slice(i, i + chunkSize));
    }

    const uploadEntry = {
      id: `upload_${Date.now()}`,
      title: title || file?.originalname || 'Untitled',
      type: type || file?.mimetype || 'text',
      topics: topics ? topics.split(',').map(t => t.trim()) : [],
      trustLevel: trustLevel || 'high',
      rawText: rawText.slice(0, 10000), // store first 10k chars
      chunks,
      chunkCount: chunks.length,
      fileSize: file?.size || rawText.length,
      active: true,
      processed: true,
      summary: rawText.slice(0, 500) + (rawText.length > 500 ? '...' : ''),
      uploadedAt: new Date().toISOString(),
    };

    UPLOADS.push(uploadEntry);
    console.log('[Admin] Upload:', uploadEntry.title, `(${chunks.length} chunks)`);

    res.json({
      success: true,
      upload: {
        id: uploadEntry.id,
        title: uploadEntry.title,
        chunkCount: chunks.length,
        status: 'active',
      }
    });
  } catch (err) {
    console.error('[Upload error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all uploads
app.get('/admin/uploads', adminAuth, (req, res) => {
  res.json({ success: true, uploads: UPLOADS.map(u => ({
    id: u.id, title: u.title, type: u.type,
    chunkCount: u.chunkCount, active: u.active,
    uploadedAt: u.uploadedAt,
  }))});
});

// Toggle upload active/inactive
app.patch('/admin/uploads/:id', adminAuth, (req, res) => {
  const upload = UPLOADS.find(u => u.id === req.params.id);
  if (!upload) return res.status(404).json({ error: 'Not found' });
  if (req.body.active !== undefined) upload.active = req.body.active;
  res.json({ success: true, upload });
});

// Delete upload
app.delete('/admin/uploads/:id', adminAuth, (req, res) => {
  const idx = UPLOADS.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  UPLOADS.splice(idx, 1);
  res.json({ success: true });
});

// Stats (demo data — connect Firebase for real data)
app.get('/admin/stats', adminAuth, (req, res) => {
  res.json({
    success: true,
    stats: {
      totalUsers: USERS.length || 0,
      activeUploads: UPLOADS.filter(u => u.active).length,
      config: CONFIG,
      serverUptime: process.uptime(),
    }
  });
});

// ── START ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🕉 DharmaSetu Backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Config: http://localhost:${PORT}/config`);
  console.log(`   Admin: http://localhost:${PORT}/admin/config (requires x-admin-key header)\n`);
});