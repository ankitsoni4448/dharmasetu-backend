'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const ALLOWED_EXTENSIONS = new Set(['.txt', '.csv', '.json', '.pdf']);
const ALLOWED_MIME = new Map([['.txt', new Set(['text/plain'])], ['.csv', new Set(['text/csv', 'application/csv', 'text/plain'])],
  ['.json', new Set(['application/json', 'text/json', 'text/plain'])], ['.pdf', new Set(['application/pdf'])]]);

function safeFilename(value) {
  const base = path.basename(String(value || '')).normalize('NFC').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\.{2,}/g, '.').trim();
  if (!base || base === '.' || base === '..') throw Object.assign(new Error('INVALID_FILE_NAME'), { code: 'INVALID_FILE_NAME' });
  return base.slice(0, 180);
}

function validateUpload(file, maxBytes = 20 * 1024 * 1024) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) throw Object.assign(new Error('FILE_REQUIRED'), { code: 'FILE_REQUIRED' });
  if (file.buffer.length < 1 || file.buffer.length > maxBytes) throw Object.assign(new Error('INVALID_FILE_SIZE'), { code: 'INVALID_FILE_SIZE' });
  const fileName = safeFilename(file.originalname); const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME.get(extension)?.has(String(file.mimetype || '').toLowerCase())) {
    throw Object.assign(new Error('FILE_TYPE_MISMATCH'), { code: 'FILE_TYPE_MISMATCH' });
  }
  if (extension === '.pdf' && file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw Object.assign(new Error('FILE_TYPE_MISMATCH'), { code: 'FILE_TYPE_MISMATCH' });
  return { fileName, extension, mimeType: String(file.mimetype).toLowerCase(), fileHash: crypto.createHash('sha256').update(file.buffer).digest('hex'), sizeBytes: file.buffer.length };
}

function inspectExtractedText(value, { ocrConfidence = null } = {}) {
  const text = String(value || '').normalize('NFC').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  const replacementCount = (text.match(/�/g) || []).length;
  const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
  const suspiciousInstruction = /(?:ignore (?:all|previous) instructions|system prompt|developer message|reveal.*secret)/iu.test(text);
  const issues = [];
  if (text.length < 20) issues.push('TEXT_TOO_SHORT');
  if (replacementCount) issues.push('UNICODE_REPLACEMENT_CHARACTERS');
  if (ocrConfidence != null && (!Number.isFinite(Number(ocrConfidence)) || Number(ocrConfidence) < 0.92)) issues.push('LOW_OCR_CONFIDENCE');
  if (suspiciousInstruction) issues.push('EMBEDDED_INSTRUCTION_CONTENT');
  return { text, charCount: text.length, replacementCount, devanagariCount, suspiciousInstruction,
    verificationStatus: issues.length || ocrConfidence != null ? 'REVIEW_REQUIRED' : 'UPLOADED', issues };
}

function structuredChunks(text, metadata = {}, maxChars = 2400) {
  const normalized = inspectExtractedText(text).text;
  const blocks = normalized.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  const chunks = []; let current = '';
  const flush = () => { if (current) { chunks.push(current); current = ''; } };
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > maxChars) flush();
    if (block.length <= maxChars) current = current ? `${current}\n\n${block}` : block;
    else { flush(); for (let offset = 0; offset < block.length; offset += maxChars) chunks.push(block.slice(offset, offset + maxChars)); }
  }
  flush();
  return chunks.map((chunk, index) => ({ ordinal: index + 1, original_text: chunk, normalized_text: chunk,
    chapter: metadata.chapter || null, section: metadata.section || null, verse: metadata.verse || null,
    page_number: metadata.pageNumber || null, language: metadata.language || null, verification_status: 'REVIEW_REQUIRED',
    content_hash: crypto.createHash('sha256').update(chunk).digest('hex') }));
}

module.exports = { ALLOWED_EXTENSIONS, safeFilename, validateUpload, inspectExtractedText, structuredChunks };
