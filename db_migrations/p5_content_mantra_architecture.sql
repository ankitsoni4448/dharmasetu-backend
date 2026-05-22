-- DharmaSetu P5 content architecture.
-- Safe additive migration for KathaVault, Drive ingestion, and 200+ mantra scale.

-- 1. Drive/content source registry. Stores metadata only, not large files.
CREATE TABLE IF NOT EXISTS content_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'drive_folder',
  source_url TEXT NOT NULL,
  drive_folder_id TEXT,
  category TEXT DEFAULT 'other',
  language TEXT DEFAULT 'mixed',
  ingestion_status TEXT NOT NULL DEFAULT 'pending_manifest',
  last_ingested_at TIMESTAMPTZ,
  manifest_url TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_sources_active
ON content_sources (is_active, category);

-- 2. Extend existing book metadata for search, offline prep, and Drive provenance.
ALTER TABLE dharmic_books
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'drive_file',
ADD COLUMN IF NOT EXISTS source_id TEXT REFERENCES content_sources(id),
ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'pdf',
ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'all',
ADD COLUMN IF NOT EXISTS search_text TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS offline_manifest_url TEXT,
ADD COLUMN IF NOT EXISTS checksum TEXT,
ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_books_source_id
ON dharmic_books (source_id);

CREATE INDEX IF NOT EXISTS idx_books_search_text
ON dharmic_books USING gin (to_tsvector('simple', coalesce(search_text, '')));

-- 3. Katha chapter metadata separates searchable chapter info from verse rows.
CREATE TABLE IF NOT EXISTS katha_chapters (
  id TEXT PRIMARY KEY,
  scripture_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'hindi',
  chapter_title TEXT,
  category TEXT DEFAULT 'scripture',
  source_id TEXT REFERENCES content_sources(id),
  verse_count INTEGER DEFAULT 0,
  generated_count INTEGER DEFAULT 0,
  search_text TEXT DEFAULT '',
  offline_ready BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scripture_id, unit_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_katha_chapters_lookup
ON katha_chapters (scripture_id, unit_id, lang);

CREATE INDEX IF NOT EXISTS idx_katha_chapters_search
ON katha_chapters USING gin (to_tsvector('simple', coalesce(search_text, '')));

-- 4. Mantra catalog table for verified 200+ records.
CREATE TABLE IF NOT EXISTS mantra_catalog (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  deity TEXT NOT NULL DEFAULT 'Universal',
  purpose TEXT NOT NULL DEFAULT 'daily_sadhana',
  language TEXT NOT NULL DEFAULT 'sanskrit',
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  scripture_source TEXT DEFAULT 'traditional',
  sanskrit_text TEXT NOT NULL,
  transliteration TEXT DEFAULT '',
  meaning_hi TEXT DEFAULT '',
  meaning_en TEXT DEFAULT '',
  audio_url TEXT DEFAULT '',
  audio_downloadable BOOLEAN NOT NULL DEFAULT true,
  offline_pack_id TEXT DEFAULT 'core_mantras_v1',
  search_text TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mantra_catalog_filters
ON mantra_catalog (is_active, deity, purpose, language, difficulty, scripture_source);

CREATE INDEX IF NOT EXISTS idx_mantra_catalog_search
ON mantra_catalog USING gin (to_tsvector('simple', coalesce(search_text, '')));

-- 5. Seed source registry. Safe upsert; no file crawling is attempted here.
INSERT INTO content_sources (id, title, source_type, source_url, drive_folder_id, category, language)
VALUES
  ('sanatan_granth_1', 'Sanatan Granth 1', 'drive_folder', 'https://drive.google.com/drive/folders/1ON1J2MeyN0nj4SRHBzH6gXqIG85w6jNB?usp=drive_link', '1ON1J2MeyN0nj4SRHBzH6gXqIG85w6jNB', 'other', 'mixed'),
  ('sanatan_granth_2', 'Sanatan Granth 2', 'drive_folder', 'https://drive.google.com/drive/folders/1Hf4ufz1w_d8iLOjGYfPgVE4vtdLzRAVx?usp=drive_link', '1Hf4ufz1w_d8iLOjGYfPgVE4vtdLzRAVx', 'other', 'mixed'),
  ('vishnu_sahasranam_course', 'Vishnu Sahasranam Full Course', 'drive_folder', 'https://drive.google.com/drive/folders/1KRVLrFliErgqseogu4GHEM67zwOZUOJ4?usp=drive_link', '1KRVLrFliErgqseogu4GHEM67zwOZUOJ4', 'courses', 'mixed'),
  ('additional_dharmic_content', 'Additional Dharmic Content', 'drive_folder', 'https://drive.google.com/drive/folders/1-XXBzjjLAd6H65Kl63dIKHaN1UIzfDW9', '1-XXBzjjLAd6H65Kl63dIKHaN1UIzfDW9', 'other', 'mixed')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  source_url = EXCLUDED.source_url,
  drive_folder_id = EXCLUDED.drive_folder_id,
  category = EXCLUDED.category,
  language = EXCLUDED.language,
  updated_at = now();
