// Office-only imports. The retained hash describes the exact UTF-8 roster text.
import {HttpError,json,randomId,now,sha256} from './util.js';
import {previewImport,verifiedImportRow} from './packet-workflow.js';
import {loadSettings} from './settings.js';
const fail=(s,m)=>{throw new HttpError(s,m);};
const stmt=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);

export async function rosterImport(env,u,s,b,tail,guardSQL,guardArgs) {
 const job=s.job.id;
 if(!tail) {
  if(typeof b.source_text!=='string'||new TextEncoder().encode(b.source_text).length>50000||!b.source_text.trim())fail(400,'Use 1–60 rows of tab-separated names and groups, up to 50 KB.');
  if(typeof b.source_ref!=='string'||!b.source_ref.trim()||b.source_ref.length>300)fail(400,'A source filename/reference is required.');
  if(!['on','off'].includes(b.crew_type))fail(400,'Choose On or Off signer.');
  const lines=b.source_text.replace(/^\uFEFF/,'').split(/\r?\n/);
  if(!lines.at(-1)?.trim())lines.pop();
  if(!lines.length||lines.length>60)fail(400,'Import 1–60 rows at a time.');
  const rows=lines.map(line=>{const cells=line.split('\t');if(cells.length>2)fail(400,'Use two columns only: name, group (optional); no header.');const [name='',group='']=cells.map(x=>x.trim());if(name.length>120||group.length>100)fail(400,'Name/group is too long.');return {group:group||null,fields:{name:{value:name||null,readable:!!name},group:{value:group||null}}};});
  const hash=await sha256(b.source_text),preview=previewImport({reference:b.source_ref.trim(),sha256:hash,format:'utf8-tsv'},rows);
  const prior=await stmt(env,'SELECT id FROM wf_imports WHERE job_id=? AND source_sha256=? AND crew_type=?',job,hash,b.crew_type).first();if(prior)return json({id:prior.id,duplicate:true});
  const id=randomId(24),r=await env.DB.batch([stmt(env,`INSERT OR IGNORE INTO wf_imports(id,job_id,source_ref,source_sha256,source_text,preview,crew_type,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guardSQL}`,id,job,b.source_ref.trim(),hash,b.source_text,JSON.stringify(preview),b.crew_type,u.id,now(),...guardArgs(u,job,s.job.rev))]);
  if(!r[0].meta.changes)fail(409,'Import source or access changed. Refresh.');return json({id});
 }
 const source=await stmt(env,'SELECT * FROM wf_imports WHERE id=? AND job_id=?',tail,job).first();if(!source)fail(404,'Import not found.');
 if(b.source_sha256!==source.source_sha256||!Array.isArray(b.verified_rows)||!b.verified_rows.length||new Set(b.verified_rows).size!==b.verified_rows.length)fail(400,'Verify each selected row against this exact source.');
 const preview=JSON.parse(source.preview),selected=b.verified_rows.map(n=>verifiedImportRow(u,preview,n,{row:n,source_sha256:b.source_sha256,fields:{name:true,group:true}}));
 if(source.committed_at){const rows=(await stmt(env,'SELECT * FROM wf_import_rows WHERE import_id=?',tail).all()).results;if(JSON.stringify(rows.map(r=>r.row_number).sort((a,b)=>a-b))!==JSON.stringify([...b.verified_rows].sort((a,b)=>a-b)))fail(409,'This preview was already imported with a different selection. Review its saved rows.');return json({duplicate:true,rows});}
 const settings=await loadSettings(env),tpl=source.crew_type==='on'?settings.cp_on:settings.cp_off,chain=Math.min(tpl.length-1,source.crew_type==='on'?settings.cp_on_chain:settings.cp_off_chain),at=now(),token=randomId(24);
 const committed='EXISTS(SELECT 1 FROM wf_imports WHERE id=? AND commit_token=?)';
 const sql=[stmt(env,`UPDATE wf_imports SET committed_by=?,committed_at=?,commit_token=? WHERE id=? AND committed_at IS NULL AND ${guardSQL}`,u.id,at,token,tail,...guardArgs(u,job,s.job.rev))];
 for(const r of selected){
  if(r.group)sql.push(stmt(env,`INSERT OR IGNORE INTO wf_groups(job_id,name,created_by,created_at) SELECT ?,?,?,? WHERE ${committed}`,job,r.group,u.id,at,tail,token));
  sql.push(stmt(env,`INSERT INTO crew(job_id,name,type,chain_end,created_at) SELECT ?,?,?,?,? WHERE ${committed}`,job,r.values.name,source.crew_type,chain,at,tail,token));
  sql.push(stmt(env,`INSERT INTO wf_import_rows(import_id,row_number,crew_id,verified_by,verified_at) SELECT ?,?,last_insert_rowid(),?,? WHERE ${committed}`,tail,r.row,u.id,at,tail,token));
  const crew='(SELECT crew_id FROM wf_import_rows WHERE import_id=? AND row_number=?)';
  sql.push(stmt(env,`INSERT INTO wf_people(crew_id,group_id,source_ref,source_sha256,identity_hash,flight_legs,verified_by,verified_at) SELECT ${crew},(SELECT id FROM wf_groups WHERE job_id=? AND name=?),?,?,'','[]',?,? WHERE ${committed}`,tail,r.row,job,r.group,'roster-import:'+tail+':row:'+r.row,source.source_sha256,u.id,at,tail,token));
  for(const [i,cp] of tpl.entries())sql.push(stmt(env,`INSERT INTO checkpoints(crew_id,idx,name,name_en,need_photo) SELECT ${crew},?,?,?,? WHERE ${committed}`,tail,r.row,i,cp.th,cp.en,cp.photo?1:0,tail,token));
 }
 sql.push(stmt(env,`INSERT INTO activity(job_id,at,user_id,kind,text) SELECT ?,?,?,?,? WHERE ${committed}`,job,at,u.id,'log','Verified roster import '+tail+' ('+selected.length+' rows)',tail,token));
 const result=await env.DB.batch(sql);if(!result[0].meta.changes)fail(409,'Import, source or access changed. Refresh before retrying.');
 return json({rows:(await stmt(env,'SELECT * FROM wf_import_rows WHERE import_id=?',tail).all()).results});
}
