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

function sbRequest({ method = 'GET', pathSuffix = '?select=*', body }) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const { key: SUPABASE_SERVICE_ROLE_KEY, source } = getSupabaseServiceRoleKey();
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');
  const endpoint = new URL(SUPABASE_URL);
  const data = body == null ? '' : JSON.stringify(body);
  const opts = {
    hostname: endpoint.hostname,
    port: endpoint.port || undefined,
    path: `/rest/v1/mantra_catalog${pathSuffix}`,
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };
  if (method === 'POST') opts.headers.Prefer = 'return=minimal,resolution=merge-duplicates';
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const raw = decodeResponseChunks(chunks);
        if (res.statusCode >= 400) {
          const grantHint = res.statusCode === 403 && raw.includes('permission denied')
            ? ' Run db_migrations/p6_service_role_ingestion_grants.sql in Supabase SQL Editor.'
            : '';
          return reject(new Error(`mantra_catalog ${res.statusCode} using ${source}: ${raw}${grantHint}`));
        }
        resolve(raw ? JSON.parse(raw) : null);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function decodeResponseChunks(chunks) {
  return Buffer.concat(chunks).toString('utf8');
}

function canonical(value) {
  if (value == null || value === '') return undefined;
  if (Array.isArray(value)) {
    if (!value.length) return undefined;
    return value.map(item => canonical(item) ?? null);
  }
  if (typeof value === 'object') {
    const normalized = Object.keys(value).sort().reduce((out, key) => {
      const item = canonical(value[key]);
      if (item !== undefined) out[key] = item;
      return out;
    }, {});
    return Object.keys(normalized).length ? normalized : undefined;
  }
  return value;
}

function comparable(row) {
  const clean = {};
  Object.keys(row).filter(key => key !== 'updated_at' && key !== 'created_at').forEach(key => { clean[key] = row[key]; });
  return JSON.stringify(canonical(clean));
}

function differingFields(target, current) {
  return Object.keys(target)
    .filter(key => key !== 'updated_at' && key !== 'created_at')
    .filter(key => JSON.stringify(canonical(target[key])) !== JSON.stringify(canonical(current[key])));
}

function planMantraImport(rows, existingRows = []) {
  const existing = new Map(existingRows.map(row => [row.id, row]));
  const inserts = [], updates = [], skipped = [];
  rows.forEach(row => {
    const current = existing.get(row.id);
    if (!current) inserts.push(row);
    else {
      const selectedCurrent = Object.keys(row).reduce((out, key) => { if (key in current) out[key] = current[key]; return out; }, {});
      if (comparable(row) === comparable(selectedCurrent)) skipped.push(row);
      else updates.push(row);
    }
  });
  return { inserts, updates, skipped, duplicates: rows.length - new Set(rows.map(row => row.id)).size };
}

async function main() {
  const manifestPath = arg('manifest');
  if (!manifestPath) throw new Error('Usage: node scripts/ingest_mantra_manifest.js --manifest path/to/mantra_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
  const errors = validateMantraManifest(manifest);
  if (errors.length) throw new Error(errors.join('\n'));

  const rows = manifest.items.map(normalizeMantra);
  const existingRows = await sbRequest({ method:'GET', pathSuffix:'?select=*' }) || [];
  const plan = planMantraImport(rows, existingRows);
  if (plan.duplicates) throw new Error(`Duplicate normalized IDs: ${plan.duplicates}`);
  const changed = [...plan.inserts, ...plan.updates].map(row => ({ ...row, updated_at:new Date().toISOString() }));
  if (changed.length) await sbRequest({ method:'POST', pathSuffix:'?on_conflict=id', body:changed });
  console.log(`Mantra import inserted=${plan.inserts.length} updated=${plan.updates.length} skipped=${plan.skipped.length} duplicates=${plan.duplicates}`);
}

if (require.main === module) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

module.exports = { canonical, comparable, decodeResponseChunks, differingFields, planMantraImport, sbRequest };
