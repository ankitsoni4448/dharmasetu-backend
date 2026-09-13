#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function readFrontendMantras(frontendRoot) {
  const legacySource = fs.readFileSync(path.join(frontendRoot, 'data', 'mantras.js'), 'utf8');
  const legacyContext = { module: { exports: {} } };
  vm.runInNewContext(legacySource.replace(/export const /g, 'const ') + '\nmodule.exports={MANTRAS};', legacyContext);

  const v2Source = fs.readFileSync(path.join(frontendRoot, 'data', 'mantraV2.js'), 'utf8');
  const v2Context = { module: { exports: {} }, MANTRAS: legacyContext.module.exports.MANTRAS, Set };
  vm.runInNewContext(
    v2Source.replace(/^import .*$/m, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ')
      + '\nmodule.exports={MANTRAS_V2,MANTRA_SCHEMA_VERSION,MANTRA_CONTENT_VERSION};',
    v2Context,
  );
  return v2Context.module.exports;
}

function toManifestItem(item) {
  return {
    id: item.id,
    schemaVersion: item.schema_version,
    contentVersion: item.content_version,
    canonicalName: item.canonical_name,
    names: item.names,
    contentType: item.content_type,
    deityIds: item.deity_ids,
    categoryIds: item.category_ids,
    purposeIds: item.purpose_ids,
    sanskritText: item.sanskrit_text,
    transliterationIast: item.transliteration_iast,
    transliterationSimple: item.transliteration_simple,
    wordSegments: item.word_segments,
    meanings: item.meanings,
    sourceReferences: item.source_references,
    tradition: item.tradition,
    sampradaya: item.sampradaya,
    practiceLevel: item.practice_level,
    instructionsScope: item.instructions_scope,
    requiresInitiation: item.requires_initiation,
    restrictionNote: item.restriction_note,
    verificationStatus: item.verification_status,
    reviewedBy: item.reviewed_by,
    reviewedAt: item.reviewed_at,
    practice: item.practice,
    audio: item.audio,
    tags: item.tags,
    searchText: item.search_text,
    isActive: item.is_active,
  };
}

function buildLegacyManifest(frontendRoot = path.resolve(__dirname, '..', '..', 'dharmasetu-app')) {
  const { MANTRAS_V2, MANTRA_SCHEMA_VERSION, MANTRA_CONTENT_VERSION } = readFrontendMantras(frontendRoot);
  return {
    schemaVersion: MANTRA_SCHEMA_VERSION,
    contentVersion: MANTRA_CONTENT_VERSION,
    source: { type: 'legacy_local_review_migration', provenanceVerified: false },
    items: MANTRAS_V2.map(toManifestItem),
  };
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const output = path.resolve(arg('output', path.join(__dirname, '..', 'data', 'mantra', 'legacy_v2_seed.json')));
  const manifest = buildLegacyManifest(arg('frontend-root') || undefined);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Generated ${manifest.items.length} review-required mantras: ${output}`);
}

module.exports = { buildLegacyManifest, toManifestItem };
