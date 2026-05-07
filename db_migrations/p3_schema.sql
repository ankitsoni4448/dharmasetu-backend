-- ════════════════════════════════════════════════════════════════
-- DharmaSetu P3 — Security & Session Schema
-- FILE: db_migrations/p3_schema.sql
-- Run in: Supabase → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── 1. INVALIDATED SESSIONS (JWT blacklist) ──────────────────────
-- Stores JTIs of logged-out tokens so they can't be reused.
-- Row auto-expires after 35 days (matches JWT lifetime).
CREATE TABLE IF NOT EXISTS invalidated_sessions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  jti        TEXT NOT NULL UNIQUE,
  phone      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_jti ON invalidated_sessions(jti);

-- Auto-cleanup: delete expired entries (35 days)
-- Run this periodically from admin or as a Supabase scheduled job:
-- DELETE FROM invalidated_sessions WHERE created_at < NOW() - INTERVAL '35 days';

-- ── 2. PREMIUM EXPIRY COLUMN on users table ──────────────────────
-- Adds server-side premium expiry to prevent infinite free premium.
-- Safe to run even if column already exists (IF NOT EXISTS guard).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS premium_expiry    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_source    TEXT; -- 'upi' | 'razorpay' | 'admin'

-- ── 3. ERROR LOGS TABLE (for server-side error tracking) ─────────
CREATE TABLE IF NOT EXISTS error_logs (
  id         TEXT PRIMARY KEY,
  source     TEXT,
  message    TEXT,
  details    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);

-- ── 4. BOOK VIEWS & FAVORITES (P2 tables — safe re-run) ─────────
CREATE TABLE IF NOT EXISTS book_views (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id    UUID REFERENCES dharmic_books(id) ON DELETE CASCADE,
  phone      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_favorites (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id    UUID REFERENCES dharmic_books(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, phone)
);

-- ── 5. PUSH NOTIFICATIONS LOG ────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_notifications (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  target_group TEXT DEFAULT 'all',   -- 'all' | 'premium' | 'free'
  status       TEXT DEFAULT 'sent',
  sent_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. MARKETING COUPONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  discount_pct   INTEGER NOT NULL CHECK (discount_pct BETWEEN 1 AND 100),
  max_uses       INTEGER,
  uses_count     INTEGER DEFAULT 0,
  expiry_date    DATE,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS POLICIES (Row Level Security) ────────────────────────────
-- Enable RLS on sensitive tables. The backend uses service key
-- which bypasses RLS, but this prevents direct Supabase client abuse.

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invalidated_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback          ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_answers     ENABLE ROW LEVEL SECURITY;

-- Public read for books (frontend fetches without auth)
ALTER TABLE dharmic_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Public read books"
  ON dharmic_books FOR SELECT USING (is_active = true);

-- ── VERIFICATION ─────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
