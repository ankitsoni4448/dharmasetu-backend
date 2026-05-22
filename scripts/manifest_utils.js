const crypto = require('crypto');

const CONTENT_TYPES = [
  ['application/pdf', 'pdf'],
  ['audio/', 'audio'],
  ['video/', 'video'],
  ['image/', 'image'],
];

const CATEGORY_HINTS = [
  ['gita', 'gita'],
  ['geeta', 'gita'],
  ['upanishad', 'upanishads'],
  ['ramayan', 'ramayana'],
  ['ramayana', 'ramayana'],
  ['mahabharat', 'mahabharata'],
  ['purana', 'puranas'],
  ['veda', 'vedas'],
  ['stotra', 'stotras'],
  ['sahasranam', 'stotras'],
  ['course', 'courses'],
];

const DEITY_HINTS = ['Shiva', 'Vishnu', 'Krishna', 'Rama', 'Hanuman', 'Ganesh', 'Durga', 'Lakshmi', 'Saraswati', 'Surya', 'Devi'];
const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);

function slug(input, fallback = 'item') {
  const clean = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return clean || `${fallback}_${crypto.createHash('sha1').update(String(input || Date.now())).digest('hex').slice(0, 8)}`;
}

function compactText(parts) {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function inferCategory(text = '') {
  const t = text.toLowerCase();
  const hit = CATEGORY_HINTS.find(([needle]) => t.includes(needle));
  return hit ? hit[1] : 'other';
}

function inferLanguage(text = '') {
  const t = text.toLowerCase();
  if (t.includes('hindi') || t.includes('हिंदी')) return 'hindi';
  if (t.includes('sanskrit') || t.includes('संस्कृत')) return 'sanskrit';
  if (t.includes('english')) return 'english';
  return 'mixed';
}

function inferContentType(item = {}) {
  const mime = item.mimeType || item.mime_type || '';
  const name = item.name || item.title || '';
  const mapped = CONTENT_TYPES.find(([needle]) => mime.includes(needle));
  if (mapped) return mapped[1];
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(mp3|m4a|wav|aac)$/i.test(name)) return 'audio';
  if (/\.(mp4|mov|mkv)$/i.test(name)) return 'video';
  return 'file';
}

function driveViewUrl(fileId) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : '';
}

