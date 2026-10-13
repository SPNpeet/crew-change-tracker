// Office-only packet workflow. All writes recheck the session, role, open job and
// source clock inside the same SQL transaction. The clock is changed by triggers
// on legacy source tables too, so editing through the old API invalidates approval.
import {HttpError,json,readJson,randomId,now,str,parseJson,intOrNull} from './util.js';
import {requireOffice} from './auth.js';
import {loadSettings} from './settings.js';
import {packetSnapshot,approvePacket,manualSubmissionRecord,canApprovePacket} from './packet-workflow.js';
import {rosterImport} from './roster-import.js';
import {identityFields,identityHash,validateLegs,expiryMissing} from './packet-validation.js';

export const WORKFLOW_TABLES=['wf_clock','wf_groups','wf_people','wf_file_reviews','wf_packets','wf_packet_files','wf_approvals','wf_submissions','wf_imports','wf_import_rows','wf_assignment_history'];
export const PACKET_STORAGE_SQL='(SELECT COALESCE(SUM(byte_size),0) FROM wf_packets)';
const usedSQL=`(SELECT COALESCE(SUM(size),0) FROM photos)+(SELECT COALESCE(SUM(size),0) FROM crew_files)+(SELECT COALESCE(SUM(avatar_size),0) FROM users)+${PACKET_STORAGE_SQL}`;
const fail=(status,message)=>{throw new HttpError(status,message);};
const hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const guardSQL=`EXISTS(SELECT 1 FROM jobs j JOIN wf_clock w ON w.job_id=j.id JOIN users u ON u.id=? JOIN sessions s ON s.user_id=u.id WHERE j.id=? AND j.status='open' AND w.rev=? AND u.active=1 AND u.role IN ('admin','office') AND s.token_hash=? AND s.expires_at>?)`;
const guardArgs=(u,job,rev)=>[u.id,job,rev,u.token_hash,now()];
const stmt=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const activity=(env,job,u,message)=>stmt(env,'INSERT INTO activity(job_id,at,user_id,kind,text) SELECT ?,?,?,?,? WHERE changes()=1',job,now(),u.id,'log',message);

