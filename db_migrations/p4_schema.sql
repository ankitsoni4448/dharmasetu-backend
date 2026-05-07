-- ════════════════════════════════════════════════════════════════
-- DharmaSetu — P4 Database Migration
-- FILE: db_migrations/p4_schema.sql
--
-- Safe to run on existing P3 production database.
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════

-- ── 1. PUSH TOKENS (on users table) ─────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token_at  TIMESTAMPTZ;

-- ── 2. ANALYTICS EVENTS TABLE ────────────────────────────────────
-- Phase 1: stores client-flushed event batches server-side
CREATE TABLE IF NOT EXISTS analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  anon_id     TEXT          NOT NULL,
  event       TEXT          NOT NULL,
  props       JSONB         DEFAULT '{}',
  platform    TEXT          DEFAULT 'android',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index for querying by event type and date
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_anon       ON analytics_events (anon_id, created_at DESC);

-- ── 3. BOOK PROGRESS TABLE ───────────────────────────────────────
-- Stores server-side reading progress per user (backup for local)
CREATE TABLE IF NOT EXISTS book_progress (
  id          BIGSERIAL PRIMARY KEY,
  user_phone  TEXT          NOT NULL,
  book_id     UUID          NOT NULL REFERENCES dharmic_books(id) ON DELETE CASCADE,
  chapter     INT           DEFAULT 0,
  page        INT           DEFAULT 0,
  pct         FLOAT         DEFAULT 0,  -- 0.0 to 1.0
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(user_phone, book_id)
);

CREATE INDEX IF NOT EXISTS idx_book_progress_user ON book_progress (user_phone, updated_at DESC);

-- ── 4. FAVOURITE SCRIPTURES TABLE ────────────────────────────────
CREATE TABLE IF NOT EXISTS favourite_scriptures (
  id          BIGSERIAL PRIMARY KEY,
  user_phone  TEXT          NOT NULL,
  book_id     UUID          NOT NULL REFERENCES dharmic_books(id) ON DELETE CASCADE,
  fav_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(user_phone, book_id)
);

CREATE INDEX IF NOT EXISTS idx_fav_scripts_user ON favourite_scriptures (user_phone);

-- ── 5. BOOK TAGS COLUMN ──────────────────────────────────────────
ALTER TABLE dharmic_books ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '';

-- ── 6. JAPA SESSIONS TABLE (backend backup) ──────────────────────
CREATE TABLE IF NOT EXISTS japa_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_phone  TEXT          NOT NULL,
  mantra_id   TEXT          NOT NULL,
  mantra_name TEXT          DEFAULT '',
  count       INT           NOT NULL DEFAULT 0,
  duration_ms BIGINT        DEFAULT 0,
  session_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_japa_sessions_user ON japa_sessions (user_phone, session_at DESC);

-- ── 7. VOICE TRANSCRIPTIONS LOG (optional) ───────────────────────
CREATE TABLE IF NOT EXISTS voice_transcriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_phone  TEXT,
  lang        TEXT          DEFAULT 'hi-IN',
  source      TEXT          DEFAULT 'whisper',  -- 'whisper' | 'fallback'
  success     BOOLEAN       DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── 8. ROW LEVEL SECURITY ────────────────────────────────────────
-- Allow users to read their own progress
ALTER TABLE book_progress        ENABLE ROW LEVEL SECURITY;
ALTER TABLE favourite_scriptures ENABLE ROW LEVEL SECURITY;
ALTER TABLE japa_sessions        ENABLE ROW LEVEL SECURITY;

-- Service-role policies (backend uses service role key — bypasses RLS)
-- These are placeholder policies; actual enforcement is via backend auth
CREATE POLICY IF NOT EXISTS "service_read_book_progress"
  ON book_progress FOR ALL
  USING (true);

CREATE POLICY IF NOT EXISTS "service_read_favourites"
  ON favourite_scriptures FOR ALL
  USING (true);

CREATE POLICY IF NOT EXISTS "service_read_japa"
  ON japa_sessions FOR ALL
  USING (true);

-- ── 9. APPROVED ANSWERS: ADD LANG COLUMN ─────────────────────────
ALTER TABLE approved_answers ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'hindi';

-- ── VERIFY ───────────────────────────────────────────────────────
-- Run this to confirm migration success:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('analytics_events','book_progress','favourite_scriptures','japa_sessions');
