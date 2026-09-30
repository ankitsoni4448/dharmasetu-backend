#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {qualityFindings}=require('./mantra_quality');
const {DIMENSIONS,sourcesFor,statusFor,validSources,publicationIssues}=require('./mantra_publication');
const ROOT=path.resolve(__dirname,'../data/mantra');
function canonicalCandidate(row) {
  const candidate={id:row.id,canonical_name:row.canonical_name||row.canonicalName||row.title||null,
    alternate_names:row.alternate_names||[],sanskrit_text:row.sanskrit_text||row.sanskritText||null,
    transliteration_iast:row.transliteration_iast||row.transliterationIast||null,
    transliteration_simple:row.transliteration_simple||row.transliterationSimple||row.transliteration||null,
    meanings:row.meanings||{hi:row.meaning_hi||null,en:row.meaning_en||null},
    content_type:row.mantra_content_type||row.contentType||row.content_type||null,
    deity_ids:row.deity_ids||row.deityIds||[],parent_deity_id:row.parent_deity_id||null,
    purpose_ids:row.purpose_ids||row.purposeIds||[],taxonomy_nodes:row.taxonomy_nodes||[],reviewed_purpose_mappings:row.reviewed_purpose_mappings||[],
    metadata_review_status:row.metadata_review_status||'REVIEW_REQUIRED',
    tradition:row.tradition||null,sampradaya:row.sampradaya||null,practice_level:row.practice_level||row.practiceLevel||null,
    requires_initiation:row.requires_initiation??row.requiresInitiation??null,requires_guru_guidance:row.requires_guru_guidance??null,
    source_references:row.source_references||row.sourceReferences||[],practice:row.practice||{},
    reviewed_by:row.reviewed_by||row.reviewedBy||null,reviewed_at:row.reviewed_at||row.reviewedAt||null,
    publication_status:row.publication_status||'REVIEW_REQUIRED',is_active:row.is_active??row.isActive??false,
    rights_status:row.rights_status||'REVIEW_REQUIRED',rights_reference:row.rights_reference||null,
    review_notes:row.review_notes||'Independent human/source review required. Existing classifications are unreviewed suggestions.',
    source_stage:row.source_stage||'LEGACY_REVIEW',audio_artifacts:row.audio_artifacts||[],artwork:row.artwork||null};
  DIMENSIONS.forEach(key=>{candidate[`${key}_sources`]=sourcesFor(row,key);candidate[`${key}_verification`]=statusFor(row,key);});
  return candidate;
}
function prepare(production,discovery) {
  const seen=new Map(),duplicates=[],candidates=[];
  for(const original of [...production,...discovery]) {
    const row=canonicalCandidate(original),source=row.source_references[0]?.url;
    const keys=[`id:${row.id}`,row.sanskrit_text?`text:${row.sanskrit_text.normalize('NFC').replace(/\s+/g,' ').trim()}`:source?`source:${source}`:null].filter(Boolean);
    const duplicate=keys.map(k=>seen.get(k)).find(Boolean);
    if(duplicate){duplicates.push({id:row.id,duplicate_of:duplicate,action:'HUMAN_REVIEW_NO_DELETION'});}
    keys.forEach(k=>seen.set(k,row.id));candidates.push(row);
  }
  const queue=candidates.map(row=>({id:row.id,source_gaps:DIMENSIONS.filter(k=>!validSources(sourcesFor(row,k))),review_required:DIMENSIONS.filter(k=>statusFor(row,k)!=='VERIFIED'),publication_blockers:publicationIssues(row)}));
  const eligible=candidates.filter(row=>publicationIssues(row).length===0&&!duplicates.some(d=>d.id===row.id));
  const summary={current_production:production.length,candidate_total:candidates.length,unique_candidate_total:candidates.length-duplicates.length,discovery_candidates:discovery.length,
    records_with_text_source:candidates.filter(r=>validSources(r.text_sources)).length,
    corrupted_production_records:new Set(qualityFindings(production).map(f=>f.record_id)).size,
    corrupted_candidate_records:new Set(qualityFindings(candidates).map(f=>f.record_id)).size,
    text_source_ready:candidates.filter(r=>r.sanskrit_text&&validSources(r.text_sources)).length,
    ...Object.fromEntries(DIMENSIONS.map(k=>[`${k}_review_required`,candidates.filter(r=>statusFor(r,k)!=='VERIFIED').length])),
    eligible_for_safe_production_import:eligible.length,still_requiring_review:candidates.length-eligible.length,
    remaining_needed_to_reach_108_safely:Math.max(0,108-eligible.length),numerical_gap_from_current_production:Math.max(0,108-production.length),
    duplicate_relationships:duplicates.length,automatic_verification:false};
  return {candidates,queue,eligible,summary,duplicates};
}
function main() {
  const snapshot=JSON.parse(fs.readFileSync(path.join(ROOT,'m3/production_snapshot.json'),'utf8'));
  const discovery=JSON.parse(fs.readFileSync(path.join(ROOT,'master_candidates_v2.json'),'utf8')).new_candidates;
  const result=prepare(snapshot.items,discovery);
  const legacy=JSON.parse(fs.readFileSync(path.join(ROOT,'legacy_review_v2.json'),'utf8')).records;
  for(const row of result.candidates){const disposition=legacy.find(item=>item.id===row.id);if(disposition)row.legacy_review=disposition;}
  result.summary.existing_approved_manifest_count=JSON.parse(fs.readFileSync(path.join(ROOT,'approved_content_v2.json'),'utf8')).items.length;
  const write=(name,value)=>fs.writeFileSync(path.join(ROOT,'m3',name),JSON.stringify(value,null,2)+'\n','utf8');
  write('content_quality_report.json',{snapshot_captured_at:snapshot.captured_at,production_records:snapshot.items.length,
    method:'UTF-8 snapshot, recursive string inspection; detection only, no sacred-text repair. No font/device rendering claim.',
    records:snapshot.items.map(row=>({record_id:row.id,findings_count:qualityFindings([row]).length})),findings:qualityFindings(snapshot.items)});
  write('canonical_candidates.json',{items:result.candidates});write('review_queue.json',{items:result.queue,duplicates:result.duplicates});
  write('pipeline_summary.json',result.summary);write('eligible_manifest.json',{schemaVersion:3,items:result.eligible});
  console.log(JSON.stringify(result.summary,null,2));
}
if(require.main===module)main();
module.exports={canonicalCandidate,prepare};
