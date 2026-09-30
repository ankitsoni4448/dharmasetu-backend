'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {publicationIssues,assertPublishable}=require('../scripts/mantra_publication');
const {prepare}=require('../scripts/prepare_mantra_m3_review');
const {normalizeMantra}=require('../scripts/manifest_utils');
const {decodeResponseChunks}=require('../scripts/ingest_mantra_manifest');
const {qualityFindings}=require('../scripts/mantra_quality');
const ready=()=>({id:'fixture',canonical_name:'Fixture',sanskrit_text:'ॐ',is_active:true,publication_status:'APPROVED',rights_status:'PROJECT_OWNED',rights_reference:'fixture rights record',text_verification:'VERIFIED',text_sources:[{reference:'fixture only'}],reviewed_by:'fixture',reviewed_at:'2026-09-28'});
test('publication gate requires explicit approval, source, active and verified text independently',()=>{
  assert.deepEqual(publicationIssues(ready()),[]);
  for(const key of ['is_active','publication_status','text_verification','text_sources','reviewed_by','sanskrit_text']){const row=ready();delete row[key];assert.ok(publicationIssues(row).length,key);assert.throws(()=>assertPublishable([row]),/blocked/);}
  assert.ok(publicationIssues({...ready(),sanskrit_text:'bad\uFFFD'}).includes('SACRED_TEXT_CORRUPTED'));
  assert.ok(publicationIssues({...ready(),rights_status:'REVIEW_REQUIRED'}).includes('RIGHTS_CLEARANCE_REQUIRED'));
});
test('discovery-only evidence cannot publish despite claimed approval; each verified dimension needs sources',()=>{
  assert.ok(publicationIssues({...ready(),source_stage:'DISCOVERY_ONLY'}).includes('DISCOVERY_IS_NOT_TEXT_EVIDENCE'));
  assert.ok(publicationIssues({...ready(),text_sources:[],source_references:[{url:'https://example.org/discovery'}]}).includes('TEXT_SOURCE_REQUIRED'));
  for(const key of ['meaning','practice','pronunciation','audio'])assert.ok(publicationIssues({...ready(),[`${key}_verification`]:'VERIFIED'}).includes(`${key.toUpperCase()}_SOURCE_REQUIRED`));
  assert.ok(publicationIssues({...ready(),sanskrit_text:{text:'unsafe'}}).includes('SACRED_TEXT_REQUIRED'));
});
test('review and corruption reports are deterministic; 108 inventory does not bypass review',()=>{
  const rows=Array.from({length:108},(_,i)=>({id:`fixture-${i}`,sanskrit_text:`broken\uFFFD${i}`}));
  assert.deepEqual(qualityFindings(rows),qualityFindings(rows));
  const result=prepare(rows,[]);assert.equal(result.summary.corrupted_production_records,108);assert.equal(result.summary.eligible_for_safe_production_import,0);assert.equal(result.summary.remaining_needed_to_reach_108_safely,108);
});
test('text approval cannot promote meaning, practice or pronunciation; no deity inference',()=>{
  const row=normalizeMantra(ready());assert.equal(row.text_verification,'VERIFIED');assert.equal(row.meaning_verification,'REVIEW_REQUIRED');assert.equal(row.practice_verification,'REVIEW_REQUIRED');assert.equal(row.audio_verification,'REVIEW_REQUIRED');
  assert.equal(normalizeMantra({...ready(),canonical_name:'Shiva fixture'}).deity,'Unspecified');
});
test('UTF-8 survives split transport bytes and JSON round trip without repair',()=>{
  const payload=JSON.stringify({text:'ॐ नमः हिन्दी śāntiḥ'}),bytes=Buffer.from(payload,'utf8');
  const decoded=decodeResponseChunks([...bytes].map(byte=>Buffer.from([byte])));assert.equal(decoded,payload);assert.deepEqual(qualityFindings([{id:'fixture',...JSON.parse(decoded)}]),[]);
});
test('offline candidate pipeline preserves originals, marks source gaps and duplicates',()=>{
  const original=[{id:'one',sanskrit_text:'fixture'},{id:'two',sanskrit_text:'fixture'}],before=JSON.stringify(original);
  const result=prepare(original,[{id:'discovery',source_references:[{url:'https://example.org/index'}]}]);
  assert.equal(JSON.stringify(original),before);assert.equal(result.summary.text_source_ready,0);assert.equal(result.summary.eligible_for_safe_production_import,0);assert.equal(result.duplicates.length,1);assert.equal(result.queue[2].source_gaps.length,5);
});
test('current snapshot has 29 rows and all 118 candidates require independent review',()=>{
  const report=require('../data/mantra/m3/pipeline_summary.json'),snapshot=require('../data/mantra/m3/production_snapshot.json');
  assert.equal(snapshot.items.length,29);assert.equal(report.candidate_total,118);assert.equal(report.eligible_for_safe_production_import,0);assert.equal(report.still_requiring_review,118);
});
test('both write entry points enforce the same publication gate before upsert',()=>{
  const cli=fs.readFileSync(require.resolve('../scripts/ingest_mantra_manifest'),'utf8'),server=fs.readFileSync(require.resolve('../server'),'utf8');
  assert.ok(cli.indexOf('assertPublishable(manifest.items)')<cli.indexOf('const rows = manifest.items.map'));
  const route=server.slice(server.indexOf("app.post('/admin/mantras/ingest/manifest'"));assert.ok(route.indexOf('publicationIssues(item)')<route.indexOf("sbUpsert('mantra_catalog'"));
});
test('quality detection remains identical in frontend and backend',()=>{
  assert.equal(fs.readFileSync(require.resolve('../scripts/mantra_quality'),'utf8'),fs.readFileSync(require.resolve('../../dharmasetu-app/utils/mantraQuality'),'utf8'));
});
