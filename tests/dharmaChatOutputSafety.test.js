'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDharmaChatOutput, enforceUnverifiedCitationSafety } = require('../utils/aiSafety');
const { enforceCitationPolicy } = require('../utils/scriptureCitationValidator');

test('presentation HTML is removed and breaks become mobile-safe newlines', () => {
  const output = sanitizeDharmaChatOutput('hello<br>world<br/>again<br />done<div><span class="x">text</span></div>');
  assert.equal(output, 'hello\nworld\nagain\ndone\ntext');
  assert.doesNotMatch(output, /<\/?(?:br|div|span)\b/i);
});

test('Markdown tables become readable bullets without raw table syntax', () => {
  const output = sanitizeDharmaChatOutput('JOB | BUSINESS\n--- | ---\nStructure | Autonomy\nTeam | Clients');
  assert.match(output, /- JOB: Structure · BUSINESS: Autonomy/);
  assert.match(output, /Team/);
  assert.doesNotMatch(output, /^\s*\|?.+\|.+$/m);
  assert.doesNotMatch(output, /---\s*\|\s*---/);
});

test('sanitization preserves Hindi, Sanskrit, and Devanagari punctuation', () => {
  const input = 'सीधा निष्कर्ष<br>कर्मण्येवाधिकारस्ते — यह पाठ सुरक्षित है।';
  const output = sanitizeDharmaChatOutput(input);
  assert.equal(output, 'सीधा निष्कर्ष\nकर्मण्येवाधिकारस्ते — यह पाठ सुरक्षित है।');
});

test('unsupported named and generic exact scripture references are omitted without internal labels', () => {
  for (const value of ['Bhagavad Gita 3.30 explains action.', 'Chapter IV Verse 7 explains this.', 'अध्याय 3 श्लोक 30 में यह कहा गया है।']) {
    const guarded = enforceCitationPolicy(enforceUnverifiedCitationSafety(value, []).text, []);
    assert.doesNotMatch(guarded.text, /Bhagavad Gita 3\.30|Chapter IV Verse 7|अध्याय 3 श्लोक 30/);
    assert.doesNotMatch(guarded.text, /\[unverified scripture reference\]|SOURCE NOT VERIFIED/);
  }
});

test('verified exact scripture citation and content survive final output sanitization', () => {
  const evidence = [{ title: 'Bhagavad Gita', chapter: '2', verse: '47' }];
  const generic = enforceUnverifiedCitationSafety('Bhagavad Gita 2.47 teaches disciplined action.', ['Bhagavad Gita 2.47']);
  const citation = enforceCitationPolicy(generic.text, evidence);
  const output = sanitizeDharmaChatOutput(citation.text);
  assert.equal(citation.citationStatus, 'VALID');
  assert.match(output, /Bhagavad Gita 2\.47 teaches disciplined action/);
});
