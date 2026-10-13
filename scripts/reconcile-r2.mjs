// Read-only reconciliation of owner-supplied D1 backup + complete R2 inventory.
// Never connects to a service or deletes anything. Inventory MUST be complete.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function reconcileR2(dump,inventory,cutoff) {
 if(!dump?.tables||!Array.isArray(inventory?.objects)||inventory.complete!==true)throw Error('Provide a D1 table snapshot and complete:true R2 inventory');
 if(!Number.isFinite(cutoff))throw Error('An explicit grace-period cutoff is required');
 const refs=new Set();
 for(const n of ['photos','crew_files'])for(const row of dump.tables[n]||[])if(row.r2_key)refs.add(row.r2_key);
 for(const row of dump.tables.wf_packet_files||[])if(row.object_key)refs.add(row.object_key);
 for(const row of dump.tables.users||[])if(row.avatar_key)refs.add(row.avatar_key);
 for(const row of dump.tables.settings||[])if(row.key==='brand') {
  const brand=JSON.parse(row.value);for(const [kind,v] of Object.entries(brand)) {
   if(v?.key)refs.add(v.key);
   else if(v && ['letterhead','signature','stamp'].includes(kind))refs.add('brand/'+kind);
  }
 }
 const keys=new Set(inventory.objects.map(o=>o.key));
 const candidates=inventory.objects.filter(o=>/^(photos|docs|avatars|brand|packets)\//.test(o.key)&&!refs.has(o.key)&&Number.isFinite(Date.parse(o.uploaded))&&Date.parse(o.uploaded)<cutoff).map(o=>({key:o.key,size:o.size,uploaded:o.uploaded}));
 return{mode:'report-only',referenceCount:refs.size,objectCount:keys.size,missing:[...refs].filter(k=>!keys.has(k)),candidates,warning:'Candidates need a fresh reference check and owner approval before deletion. Concurrent uploads and interrupted commits are possible.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [, ,dbFile,objectsFile,cutoff]=process.argv;if(!dbFile||!objectsFile||!cutoff)throw Error('Usage: node scripts/reconcile-r2.mjs backup.json inventory.json cutoff-ISO');console.log(JSON.stringify(reconcileR2(JSON.parse(readFileSync(dbFile,'utf8')),JSON.parse(readFileSync(objectsFile,'utf8')),Date.parse(cutoff)),null,2));}
