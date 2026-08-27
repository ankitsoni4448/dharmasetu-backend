'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('reasoning-model requests reserve tokens for reasoning and constrain effort', () => {
  assert.match(server, /thinkingConfig = \{ thinkingLevel: 'low' \}/);
  assert.match(server, /max_completion_tokens: providerGenerationLimit/);
  assert.match(server, /reasoning_effort: 'low'/);
  assert.match(server, /reasoning_format: 'hidden'/);
});

test('full request budget leaves fallback and continuation inside frontend deadline', () => {
  assert.match(server, /primaryTimeoutMs:\s*20000/);
  assert.match(server, /fallbackTimeoutMs:\s*10000/);
  assert.match(server, /timeoutMs:\s*8000/);
});

test('fact-check and history prompt inputs are bounded', () => {
  assert.match(server, /const evidenceLimit = isFC \? 3 : 4/);
  assert.match(server, /limit=20/);
  assert.match(server, /const historyLimit = fastPath \? 1 : 6/);
  assert.match(server, /const historyChars = fastPath \? 200 : 700/);
});

test('safe diagnostics contain metadata but never prompt or credential values', () => {
  const logger = server.match(/function logProviderResult[\s\S]*?\n\}/)?.[0] || '';
  assert.match(logger, /provider=.*model=.*status=.*category=.*elapsedMs=/s);
  assert.match(logger, /promptChars=.*promptTokenEstimate=.*timeoutMs=/s);
  assert.doesNotMatch(logger, /apiKey|Authorization|JWT|DOB|birth time|\$\{prompt\}/i);
});