function normalizeContentItem(raw = {}, source = {}) {
  const title = raw.title || raw.name || 'Untitled';
  const driveFileId = raw.driveFileId || raw.id || '';
  const category = raw.category || source.category || inferCategory(`${title} ${raw.description || ''}`);
  const language = raw.language || source.language || inferLanguage(`${title} ${raw.description || ''}`);
  const tags = Array.isArray(raw.tags) ? raw.tags : String(raw.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  return {
    id: raw.id && raw.id !== driveFileId ? raw.id : `bk_${slug(`${source.id || 'src'}_${driveFileId || title}`)}`,
    title,
    title_hindi: raw.titleHindi || raw.title_hindi || '',
    title_sanskrit: raw.titleSanskrit || raw.title_sanskrit || '',
    author: raw.author || '',
    source: raw.source || source.title || '',
    language,
    category,
    sub_category: raw.subCategory || raw.sub_category || raw.scriptureGroup || '',
    description: raw.description || '',
    description_hindi: raw.descriptionHindi || raw.description_hindi || '',
    tags: tags.join(','),
    page_count: Number(raw.pageCount || raw.page_count || 0) || null,
    file_url: raw.fileUrl || raw.file_url || driveViewUrl(driveFileId),
    thumbnail_url: raw.thumbnailUrl || raw.thumbnail_url || '',
    scripture_refs: raw.scriptureRefs || raw.scripture_refs || '',
    source_type: raw.sourceType || 'drive_file',
    source_id: source.id || raw.sourceId || '',
    drive_file_id: driveFileId,
    content_type: raw.contentType || inferContentType(raw),
    difficulty: raw.difficulty || 'all',
    search_text: compactText([title, raw.titleHindi, raw.titleSanskrit, raw.author, source.title, language, category, tags.join(' '), raw.description, raw.scriptureGroup]),
    offline_manifest_url: raw.offlineManifestUrl || '',
    checksum: raw.checksum || raw.md5Checksum || '',
    file_size_bytes: Number(raw.fileSizeBytes || raw.size || 0) || 0,
    is_active: raw.isActive !== false,
    is_premium: raw.isPremium === true,
    updated_at: new Date().toISOString(),
  };
}

function validateContentManifest(manifest = {}) {
  const errors = [];
  if (!manifest.source?.id) errors.push('source.id required');
  if (!manifest.source?.title) errors.push('source.title required');
  if (!Array.isArray(manifest.items)) errors.push('items must be an array');
  (manifest.items || []).forEach((item, i) => {
    if (!item.title && !item.name) errors.push(`items[${i}].title required`);
    if (!item.fileUrl && !item.file_url && !item.driveFileId && !item.id) errors.push(`items[${i}] needs fileUrl or driveFileId`);
  });
  return errors;
}

function normalizeSource(source = {}) {
  return {
    id: source.id || slug(source.title || source.driveFolderId, 'source'),
    title: source.title || 'Untitled Source',
    source_type: source.sourceType || source.source_type || 'drive_folder',
    source_url: source.sourceUrl || source.source_url || '',
    drive_folder_id: source.driveFolderId || source.drive_folder_id || '',
    category: source.category || 'other',
    language: source.language || 'mixed',
    ingestion_status: source.ingestionStatus || source.ingestion_status || 'manifest_ready',
    manifest_url: source.manifestUrl || '',
    updated_at: new Date().toISOString(),
  };
}

function normalizeMantra(raw = {}) {
  const title = raw.title || raw.name || 'Untitled Mantra';
  const deity = raw.deity || DEITY_HINTS.find(d => title.toLowerCase().includes(d.toLowerCase())) || 'Universal';
  const purpose = raw.purpose || (Array.isArray(raw.tags) && raw.tags[0]) || 'daily_sadhana';
  const difficulty = DIFFICULTIES.has(raw.difficulty) ? raw.difficulty : 'beginner';
  return {
    id: raw.id || `mantra_${slug(title)}`,
    title,
    deity,
    purpose,
    language: raw.language || 'sanskrit',
    difficulty,
    scripture_source: raw.scriptureSource || raw.scripture_source || 'traditional',
    sanskrit_text: raw.sanskritText || raw.sanskrit_text || raw.text || '',
    transliteration: raw.transliteration || '',
    meaning_hi: raw.meaningHi || raw.meaning_hi || '',
    meaning_en: raw.meaningEn || raw.meaning_en || '',
    audio_url: raw.audioUrl || raw.audio_url || '',
    audio_downloadable: raw.audioDownloadable !== false,
    offline_pack_id: raw.offlinePackId || raw.offline_pack_id || 'core_mantras_v1',
    search_text: compactText([title, deity, purpose, raw.scriptureSource, raw.sanskritText || raw.text, raw.transliteration, raw.meaningHi, raw.meaningEn, ...(raw.tags || [])]),
    is_active: raw.isActive !== false,
    updated_at: new Date().toISOString(),
  };
}

function validateMantraManifest(manifest = {}) {
  const errors = [];
  if (!Array.isArray(manifest.items)) errors.push('items must be an array');
  (manifest.items || []).forEach((item, i) => {
    if (!item.title && !item.name) errors.push(`items[${i}].title required`);
    if (!item.sanskritText && !item.sanskrit_text && !item.text) errors.push(`items[${i}].sanskritText required`);
  });
  return errors;
}

module.exports = {
  compactText,
  inferCategory,
  inferContentType,
  inferLanguage,
  normalizeContentItem,
  normalizeMantra,
  normalizeSource,
  slug,
  validateContentManifest,
  validateMantraManifest,
};
