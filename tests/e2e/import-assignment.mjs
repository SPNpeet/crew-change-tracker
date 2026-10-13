import assert from 'node:assert/strict';
import {browser,login,BASE,OUT,FIELD_PASS} from './cdp.mjs';
import {checkpointBody} from '../checkpoint-client.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const office=await login('pranee',FIELD_PASS),field=await login('somsak',FIELD_PASS);
async function call(method,path,body,token=office){body=await checkpointBody(BASE,'cct_s='+token,path,body,method);const r=await fetch(BASE+path,{method,headers:{cookie:'cct_s='+token,'x-cct':'1','content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
const job=(await call('POST','/api/jobs',{vessel:'SYNTHETIC IMPORT HISTORY'})).id,uid=(await call('GET','/api/me',undefined,field)).user.id;
const get=()=>call('GET',`/api/workflow/jobs/${job}`),b=await browser(),sel=s=>`document.querySelector(${JSON.stringify(s)})`;
const check=(v,label)=>{assert.ok(v,label);console.log('PASS IH '+label);};
async function until(fn,label){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
const present=s=>until(()=>b.eval(`!!${sel(s)}`),s);
async function fill(s,value){await present(s);await b.eval(`${sel(s)}.value=${JSON.stringify(value)}`);}
async function submit(s){await present(s);assert.ok(await b.eval(`${sel(s)}.reportValidity()`));await b.eval(`${sel(s)}.requestSubmit()`);}
try{
 await b.size(390,844,true);await b.go('/api/health',50);await b.cookie(office);await b.go(`/jobs/${job}/packets`);
 await fill('[name=source_ref]','Synthetic source.tsv');await fill('[name=source_text]','Synthetic Import Alpha\tBlue\n\tUnreadable\nSynthetic Import Beta\tGreen');await submit('[data-packet-form=import]');
 await until(async()=>((await get()).imports.length===1),'preview retained');const initial=await get(),id=initial.imports[0].id;check(initial.crew.length===0,'preview never creates crew');
 await present(`[data-import-id="${id}"]`);await b.eval(`${sel(`[data-import-id="${id}"]`)}.open=true`);check(await b.eval(`${sel('[name=verified_rows][value="2"]')}.disabled`),'unreadable name cannot be selected');
 for(const width of [360,390,1366]){await b.size(width,844,width<600);check(await b.eval('document.documentElement.scrollWidth<=innerWidth+1'),'import preview fits '+width);await b.shot('import-preview-'+width);}
 await b.eval(`${sel('[name=verified_rows][value="1"]')}.click();${sel('[name=verified_rows][value="3"]')}.click()`);await submit('[data-packet-form=import-commit]');await until(async()=>((await get()).crew.length===2),'verified rows imported');
 const imported=await get(),crew=imported.crew[0];check(imported.groups.length===2&&imported.import_rows.length===2,'names and independent groups persist with row provenance');check(imported.preview.manifest.incomplete_people===2,'imported names remain incomplete without documents');
 const groupForm=`[data-packet-form=person-group][data-id="${crew.id}"]`;await present(groupForm);await b.eval(`${sel(groupForm)}.closest('details').open=true`);const groupId=imported.groups.find(g=>g.name==='Green').id;await fill(groupForm+' [name=group_id]',String(groupId));await submit(groupForm);await until(async()=>((await get()).people.find(p=>p.crew_id===crew.id).group_id===groupId),'independent group edit');check((await get()).preview.manifest.incomplete_people===2,'group changes need no identity documents and do not verify them');
 await b.go(`/jobs/${job}/7`);const assign=`[data-chg=o-set][data-id="${crew.id}"][data-f=agent_id]`;await present(assign);await b.eval(`${sel(assign)}.value=${JSON.stringify(String(uid))};${sel(assign)}.dispatchEvent(new Event('change',{bubbles:true}))`);await until(async()=>((await get()).crew.find(c=>c.id===crew.id).agent_id===uid),'assignment control committed');
 await b.go(`/jobs/${job}/packets`);await present('[data-incomplete-count]');check((await get()).assignment_history.some(h=>h.changed_by&&h.to_agent_id===uid),'existing office control writes actor and prior/new history');await b.size(390,844,true);await b.eval(`for(const d of document.querySelectorAll('details'))if(d.textContent.includes('ฉบับการมอบหมาย'))d.open=true`);await b.shot('assignment-history-390');
 await b.cookie(field);await b.go('/field/'+crew.id);await present('[data-act=f-confirm]');await b.eval(`window.actualFetch=fetch;window.fetch=(url,opts)=>String(url).includes('/confirm')?Promise.reject(new TypeError('offline fixture')):actualFetch(url,opts);${sel('[data-act=f-confirm]')}.click()`);await until(()=>b.eval(`JSON.parse(localStorage.getItem('cct-outbox-v1')||'[]').length===1`),'queued event');
 const queued=await b.eval(`JSON.parse(localStorage.getItem('cct-outbox-v1'))`);check(Number.isSafeInteger(queued[0].assignment_revision),'offline event retains displayed assignment revision');
 await call('PATCH','/api/crew/'+crew.id,{agent_id:null});await call('PATCH','/api/crew/'+crew.id,{agent_id:uid});await b.eval(`window.fetch=actualFetch;import('/js/api.js').then(m=>m.flushOutbox(${uid}))`);await until(()=>b.eval(`!!JSON.parse(localStorage.getItem('cct-outbox-v1'))[0].error`),'stale event retained');
 await b.go('/field/'+crew.id);await present('[data-act=f-confirm]');check(await b.eval(`${sel('[data-act=f-confirm]')}.dataset.idx==='0'`),'away/back assignment never overlays or commits stale confirmation');check((await call('GET','/api/field',undefined,field)).crew.find(c=>c.id===crew.id).cps.every(c=>c.actual===null),'server checkpoint remains unchanged');await b.shot('stale-assignment-390');
 check(b.logs.length===0,'no browser console errors');writeFileSync(join(OUT,'import-assignment-evidence.json'),JSON.stringify({job,importId:id,crewId:crew.id,checks:13,scope:'synthetic local browser; no customer UAT'},null,2));
}finally{b.close();}
