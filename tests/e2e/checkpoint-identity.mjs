import assert from 'node:assert/strict';
import {browser,login,BASE,ADMIN_USER,FIELD_PASS,photo} from './cdp.mjs';
const admin=await login(ADMIN_USER,process.env.ADMIN_PASS),staff=await login('somsak',FIELD_PASS);
const call=async(path,body)=>{const r=await fetch(BASE+path,{method:body?'PATCH':'GET',headers:{cookie:'cct_s='+admin,'x-cct':'1','content-type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
const full=await call('/api/jobs/1'),crew=full.crew.find(c=>c.name==='Joel Castillo');
const b=await browser();const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(selector='[data-act="f-confirm"],[data-chg="f-snap"]'){for(let i=0;i<100;i++){if(await b.eval(`!!document.querySelector(${JSON.stringify(selector)})`))return;await sleep(100);}throw Error('Field checkpoint button did not render');}
try{
 await b.size(390,844,true);await b.go('/api/health',50);await b.cookie(staff);await b.go('/field/'+crew.id);await ready();
 await b.eval(`window.actualFetch=fetch;window.fetch=(url,opts)=>String(url).includes('/confirm')?Promise.reject(new TypeError('offline fixture')):actualFetch(url,opts);document.querySelector('[data-act="f-confirm"]').click()`);await sleep(1900);
 const queued=await b.eval(`JSON.parse(localStorage.getItem('cct-outbox-v1'))`);assert.equal(queued.length,1);assert.equal(queued[0].cp_id,crew.cps[0].id);
 await call('/api/crew/'+crew.id,{type:'off'});
 await b.eval(`window.fetch=actualFetch;import('/js/api.js').then(m=>m.flushOutbox(${queued[0].uid}))`);
 const retained=await b.eval(`JSON.parse(localStorage.getItem('cct-outbox-v1'))`);assert.equal(retained.length,1);assert.ok(retained[0].error);
 await b.go('/field/'+crew.id,350);await ready();const latest=(await call('/api/jobs/1')).crew.find(c=>c.id===crew.id);assert.ok(latest.cps.every(x=>x.actual===null));
 assert.equal(await b.eval(`document.querySelector('[data-act="f-confirm"],[data-chg="f-snap"]').dataset.idx`),'0');
 console.log('PASS CI01 offline identity retained; replaced checkpoint rejected and never overlaid');
 await b.eval(`const a=JSON.parse(localStorage.getItem('cct-outbox-v1'));delete a[0].cp_id;delete a[0].error;localStorage.setItem('cct-outbox-v1',JSON.stringify(a));import('/js/api.js').then(m=>m.flushOutbox(${queued[0].uid}))`);
 const legacy=await b.eval(`JSON.parse(localStorage.getItem('cct-outbox-v1'))`);assert.ok(legacy[0].error);assert.equal(legacy.length,1);
 console.log('PASS CI02 legacy queue receives refresh error and keeps recoverable work');
 // The new off-signer point requires a stored photo. Meet that requirement before
 // testing repeated confirmation; never disable the integrated evidence policy.
 const q=new URLSearchParams({assignment_revision:String(latest.assignment_rev),cp_idx:'0',cp_id:String(latest.cps[0].id),point:latest.cps[0].name});
 const uploaded=await fetch(BASE+'/api/crew/'+crew.id+'/photos?'+q,{method:'POST',headers:{cookie:'cct_s='+staff,'x-cct':'1','content-type':'image/jpeg'},body:photo()});
 assert.equal(uploaded.status,200);
 await b.go('/field/'+crew.id,350);await ready('[data-act="f-confirm"]');
 await b.eval(`const t=document.querySelector('[data-act="f-confirm"]');t.click();t.click()`);await sleep(1900);
 const confirmed=(await call('/api/jobs/1')).crew.find(c=>c.id===crew.id);assert.equal(confirmed.cps.filter(x=>x.actual!==null).length,1);assert.equal(confirmed.cps[0].id,latest.cps[0].id);
 console.log('PASS CI03 repeat clicks confirm exactly one current checkpoint');
 await b.shot('identity-retained-390');assert.deepEqual(b.logs,[]);
}finally{b.close();}
