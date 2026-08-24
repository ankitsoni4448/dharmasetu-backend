'use strict';

const { inspectExtractedText, structuredChunks } = require('./granthIngestion');

function normalizePages(pages, provenance = {}) {
  if (!Array.isArray(pages) || !pages.length) throw Object.assign(new Error('EXTRACTION_EMPTY'), { code: 'EXTRACTION_EMPTY' });
  return pages.map((page, index) => {
    const pageNumber = Number(page.pageNumber || index + 1);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw Object.assign(new Error('INVALID_PAGE_NUMBER'), { code: 'INVALID_PAGE_NUMBER' });
    const inspected = inspectExtractedText(page.text, { ocrConfidence: page.ocrConfidence ?? null });
    return { pageNumber, ...inspected, extractionTool: provenance.tool || 'external-provider', extractionVersion: provenance.version || null,
      extractionMode: page.ocrConfidence == null ? 'TEXT_EXTRACTION' : 'OCR' };
  });
}

function chunksFromPages(pages, metadata = {}) {
  return pages.flatMap(page => structuredChunks(page.text, { ...metadata, pageNumber: page.pageNumber }).map(chunk => ({
    ...chunk, extraction_confidence: page.ocrConfidence, extraction_provenance: {
      tool: page.extractionTool, version: page.extractionVersion, mode: page.extractionMode,
    }, quality_flags: page.issues,
  })));
}

async function requestExternalExtraction({ signedUrl, mimeType, fileHash, providerUrl, providerToken, timeoutMs = 30000 }) {
  if (!providerUrl || !providerToken) throw Object.assign(new Error('OCR_PROVIDER_NOT_CONFIGURED'), { code: 'OCR_PROVIDER_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 3000), 60000));
  try {
    const response = await fetch(providerUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ signedUrl, mimeType, fileHash }), signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error('EXTRACTION_PROVIDER_FAILED'), { code: 'EXTRACTION_PROVIDER_FAILED' });
    const body = await response.json();
    return normalizePages(body.pages, { tool: body.provider || 'external-provider', version: body.version || null });
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('EXTRACTION_TIMEOUT'), { code: 'EXTRACTION_TIMEOUT' });
    throw error;
  } finally { clearTimeout(timeout); }
}

module.exports = { normalizePages, chunksFromPages, requestExternalExtraction };