async function state(env,id) {
  const sql=[['job','SELECT j.*,w.rev FROM jobs j JOIN wf_clock w ON w.job_id=j.id WHERE j.id=?'],['crew','SELECT * FROM crew WHERE job_id=? ORDER BY sort,id'],['groups','SELECT * FROM wf_groups WHERE job_id=? ORDER BY name'],['people','SELECT p.* FROM wf_people p JOIN crew c ON c.id=p.crew_id WHERE c.job_id=?'],['files','SELECT f.*,r.sha256,r.pages,r.byte_size,r.reviewed_by,r.reviewed_at FROM crew_files f JOIN crew c ON c.id=f.crew_id LEFT JOIN wf_file_reviews r ON r.file_id=f.id WHERE c.job_id=? ORDER BY f.id'],['imports','SELECT * FROM wf_imports WHERE job_id=? ORDER BY created_at DESC'],['import_rows','SELECT r.* FROM wf_import_rows r JOIN wf_imports i ON i.id=r.import_id WHERE i.job_id=?'],['assignment_history','SELECT h.* FROM wf_assignment_history h JOIN crew c ON c.id=h.crew_id WHERE c.job_id=? ORDER BY h.id DESC'],['packets','SELECT p.id,p.source_rev,p.prepared_by,p.prepared_at,p.byte_size,a.approved_by,a.approved_role,a.approved_at,s.destination,s.evidence_ref,s.submitted_at,s.recorded_by,s.recorded_at FROM wf_packets p LEFT JOIN wf_approvals a ON a.packet_id=p.id LEFT JOIN wf_submissions s ON s.packet_id=p.id WHERE p.job_id=? ORDER BY p.prepared_at DESC']];
  const rows=await env.DB.batch(sql.map(([,s])=>stmt(env,s,id)));
  const out=Object.fromEntries(sql.map(([k],i)=>[k,rows[i].results]));out.job=out.job[0];
  if(!out.job)fail(404,'Job not found.');return out;
}
async function snapshot(s,selectedIds) {
  const crew=await Promise.all(s.crew.map(async c=>{
    const p=s.people.find(p=>p.crew_id===c.id),legs=p?parseJson(p.flight_legs,[]):[];
    const source=p?s.files.find(f=>'crew-file:'+f.id===p.source_ref&&f.crew_id===c.id&&f.sha256===p.source_sha256):null;
    return {...Object.fromEntries(['id','job_id','type',...identityFields].map(k=>[k,c[k]])),group_id:p?.group_id??null,flight:c.flight,flight_legs:legs,source_ref:p?.source_ref||'',source_sha256:p?.source_sha256||'',identity_verified:source&&p.identity_hash===await identityHash(c)?'yes':null,flight_verified:legs.length?'yes':null,expiry_valid:expiryMissing(c,legs).length?null:'yes'};
  }));
  const files=s.files.map(f=>({...f,job_id:s.job.id,status:'accepted',verified:!!f.sha256&&f.byte_size===f.size}));
  const job=Object.fromEntries(['id','vessel','port','eta','etb','etd','oktb'].map(k=>[k,s.job[k]]));
  return packetSnapshot({job,crew,groups:s.groups,files,selectedIds,requiredKinds:['passport','sirb','ticket'],requiredFields:[...identityFields,'identity_verified','flight_verified','expiry_valid'],sourceRevision:String(s.job.rev),templateRevision:'document-review-packet-v1'});
}
async function objectBytes(env,key) {
  const object=await env.FILES.get(key);if(!object)fail(409,'A source file is unavailable. Upload/review it again.');
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}
async function inspectFile(env,f) {
  const bytes=await objectBytes(env,f.r2_key);if(bytes.length!==f.size)fail(409,'Source file size changed.');
  const {PDFDocument}=await import('../public/js/vendor/pdf-lib.esm.min.js');let pages;
  try {
    if(f.mime==='application/pdf')pages=(await PDFDocument.load(bytes)).getPageCount();
    else {const doc=await PDFDocument.create();if(f.mime==='image/png')await doc.embedPng(bytes);else if(f.mime==='image/jpeg')await doc.embedJpg(bytes);else fail(422,'Review requires PDF, PNG or JPEG. Convert WebP before verification.');pages=1;}
  }catch(e){if(e instanceof HttpError)throw e;fail(422,'The file cannot be read as an unencrypted document.');}
  if(!pages||pages>100)fail(422,'Use a document with 1–100 readable pages.');
  return {bytes,sha256:await hashBytes(bytes),pages};
}
async function getPacket(env,id) {
  const p=await stmt(env,'SELECT * FROM wf_packets WHERE id=?',id).first();if(!p)fail(404,'Packet not found.');
  p.snapshot=parseJson(p.snapshot,null);
  const [f,a,s]=await env.DB.batch([stmt(env,'SELECT * FROM wf_packet_files WHERE packet_id=? ORDER BY file_id',id),stmt(env,'SELECT * FROM wf_approvals WHERE packet_id=?',id),stmt(env,'SELECT * FROM wf_submissions WHERE packet_id=?',id)]);
  p.files=f.results;p.approval=a.results[0]||null;p.submission=s.results[0]||null;return p;
}
async function verifyCopies(env,p) {
  for(const f of p.files)if(await hashBytes(await objectBytes(env,f.object_key))!==f.sha256)fail(409,'Stored packet evidence is missing or changed.');
}
async function compensate(env,keys) {
  for(const key of keys)try {
    if(!await stmt(env,'SELECT 1 FROM wf_packet_files WHERE object_key=?',key).first())await env.FILES.delete(key);
  }catch {console.warn('Packet cleanup outcome unknown; reconcile packet object inventory before deletion.');}
}
function expected(b,s){if(b.expected_revision!==s.job.rev)fail(409,'The job changed. Refresh and review before saving.');}

