-- ════════════════════════════════════════════════════════════════
-- DharmaSetu P3 — Security & Session Schema
-- FIXED VERSION FOR SUPABASE
-- ════════════════════════════════════════════════════════════════

-- ── 1. INVALIDATED SESSIONS (JWT blacklist) ──────────────────────
CREATE TABLE IF NOT EXISTS invalidated_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  jti TEXT NOT NULL UNIQUE,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_sessions_jti
ON invalidated_sessions(jti);

-- ── 2. PREMIUM EXPIRY COLUMNS ────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS premium_expiry TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_source TEXT;

-- ── 3. ERROR LOGS TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY,
  source TEXT,
  message TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created
ON error_logs(created_at DESC);

-- ── 4. BOOK VIEWS TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id UUID REFERENCES dharmic_books(id) ON DELETE CASCADE,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. BOOK FAVORITES TABLE ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id UUID REFERENCES dharmic_books(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, phone)
);

-- ── 6. PUSH NOTIFICATIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_group TEXT DEFAULT 'all',
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. COUPONS TABLE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_pct INTEGER NOT NULL CHECK (discount_pct BETWEEN 1 AND 100),
  max_uses INTEGER,
  uses_count INTEGER DEFAULT 0,
  expiry_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. ENABLE RLS ────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE invalidated_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dharmic_books ENABLE ROW LEVEL SECURITY;

-- ── 9. SAFE PUBLIC READ POLICY ───────────────────────────────────
DROP POLICY IF EXISTS "Public read books" ON dharmic_books;

CREATE POLICY "Public read books"
ON dharmic_books
FOR SELECT
USING (is_active = true);

-- ── 10. VERIFY TABLES ────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;