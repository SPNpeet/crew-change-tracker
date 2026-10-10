// Local-only behavioral audit. All names/passwords/data are synthetic fixtures.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
const PORT=8944,BASE=`http://127.0.0.1:${PORT}`,KEY='test-setup-key',PW='readiness-fixture-only';
const wr=join(process.cwd(),'node_modules/wrangler/bin/wrangler.js');
const persist=mkdtempSync(join(tmpdir(),'cct-readiness-'));
let server,admin;const S={};
function client(){let cookie='';return async(method,path,body,extra={})=>{
 const bytes=body instanceof Uint8Array;const headers={'x-cct':'1',cookie,...extra.headers};
 if(body!==undefined&&!bytes)headers['content-type']='application/json';
 const r=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:bytes?body:JSON.stringify(body)});
 if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
 return{status:r.status,headers:r.headers,data:(r.headers.get('content-type')||'').includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};
};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const anon=client(),office=client(),field=client(),other=client();
before(async()=>{
 try{await fetch(BASE+'/api/health');throw new Error('Port occupied');}catch(e){if(e.message==='Port occupied')throw e;}
 execFileSync(process.execPath,[wr,'d1','migrations','apply','cct','--local','--persist-to',persist],{stdio:'ignore',windowsHide:true});
 server=spawn(process.execPath,[wr,'dev','--local','--ip','127.0.0.1','--port',String(PORT),'--persist-to',persist,'--var','SETUP_KEY:'+KEY,'--var','CRON_NOW:'+Date.UTC(2026,9,9,19),'--test-scheduled'],{stdio:'ignore',windowsHide:true});
 for(let i=0;i<100;i++){try{if((await fetch(BASE+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,300));}throw new Error('Local startup timeout');
});
after(()=>{if(server)try{execFileSync('taskkill',['/pid',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}console.log('Synthetic state retained at '+persist);});

test('RD01 simultaneous first setup creates exactly one administrator',async()=>{
 const a=client(),b=client();const attempts=await Promise.all([a('POST','/api/setup',{key:KEY,username:'adminone',name:'Synthetic Admin One',password:PW}),b('POST','/api/setup',{key:KEY,username:'admintwo',name:'Synthetic Admin Two',password:PW})]);
 admin=attempts[0].status===200?a:b;S.adminName=attempts[0].status===200?'adminone':'admintwo';
 const users=ok(await admin('GET','/api/users')).users;S.adminId=users.find(u=>u.username===S.adminName).id;
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);assert.equal(users.length,1);
});
test('RD02 role fixtures and field privacy cover direct API access',async()=>{
 for(const [name,role]of[['office','office'],['field','field'],['other','field'],['supervisor','field']])S[name]=ok(await admin('POST','/api/users',{username:name,name:'Synthetic '+name,role,password:PW,see_all:name==='supervisor'})).id;
 for(const[c,name]of[[office,'office'],[field,'field'],[other,'other']])ok(await c('POST','/api/login',{username:name,password:PW}));
 S.job=ok(await office('POST','/api/jobs',{vessel:'TEST READINESS',port:'Synthetic port',owner_email:'owner@example.invalid',agent_email:'agent@example.invalid',eta:Date.now()+3600000})).id;
 S.crew=ok(await office('POST',`/api/jobs/${S.job}/crew`,{name:'Synthetic Crew',passport:'SYNTHETIC-PASSPORT',agent_id:S.field})).ids[0];
 S.otherCrew=ok(await office('POST',`/api/jobs/${S.job}/crew`,{name:'Synthetic Other Crew',agent_id:S.other,type:'off'})).ids[0];
 assert.equal((await field('GET','/api/users')).status,403);assert.equal((await office('GET','/api/users')).status,403);
 const data=ok(await field('GET',`/api/jobs/${S.job}`));assert.equal(data.crew.length,1);assert.equal(data.crew[0].passport,undefined);assert.equal(data.job.owner_token,undefined);assert.equal(data.job.owner_email,undefined);
 assert.equal((await other('POST',`/api/crew/${S.crew}/notes`,{text:'not allowed'})).status,403);
 const supervisor=client();ok(await supervisor('POST','/api/login',{username:'supervisor',password:PW}));assert.equal(ok(await supervisor('GET','/api/field')).crew.length,2);
});
test('RD03 malformed settings are rejected as 400 and atomic',async()=>{
 const prior=ok(await admin('GET','/api/me')).settings;
 for(const body of [{company:null},{cp_on:[null,null]},[],{late_min:33,company:null}])assert.equal((await admin('PUT','/api/settings',body)).status,400,JSON.stringify(body));
 assert.deepEqual(ok(await admin('GET','/api/me')).settings,prior);
});
test('RD04 closed jobs reject edits until explicitly reopened',async()=>{
 ok(await office('PATCH',`/api/jobs/${S.job}`,{status:'closed'}));
 try{
  assert.equal((await office('PATCH',`/api/jobs/${S.job}`,{vessel:'SHOULD NOT CHANGE'})).status,409);
  assert.equal((await office('PATCH',`/api/jobs/${S.job}`,{status:'open',remark:'mixed reopen edit'})).status,409);
  assert.equal(ok(await office('GET',`/api/jobs/${S.job}`)).job.vessel,'TEST READINESS');
 }finally{ok(await office('PATCH',`/api/jobs/${S.job}`,{status:'open'}));}
});
test('RD05 assigning an office or inactive user is refused',async()=>{
 assert.equal((await office('PATCH',`/api/crew/${S.crew}`,{agent_id:S.office})).status,400);
 ok(await admin('PATCH',`/api/users/${S.other}`,{active:false}));
 try{assert.equal((await office('PATCH',`/api/crew/${S.crew}`,{agent_id:S.other})).status,400);assert.equal((await office('POST',`/api/jobs/${S.job}/crew`,{name:'Invalid inactive assignment',agent_id:S.other})).status,400);}
 finally{ok(await admin('PATCH',`/api/users/${S.other}`,{active:true}));ok(await office('PATCH',`/api/crew/${S.crew}`,{agent_id:S.field}));}
});
test('RD06 inactive resources cannot be newly assigned and missing resources are 404',async()=>{
 for(const kind of ['vehicles','hotels']){
  const id=ok(await office('POST','/api/'+kind,{name:'Inactive '+kind,active:false})).id;
  assert.equal((await office('PATCH',`/api/crew/${S.crew}`,{[kind==='vehicles'?'vehicle_id':'hotel_id']:id})).status,400);
  assert.equal((await office('PATCH',`/api/${kind}/999999`,{name:'Missing'})).status,404);
 }
});
test('RD07 concurrent confirmations create one checkpoint and one history entry',async()=>{
 ok(await office('PATCH',`/api/crew/${S.crew}`,{agent_id:S.field}));
 const at=Date.now();const before=ok(await office('GET',`/api/jobs/${S.job}`)).activity.filter(x=>x.kind==='cp').length;
 const attempts=await Promise.all(Array.from({length:6},()=>field('POST',`/api/crew/${S.crew}/confirm`,{idx:0,at})));
 assert.ok(attempts.some(r=>r.status===200));assert.ok(attempts.every(r=>[200,409].includes(r.status)));
 const full=ok(await office('GET',`/api/jobs/${S.job}`));assert.equal(full.activity.filter(x=>x.kind==='cp').length-before,1);
 assert.equal(full.crew.find(c=>c.id===S.crew).cps.filter(c=>c.actual!=null).length,1);
});
test('RD08 invalid crew type and out-of-range GPS do not change data',async()=>{
 assert.equal((await office('POST',`/api/jobs/${S.job}/crew`,{name:'Bad type',type:'on_typo'})).status,400);
 assert.equal((await field('POST',`/api/crew/${S.crew}/confirm`,{idx:1,lat:1000,lng:1000})).status,400);
});
test('RD09 concurrent account creation obeys the 15 active account cap',async()=>{
 const users=ok(await admin('GET','/api/users')).users;const n=users.filter(u=>u.active).length;
 for(let i=n;i<14;i++)ok(await admin('POST','/api/users',{username:'capfill'+i,name:'Synthetic cap fixture',role:'field',password:PW}));
 const results=await Promise.all(Array.from({length:5},(_,i)=>admin('POST','/api/users',{username:'caprace'+i,name:'Synthetic race '+i,role:'field',password:PW})));
 const all=ok(await admin('GET','/api/users')).users;
 for(const u of all.filter(u=>u.username.startsWith('cap')))ok(await admin('PATCH','/api/users/'+u.id,{active:false}));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,4);assert.equal(all.filter(u=>u.active).length,15);
});
test('RD10 password reset and deactivation invalidate sessions without erasing job history',async()=>{
 const old=client();ok(await old('POST','/api/login',{username:'field',password:PW}));
 ok(await admin('PATCH','/api/users/'+S.field,{password:PW+'-new'}));assert.equal((await old('GET','/api/me')).status,401);assert.equal((await client()('POST','/api/login',{username:'field',password:PW})).status,401);
 ok(await field('POST','/api/login',{username:'field',password:PW+'-new'}));
 ok(await admin('PATCH','/api/users/'+S.field,{active:false}));assert.equal((await field('GET','/api/me')).status,401);assert.ok(ok(await office('GET',`/api/jobs/${S.job}`)).activity.length>0);
 ok(await admin('PATCH','/api/users/'+S.field,{active:true,password:PW}));ok(await field('POST','/api/login',{username:'field',password:PW}));
});
test('RD11 backup permissions, traversal and unauthenticated downloads',async()=>{
 for(const p of ['/api/backups','/api/backups/daily/2026-10-10.json.gz','/api/export/all.xlsx'])assert.equal((await anon('GET',p)).status,401);
 assert.equal((await office('GET','/api/backups')).status,403);assert.equal((await field('GET','/api/export/all.xlsx')).status,403);
 assert.equal((await admin('GET','/api/backups/%2e%2e%2fphotos%2ffile.jpg')).status,404);
});
test('RD12 photo limits, cross-user denial, deletion permissions and closed job protection',async()=>{
 const bytes=readFileSync(new URL('./e2e/photo.jpg',import.meta.url));const path=`/api/crew/${S.crew}/photos?upload_id=readiness-photo-0000001`;
 assert.equal((await field('POST',path,new Uint8Array(),{headers:{'content-type':'image/jpeg'}})).status,400);
 assert.equal((await field('POST',path,bytes,{headers:{'content-type':'image/svg+xml'}})).status,415);
 assert.equal((await field('POST',path,new Uint8Array(10*1024*1024+1),{headers:{'content-type':'image/jpeg'}})).status,413);
 const id=ok(await field('POST',path,bytes,{headers:{'content-type':'image/jpeg'}})).id;S.photo=id;
 // Authenticate explicitly so this case is independent of the earlier negative assertions.
 ok(await other('POST','/api/login',{username:'other',password:PW}));assert.equal((await other('GET','/api/photos/'+id)).status,403);assert.equal((await other('DELETE','/api/photos/'+id)).status,403);
 ok(await office('PATCH',`/api/jobs/${S.job}`,{status:'closed'}));assert.equal((await field('DELETE','/api/photos/'+id)).status,409);ok(await office('PATCH',`/api/jobs/${S.job}`,{status:'open'}));
});
test('RD13 Owner rotation, output privacy and XSS text round-trip',async()=>{
 const hostile='<img src=x onerror=alert(1)> & =SUM(1,2)';ok(await office('PATCH',`/api/crew/${S.crew}`,{name:hostile}));
 const original=ok(await office('GET',`/api/jobs/${S.job}`)).job.owner_token;
 const p=ok(await anon('GET','/api/public/'+original));assert.equal(p.crew.find(c=>c.id===S.crew).name,hostile);assert.equal(p.crew[0].passport,undefined);assert.equal(p.crew[0].photos,undefined);assert.equal(p.crew[0].notes,undefined);
 const next=ok(await office('POST',`/api/jobs/${S.job}/token`));assert.ok(next.owner_token);assert.equal((await anon('GET','/api/public/'+original)).status,404);assert.equal((await anon('GET','/api/public/'+next.owner_token)).status,200);
});
test('RD14 deletion authorization and database cascades',async()=>{
 assert.equal((await office('DELETE',`/api/jobs/${S.job}`)).status,403);
 assert.equal((await field('DELETE',`/api/crew/${S.otherCrew}`)).status,403);
 ok(await office('DELETE',`/api/crew/${S.otherCrew}`));assert.equal(ok(await office('GET',`/api/jobs/${S.job}`)).crew.some(c=>c.id===S.otherCrew),false);
});
test('RD15 more than 200 jobs remain reachable through pagination',async()=>{
 const ids=[];for(let i=0;i<202;i++)ids.push(ok(await office('POST','/api/jobs',{vessel:'TEST PAGE '+String(i).padStart(3,'0'),eta:Date.now()+i*60000})).id);
 const seen=new Set();let offset=0,pages=0;
 do{const d=ok(await office('GET','/api/jobs?limit=50&offset='+offset));assert.ok(d.jobs.length<=50);d.jobs.forEach(j=>{assert.ok(!seen.has(j.id));seen.add(j.id);});offset=d.nextOffset;pages++;assert.ok(pages<10);}while(offset!=null);
 assert.ok(ids.every(id=>seen.has(id)));assert.equal(seen.size,203);assert.ok(pages>=5);
});

test('RD16 concurrent email editors cannot silently overwrite another saved revision',async()=>{
 const before=ok(await admin('GET','/api/me')).settings.mail_tpl;
 const a={...before,appoint:'Editor A {{vessel}}'},b={...before,gate:'Editor B {{vessel}}'};
 const writes=await Promise.all([admin('PUT','/api/settings',{mail_tpl:a,mail_tpl_expected:before}),admin('PUT','/api/settings',{mail_tpl:b,mail_tpl_expected:before})]);
 assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
 const saved=ok(await admin('GET','/api/me')).settings.mail_tpl;
 assert.deepEqual(saved,writes[0].status===200?a:b);
 assert.equal((await admin('PUT','/api/settings',{mail_tpl:before})).status,428);
 assert.equal((await admin('PUT','/api/settings',{mail_tpl:before,mail_tpl_expected:before,late_min:77})).status,400);
 assert.deepEqual(ok(await admin('GET','/api/me')).settings.mail_tpl,saved);
 ok(await admin('PUT','/api/settings',{mail_tpl:before,mail_tpl_expected:saved}));
});

test('RD17 unknown, incorrect and disabled logins return the same public error',async()=>{
 const id=ok(await admin('POST','/api/users',{username:'disabledfixture',name:'Synthetic disabled fixture',role:'field',password:PW,active:false})).id;
 ok(await admin('PATCH','/api/users/'+id,{active:false}));
 const responses=[];for(const [username,password]of[['unknownfixture',PW],[S.adminName,'wrong-synthetic-password'],['disabledfixture',PW]])responses.push(await client()('POST','/api/login',{username,password}));
 assert.deepEqual(responses.map(r=>r.status),[401,401,401]);assert.deepEqual(responses[0].data,responses[1].data);assert.deepEqual(responses[0].data,responses[2].data);
 for(const r of responses){assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.has('set-cookie'),false);}
});

test('RD18 Owner access expires 30 days after closure and reopening restores current link',async()=>{
 const token=ok(await office('GET','/api/jobs/'+S.job)).job.owner_token;
 const setClosed=age=>execFileSync(process.execPath,[wr,'d1','execute','cct','--local','--persist-to',persist,'--command',`UPDATE jobs SET status='closed',closed_at=${Date.now()-age} WHERE id=${S.job}`],{stdio:'ignore',windowsHide:true});
 try{setClosed(30*86400000-60000);assert.equal((await anon('GET','/api/public/'+token)).status,200);setClosed(30*86400000+60000);assert.equal((await anon('GET','/api/public/'+token)).status,404);}
 finally{ok(await office('PATCH','/api/jobs/'+S.job,{status:'open'}));}
 assert.equal((await anon('GET','/api/public/'+token)).status,200);
});
