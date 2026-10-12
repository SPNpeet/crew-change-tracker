import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {browser,login,photo,BASE,OUT,ADMIN_USER,FIELD_PASS} from './cdp.mjs';
const admin=await login(ADMIN_USER,process.env.ADMIN_PASS),staff=await login('somsak',FIELD_PASS);
async function api(method,path,body){const r=await fetch(BASE+path,{method,headers:{cookie:'cct_s='+admin,'x-cct':'1','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
const jobs=(await api('GET','/api/jobs')).jobs,job=await api('GET','/api/jobs/'+jobs[0].id),crew=job.crew.find(c=>c.name==='Arun Pillai');
const otherJob=(await api('POST','/api/jobs',{vessel:'TEST OTHER NAVIGATION'})).id;
const b=await browser(),results=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(path){
 const selector=path.startsWith('/admin/general')?'#mailform textarea[name="gate"]':path.startsWith('/admin/backup')?'[href="/api/export/all.xlsx"]':path==='/account'?'#pwf':path.startsWith('/t/')?'.ow-head':/^\/field\//.test(path)?'.fieldpage':path==='/jobs'?'.jobtile':'.jobcard';
 for(let i=0;i<300;i++){try{if(await b.eval(`location.pathname===${JSON.stringify(path)}&&!!document.querySelector(${JSON.stringify(selector)})`))return;}catch{}await sleep(100);}
 throw new Error('Page did not become ready: '+path);
}
async function fresh(path,cookie=admin){await b.go('/api/health',50);await b.cookie(cookie);await b.go(path,0);await ready(path);}
async function check(id,name,fn){try{await fn();results.push({id,name,passed:true});console.log('PASS '+id+' '+name);}catch(e){results.push({id,name,passed:false,error:e.message});console.log('FAIL '+id+' '+name+': '+e.message);await b.shot(id+'-failure');}}
async function hold(fragment,method){await b.eval(`window.originalFetch=fetch;window.held=[];window.fetch=(url,opts={})=>String(url).includes(${JSON.stringify(fragment)})&&(!${JSON.stringify(method||'')}||opts.method===${JSON.stringify(method||'')})?new Promise(resolve=>window.held.push({url,opts,resolve})):window.originalFetch(url,opts)`);}
async function waitHeld(){for(let i=0;i<400;i++){if(await b.eval('window.held.length'))return;await sleep(30);}throw new Error('Request not intercepted');}
// Waits for a state the page or the server reaches after a save, instead of sleeping a fixed time.
async function until(fn,label){for(let i=0;i<150;i++){try{if(await fn())return;}catch{}await sleep(100);}throw new Error('Timed out waiting for '+label);}
async function release(){await b.eval(`(async()=>{window.fetch=window.originalFetch;for(const x of window.held){x.resolve(await window.originalFetch(x.url,x.opts));}window.held=[]})()`);await sleep(100);}
async function nav(path){await b.eval(`import('/js/app.js').then(a=>a.go(${JSON.stringify(path)}))`);await ready(path);}
try{
 await b.size(390,844,true);
 await check('BR01','slow checkpoint response cannot replace the account page',async()=>{
  await fresh('/field/'+crew.id,staff);await hold('/confirm','POST');await b.eval(`document.querySelector('[data-act="f-nophoto"]').click();document.querySelector('#dlg [name=why]').click();document.querySelector('#dlg form').requestSubmit()`);await waitHeld();await nav('/account');assert.equal(await b.eval(`!!document.querySelector('#pwf')`),true);await release();assert.equal(await b.eval(`!!document.querySelector('#pwf')&&!document.querySelector('.fieldpage')`),true);await b.shot('slow-confirm-account-preserved');
 });
 await check('BR02','revoked Owner link clears an already-open page on the next poll',async()=>{
  const j=await api('GET','/api/jobs/'+job.job.id);await fresh('/t/'+j.job.owner_token);assert.equal(await b.eval('!!document.querySelector(".ow-head")'),true);await api('POST','/api/jobs/'+job.job.id+'/token');await b.eval(`import('/js/views/owner.js').then(v=>v.poll())`);assert.equal(await b.eval(`!document.querySelector('.ow-head')&&document.querySelector('main').textContent.includes('not available')`),true);
 });
 await check('BR03','late Owner response cannot replace another route',async()=>{
  const j=await api('GET','/api/jobs/'+job.job.id);await fresh('/account');await hold('/api/public/','GET');await b.eval(`import('/js/app.js').then(a=>{a.go('/t/${j.job.owner_token}')})`);await waitHeld();await nav('/account');await release();assert.equal(await b.eval(`!!document.querySelector('#pwf')&&!document.querySelector('.ow-head')`),true);
 });
 await check('BR04','stale office response cannot change the job targeted by the next action',async()=>{
  await fresh('/jobs/'+job.job.id+'/1');await hold('/api/jobs/'+job.job.id,'GET');await b.eval(`void(window.oldPoll=import('/js/views/office.js').then(v=>v.poll({name:'job',params:{id:${job.job.id},step:1}})))`);await waitHeld();await nav('/jobs/'+otherJob+'/1');await release();await b.eval('window.oldPoll');
  const id=await b.eval(`import('/js/app.js').then(a=>a.A.job.job.id)`);assert.equal(id,otherJob);assert.equal(await b.eval(`document.querySelector('.jobcard .v').textContent`),'TEST OTHER NAVIGATION');
 });
 await check('BR05','field note draft survives the actual 20-second refresh timer',async()=>{
  await fresh('/field/'+crew.id,staff);await b.eval(`document.querySelector('[data-act="f-note"]').click();document.querySelector('#noteedit textarea').value='SYNTHETIC UNSENT NOTE';document.querySelector('#noteedit textarea').blur()`);await sleep(21300);assert.equal(await b.eval(`document.querySelector('#noteedit textarea').value`),'SYNTHETIC UNSENT NOTE');assert.equal(await b.eval(`document.querySelector('#noteedit').hidden`),false);
 });
 await check('BR06','edited step-8 email survives refresh while new notes reach the dashboard',async()=>{
  await fresh('/jobs/'+job.job.id+'/8');await b.eval(`const ta=document.querySelector('textarea.mail');ta.value='SYNTHETIC EDITED EMAIL';ta.dispatchEvent(new Event('input',{bubbles:true}));ta.blur()`);await api('POST','/api/crew/'+crew.id+'/notes',{text:'SYNTHETIC LIVE POLL NOTE'});await b.eval(`import('/js/views/office.js').then(v=>v.poll({name:'job',params:{id:${job.job.id},step:8}}))`);assert.equal(await b.eval(`document.querySelector('textarea.mail').value`),'SYNTHETIC EDITED EMAIL');assert.equal(await b.eval(`import('/js/app.js').then(a=>a.A.job.crew.some(c=>c.notes.some(n=>n.text==='SYNTHETIC LIVE POLL NOTE')))`),true);
 });
 await check('BR07','immediate rejected camera photo retains its recovery bytes and reason',async()=>{
  await fresh('/field/'+crew.id,staff);await b.eval(`localStorage.removeItem('cct-outbox-v1');window.originalFetch=fetch;window.fetch=(url,opts)=>String(url).includes('/photos?')?Promise.resolve(new Response(JSON.stringify({error:'Synthetic job closed during capture'}),{status:409,headers:{'content-type':'application/json'}})):window.originalFetch(url,opts)`);
  const bytes=photo().toString('base64');await b.eval(`(async()=>{const a=await import('/js/api.js'),s=await import('/js/app.js');try{await a.uploadPhoto(${crew.id},new Blob([Uint8Array.from(atob('${bytes}'),x=>x.charCodeAt(0))],{type:'image/jpeg'}),{point:'direct-rejection',label:'synthetic photo'},s.A.me.id)}catch(e){};const items=a.pendingItems(s.A.me.id);window.directItems=items;window.recoverySize=items.length?(await a.pendingFile(a.itemKey(items[0]),s.A.me.id)).blob.size:0})()`);
  assert.equal(await b.eval('window.directItems.length'),1);assert.equal(await b.eval('window.recoverySize'),photo().length);assert.match(await b.eval('window.directItems[0].error'),/Synthetic job closed/);await nav('/account');await b.shot('direct-photo-rejection-retained');
 });
 await check('BR08','all seven email templates preview variables, save and reset',async()=>{
  await fresh('/admin/general');await sleep(250);const kinds=['appoint','sched','gate','plan','night','morning','update'];
  await b.eval(`for(const k of ${JSON.stringify(kinds)}){const ta=document.querySelector('#mailform textarea[name="'+k+'"]');ta.closest('details').open=true;ta.value='Subject: '+k+' {{vessel}}'+String.fromCharCode(10,10)+'{{signature}}';ta.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('#mailform').requestSubmit()`);await until(async()=>(await api('GET','/api/me')).settings.mail_tpl.update.includes('Subject: update {{vessel}}'),'the seven templates to be saved');
  const settings=(await api('GET','/api/me')).settings;for(const k of kinds)assert.ok(settings.mail_tpl[k].includes('Subject: '+k+' {{vessel}}'));
  await fresh('/admin/general');await until(()=>b.eval(`!document.querySelector('#mailform .tpl-prev').hidden`),'the template previews');
  const previews=await b.eval(`Array.from(document.querySelectorAll('#mailform details')).map(d=>{d.open=true;d.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));return d.querySelector('.tpl-prev pre').textContent})`);
  assert.equal(previews.length,7);assert.ok(previews.every(p=>p.includes('TEST OTHER NAVIGATION')||p.includes('MT OCEAN MERIDIAN')));assert.ok(previews.every(p=>!p.includes('{{vessel}}')));
  await b.eval(`window.confirm=()=>true;document.querySelectorAll('[data-act="a-tplreset"]').forEach(t=>t.click());document.querySelector('#mailform').requestSubmit()`);await until(async()=>!(await api('GET','/api/me')).settings.mail_tpl.update.includes('Subject: update {{vessel}}'),'the reset templates to be saved');const reset=(await api('GET','/api/me')).settings.mail_tpl;for(const k of kinds)assert.notEqual(reset[k],settings.mail_tpl[k]);
 });
 await check('BR09','untrusted crew text stays text in Field and Owner views',async()=>{
  const hostile='<img src=x onerror="window.fixtureXss=1">';await api('PATCH','/api/crew/'+crew.id,{name:hostile});
  for(const path of ['/field/'+crew.id,'/t/'+(await api('GET','/api/jobs/'+job.job.id)).job.owner_token]){await fresh(path,staff);assert.equal(await b.eval('window.fixtureXss||0'),0);assert.equal(await b.eval(`document.querySelector('main').textContent.includes(${JSON.stringify(hostile)})`),true);assert.equal(await b.eval(`!!document.querySelector('img[src="x"]')`),false);}
 });
 await check('BR10','backup screen distinguishes nightly R2 retention, plan and NAS verification',async()=>{
  await fresh('/admin/backup');const t=await b.eval(`document.querySelector('main').textContent`);assert.ok(t.includes('35'));assert.ok(t.includes('ทั้งระบบ'));assert.ok(t.includes('NAS'));assert.ok(!t.includes('กู้คืนข้อมูลได้ถึง 30 วัน'));
 });
 await check('BR11','an email conflict preserves the unsaved form and the other saved revision',async()=>{
  await fresh('/admin/general');const before=(await api('GET','/api/me')).settings.mail_tpl;
  await b.eval(`document.querySelector('#mailform textarea[name="gate"]').value='UNSAVED LOCAL DRAFT {{vessel}}'`);
  const remote={...before,gate:'ANOTHER EDITOR SAVED {{vessel}}'};await api('PUT','/api/settings',{mail_tpl:remote,mail_tpl_expected:before});
  await b.eval(`document.querySelector('#mailform').requestSubmit()`);await until(()=>b.eval(`document.querySelector('#mailform .ferr').textContent.length>0`),'the conflict message');
  assert.equal(await b.eval(`document.querySelector('#mailform textarea[name="gate"]').value`),'UNSAVED LOCAL DRAFT {{vessel}}');assert.ok((await b.eval(`document.querySelector('#mailform .ferr').textContent`)).includes('มีผู้แก้'));
  assert.equal((await api('GET','/api/me')).settings.mail_tpl.gate,remote.gate);await b.shot('email-concurrent-editor-draft-preserved');
 });
 await check('BR12','job list load-more reveals records beyond the first 200',async()=>{
  for(let i=0;i<202;i++)await api('POST','/api/jobs',{vessel:'TEST PAGINATION '+String(i).padStart(3,'0')});
  await fresh('/jobs');const before=await b.eval(`document.querySelectorAll('.jobtile').length`);
  await b.eval(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('โหลดงานเพิ่มเติม')).click()`);await until(()=>b.eval(`document.querySelectorAll('.jobtile').length>200`),'the next page of jobs');
  const after=await b.eval(`document.querySelectorAll('.jobtile').length`);assert.equal(before,200);assert.ok(after>200);assert.equal(await b.eval(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('โหลดงานเพิ่มเติม'))`),false);
 });
}finally{mkdirSync(dirname(OUT),{recursive:true});writeFileSync(join(dirname(OUT),'browser-results.json'),JSON.stringify({results,console:b.logs},null,2));console.log(JSON.stringify({pass:results.filter(x=>x.passed).length,fail:results.filter(x=>!x.passed).length,consoleErrors:b.logs.length}));b.close();}
if(results.some(r=>!r.passed)||b.logs.length)process.exitCode=1;