export async function packetRoute(req,env,u,seg) {
  requireOffice(u);
  const method=req.method;
  if(seg[1]==='jobs'&&seg[2]) {
    const id=intOrNull(seg[2]),s=await state(env,id);
    if(seg.length===3&&method==='GET') {
      const ids=s.crew.filter(c=>c.type==='on').map(c=>c.id);
      const preview=ids.length?await snapshot(s,ids):null;
      return json({...s,preview,files:s.files.map(({r2_key,...f})=>f)});
    }
    if(method!=='POST')fail(404,'Workflow route not found.');
    const b=await readJson(req);expected(b,s);
    if(s.job.status!=='open')fail(409,'The job is closed.');
    if(seg[3]==='imports'&&(seg.length===4||(seg.length===6&&seg[5]==='commit')))return rosterImport(env,u,s,b,seg[4],guardSQL,guardArgs);
    if(seg[3]==='groups'&&seg.length===4) {
      const name=str(b.name,100);if(!name)fail(400,'A group name is required.');
      const result=await env.DB.batch([stmt(env,`INSERT OR IGNORE INTO wf_groups(job_id,name,created_by,created_at) SELECT ?,?,?,? WHERE ${guardSQL}`,id,name,u.id,now(),...guardArgs(u,id,s.job.rev)),activity(env,id,u,'Created operational group: '+name)]);
      if(!result[0].meta.changes)fail(409,'Group exists or source/access changed. Refresh.');return json({id:result[0].meta.last_row_id});
    }
    if(seg[3]==='people'&&seg[4]&&seg[5]==='group'&&seg.length===6) {
      const c=s.crew.find(c=>c.id===intOrNull(seg[4]));if(!c)fail(404,'Crew not found in this job.');
      const group=intOrNull(b.group_id);if(group&&!s.groups.some(g=>g.id===group))fail(409,'Choose a group from this job.');
      const r=await env.DB.batch([stmt(env,`INSERT INTO wf_people(crew_id,group_id,source_ref,source_sha256,identity_hash,flight_legs,verified_by,verified_at) SELECT ?,?,'manual-group','','','[]',?,? WHERE ${guardSQL} ON CONFLICT(crew_id) DO UPDATE SET group_id=excluded.group_id`,c.id,group,u.id,now(),...guardArgs(u,id,s.job.rev)),activity(env,id,u,'Assigned operational group for crew '+c.id)]);
      if(!r[0].meta.changes)fail(409,'Source or access changed during group assignment.');return json({ok:true});
    }
    if(seg[3]==='people'&&seg[4]) {
      const c=s.crew.find(c=>c.id===intOrNull(seg[4]));if(!c)fail(404,'Crew not found in this job.');
      const group=intOrNull(b.group_id);if(group&&!s.groups.some(g=>g.id===group))fail(409,'Choose a group from this job.');
      if(b.human_verified!==true)fail(400,'Human comparison of the displayed identity and source is required.');
      const source=s.files.find(f=>f.id===intOrNull(b.source_file_id)&&f.crew_id===c.id);if(!source)fail(400,'Choose an uploaded identity source for this person.');
      const evidence=await inspectFile(env,source),legs=validateLegs(b.flight_legs||[]),at=now();
      const r=await env.DB.batch([stmt(env,`INSERT INTO wf_people(crew_id,group_id,source_ref,source_sha256,identity_hash,flight_legs,verified_by,verified_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guardSQL} ON CONFLICT(crew_id) DO UPDATE SET group_id=excluded.group_id,source_ref=excluded.source_ref,source_sha256=excluded.source_sha256,identity_hash=excluded.identity_hash,flight_legs=excluded.flight_legs,verified_by=excluded.verified_by,verified_at=excluded.verified_at`,c.id,group,'crew-file:'+source.id,evidence.sha256,await identityHash(c),JSON.stringify(legs),u.id,at,...guardArgs(u,id,s.job.rev)),activity(env,id,u,'Verified identity, group and flight source for crew '+c.id)]);
      if(!r[0].meta.changes)fail(409,'Source or access changed during verification.');return json({ok:true});
    }
    if(seg[3]==='files'&&seg[4]&&seg[5]==='review') {
      const f=s.files.find(f=>f.id===intOrNull(seg[4]));if(!f)fail(404,'File not found in this job.');
      if(b.human_verified!==true)fail(400,'Open and compare this file with the person before confirming.');
      const evidence=await inspectFile(env,f);
      const r=await env.DB.batch([stmt(env,`INSERT INTO wf_file_reviews(file_id,sha256,byte_size,pages,reviewed_by,reviewed_at) SELECT ?,?,?,?,?,? WHERE ${guardSQL} ON CONFLICT(file_id) DO UPDATE SET sha256=excluded.sha256,byte_size=excluded.byte_size,pages=excluded.pages,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`,f.id,evidence.sha256,f.size,evidence.pages,u.id,now(),...guardArgs(u,id,s.job.rev)),activity(env,id,u,'Reviewed document file '+f.id)]);
      if(!r[0].meta.changes)fail(409,'Source or access changed during review.');return json({sha256:evidence.sha256,pages:evidence.pages});
    }
    if(seg[3]==='packets'&&seg.length===4) {
      if(!/^[A-Za-z0-9_-]{16,80}$/.test(b.request_key||''))fail(400,'A unique retry key is required.');
      const prior=await stmt(env,'SELECT id,job_id,snapshot FROM wf_packets WHERE prepared_by=? AND request_key=?',u.id,b.request_key).first();
      if(prior){if(prior.job_id!==id||JSON.stringify(parseJson(prior.snapshot,null)?.payload.people.map(p=>p.crew.id))!==JSON.stringify(b.selected_ids))fail(409,'Retry key belongs to a different packet selection. Use a new key.');return json({id:prior.id,duplicate:true});}
      const snap=await snapshot(s,b.selected_ids),packetId=randomId(24),keys=[],fileRows=[],at=now();
      try {
        for(const person of snap.payload.people)for(const f of person.files) {
          const bytes=await objectBytes(env,f.r2_key);if(await hashBytes(bytes)!==f.sha256)fail(409,'Reviewed file bytes changed. Review the source again.');
          const key=`packets/${packetId}/${f.id}`;keys.push(key);
          await env.FILES.put(key,bytes,{httpMetadata:{contentType:f.mime}});
          fileRows.push({f,key});
        }
        const size=fileRows.reduce((sum,{f})=>sum+f.size,0),settings=await loadSettings(env);
        const statements=[stmt(env,`INSERT OR IGNORE INTO wf_packets(id,job_id,source_rev,snapshot,prepared_by,prepared_at,byte_size,request_key) SELECT ?,?,?,?,?,?,?,? WHERE ${guardSQL} AND ${usedSQL}+?<=?`,packetId,id,s.job.rev,JSON.stringify(snap),u.id,at,size,b.request_key,...guardArgs(u,id,s.job.rev),size,settings.storage_gb*1024**3)];
        for(const {f,key} of fileRows)statements.push(stmt(env,'INSERT INTO wf_packet_files(packet_id,file_id,crew_id,object_key,sha256,size,mime,name) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM wf_packets WHERE id=?)',packetId,f.id,f.crew_id,key,f.sha256,f.size,f.mime,f.name,packetId));
        statements.push(stmt(env,'INSERT INTO activity(job_id,at,user_id,kind,text) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM wf_packets WHERE id=?)',id,at,u.id,'log','Prepared '+snap.status+' packet '+packetId,packetId));
        const result=await env.DB.batch(statements);
        if(!result[0].meta.changes) {
          await compensate(env,keys);
          const winner=await stmt(env,'SELECT id,snapshot FROM wf_packets WHERE prepared_by=? AND request_key=? AND job_id=?',u.id,b.request_key,id).first();
          if(winner){if(JSON.stringify(parseJson(winner.snapshot,null)?.payload.people.map(p=>p.crew.id))!==JSON.stringify(b.selected_ids))fail(409,'Retry key belongs to a different packet selection. Use a new key.');return json({id:winner.id,duplicate:true});}
          fail(409,'Source/access changed or storage is full. Refresh before preparing.');
        }
        return json({id:packetId,status:snap.status});
      }catch(e){await compensate(env,keys);throw e;}
    }
  }
  if(seg[1]==='packets'&&/^[A-Za-z0-9_-]{24}$/.test(seg[2]||'')) {
    const p=await getPacket(env,seg[2]);
    if(method==='GET'&&seg.length===3)return json({...p,files:p.files.map(({object_key,...f})=>f)});
    if(method==='GET'&&seg[3]==='files'&&seg[4]) {
      const f=p.files.find(f=>f.file_id===intOrNull(seg[4]));if(!f)fail(404,'Packet file not found.');
      const bytes=await objectBytes(env,f.object_key);if(await hashBytes(bytes)!==f.sha256)fail(409,'Packet evidence changed.');
      return new Response(bytes,{headers:{'content-type':f.mime,'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    if(method==='POST'&&['approve','submit'].includes(seg[3])&&seg.length===4) {
      const s=await state(env,p.job_id),b=await readJson(req);expected(b,s);
      if(s.job.rev!==p.source_rev)fail(409,'This packet is stale. Prepare and review a new version.');
      const current=await snapshot(s,p.snapshot.payload.people.map(x=>x.crew.id));
      if(current.revision!==p.snapshot.revision)fail(409,'Packet sources changed.');
      await verifyCopies(env,p);
      if(seg[3]==='approve') {
        const approval=await approvePacket(p.snapshot,u,{at:now(),prepared_by:p.prepared_by});
        const r=await env.DB.batch([stmt(env,`INSERT OR IGNORE INTO wf_approvals(packet_id,revision,approved_by,approved_role,approved_at) SELECT ?,?,?,(SELECT role FROM users WHERE id=?),? WHERE ${guardSQL}`,p.id,approval.revision,u.id,u.id,approval.approved_at,...guardArgs(u,p.job_id,p.source_rev)),activity(env,p.job_id,u,'Internally approved packet '+p.id),stmt(env,`SELECT 1 AS allowed WHERE ${guardSQL}`,...guardArgs(u,p.job_id,p.source_rev))]);
        if(!r[2].results.length||(!r[0].meta.changes&&!p.approval))fail(409,'Source or access changed during approval.');
        return json((await getPacket(env,p.id)).approval);
      }
      const approver=p.approval?await stmt(env,'SELECT id,role,active FROM users WHERE id=?',p.approval.approved_by).first():null;
      const at=Number(b.submitted_at),destination=str(b.destination,200),reference=str(b.evidence_ref,500);
      if(!Number.isFinite(at)||at<946684800000||at>now()+60000)fail(400,'Use the actual past submission time.');
      const record=await manualSubmissionRecord({snapshot:p.snapshot,current,approval:p.approval,actor:u,destination,evidence:{reference},at},()=>canApprovePacket(approver));
      const r=await env.DB.batch([stmt(env,`INSERT OR IGNORE INTO wf_submissions(packet_id,destination,evidence_ref,submitted_at,recorded_by,recorded_at) SELECT ?,?,?,?,?,? WHERE ${guardSQL} AND EXISTS(SELECT 1 FROM wf_approvals a JOIN users u ON u.id=a.approved_by WHERE a.packet_id=? AND a.revision=? AND u.active=1 AND u.role IN ('admin','office'))`,p.id,record.destination,reference,at,u.id,now(),...guardArgs(u,p.job_id,p.source_rev),p.id,p.snapshot.revision),activity(env,p.job_id,u,'Recorded manual submission for packet '+p.id),stmt(env,`SELECT 1 AS allowed WHERE ${guardSQL}`,...guardArgs(u,p.job_id,p.source_rev))]);
      if(!r[2].results.length||(!r[0].meta.changes&&!p.submission))fail(409,'Source or approval access changed during recording.');
      return json((await getPacket(env,p.id)).submission);
    }
  }
  fail(404,'Workflow route not found.');
}
