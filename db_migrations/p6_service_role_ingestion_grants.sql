-- DharmaSetu P6 — secure ingestion grants.
-- Purpose: allow backend-only service_role ingestion while preserving public READ-only RLS.
-- Run in Supabase SQL Editor after P5 schema.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Public clients may read only through RLS policies.
GRANT SELECT ON TABLE content_sources TO anon, authenticated;
GRANT SELECT ON TABLE dharmic_books TO anon, authenticated;
GRANT SELECT ON TABLE katha_chapters TO anon, authenticated;
GRANT SELECT ON TABLE mantra_catalog TO anon, authenticated;

-- Backend ingestion uses service_role only. No public writes.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE content_sources TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dharmic_books TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE katha_chapters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mantra_catalog TO service_role;

ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE dharmic_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE katha_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE mantra_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_content_sources" ON content_sources;
CREATE POLICY "public_read_content_sources"
ON content_sources
FOR SELECT
TO anon, authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "public_read_dharmic_books" ON dharmic_books;
CREATE POLICY "public_read_dharmic_books"
ON dharmic_books
FOR SELECT
TO anon, authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "public_read_katha_chapters" ON katha_chapters;
CREATE POLICY "public_read_katha_chapters"
ON katha_chapters
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public_read_mantra_catalog" ON mantra_catalog;
CREATE POLICY "public_read_mantra_catalog"
ON mantra_catalog
FOR SELECT
TO anon, authenticated
USING (is_active = true);
