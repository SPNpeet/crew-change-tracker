// Option 2 domain rules used by the local packet API.
// Approval roles follow the owner's explicit decision.
import {HttpError,sha256} from './util.js';
import {isOffice} from './auth.js';

const fail = (status,message) => { throw new HttpError(status,message); };
const copy = value => structuredClone(value);
const activeOffice = actor => Number.isSafeInteger(actor?.id) && actor.id>0 && !!actor.active && !!isOffice(actor);
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export const revisionOf = async value => sha256(JSON.stringify(canonical(value)));

export function assertGroupAssignment(crew,group) {
  if(group && group.job_id!==crew.job_id)fail(409,'A group must belong to the same job.');
  return {crew_id:crew.id,group_id:group?.id??null};
}

export function previewImport(source,rows) {
  if(!source?.reference || !/^[a-f0-9]{64}$/i.test(source.sha256||''))fail(400,'A source reference and content hash are required.');
  return {source:copy(source),rows:rows.map((r,index)=>({row:index+1,group:r.group??null,fields:Object.fromEntries(Object.entries(r.fields||{}).map(([k,v])=>[k,{value:v.readable===false?null:v.value??null,source_reference:v.source_reference||source.reference,page:v.page??null,readable:v.readable!==false,verified:false}]))})),verified:false};
}

export function verifiedImportRow(actor,preview,rowNumber,verification) {
  if(!activeOffice(actor))fail(403,'Only active office staff can verify names and groups.');
  const row=preview.rows.find(r=>r.row===rowNumber);
  if(!row || verification?.source_sha256!==preview.source.sha256 || verification.row!==rowNumber)fail(409,'The source preview changed.');
  if(!row.fields.name?.readable || !String(row.fields.name.value||'').trim())fail(409,'A verified readable name is required; never infer it.');
  const values={};
  for(const [key,field] of Object.entries(row.fields)){
    if(field.value!==null && verification.fields?.[key]!==true)fail(409,'Every imported value needs human verification.');
    values[key]=field.value;
  }
  return {values,group:row.group,source:copy(preview.source),row:rowNumber,verified_by:actor.id};
}

export async function packetSnapshot({job,selectedIds,crew,groups=[],files,requiredKinds,requiredFields=[],sourceRevision,templateRevision}) {
  if(!job?.id || !sourceRevision || !templateRevision || !Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id=>!Number.isSafeInteger(id)||id<1) || new Set(selectedIds).size!==selectedIds.length)fail(400,'An explicit job, unique selection and source/template revisions are required.');
  const selected=selectedIds.map(id=>{
    const c=crew.find(c=>c.id===id);
    if(!c || c.job_id!==job.id || c.type!=='on')fail(409,'Packet selection must contain on-signers from this job only.');
    const group=c.group_id==null?null:groups.find(g=>g.id===c.group_id);
    if(c.group_id!=null && !group)fail(409,'Assigned group is missing.');
    assertGroupAssignment(c,group);
    const accepted=files.filter(f=>f.crew_id===c.id && f.job_id===job.id && f.status==='accepted' && !f.deleted_at && f.verified===true && /^[a-f0-9]{64}$/i.test(f.sha256||'') && Number.isSafeInteger(f.pages) && f.pages>0);
    const missing=[...requiredKinds.filter(kind=>!accepted.some(f=>f.kind===kind)),...requiredFields.filter(k=>c[k]==null||c[k]==='').map(k=>'field:'+k)];
    return {crew:copy(c),group:copy(group),files:accepted.map(copy),missing};
  });
  const omissions=selected.filter(p=>p.missing.length).map(p=>({crew_id:p.crew.id,name:p.crew.name,group_id:p.group?.id??null,group_name:p.group?.name??null,missing:p.missing}));
  const payload={job:copy(job),sourceRevision,templateRevision,requiredKinds:copy(requiredKinds),requiredFields:copy(requiredFields),people:selected};
  return {revision:await revisionOf(payload),payload,status:omissions.length?'partial':'ready_for_review',manifest:{incomplete_people:omissions.length,omissions,included_files:selected.flatMap(p=>p.files.map(f=>({crew_id:p.crew.id,file_id:f.id,sha256:f.sha256,pages:f.pages}))),warning:omissions.length?'PARTIAL EXPORT — missing evidence is omitted. Not approved for submission.':'Prepared for internal review. This is not approval or proof of submission.'}};
}

