-- Additive storage for the structured Mantra V2 catalog. No content is seeded.
ALTER TABLE mantra_catalog
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS canonical_name TEXT,
  ADD COLUMN IF NOT EXISTS names JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mantra_content_type TEXT NOT NULL DEFAULT 'MANTRA',
  ADD COLUMN IF NOT EXISTS deity_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS category_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS purpose_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS transliteration_iast TEXT,
  ADD COLUMN IF NOT EXISTS transliteration_simple TEXT,
  ADD COLUMN IF NOT EXISTS word_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS meanings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tradition TEXT,
  ADD COLUMN IF NOT EXISTS sampradaya TEXT,
  ADD COLUMN IF NOT EXISTS practice_level TEXT NOT NULL DEFAULT 'GENERAL_DEVOTIONAL',
  ADD COLUMN IF NOT EXISTS instructions_scope TEXT,
  ADD COLUMN IF NOT EXISTS requires_initiation BOOLEAN,
  ADD COLUMN IF NOT EXISTS restriction_note TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS practice JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS audio_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tags_v2 TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_mantra_catalog_v2_filters
ON mantra_catalog (is_active, verification_status, mantra_content_type, practice_level);

CREATE INDEX IF NOT EXISTS idx_mantra_catalog_v2_deities
ON mantra_catalog USING gin (deity_ids);

CREATE INDEX IF NOT EXISTS idx_mantra_catalog_v2_purposes
ON mantra_catalog USING gin (purpose_ids);
