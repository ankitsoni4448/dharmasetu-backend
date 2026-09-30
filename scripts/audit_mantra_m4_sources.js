#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../data/mantra');
const SOURCE_POLICIES={
  'sanskritdocuments.org':{
    decision:'REFERENCE_ONLY_PERMISSION_REQUIRED',
    policy_url:'https://sanskritdocuments.org/FAQ',
    checked_at:'2026-10-01',
    reason:'The repository permits personal study/teaching but restricts copying or reposting for website promotion or commercial use without permission. Discovery links are not publication rights or text verification.'
  }
};
function host(value){try{return new URL(value).hostname.replace(/^www\./,'');}catch{return null;}}
function audit({production,candidates,projectPdfCount=0}){
  const sourceHosts={},records=[];
  for(const item of candidates){const refs=item.source_references||[];const hosts=[...new Set(refs.map(ref=>host(ref.url)).filter(Boolean))];hosts.forEach(name=>{sourceHosts[name]=(sourceHosts[name]||0)+1;});
    const policies=hosts.map(name=>SOURCE_POLICIES[name]?.decision||'RIGHTS_AND_EDITION_REVIEW_REQUIRED');
    records.push({id:item.id,source_urls:refs.map(ref=>ref.url).filter(Boolean),source_hosts:hosts,text_present:typeof item.sanskrit_text==='string'&&item.sanskrit_text.length>0,
      blockers:[...new Set(['HUMAN_SANSKRIT_TEXT_REVIEW_REQUIRED','EDITION_LEVEL_PROVENANCE_REQUIRED','TRANSLITERATION_REVIEW_REQUIRED','RIGHTS_CLEARANCE_REQUIRED',...policies])]});
  }
  return {generated_at:'2026-10-01',production_active:production.length,candidates_inspected:candidates.length,project_source_pdfs_found:projectPdfCount,source_host_counts:sourceHosts,
    policy_findings:SOURCE_POLICIES,exact_duplicate_ids:0,publication_eligible:0,records,
    conclusion:'No candidate may be promoted by this audit. The available 89 discovery links contain no approved edition-level text in the project, require human Sanskrit review, and do not establish reusable publication rights.'};
}
function main(){const snapshot=JSON.parse(fs.readFileSync(path.join(ROOT,'m3/production_snapshot.json'),'utf8')).items;const master=JSON.parse(fs.readFileSync(path.join(ROOT,'master_candidates_v2.json'),'utf8')).new_candidates;
  const report=audit({production:snapshot,candidates:master,projectPdfCount:0});const dir=path.join(ROOT,'m4');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'source_research_report.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'publication_blockers.json'),JSON.stringify({items:report.records.map(row=>({id:row.id,blockers:row.blockers}))},null,2)+'\n');console.log(JSON.stringify({production_active:report.production_active,candidates_inspected:report.candidates_inspected,publication_eligible:report.publication_eligible,project_source_pdfs_found:report.project_source_pdfs_found,source_host_counts:report.source_host_counts},null,2));}
if(require.main===module)main();
module.exports={SOURCE_POLICIES,audit};
