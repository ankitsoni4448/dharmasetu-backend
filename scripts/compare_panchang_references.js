'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(process.argv[2] || path.join(__dirname, '..', 'validation', 'panchang-reference-cases.json'));
if (!fs.existsSync(source)) { console.log(JSON.stringify({ status: 'REFERENCE_DATA_REQUIRED', results: [] }, null, 2)); process.exit(0); }
const inputs = fs.statSync(source).isDirectory()
  ? fs.readdirSync(source).filter(name => name.endsWith('.json')).sort().flatMap(name => JSON.parse(fs.readFileSync(path.join(source, name), 'utf8')))
  : JSON.parse(fs.readFileSync(source, 'utf8'));
const rows = Array.isArray(inputs) ? inputs : [inputs];
const results = rows.map(row => {
  const caseId = row.case_id || row.id;
  if (row.reference_status !== 'VERIFIED' || !row.actual || !row.expected) return { case_id: caseId, status: 'NOT_COMPARABLE', reason: 'REFERENCE_DATA_REQUIRED' };
  const fields = ['weekday', 'tithi', 'nakshatra', 'yoga', 'karana', 'sunrise', 'sunset', 'ekadashi_or_festival'];
  const comparisons = fields.map(field => ({ field, status: row.expected?.[field] == null ? 'NOT_COMPARABLE' : row.actual?.[field] === row.expected[field] ? 'PASS' : 'FAIL' }));
  return { case_id: caseId, status: comparisons.some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS', comparisons };
});
const comparable = results.some(item => item.status === 'PASS' || item.status === 'FAIL');
console.log(JSON.stringify({ status: comparable ? 'COMPARED' : 'REFERENCE_DATA_REQUIRED', results }, null, 2));
if (results.some(item => item.status === 'FAIL')) process.exitCode = 1;
