// Local-only review of the explicitly supplied additive migration snapshot.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dumpAll} from '../src/index.js';
const path=process.argv[2];if(!path)throw Error('Supply the proposed migration SQL path');
const sql=readFileSync(path,'utf8'),db=new DatabaseSync(':memory:');
try{
 for(const f of readdirSync('migrations').sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.exec("INSERT INTO users(id,username,name,role,pw_hash,pw_salt,created_at) VALUES(1,'synthetic','Synthetic','field','x','x',1); INSERT INTO jobs(id,vessel,owner_token,created_at,updated_at) VALUES(1,'SYNTHETIC','synthetic-token',1,1); INSERT INTO crew(id,job_id,name,type,agent_id,created_at) VALUES(1,1,'Synthetic','on',1,1); INSERT INTO checkpoints(crew_id,idx,name,name_en) VALUES(1,0,'Synthetic','Synthetic'); INSERT INTO photos(crew_id,r2_key,size,at,user_id,upload_id,request_hash) VALUES(1,'photos/synthetic',4,1,1,'synthetic-upload','synthetic-hash')");
 const names=['users','jobs','crew','checkpoints','photos'];const before=Object.fromEntries(names.map(n=>[n,db.prepare('SELECT * FROM '+n).all()]));
 db.exec(sql);
 for(const n of names){const after=db.prepare('SELECT * FROM '+n).all();assert.equal(after.length,before[n].length);for(let i=0;i<after.length;i++)for(const k of Object.keys(before[n][i]))assert.deepEqual(after[i][k],before[n][i][k]);}
 console.log('PASS MG01 additive migration preserves every pre-existing fixture column value');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='crew_driver'").get());assert.equal(db.prepare('SELECT driver_id FROM crew').get().driver_id,null);assert.equal(db.prepare('SELECT need_photo FROM checkpoints').get().need_photo,0);
 console.log('PASS MG02 new nullable assignments and evidence defaults do not fabricate history');
 const prepare=s=>({all:async()=>({results:db.prepare(s).all()})});const dump=await dumpAll({DB:{prepare,batch:async stmts=>{db.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.all());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}});
 const dir=mkdtempSync(join(tmpdir(),'cct-migration-restore-')),input=join(dir,'backup.json'),output=join(dir,'restore.sql');writeFileSync(input,JSON.stringify(dump));
 execFileSync(process.execPath,['scripts/backup-to-sql.mjs',input,output],{windowsHide:true});
 const clone=new DatabaseSync(':memory:');try{for(const f of readdirSync('migrations').sort())clone.exec(readFileSync('migrations/'+f,'utf8'));clone.exec(sql);clone.exec(readFileSync(output,'utf8'));assert.deepEqual(clone.prepare('PRAGMA foreign_key_check').all(),[]);for(const n of Object.keys(dump.tables))assert.deepEqual(clone.prepare('SELECT * FROM '+n+' ORDER BY rowid').all(),db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all());}finally{clone.close();}

 console.log('PASS MG03 baseline dumpAll + additive schema restores all old/new fixture columns');
 console.log(JSON.stringify({migrationSha256:createHash('sha256').update(sql).digest('hex'),pass:3,fail:0,scope:'local SQLite; not applied production ledger, deployment, or real R2/NAS restore'}));
}finally{db.close();}
