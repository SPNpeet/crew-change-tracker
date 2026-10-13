import assert from 'node:assert/strict';
import {browser,login,BASE,ADMIN_USER} from './cdp.mjs';
const ck=await login(ADMIN_USER,process.env.ADMIN_PASS),headers={cookie:'cct_s='+ck,'x-cct':'1','content-type':'application/json'};
const get=async path=>{const r=await fetch(BASE+path,{headers});assert.equal(r.status,200);return r.json();};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<100;n++){if(await fn())return;await sleep(100);}throw Error('Timed out waiting for UI');}
const job=await get('/api/jobs/1'),agent=job.crew.find(c=>c.agent_id).agent_id,vehicle=job.crew.find(c=>c.vehicle_id).vehicle_id;
const names=['Synthetic both <img src=x onerror="window.gateInjected=1">','Synthetic agent only & <b>escaped</b>','Synthetic vehicle only'];
const b=await browser();
try{
 await b.size(1280,900);await b.go('/api/health',50);await b.cookie(ck);
 for(const name of names){await b.go('/jobs/1/1',100);await until(()=>b.eval('!!document.querySelector("#addcrew")'));await b.eval(`(()=>{const e=document.querySelector('#addcrew [name=name]');e.value=${JSON.stringify(name)};e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#addcrew').requestSubmit();})()`);await until(async()=>(await get('/api/jobs/1')).crew.some(c=>c.name===name));}
 const fixtures=(await get('/api/jobs/1')).crew.filter(c=>names.includes(c.name));
 async function assign(c,field,value){await b.go('/jobs/1/7',100);await until(()=>b.eval('!!document.querySelector("select[data-f=vehicle_id]")'));await b.eval(`(()=>{const e=document.querySelector('select[data-f="${field}"][data-id="${c.id}"]');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(async()=>(await get('/api/jobs/1')).crew.find(x=>x.id===c.id)[field]===value);}
 await assign(fixtures.find(c=>c.name===names[1]),'vehicle_id',vehicle);await assign(fixtures.find(c=>c.name===names[2]),'agent_id',agent);
 await b.go('/jobs/1/6',100);await until(()=>b.eval('!!document.querySelector("#mailtext")'));await b.shot('B6-missing-assignment-details');
 const rows=await b.eval("[...document.querySelectorAll('[data-gate-missing]')].map(e=>({id:Number(e.dataset.gateMissing),text:e.textContent}))");
 assert.equal(rows.length,3,'B6 must identify each missing person, rather than only show a generic warning');
 for(const c of fixtures){const row=rows.find(r=>r.id===c.id);assert.ok(row?.text.includes(c.name),'exact person name preserved');const expected=c.name===names[0]?['ผู้ดูแล','รถ']:c.name===names[1]?['ผู้ดูแล']:['รถ'];for(const term of expected)assert.ok(row.text.includes(term));if(expected.length===1)assert.ok(!row.text.includes(expected[0]==='รถ'?'ผู้ดูแล':'รถ'));}
 console.log('PASS B6 names each missing person and the exact missing agent/vehicle');
 assert.equal(await b.eval('!!window.gateInjected'),false);assert.equal(await b.eval('document.querySelectorAll("[data-gate-missing] img,[data-gate-missing] b").length'),0);console.log('PASS B6 escapes untrusted crew names');
 for(const c of fixtures){await assign(c,'agent_id',agent);await assign(c,'vehicle_id',vehicle);}
 await b.go('/jobs/1/6',100);await until(()=>b.eval('!!document.querySelector("#mailtext")'));assert.equal(await b.eval('document.querySelectorAll("[data-gate-missing]").length'),0);await b.shot('B6-complete');console.log('PASS B6 removes the warning after all assignments are complete');
 const refs=await get('/api/me'),person=job.crew.find(c=>c.passport&&c.agent_id===agent&&c.vehicle_id===vehicle),staff=refs.users.find(u=>u.id===agent),van=refs.vehicles.find(v=>v.id===vehicle),draft=await b.eval('document.querySelector("#mailtext").value');
 for(const value of [person.name,person.passport,staff.name_en||staff.name,van.driver_en||van.driver,van.plate])assert.ok(draft.includes(value),'Gate includes '+value);
 console.log('PASS B6 completed Gate draft includes crew, passport, agent, driver and registration');
}finally{b.close();}
