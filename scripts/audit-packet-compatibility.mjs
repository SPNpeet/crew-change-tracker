// Read-only input snapshots, temporary synthetic databases, no production writes.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import worker,{dumpAll} from '../src/index.js';
import {sha256} from '../src/util.js';
const path=process.argv[2];if(!path)throw Error('Supply the explicit proposed 0005 SQL file');
const proposed=readFileSync(path,'utf8'),names=readdirSync('migrations').sort(),base=names.filter(n=>n<'0005_').map(n=>readFileSync('migrations/'+n,'utf8')),packet=readFileSync('migrations/0006_packet_workflow.sql','utf8'),extra=names.filter(n=>n>='0007_').map(n=>readFileSync('migrations/'+n,'utf8'));
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
const sqls=[...base,proposed,packet,...extra];for(const sql of sqls)db.exec(sql);
const other=new DatabaseSync(':memory:');for(const sql of [...base,packet,proposed,...extra])other.exec(sql);
const schema=d=>d.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY name").all();assert.deepEqual(schema(db),schema(other));other.close();console.log('PASS PC01 additive 0005/0006 commute without migration filename replacement');
db.exec("INSERT INTO users(id,username,name,role,pw_hash,pw_salt,created_at) VALUES(1,'synthetic','Synthetic Office','office','x','x',1); INSERT INTO jobs(id,vessel,owner_token,created_at,updated_at) VALUES(1,'SYNTHETIC COMPATIBILITY','synthetic-owner',1,1); INSERT INTO crew(id,job_id,name,type,created_at) VALUES(1,1,'Synthetic Crew','on',1); UPDATE users SET avatar_key='avatars/synthetic',avatar_size=5 WHERE id=1; UPDATE crew SET driver_id=1 WHERE id=1");
db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await sha256('synthetic-cookie'),1,Date.now()+3600000,1);
const prepare=(sql,args=[])=>({bind:(...a)=>prepare(sql,a),async all(){const st=db.prepare(sql),results=st.columns().length?st.all(...args):(st.run(...args),[]);return{results,meta:{changes:db.prepare('SELECT changes() n').get().n,last_row_id:db.prepare('SELECT last_insert_rowid() n').get().n}};},async first(){return(await this.all()).results[0]||null;},async run(){return this.all();}});
const env={DB:{prepare,async batch(st){db.exec('BEGIN');try{const rows=[];for(const x of st)rows.push(await x.all());db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;}}},FILES:{get:async()=>null,put:async()=>{},delete:async()=>{}}};
async function call(w,method,path,body){const r=await w.fetch(new Request('https://synthetic.test/api'+path,{method,headers:{cookie:'cct_s=synthetic-cookie','x-cct':'1','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env,{});return{status:r.status,data:await r.json()};}
let r=await call(worker,'GET','/workflow/jobs/1');assert.equal(r.status,200);const rev=r.data.job.rev;
r=await call(worker,'POST','/workflow/jobs/1/packets',{expected_revision:rev,selected_ids:[1],request_key:'synthetic-compatibility-key'});assert.equal(r.status,200);assert.equal(r.data.status,'partial');const packetId=r.data.id;console.log('PASS PC02 current packet router works with the proposed 0005 columns present');
const dump=await dumpAll(env),dir=mkdtempSync(join(tmpdir(),'cct-combined-restore-')),input=join(dir,'dump.json'),output=join(dir,'restore.sql');writeFileSync(input,JSON.stringify(dump));execFileSync(process.execPath,['scripts/backup-to-sql.mjs',input,output],{windowsHide:true});
const clone=new DatabaseSync(':memory:');for(const sql of sqls)clone.exec(sql);clone.exec(readFileSync(output,'utf8'));for(const table of Object.keys(dump.tables))assert.deepEqual(clone.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());assert.deepEqual(clone.prepare('PRAGMA foreign_key_check').all(),[]);clone.close();console.log('PASS PC03 actual backup-to-sql restores all combined schema rows and exact packet clock');
// Apply and retry through real local Wrangler/D1 migration bookkeeping.
const combined=join(dir,'combined');mkdirSync(join(combined,'migrations'),{recursive:true});
for(const name of names.filter(n=>!n.startsWith('0006_')))writeFileSync(join(combined,'migrations',name),readFileSync('migrations/'+name));
writeFileSync(join(combined,'migrations','0005_field_evidence.sql'),proposed);writeFileSync(join(combined,'migrations','0006_packet_workflow.sql'),packet);
const config=join(combined,'wrangler.json'),persist=join(combined,'state');writeFileSync(config,JSON.stringify({name:'synthetic-compatibility',compatibility_date:'2026-09-01',d1_databases:[{binding:'DB',database_name:'cct',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:'migrations'}]}));
const wr=resolve('node_modules/wrangler/bin/wrangler.js'),opts={encoding:'utf8',windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_HIDE_BANNER:'true'}};
for(let attempt=1;attempt<=2;attempt++)writeFileSync(join(combined,'migration-'+attempt+'.log'),execFileSync(process.execPath,[wr,'d1','migrations','apply','cct','--local','--config',config,'--persist-to',persist],opts));
const raw=execFileSync(process.execPath,[wr,'d1','execute','cct','--local','--config',config,'--persist-to',persist,'--json','--command','SELECT name FROM d1_migrations ORDER BY name'],opts);
assert.deepEqual(JSON.parse(raw)[0].results.map(r=>r.name),[...new Set([...names,'0005_field_evidence.sql'])].sort());
console.log('PASS PC04 real local D1 ledger applies all candidate migrations once and retry skips them');

const oldRoot=mkdtempSync(join(tmpdir(),'cct-057f498-')),archive=join(oldRoot,'source.zip'),oldCommit='057f4988ca5e6ff322867c6963522b1e976f3a75';execFileSync('git',['archive','--format=zip','--output',archive,oldCommit],{windowsHide:true});execFileSync('python',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,oldRoot],{windowsHide:true});const {default:old}=await import(pathToFileURL(join(oldRoot,'src/index.js')));
const priorClock=db.prepare('SELECT rev FROM wf_clock WHERE job_id=1').get().rev;
r=await call(old,'PATCH','/crew/1',{name:'Synthetic old-client edit'});assert.equal(r.status,200);assert.ok(db.prepare('SELECT rev FROM wf_clock WHERE job_id=1').get().rev>priorClock);assert.equal(db.prepare('SELECT driver_id FROM crew WHERE id=1').get().driver_id,1);assert.equal(db.prepare('SELECT id FROM wf_packets').get().id,packetId);assert.equal(db.prepare('SELECT avatar_size FROM users').get().avatar_size,5);console.log('PASS PC05 immutable old commit writes preserve new columns/history and invalidate changed packet sources');
r=await call(old,'POST','/jobs',{vessel:'Synthetic old-code create'});assert.equal(r.status,200);assert.ok(db.prepare('SELECT rev FROM wf_clock WHERE job_id=?').get(r.data.id));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);console.log('PASS PC06 old code job creation receives a source clock automatically');
console.log(JSON.stringify({pass:6,fail:0,migrationSHA256:createHash('sha256').update(proposed).digest('hex'),oldCommit,scope:'local SQLite + exact old-code bundle; schema, merged API, exact old-code bundle and local D1 bookkeeping; UI proven separately; no physical-device or real object/NAS restore proof'}));db.close();
