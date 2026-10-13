import assert from 'node:assert/strict';
import {mkdirSync,existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {browser,login,BASE,OUT,FIELD_PASS} from './cdp.mjs';
import {pdf} from '../gen.mjs';
import {PDFDocument} from '../../public/js/vendor/pdf-lib.esm.min.js';
// Fixtures are synthetic. Real browser controls drive review, groups, flights,
// preparation, downloads, self-approval, and manual submission on a local worker.
const ck=await login('pranee',FIELD_PASS),field=await login('somsak',FIELD_PASS);
async function call(method,path,body,cookie=ck){const bytes=body instanceof Uint8Array;const r=await fetch(BASE+path,{method,headers:{cookie:'cct_s='+cookie,'x-cct':'1',...(body?{'content-type':bytes?'application/pdf':'application/json'}:{})},body:body?bytes?body:JSON.stringify(body):undefined});return{status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer())};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const check=(value,label)=>{assert.ok(value,label);console.log('PASS PU '+label);};
const job=ok(await call('POST','/api/jobs',{vessel:'SYNTHETIC PACKET AUDIT',imm_deadline:Date.now()+5*3600000})).id;
const names=['Synthetic Alpha','Synthetic Beta'];
const ids=ok(await call('POST',`/api/jobs/${job}/crew`,{crew:names.map((name,i)=>({name,rank:'AB',type:'on',nationality:'PH',passport:'SYN-P-'+i,passport_exp:'2031-12-31',sirb_no:'SYN-S-'+i,sirb_exp:'2031-12-31'}))})).ids;
const fileIds=[];
async function upload(i,kind){const r=ok(await call('POST',`/api/crew/${ids[i]}/files?kind=${kind}&name=synthetic-${i}-${kind}.pdf`,pdf(kind==='ticket'?[names[i]+' ticket leg one',names[i]+' ticket leg two']:[names[i]+' '+kind])));fileIds.push(r.id);return r.id;}
for(let i=0;i<2;i++)for(const kind of i?['passport','sirb']:['passport','sirb','ticket'])await upload(i,kind);
const get=async()=>ok(await call('GET',`/api/workflow/jobs/${job}`));
const b=await browser(),DL=join(OUT,'downloads');mkdirSync(DL,{recursive:true});
const sel=s=>`document.querySelector(${JSON.stringify(s)})`;
async function until(fn,label){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
async function present(s){await until(()=>b.eval(`!!${sel(s)}`),'element '+s);}
async function click(s){await present(s);await b.eval(`${sel(s)}.click()`);}
async function fill(s,value){await present(s);await b.eval(`(()=>{const e=${sel(s)};e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function submit(s){await present(s);check(await b.eval(`${sel(s)}.reportValidity()`),'valid form '+s);await b.eval(`${sel(s)}.requestSubmit()`);}
async function openPerson(id){await b.eval(`${sel(`form[data-packet-form=person][data-id="${id}"]`)}.closest('details').open=true`);}
async function rendered(){await present('[data-incomplete-count]');}
async function navigate(path){await b.go(path,150);await rendered();}
async function mutation(form){const rev=(await get()).job.rev;await submit(form);await until(async()=>((await get()).job.rev>rev),'saved mutation');await until(()=>b.eval(`!document.querySelector(${JSON.stringify(form+' button[type=submit]')})?.disabled`),'render after mutation');}
async function review(id){await b.eval(`${sel(`form[data-packet-form=file][data-id="${id}"]`)}.closest('details').open=true`);await click(`form[data-packet-form=file][data-id="${id}"] input[type=checkbox]`);await mutation(`form[data-packet-form=file][data-id="${id}"]`);}
const legs=[{flight:'EX101',from:'MNL',to:'HKG',departure:'2026-10-20T08:00+08:00',departure_zone:'Asia/Manila',arrival:'2026-10-20T10:00+08:00',arrival_zone:'Asia/Hong_Kong'},{flight:'EX202',from:'HKG',to:'BKK',departure:'2026-10-20T12:00+08:00',departure_zone:'Asia/Hong_Kong',arrival:'2026-10-20T14:00+07:00',arrival_zone:'Asia/Bangkok'}];
async function verifyPerson(i,groupId){const id=ids[i],form=`form[data-packet-form=person][data-id="${id}"]`;await openPerson(id);await fill(form+' [name=group_id]',String(groupId));await fill(form+' [name=source_file_id]',String(fileIds[i?3:0]));for(let k=0;k<2;k++){await click(form+' [data-act=packet-add-leg]');for(const[name,value]of Object.entries(legs[k]))await fill(form+` .packet-leg:nth-child(${k+1}) [name=${name}]`,i&&name==='flight'?value+'B':value);}await click(form+' [name=verified]');await mutation(form);}
async function prepare(){const prior=(await get()).packets.length;await submit('form[data-packet-form=prepare]');await until(async()=>((await get()).packets.length>prior),'prepared packet');await present('#packet-detail [data-act=packet-pdf]');return (await get()).packets[0].id;}
async function download(kind,id){const name=kind==='pdf'?`review-packet-${id}.pdf`:`packet-${id}.json`;await click(`[data-act=packet-${kind}][data-id="${id}"]`);await until(()=>existsSync(join(DL,name))&&!readdirSync(DL).some(f=>f.endsWith('.crdownload')),'download '+name);return readFileSync(join(DL,name));}
try{
 await b.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));"});
 await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:DL});
 await b.go('/api/health',50);await b.cookie(ck);await b.go(`/jobs/${job}/4`,200);await click(`a[href="/jobs/${job}/packets"]`);await rendered();
 check(await b.eval('location.pathname.endsWith("/packets")'),'office enters packet workflow from existing job navigation');
 check(await b.eval(`${sel('[data-incomplete-count]')}.textContent==='2'`),'unreviewed evidence counts two people once');
 await click('section[aria-labelledby=missing-title] summary');
 check(await b.eval(`document.querySelector('section[aria-labelledby=missing-title]').innerText.includes('Synthetic Alpha')&&document.querySelector('section[aria-labelledby=missing-title]').innerText.includes('Synthetic Beta')`),'incomplete count drills into named people and missing items');
 await fill('form[data-packet-form=group] [name=name]','Synthetic Group A');await mutation('form[data-packet-form=group]');const groupId=(await get()).groups[0].id;
 for(const id of fileIds)await review(id);
 await verifyPerson(0,groupId);await verifyPerson(1,groupId);
 const partialState=await get();check(partialState.preview.manifest.incomplete_people===1&&partialState.preview.manifest.omissions[0].name===names[1]&&partialState.preview.manifest.omissions[0].group_name==='Synthetic Group A','named group drilldown reports only missing ticket for Beta');
 check(partialState.people.every(p=>JSON.parse(p.flight_legs).length===2),'two connecting flight legs saved through person forms');
 for(const width of [360,390,1366]){await b.size(width,844,width<700);await navigate(`/jobs/${job}/packets`);await openPerson(ids[0]);await click('section[aria-labelledby=missing-title] summary');check(await b.eval('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),'packet page and expanded flight form fit '+width);await b.shot('packet-form-'+width);}
 const partial=await prepare();check(await b.eval(`${sel('[data-act=packet-approve]')}.disabled&&${sel('form[data-packet-form=submit] button')}.disabled`),'partial packet disables both approval and actual submission');
 const partialJSON=JSON.parse(await download('manifest',partial));check(partialJSON.snapshot.manifest.incomplete_people===1&&partialJSON.snapshot.manifest.omissions[0].missing.includes('ticket'),'downloaded JSON retains exact omissions');
 const partialPDF=await download('pdf',partial),partialDoc=await PDFDocument.load(partialPDF);check(partialDoc.getPageCount()>=7&&partialDoc.getPageCount()<=8,'partial PDF contains omission pages plus all six reviewed evidence pages');writeFileSync(join(OUT,'partial.pdf'),partialPDF);
 check((await get()).packets[0].approved_at===null&&(await get()).packets[0].submitted_at===null,'partial export never creates approval or submission');
 const ticket=await upload(1,'ticket');await navigate(`/jobs/${job}/packets`);await review(ticket);check((await get()).preview.manifest.incomplete_people===0,'adding and reviewing the missing ticket completes both people');
 const complete=await prepare();await click('[data-act=packet-approve]');await until(async()=>!!(await get()).packets.find(p=>p.id===complete).approved_at,'office self-approval');await present('form[data-packet-form=submit]');
 const packet=ok(await call('GET','/api/workflow/packets/'+complete));check(packet.approval.approved_role==='office'&&packet.approval.approved_by===packet.prepared_by,'office self-approval binds exact preparer and revision');
 const completePDF=await download('pdf',complete);check((await PDFDocument.load(completePDF)).getPageCount()>=9,'complete PDF includes both two-page tickets');writeFileSync(join(OUT,'complete.pdf'),completePDF);
 await fill('form[data-packet-form=submit] [name=destination]','Synthetic submission desk');await fill('form[data-packet-form=submit] [name=evidence_ref]','Synthetic receipt only');
 await until(()=>Date.now()>packet.approval.approved_at+1100,'next representable local second');const time=await b.eval(`(()=>{const d=new Date();d.setMilliseconds(0);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19)})()`);await fill('form[data-packet-form=submit] [name=submitted_at]',time);await submit('form[data-packet-form=submit]');await until(async()=>!!(await get()).packets.find(p=>p.id===complete).submitted_at,'manual submission');
 const recorded=ok(await call('GET','/api/workflow/packets/'+complete));check(recorded.submission.submitted_at>=recorded.approval.approved_at&&recorded.submission.evidence_ref==='Synthetic receipt only','manual record stores destination, evidence and time after approval');
 await b.go(`/jobs/${job}/4`,150);await present('[data-act=o-s4][data-key=imm]');check(await b.eval(`[...document.querySelectorAll('[data-act=o-s4][data-key=imm]')].every(e=>e.textContent.includes('บันทึกยื่นแล้ว'))`),'legacy office status reflects current packet submission');
 check(await b.eval(`document.body.innerText.includes('หลักฐานตอบรับและอนุมัติแยกกัน')`),'office keeps submission distinct from authority acceptance');
 const before=(await get()).people.map(p=>({id:p.crew_id,group:p.group_id,legs:p.flight_legs}));ok(await call('PATCH','/api/crew/'+ids[0],{vehicle_id:1}));check(JSON.stringify((await get()).people.map(p=>({id:p.crew_id,group:p.group_id,legs:p.flight_legs})))===JSON.stringify(before),'per-person vehicle assignment preserves groups and individual flight legs');
 await navigate(`/jobs/${job}/packets`);await click(`[data-act=packet-view][data-id="${complete}"]`);await present('#packet-detail [data-act=packet-pdf]');check(await b.eval(`${sel('#packet-detail')}.textContent.includes('ข้อมูลปัจจุบันเปลี่ยนแล้ว')`),'source change visibly marks the recorded packet stale');
 const immutable=ok(await call('GET','/api/workflow/packets/'+complete));check(immutable.snapshot.revision===recorded.snapshot.revision,'prepared snapshot remains immutable after source changes');
 check((await call('GET',`/api/workflow/jobs/${job}`,undefined,field)).status===403,'field session cannot read packet identities through API');
 await b.cookie(field);await b.go(`/jobs/${job}/packets`,150);await until(()=>b.eval('location.pathname==="/field"'),'field route redirect');check(true,'field session cannot enter document page');
 check((await call('POST','/api/users',{username:'forbidden',name:'Synthetic forbidden',password:'not-real-password',role:'admin'})).status===403,'office cannot create users through actual server route');
 check(b.logs.length===0,'no browser exceptions or console errors');check((await b.eval('window.__csp||[]')).length===0,'no CSP violations');
 writeFileSync(join(OUT,'packet-evidence.json'),JSON.stringify({job,ids,partial,complete,partialPages:partialDoc.getPageCount(),completePages:(await PDFDocument.load(completePDF)).getPageCount(),revision:recorded.snapshot.revision,scope:'synthetic local worker and isolated browser; no external sending or customer UAT'},null,2));
}finally{b.close();}
