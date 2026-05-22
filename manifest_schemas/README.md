# DharmaSetu Manifest Ingestion

Phase 3 keeps large files in Google Drive/Supabase-managed URLs. The app consumes only searchable metadata.

## Content manifest

Generate from a Drive folder, without downloading files:

```bash
npm run manifest:drive -- --drive-folder <folder_id> --source-id sanatan_granth_1 --title "Sanatan Granth 1" --source-url "https://drive.google.com/drive/folders/<folder_id>" --out manifests/sanatan_granth_1.json
```

Requires `GOOGLE_DRIVE_API_KEY` when reading Drive directly. For manual exports, pass `--input files.json`.

Ingest to Supabase:

```bash
npm run ingest:content -- --manifest manifests/sanatan_granth_1.json
```

If ingestion returns `permission denied for table content_sources`, run
`db_migrations/p6_service_role_ingestion_grants.sql` in the Supabase SQL Editor.
This grants writes only to `service_role`; anon/authenticated remain read-only.

## Mantra manifest

Use `mantra_manifest.schema.json` for verified batches. Ingest:

```bash
npm run ingest:mantras -- --manifest manifests/mantras_batch_001.json
```

Mantra text must be verified before ingestion. The UI should never receive hardcoded 200+ records.
