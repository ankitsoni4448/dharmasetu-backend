'use strict';

require('dotenv').config();
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { ingestDatasets } = require('../utils/panchangEventDataset');
const { getSupabaseServiceRoleKey } = require('./supabase_service_role');

const datasets = [2026, 2027].map(year => require(path.join('..', 'data', 'panchang', 'events', `${year}.json`)));

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = getSupabaseServiceRoleKey({ required: true }).key;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  const result = await ingestDatasets(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), datasets);
  console.log(`[Panchang events] inserted=${result.inserted} updated=${result.updated} content-inserted=${result.contentInserted} content-updated=${result.contentUpdated} skipped=${result.skipped} review-required=${result.reviewRequired}`);
}

if (require.main === module) main().catch(error => { console.error(`[Panchang events] failed: ${error.message}`); process.exitCode = 1; });

module.exports = { main };