export async function verifySnapshot(snapshot) {
  if(!snapshot?.payload || snapshot.revision!==await revisionOf(snapshot.payload))fail(409,'Packet snapshot was altered.');
}

export const canApprovePacket = activeOffice;

export async function approvePacket(snapshot,actor,{at,prepared_by}) {
  if(!canApprovePacket(actor))fail(403,'Only an active admin or office user may approve.');
  await verifySnapshot(snapshot);
  if(snapshot.payload.people.some(p=>p.missing.length))fail(409,'Required evidence is incomplete; partial export remains available.');
  if(!Number.isFinite(at) || !Number.isSafeInteger(prepared_by))fail(400,'A server approval time and preparer identity are required.');
  return {revision:snapshot.revision,approved_by:actor.id,approved_role:actor.role,approved_at:at,prepared_by,self_approved:actor.id===prepared_by};
}

// authorizeApproval must be a trusted server policy function. There is no role
// client-provided boolean. The adapter must load the current actor from auth.
export async function assertSubmittable(snapshot,current,approval,authorizeApproval) {
  await verifySnapshot(snapshot);await verifySnapshot(current);
  if(snapshot.payload.people.some(p=>p.missing.length) || current.payload.people.some(p=>p.missing.length))fail(409,'Required evidence is incomplete; partial export remains available.');
  if(snapshot.revision!==current.revision)fail(409,'Source changed after preparation; review the current revision.');
  if(!approval || approval.revision!==snapshot.revision || !approval.approved_by || !approval.approved_at)fail(409,'Internal approval for this exact revision is required.');
  if(typeof authorizeApproval!=='function' || await authorizeApproval(approval,snapshot)!==true)fail(403,'Approval authority has not been established.');
  return true;
}

export async function manualSubmissionRecord({snapshot,current,approval,actor,destination,evidence,at},authorizeApproval) {
  if(!activeOffice(actor))fail(403,'Only active office staff can record a submission.');
  await assertSubmittable(snapshot,current,approval,authorizeApproval);
  if(!String(destination||'').trim() || !evidence?.reference || !Number.isFinite(at))fail(400,'Destination, evidence reference and actual recorded time are required.');
  if(at<approval.approved_at)fail(400,'Actual submission time must be at or after internal approval for this revision.');
  return {method:'manual-record',revision:snapshot.revision,recorded_by:actor.id,destination:String(destination).trim(),evidence:copy(evidence),at,status:'submission_recorded'};
}

export function transportReassignment(actor,current,{vehicle_id,driver_id,expected_revision},at) {
  if(!activeOffice(actor))fail(403,'Only active office staff can reassign transport.');
  if(expected_revision!==current.revision)fail(409,'Assignment changed; refresh before reassigning.');
  // Operational group and flight remain independent of this per-person change.
  return {next:{...copy(current),vehicle_id,driver_id,revision:current.revision+1},history:{crew_id:current.crew_id,from_vehicle_id:current.vehicle_id,from_driver_id:current.driver_id,to_vehicle_id:vehicle_id,to_driver_id:driver_id,by:actor.id,at,prior_revision:current.revision}};
}

export function assertAssignedEvent(actor,current,event) {
  if(!actor?.active || actor.role!=='field' || current.driver_id!==actor.id)fail(403,'Current driver assignment is required.');
  if(event.crew_id!==current.crew_id || event.assignment_revision!==current.revision)fail(409,'Offline assignment is stale; preserve it for review without applying.');
  return true; // Completeness of immigration documents is unrelated to this event.
}
