// SQLite models a write arriving between independently awaited backup reads.
// D1 batch() is transactional; this adapter uses a real SQLite transaction.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {dumpAll} from '../src/index.js';
test('BK01 a concurrent job creation cannot produce orphan crew in a database snapshot',async()=>{
 const db=new DatabaseSync(':memory:');for(const m of readdirSync(new URL('../migrations/',import.meta.url)).sort())db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 let inserted=false,inBatch=false;
 const write=()=>{if(inserted)return;inserted=true;db.exec("INSERT INTO jobs (vessel,owner_token,created_at,updated_at) VALUES ('SYNTHETIC SNAPSHOT','synthetic-owner-token',1,1); INSERT INTO crew (job_id,name,type,created_at) VALUES (1,'Synthetic Crew','on',1)");};
 const prepare=sql=>({all:async()=>{const results=db.prepare(sql).all();if(sql.includes('FROM jobs')&&!inBatch)write();return{results};}});
 const DB={prepare,batch:async statements=>{inBatch=true;db.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.all());db.exec('COMMIT');write();return result;}catch(e){db.exec('ROLLBACK');throw e;}finally{inBatch=false;}}};
 try{const dump=await dumpAll({DB});assert.equal(inserted,true);const ids=new Set(dump.tables.jobs.map(j=>j.id));assert.ok(dump.tables.crew.every(c=>ids.has(c.job_id)),'backup contains crew whose job is absent');assert.equal(db.prepare('SELECT count(*) n FROM crew').get().n,1);}
 finally{db.close();}
});
