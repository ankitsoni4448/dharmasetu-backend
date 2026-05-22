#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  normalizeContentItem,
  normalizeSource,
  validateContentManifest,
} = require('./manifest_utils');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function fetchDriveFiles(folderId, apiKey) {
  if (!folderId || !apiKey) return [];
  const files = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,md5Checksum,webViewLink,thumbnailLink,createdTime,modifiedTime)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function main() {
  const inputPath = arg('input');
  const outPath = arg('out', 'content_manifest.generated.json');
  const source = normalizeSource({
    id: arg('source-id'),
    title: arg('title', 'Drive Content Source'),
    sourceType: 'drive_folder',
    sourceUrl: arg('source-url'),
    driveFolderId: arg('drive-folder'),
    category: arg('category', 'other'),
    language: arg('language', 'mixed'),
  });

  const rawItems = inputPath
    ? JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'))
    : await fetchDriveFiles(source.drive_folder_id, process.env.GOOGLE_DRIVE_API_KEY);

  const items = rawItems.map(item => {
    const normalized = normalizeContentItem({
      ...item,
      fileUrl: item.webViewLink,
      thumbnailUrl: item.thumbnailLink,
      fileSizeBytes: item.size,
    }, source);
    return {
      id: normalized.id,
      title: normalized.title,
      author: normalized.author,
      source: normalized.source,
      language: normalized.language,
      category: normalized.category,
      subCategory: normalized.sub_category,
      description: normalized.description,
      tags: normalized.tags ? normalized.tags.split(',') : [],
      contentType: normalized.content_type,
      fileUrl: normalized.file_url,
      driveFileId: normalized.drive_file_id,
      thumbnailUrl: normalized.thumbnail_url,
      fileSizeBytes: normalized.file_size_bytes,
      offlineManifestUrl: normalized.offline_manifest_url,
      checksum: normalized.checksum,
      scriptureGroup: normalized.sub_category,
    };
  });

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      id: source.id,
      title: source.title,
      sourceType: source.source_type,
      sourceUrl: source.source_url,
      driveFolderId: source.drive_folder_id,
      category: source.category,
      language: source.language,
    },
    counts: {
      total: items.length,
      byContentType: items.reduce((acc, item) => {
        acc[item.contentType] = (acc[item.contentType] || 0) + 1;
        return acc;
      }, {}),
    },
    items,
  };

  const errors = validateContentManifest(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(manifest, null, 2));
  console.log(`Manifest written: ${outPath} (${items.length} items)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
