import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileR2} from '../scripts/reconcile-r2.mjs';
test('RC01 crash orphan inventory preserves referenced, recent and unrelated objects',()=>{
 const tables={photos:[{r2_key:'photos/kept'},{r2_key:'photos/missing'}],crew_files:[{r2_key:'docs/passport'}],users:[{avatar_key:'avatars/user'}],settings:[{key:'brand',value:JSON.stringify({letterhead:12345})}]};
 const objects=['photos/kept','docs/passport','avatars/user','brand/letterhead','photos/crash','backups/old'].map(key=>({key,uploaded:'2026-10-01T00:00:00Z',size:4}));objects.push({key:'photos/inflight',uploaded:'2026-10-13T00:00:00Z',size:4});
 const out=reconcileR2({tables},{objects,complete:true},Date.parse('2026-10-12T00:00:00Z'));
 assert.deepEqual(out.missing,['photos/missing']);assert.deepEqual(out.candidates.map(x=>x.key),['photos/crash']);assert.equal(out.mode,'report-only');
});
test('RC02 incomplete inventory cannot suggest deletion candidates',()=>{assert.throws(()=>reconcileR2({tables:{}},{objects:[]},0));});
