import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {browser,login,BASE,OUT,ADMIN_USER,FIELD_PASS} from './cdp.mjs';

// Run against an isolated first-run local database with an admin but no seed data.
const token=await login(ADMIN_USER,process.env.ADMIN_PASS),checks=[];
async function api(method,path,body){const r=await fetch(BASE+path,{method,headers:{cookie:'cct_s='+token,'x-cct':'1','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200,method+' '+path);return r.json();}
const b=await browser(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('PASS '+label);};
async function page(path,selector){await b.go(path,150);for(let i=0;i<60;i++){if(await b.eval(`!!document.querySelector(${JSON.stringify(selector)})`))return;await sleep(100);}throw Error('Page not ready '+path);}
async function mockStorage(level){await b.eval(`window.realStorageFetch=window.realStorageFetch||fetch;window.fetch=(url,opts)=>String(url)==='/api/storage'?Promise.resolve(new Response(JSON.stringify(${JSON.stringify({usedBytes:level==='full'?10*1024**3:8.5*1024**3,limitBytes:10*1024**3,percent:level==='full'?100:85,warningPercent:75,level})}),{status:200,headers:{'content-type':'application/json'}})):window.realStorageFetch(url,opts)`);await b.eval(`import('/js/app.js').then(a=>a.go('/jobs'))`);await sleep(250);}
try{
 await b.size(1280,900);await b.go('/api/health',50);await b.cookie(token);
 await page('/jobs','.card.start');
 const links=await b.eval(`Array.from(document.querySelectorAll('.card.start a')).map(a=>a.getAttribute('href'))`);
 ok(['/admin/users','/admin/vehicles','/admin/hotels','/jobs/new'].every(p=>links.includes(p)),'first admin sees setup links before any jobs exist');
 ok(await b.eval(`document.querySelector('[data-storage-level="ok"]').textContent.includes('0 KB')`),'empty system shows measured zero storage usage');
 await b.shot('first-admin-desktop');
 await page('/jobs/new','#newjob');
 const fields=await b.eval(`Array.from(document.querySelectorAll('#newjob input')).map(i=>({name:i.name,required:i.required,help:i.closest('label').querySelector('.fhelp')?.textContent}))`);
 ok(fields.length===9&&fields.every(f=>f.help)&&fields.filter(f=>f.required).map(f=>f.name).join(',')==='vessel','all nine job fields have help and only vessel is required');
 for(const w of [360,390,768,1280]){await b.size(w,900,w<700);ok(await b.eval('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),'form fits viewport '+w);}
 await b.size(390,844,true);await b.shot('new-job-help-mobile');
 await b.eval(`document.querySelector('[name="vessel"]').value='TEST VESSEL ONLY';document.querySelector('#newjob').requestSubmit()`);
 for(let i=0;i<60;i++){if(await b.eval('!!document.querySelector(".jobcard")'))break;await sleep(100);}
 ok((await api('GET','/api/jobs')).jobs.some(j=>j.vessel==='TEST VESSEL ONLY'),'vessel-only form submission creates a usable job');
 await page('/admin/general','#genform');
 ok(await b.eval(`document.querySelector('[name="storage_warning_percent"]').value==='80'&&document.querySelector('#genform').textContent.includes('ค่าเริ่มต้น 80%')`),'admin sees configurable default 80 percent without a quota or price change');
 await b.eval(`document.querySelector('[name="storage_warning_percent"]').value='75';document.querySelector('#genform').requestSubmit()`);
 for(let i=0;i<40;i++){if((await api('GET','/api/storage')).warningPercent===75)break;await sleep(100);}
 const saved=await api('GET','/api/storage');ok(saved.warningPercent===75&&saved.limitBytes===10*1024**3,'warning threshold saves while storage quota remains unchanged');
 await page('/admin/general','#genform');ok(await b.eval(`document.querySelector('[name="storage_warning_percent"]').value==='75'`),'saved warning threshold survives page reload');
 await mockStorage('warning');
 ok(await b.eval(`document.querySelector('[data-storage-level="warning"]').textContent.includes('ขออนุมัติบริษัทก่อน')&&!!document.querySelector('.jobtile')`),'near-full notice requests cost approval and leaves the job list usable');
 await b.shot('storage-warning-mobile');
 await mockStorage('full');ok(await b.eval(`document.querySelector('[data-storage-level="full"]').textContent.includes('พื้นที่รูปเต็มแล้ว')`),'full quota has a distinct notice');
 await b.eval(`window.fetch=(url,opts)=>String(url)==='/api/storage'?Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}})):window.realStorageFetch(url,opts);import('/js/app.js').then(a=>a.go('/jobs'))`);await sleep(250);
 ok(await b.eval(`document.querySelector('.storage-status').textContent.includes('ตรวจพื้นที่รูปไม่ได้')&&!!document.querySelector('.jobtile')`),'storage-read failure leaves existing jobs accessible');
 await api('POST','/api/users',{username:'officefixture',name:'TEST OFFICE',role:'office',password:FIELD_PASS});
 const v=await api('POST','/api/vehicles',{name:'TEST VAN',plate:'TEST 001',driver:'TEST DRIVER'});
 const h=await api('POST','/api/hotels',{name:'TEST HOTEL'});
 await page('/jobs','.jobtile');ok(await b.eval('!document.querySelector(".card.start")'),'setup checklist disappears when active resources exist');
 await api('PATCH','/api/vehicles/'+v.id,{active:false});await api('PATCH','/api/hotels/'+h.id,{active:false});
 await page('/jobs','.card.start');ok(await b.eval(`document.querySelectorAll('.card.start li.done').length===1`),'inactive vehicles and hotels do not count as completed setup');
 await b.cookie(await login('officefixture',FIELD_PASS));await page('/jobs','.jobtile');
 ok(await b.eval(`!document.querySelector('.card.start')&&!!document.querySelector('.storage-status')&&!document.querySelector('.storage-status a')`),'office role sees storage status without admin setup or configuration links');
 ok(b.logs.length===0,'no browser console errors');
 mkdirSync(OUT,{recursive:true});writeFileSync(join(OUT,'onboarding-storage-checks.json'),JSON.stringify({localOnly:true,mockedUiStates:['warning','full','storage-unavailable'],checks,passed:checks.length,failed:0},null,2));
 console.log(`PASS ${checks.length} / FAIL 0 / CONSOLE ${b.logs.length}`);
}finally{b.close();}
