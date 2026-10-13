import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {browser,login,BASE,OUT,ADMIN_USER} from './cdp.mjs';
const token=await login(ADMIN_USER,process.env.ADMIN_PASS),vessel='TEST-DOT-BROWSER-20261012-1810';
async function api(method,path,body){const r=await fetch(BASE+path,{method,headers:{cookie:'cct_s='+token,'x-cct':'1','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
// Match the reported route with disposable local jobs; never use production data.
await api('POST','/api/jobs',{vessel:'SYNTHETIC LAYOUT FILLER 2'});await api('POST','/api/jobs',{vessel:'SYNTHETIC LAYOUT FILLER 3'});
const job=await api('POST','/api/jobs',{vessel});assert.equal(job.id,4);await api('POST','/api/jobs/4/crew',{name:'Synthetic Layout Crew',type:'on'});
const b=await browser(),results=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(){for(let i=0;i<80;i++){if(await b.eval('!!document.querySelector("#addcrew")'))return;await sleep(100);}throw Error('Office page unavailable');}
try{
 await b.go('/api/health',50);await b.cookie(token);
 for(const width of [1180,1181,1366,1024,921,920,901,900,768,390,360]){
  await b.size(width,757,width<700);await b.go('/jobs/4/1',100);await ready();await b.eval('document.fonts.ready.then(()=>true)');
  const m=await b.eval(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height};};const title=document.querySelector('.jobcard .v');return{viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,side:rect('.office > .side'),card:rect('.jobcard'),section:rect('.office > section'),heading:rect('.sh h1'),title:rect('.jobcard .v'),edit:rect('[data-act=o-editjob]'),titleText:title.textContent,titleOverflow:getComputedStyle(title).textOverflow,titleClientWidth:title.clientWidth,titleScrollWidth:title.scrollWidth};})()`);
  await b.shot('long-vessel-'+width,false);
  const contained=m.card.x>=m.side.x-1&&m.card.right<=m.side.right+1;
  const columns=m.section.x>m.side.x+20;
  const noOverlap=!columns||m.card.right<=m.section.x-1;
  const passed=contained&&noOverlap&&m.pageWidth<=width+1&&m.titleText===vessel&&m.edit.right<=m.card.right+1&&m.title.right<=m.edit.x+1;
  results.push({width,route:'/jobs/4/1',passed,contained,noOverlap,columns,overlapPixels:columns?Math.max(0,m.card.right-m.section.x):0,measurements:m});
  console.log((passed?'PASS ':'FAIL ')+'long vessel layout at '+width+'x757 '+JSON.stringify({sideWidth:m.side.width,cardWidth:m.card.width,cardRight:m.card.right,sectionX:m.section.x,overlapPixels:results.at(-1).overlapPixels,pageWidth:m.pageWidth}));
 }
 await b.size(1180,757);await b.go('/jobs/4/1',100);await ready();await b.eval('document.querySelector("[data-act=o-editjob]").click()');await sleep(100);assert.equal(await b.eval('document.querySelector("#dlg [name=vessel]").value'),vessel);console.log('PASS full vessel name remains available in the edit dialog');
 writeFileSync(join(OUT,'long-vessel-measurements.json'),JSON.stringify({baseCommit:'41b67b155d304d1cea72dc0fbe18e3509a97b2c4',fixture:'synthetic local reproduction',vessel,results},null,2));
 if(results.some(r=>!r.passed))process.exitCode=1;
}finally{b.close();}
