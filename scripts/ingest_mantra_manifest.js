#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const https = require('https');
const path = require('path');
const {
  normalizeMantra,
  validateMantraManifest,
} = require('./manifest_utils');
const { getSupabaseServiceRoleKey } = require('./supabase_service_role');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function sbRequest(body) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const { key: SUPABASE_SERVICE_ROLE_KEY, source } = getSupabaseServiceRoleKey();
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');
  const data = JSON.stringify(body);
  const opts = {
    hostname: SUPABASE_URL.replace('https://', ''),
    path: '/rest/v1/mantra_catalog?on_conflict=id',
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
      'Content-Length': Buffer.byteLength(data),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const grantHint = res.statusCode === 403 && raw.includes('permission denied')
            ? ' Run db_migrations/p6_service_role_ingestion_grants.sql in Supabase SQL Editor.'
            : '';
          return reject(new Error(`mantra_catalog ${res.statusCode} using ${source}: ${raw}${grantHint}`));
        }
        resolve(raw);
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const manifestPath = arg('manifest');
  if (!manifestPath) throw new Error('Usage: node scripts/ingest_mantra_manifest.js --manifest path/to/mantra_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
  const errors = validateMantraManifest(manifest);
  if (errors.length) throw new Error(errors.join('\n'));

  const rows = manifest.items.map(normalizeMantra);
  for (const row of rows) await sbRequest(row);
  console.log(`Ingested mantras=${rows.length}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
