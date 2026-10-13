import assert from 'node:assert/strict';
import {browser,login,BASE,ADMIN_USER} from './cdp.mjs';
const ck=await login(ADMIN_USER,process.env.ADMIN_PASS);
async function call(path,body){const r=await fetch(BASE+path,{method:body?'PATCH':'GET',headers:{cookie:'cct_s='+ck,'x-cct':'1','content-type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
const b=await browser();
try{
 await b.go('/api/health',50);await b.cookie(ck);
 for(const [hours,label] of [[23,'24 ชม.'],[5,'6 ชม.'],[-1,'เกินกำหนด']]){
  assert.equal((await call('/api/jobs/1',{imm_deadline:Date.now()+hours*3600000})).status,200);
  await b.go('/jobs/1/8',450);assert.ok(await b.eval(`document.body.innerText.includes(${JSON.stringify(label)})`));console.log('PASS IU '+label+' deadline banner');
 }
 for(const width of [360,390,1366]){
  await b.size(width,844,width<700);await b.go('/jobs/1/4',300);
  assert.ok(await b.eval(`document.body.innerText.includes('24 ชั่วโมง')&&document.body.innerText.includes('6 ชั่วโมง')&&document.body.innerText.includes('ไม่ใช่หลักฐาน')`));
  assert.ok(await b.eval('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'));
  await b.shot('deadline-step4-'+width);console.log('PASS IU status wording and layout '+width);
 }
 const full=(await call('/api/jobs/1')).data,c=full.crew.find(c=>c.name==='Arun Pillai');
 assert.equal((await call('/api/crew/'+c.id,{s4:{oktb:true,meet:false,imm:false}})).status,409);console.log('PASS IU incomplete crew cannot newly mark OKTB issued');
 const before=full.crew.map(c=>({id:c.id,s4:c.s4}));await call('/api/jobs/1',{oktb:{to:'Synthetic recipient',date:'2026-10-13'}});
 const after=(await call('/api/jobs/1')).data.crew.map(c=>({id:c.id,s4:c.s4}));assert.deepEqual(after,before);console.log('PASS IU document options never manufacture immigration/airline status');
 assert.deepEqual(b.logs,[]);
}finally{b.close();}
