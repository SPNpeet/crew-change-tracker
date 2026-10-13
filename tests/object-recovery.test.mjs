import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {DUMP_TABLES} from '../src/index.js';
import {verifyRecovery,objectHash} from '../scripts/verify-recovery-bundle.mjs';
import {pdf,png} from './gen.mjs';

test('RB01 actual local R2 bytes plus database restore recover all five referenced file categories; missing/corrupt files fail',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cct-object-recovery-')),options={modules:true,script:'export default {fetch(){return new Response("synthetic");}}',compatibilityDate:'2026-09-01',r2Buckets:['FILES'],inspectorPort:0};
 const source=new Miniflare(convertV4MiniflareOptions({...options,r2Persist:join(dir,'source-r2'),cf:false,telemetry:{enabled:false}})),target=new Miniflare(convertV4MiniflareOptions({...options,r2Persist:join(dir,'restored-r2'),cf:false,telemetry:{enabled:false}}));t.after(async()=>{await source.dispose();await target.dispose();});
 const a=await source.getR2Bucket('FILES'),b=await target.getR2Bucket('FILES'),doc=pdf(['SYNTHETIC recovery specimen']),img=png(8,8),objects=[['photos/1/1/synthetic.png',img,'image/png'],['docs/synthetic.pdf',doc,'application/pdf'],['avatars/synthetic.png',img,'image/png'],['brand/letterhead',img,'image/png'],['packets/synthetic/1',doc,'application/pdf']];
 const db=new DatabaseSync(':memory:'),restored=new DatabaseSync(':memory:');t.after(()=>{db.close();restored.close();});for(const d of [db,restored]){d.exec('PRAGMA foreign_keys=ON');for(const m of readdirSync(new URL('../migrations/',import.meta.url)).sort())d.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));}
 db.exec("INSERT INTO users(id,username,name,role,pw_hash,pw_salt,created_at) VALUES(1,'synthetic','Synthetic','admin','x','x',1);INSERT INTO jobs(id,vessel,owner_token,created_at,updated_at) VALUES(1,'Synthetic restore','synthetic',1,1);INSERT INTO crew(id,job_id,name,type,created_at) VALUES(1,1,'Synthetic One','on',1)");
 db.prepare('UPDATE users SET avatar_key=?,avatar_size=? WHERE id=1').run(objects[2][0],img.length);db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('brand',JSON.stringify({letterhead:{key:'brand/letterhead'}}));
 db.prepare('INSERT INTO photos(crew_id,r2_key,size,at,user_id) VALUES(1,?,?,1,1)').run(objects[0][0],img.length);db.prepare('INSERT INTO crew_files(crew_id,kind,name,mime,r2_key,size,at,user_id) VALUES(1,?,?,?,?,?,1,1)').run('passport','Synthetic.pdf','application/pdf',objects[1][0],doc.length);
 db.prepare('INSERT INTO wf_packets VALUES(?,?,?,?,?,?,?,?)').run('synthetic',1,1,'{}',1,1,doc.length,'synthetic-key');db.prepare('INSERT INTO wf_packet_files VALUES(?,?,?,?,?,?,?,?)').run('synthetic',1,1,objects[4][0],objectHash(doc),doc.length,'application/pdf','Synthetic.pdf');
 const dump={format:'cct-backup',version:1,created:Date.now(),tables:Object.fromEntries(DUMP_TABLES.map(name=>[name,db.prepare('SELECT * FROM '+name).all()]))},manifest={complete:true,objects:[]},root=join(dir,'nas-like-copy');mkdirSync(root);
 for(const [key,bytes,mime] of objects){await a.put(key,bytes,{httpMetadata:{contentType:mime}});const original=await a.get(key),copy=Buffer.from(await original.arrayBuffer());const file=join(root,key);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,copy);manifest.objects.push({key,size:copy.length,sha256:objectHash(copy),httpMetadata:original.httpMetadata});}
 const input=join(dir,'backup.json'),sql=join(dir,'restore.sql');writeFileSync(input,JSON.stringify(dump));writeFileSync(join(dir,'objects-manifest.json'),JSON.stringify(manifest));execFileSync(process.execPath,['scripts/backup-to-sql.mjs',input,sql],{windowsHide:true});restored.exec(readFileSync(sql,'utf8'));for(const table of DUMP_TABLES)assert.deepEqual(restored.prepare('SELECT * FROM '+table).all(),db.prepare('SELECT * FROM '+table).all());assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
 const read=async key=>{const object=await b.get(key);return object?Buffer.from(await object.arrayBuffer()):null;};assert.equal((await verifyRecovery(dump,manifest,read)).missing.length,5,'DB-only restore does not recover files');
 for(const o of manifest.objects)await b.put(o.key,readFileSync(join(root,o.key)),{httpMetadata:o.httpMetadata});const report=await verifyRecovery(dump,manifest,read);assert.equal(report.ok,true);assert.deepEqual(report.categories,{photos:1,docs:1,packets:1,avatars:1,brand:1});for(const o of manifest.objects)assert.equal((await b.get(o.key)).httpMetadata.contentType,o.httpMetadata.contentType);
 await b.put(objects[0][0],new Uint8Array([0]));const corrupt=await verifyRecovery(dump,manifest,read);assert.deepEqual(corrupt.mismatched,[objects[0][0]]);await b.delete(objects[4][0]);assert.deepEqual((await verifyRecovery(dump,manifest,read)).missing,[objects[4][0]]);
 const out=process.env.CCT_RECOVERY_EVIDENCE;if(out)writeFileSync(out,JSON.stringify({report,negativeChecks:['DB-only: 5 missing','corrupt photo: mismatch','deleted packet: missing'],manifest,localDirectory:dir,physicalNAS:false,productionR2:false},null,2));
});
