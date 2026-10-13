// Fresh synthetic local database and browser profile per suite; never Browser1.
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=process.cwd(),evidence=resolve('audit-evidence/ui',process.env.AUDIT_RUN||new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(evidence,{recursive:true});
const wr=resolve('node_modules/wrangler/bin/wrangler.js'),PORT=8962,BASE=`http://127.0.0.1:${PORT}`;
const suites=process.argv.slice(2);if(!suites.length)throw Error('Specify suite filenames without .mjs');
const env={...process.env,BASE,ADMIN_USER:'somying',ADMIN_PASS:'synthetic-ui-fixture-only',CDP_PORT:'9453',WIDTHS:'360,390,1366',WRANGLER_SEND_METRICS:'false',WRANGLER_HIDE_BANNER:'true'};
try{await fetch(BASE+'/api/health');throw Error('Local audit port already occupied');}catch(e){if(e.message.includes('occupied'))throw e;}
function run(file,args,options={}){return new Promise(resolve=>{let out='';const p=spawn(file,args,{env,windowsHide:true,...options});p.stdout?.on('data',b=>out+=b);p.stderr?.on('data',b=>out+=b);p.on('exit',code=>resolve({code,out}));p.on('error',e=>resolve({code:-1,out:out+e.stack}));});}
const results=[];
for(const suite of suites){
 const dir=join(evidence,suite);mkdirSync(dir,{recursive:true});const persist=join(dir,'state');if(existsSync(persist))throw Error('Refusing to reuse an existing fixture: choose a fresh AUDIT_RUN');env.OUT=join(dir,'out');env.SHOTS=suite==='audit-app'?'account,admin-users,step1,crew,owner':'';
 const migrated=await run(process.execPath,[wr,'d1','migrations','apply','cct','--local','--persist-to',persist]);writeFileSync(join(dir,'migration.log'),migrated.out);if(migrated.code!==0)throw Error('Local migrations failed');
 let log='';const server=spawn(process.execPath,[wr,'dev','--local','--ip','127.0.0.1','--port',String(PORT),'--persist-to',persist,'--var','SETUP_KEY:local-audit-key','--test-scheduled'],{env,windowsHide:true});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(BASE+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error('Local startup failed');
  const setup=await fetch(BASE+'/api/setup',{method:'POST',headers:{'x-cct':'1','content-type':'application/json'},body:JSON.stringify({key:'local-audit-key',username:env.ADMIN_USER,password:env.ADMIN_PASS,name:'Synthetic Audit Admin'})});if(!setup.ok)throw Error('Synthetic setup failed '+setup.status);
  if(suite!=='onboarding-storage'){const seed=await run(process.execPath,['scripts/seed-local.mjs']);writeFileSync(join(dir,'seed.log'),seed.out);if(seed.code)throw Error('Synthetic seed failed');}
  console.log('RUN '+suite);const result=await run(process.execPath,['tests/e2e/'+suite+'.mjs']);writeFileSync(join(dir,'test.log'),result.out);const record={suite,exitCode:result.code,passLines:result.out.split(/\r?\n/).filter(l=>l.startsWith('PASS ')&&!/^PASS \d+ \/ FAIL/.test(l)).length};results.push(record);console.log(JSON.stringify(record));
 }catch(e){results.push({suite,error:e.message});console.log('ERROR '+suite+': '+e.message);}
 finally{try{execFileSync('taskkill',['/pid',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}writeFileSync(join(dir,'server.log'),log);}
 writeFileSync(join(evidence,'results.json'),JSON.stringify(results,null,2));
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
