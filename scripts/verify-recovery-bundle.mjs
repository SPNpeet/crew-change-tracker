// Read-only: compare a D1 backup's referenced objects with a retained object manifest and local bytes.
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {reconcileR2} from './reconcile-r2.mjs';
export const objectHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyRecovery(dump,manifest,readObject){
 if(manifest?.complete!==true||!Array.isArray(manifest.objects))throw Error('A complete retained object manifest is required.');
 const references=reconcileR2(dump,{complete:true,objects:[]},0).missing,entries=new Map();
 for(const o of manifest.objects){if(!o||typeof o.key!=='string'||entries.has(o.key)||!Number.isSafeInteger(o.size)||o.size<0||!/^([a-f0-9]{64})$/.test(o.sha256||''))throw Error('Malformed or duplicate object manifest entry.');entries.set(o.key,o);}
 const metadata=new Map();for(const table of ['photos','crew_files'])for(const row of dump.tables[table]||[])metadata.set(row.r2_key,{size:row.size});
 for(const row of dump.tables.users||[])if(row.avatar_key)metadata.set(row.avatar_key,{size:row.avatar_size});
 for(const row of dump.tables.wf_packet_files||[])metadata.set(row.object_key,{size:row.size,sha256:row.sha256});
 const missing=[],mismatched=[],verified=[],categories={};
 for(const key of references){const entry=entries.get(key);if(!entry){missing.push(key);continue;}let bytes;try{bytes=await readObject(key);}catch{missing.push(key);continue;}if(!bytes){missing.push(key);continue;}const hash=objectHash(bytes),m=metadata.get(key);if(bytes.length!==entry.size||hash!==entry.sha256||(m&&(m.size!==bytes.length||(m.sha256&&m.sha256!==hash)))){mismatched.push(key);continue;}verified.push(key);const category=key.split('/')[0];categories[category]=(categories[category]||0)+1;}
 return {mode:'read-only',ok:missing.length===0&&mismatched.length===0,references:references.length,verified:verified.length,categories,missing,mismatched,scope:'Referenced file bytes only; does not prove NAS scheduling, retention, permissions or customer access.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [backupFile,manifestFile,objectRoot]=process.argv.slice(2);if(!objectRoot)throw Error('Usage: node scripts/verify-recovery-bundle.mjs backup.json[.gz] objects-manifest.json object-directory');
 const raw=readFileSync(backupFile),dump=JSON.parse((backupFile.endsWith('.gz')?gunzipSync(raw):raw).toString('utf8')),root=realpathSync(objectRoot);
 const report=await verifyRecovery(dump,JSON.parse(readFileSync(manifestFile,'utf8')),async key=>{const file=realpathSync(resolve(root,key));if(!file.toLowerCase().startsWith((root+sep).toLowerCase()))throw Error('Object path escapes bundle');return readFileSync(file);});console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
}
