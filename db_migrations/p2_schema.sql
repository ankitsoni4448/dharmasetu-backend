-- ════════════════════════════════════════════════════════════════
-- DharmaSetu P2 — Supabase Database Tables
-- Run each block in Supabase SQL Editor (Dashboard → SQL Editor)
-- ════════════════════════════════════════════════════════════════

-- ── 1. DHARMIC BOOKS ──────────────────────────────────────────
-- Supports 100GB+ library via external file_url (Google Drive → R2 later)
CREATE TABLE IF NOT EXISTS dharmic_books (
  id              TEXT PRIMARY KEY DEFAULT ('bk_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6)),
  title           TEXT NOT NULL,
  title_hindi     TEXT,
  title_sanskrit  TEXT,
  author          TEXT,
  source          TEXT,                      -- e.g. "Gita Press", "BORI"
  language        TEXT NOT NULL DEFAULT 'hindi',
                                             -- 'hindi' | 'english' | 'sanskrit' | 'marathi' | 'gujarati'
  category        TEXT NOT NULL DEFAULT 'other',
                                             -- 'vedas' | 'upanishads' | 'puranas' | 'gita' | 'ramayana'
                                             -- | 'mahabharata' | 'smritis' | 'agamas' | 'stotras' | 'modern' | 'other'
  sub_category    TEXT,
  description     TEXT,
  description_hindi TEXT,
  tags            TEXT,                      -- comma-separated: "krishna,gita,advaita"
  page_count      INTEGER,
  file_url        TEXT,                      -- Google Drive share link (Phase 1), R2 URL (Phase 2)
  thumbnail_url   TEXT,
  scripture_refs  TEXT,                      -- comma-separated references
  indexing_status TEXT NOT NULL DEFAULT 'pending',
                                             -- 'pending' | 'indexed' | 'error'
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_premium      BOOLEAN NOT NULL DEFAULT false,
  downloads       INTEGER NOT NULL DEFAULT 0,
  views           INTEGER NOT NULL DEFAULT 0,
  admin_notes     TEXT,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_language  ON dharmic_books(language);
CREATE INDEX IF NOT EXISTS idx_books_category  ON dharmic_books(category);
CREATE INDEX IF NOT EXISTS idx_books_is_active ON dharmic_books(is_active);

-- ── 2. BOOK VIEWS (for recently viewed / analytics) ───────────
CREATE TABLE IF NOT EXISTS book_views (
  id         TEXT PRIMARY KEY DEFAULT ('bv_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 5)),
  book_id    TEXT REFERENCES dharmic_books(id) ON DELETE CASCADE,
  phone      TEXT,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_book_views_book  ON book_views(book_id);
CREATE INDEX IF NOT EXISTS idx_book_views_phone ON book_views(phone);

-- ── 3. BOOK FAVORITES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_favorites (
  id         TEXT PRIMARY KEY DEFAULT ('bf_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 5)),
  book_id    TEXT REFERENCES dharmic_books(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(book_id, phone)
);

-- ── 4. AI FEEDBACK (expanded from existing feedback table) ────
-- NOTE: The existing 'feedback' table stays intact.
-- This is a richer separate table for moderated AI quality feedback.
CREATE TABLE IF NOT EXISTS ai_feedback (
  id               TEXT PRIMARY KEY DEFAULT ('af_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6)),
  question         TEXT NOT NULL,
  ai_answer        TEXT NOT NULL,
  rating           TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  reason           TEXT,
  phone            TEXT,
  language         TEXT DEFAULT 'hindi',
  -- Admin moderation fields
  admin_reviewed   BOOLEAN NOT NULL DEFAULT false,
  admin_action     TEXT CHECK (admin_action IN ('approved', 'rejected', 'corrected', NULL)),
  admin_notes      TEXT,
  quality_score    FLOAT NOT NULL DEFAULT 0.5,
  -- Approved correction
  approved_answer  TEXT,
  reviewed_at      TIMESTAMPTZ,
  -- Metadata
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_fb_reviewed ON ai_feedback(admin_reviewed);
CREATE INDEX IF NOT EXISTS idx_ai_fb_rating   ON ai_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_ai_fb_created  ON ai_feedback(created_at DESC);

-- ── 5. APPROVED ANSWERS (retrieval-enhancement, no self-training) ──
-- Admin-curated Q&A pairs that improve DharmaChat response quality
-- by being injected as context when semantically similar questions arise.
CREATE TABLE IF NOT EXISTS approved_answers (
  id               TEXT PRIMARY KEY DEFAULT ('aa_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6)),
  question_pattern TEXT NOT NULL,
  approved_answer  TEXT NOT NULL,
  scripture_ref    TEXT,
  language         TEXT DEFAULT 'hindi',
  category         TEXT DEFAULT 'general',  -- 'jyotish'|'gita'|'dharma'|'puja'|'general'
  is_active        BOOLEAN NOT NULL DEFAULT true,
  use_count        INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT DEFAULT 'admin',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approved_lang    ON approved_answers(language);
CREATE INDEX IF NOT EXISTS idx_approved_active  ON approved_answers(is_active);

-- ── 6. AUDIT LOGS (already exists, ensure it does) ────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  action     TEXT,
  admin_user TEXT,
  target     TEXT,
  details    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. ERROR LOGS (already exists, ensure it does) ────────────
CREATE TABLE IF NOT EXISTS error_logs (
  id         TEXT PRIMARY KEY,
  source     TEXT,
  message    TEXT,
  details    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── GRANT PUBLIC READ on books (Supabase RLS) ─────────────────
-- Run if RLS is enabled:
-- ALTER TABLE dharmic_books ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "public_read_books" ON dharmic_books FOR SELECT USING (is_active = true);
