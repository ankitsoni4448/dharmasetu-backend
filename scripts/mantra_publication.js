'use strict';
const {qualityFindings}=require('./mantra_quality');
const DIMENSIONS=['text','meaning','practice','pronunciation','audio'];
const PUBLISHABLE_RIGHTS=new Set(['PUBLIC_DOMAIN','LICENSED','PROJECT_OWNED','PERMISSION_GRANTED']);
const sourcesFor=(item,key)=>item[`${key}_sources`]||item.provenance?.[key]||[];
const statusFor=(item,key)=>item[`${key}_verification`]||item.verification_dimensions?.[key]||'UNVERIFIED';
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const validSources=value=>Array.isArray(value)&&value.length>0&&value.every(s=>s&&typeof s==='object'&&[s.url,s.document,s.reference].some(nonempty)&&s.stage!=='DISCOVERY_ONLY');
function publicationIssues(item) {
  if(!item||typeof item!=='object'||Array.isArray(item))return ['CANDIDATE_REQUIRED'];
  const issues=[];
  if((item.is_active??item.isActive)!==true)issues.push('ACTIVE_REQUIRED');
  if(item.publication_status!=='APPROVED')issues.push('PUBLICATION_APPROVAL_REQUIRED');
  if(statusFor(item,'text')!=='VERIFIED')issues.push('TEXT_REVIEW_REQUIRED');
  if(!validSources(sourcesFor(item,'text')))issues.push('TEXT_SOURCE_REQUIRED');
  if(!PUBLISHABLE_RIGHTS.has(item.rights_status)||!nonempty(item.rights_reference))issues.push('RIGHTS_CLEARANCE_REQUIRED');
  if(!nonempty(item.reviewed_by||item.reviewedBy)||!nonempty(item.reviewed_at||item.reviewedAt)||!Number.isFinite(Date.parse(item.reviewed_at||item.reviewedAt)))issues.push('REVIEW_ATTRIBUTION_REQUIRED');
  if(!nonempty(item.sanskrit_text||item.sanskritText||item.text))issues.push('SACRED_TEXT_REQUIRED');
  if(item.source_stage==='DISCOVERY_ONLY')issues.push('DISCOVERY_IS_NOT_TEXT_EVIDENCE');
  for(const dimension of DIMENSIONS.slice(1))if(statusFor(item,dimension)==='VERIFIED'&&!validSources(sourcesFor(item,dimension)))issues.push(`${dimension.toUpperCase()}_SOURCE_REQUIRED`);
  if(qualityFindings([item]).some(f=>/sanskrit|sanskritText|^text$/.test(f.field)))issues.push('SACRED_TEXT_CORRUPTED');
  return issues;
}
function corePublicationIssues(item) {
  const issues=publicationIssues(item);
  if(!nonempty(item?.canonical_name||item?.canonicalName||item?.title))issues.push('CANONICAL_IDENTITY_REQUIRED');
  if(!nonempty(item?.content_type||item?.mantra_content_type||item?.contentType))issues.push('CONTENT_CLASSIFICATION_REQUIRED');
  return [...new Set(issues)];
}
function fieldPublicationState(item,field) {
  const value=field==='transliteration'?(item.transliteration||item.transliteration_iast||item.transliteration_simple):field==='meaning'?(item.meaning||item.meanings):item[field];
  const present=typeof value==='string'?nonempty(value):value&&typeof value==='object'&&Object.values(value).some(nonempty);
  const sources=field==='transliteration'?(item.transliteration_sources||[]):sourcesFor(item,field);
  const verification=item[`${field}_verification`]||item.verification_dimensions?.[field]||'UNVERIFIED';
  return {present:!!present,displayable:!!present&&verification==='VERIFIED'&&validSources(sources),verification,withhold:!!present&&!(verification==='VERIFIED'&&validSources(sources))};
}
function assertPublishable(items) {
  const errors=items.flatMap(item=>corePublicationIssues(item).map(issue=>`${item.id}: ${issue}`));
  if(errors.length)throw new Error(`Mantra publication blocked: ${errors.join('; ')}`);
}
module.exports={DIMENSIONS,PUBLISHABLE_RIGHTS,sourcesFor,statusFor,validSources,publicationIssues,corePublicationIssues,fieldPublicationState,assertPublishable};
