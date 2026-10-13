import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { browser, login, photo, BASE, OUT, FIELD_PASS, ADMIN_USER } from './cdp.mjs';

// All data, accounts and photos come from seed-local.mjs in a disposable local DB.
const admin = await login(ADMIN_USER, process.env.ADMIN_PASS);
const b = await browser(), results = [];
let ck, uid, crew;
const request = (path, init = {}, cookie = ck) => fetch(BASE + path, { ...init, headers: { cookie: 'cct_s=' + cookie, 'x-cct': '1', ...(init.headers || {}) } });
const read = async path => (await request(path)).json();
const count = async () => (await read('/api/field')).crew.find(c => c.id === crew.id).photos.length;
const pending = () => b.eval(`JSON.parse(localStorage.getItem('cct-outbox-v1') || '[]')`);
const blobCount = () => b.eval(`new Promise((resolve,reject)=>{const r=indexedDB.open('cct-photos',1);r.onupgradeneeded=()=>r.result.createObjectStore('blobs');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('blobs'),q=tx.objectStore('blobs').count();tx.oncomplete=()=>{db.close();resolve(q.result)}}})`);
const bytes = `Uint8Array.from(atob(${JSON.stringify(photo().toString('base64'))}), c => c.charCodeAt(0))`;
const queuePhoto = label => b.eval(`(async()=>{const a=await import('/js/api.js');return a.uploadPhoto(${crew.id},new Blob([${bytes}],{type:'image/jpeg'}),{point:${JSON.stringify(label)},label:${JSON.stringify(label)},assignment_revision:${crew.assignment_rev}},${uid})})()`);
const flush = () => b.eval(`(async()=>{const a=await import('/js/api.js');return a.flushOutbox(${uid})})()`);
const blockUploads = () => b.eval(`window.originalFetch=window.fetch;window.fetch=(url,opts)=>String(url).includes('/photos?')?Promise.resolve(new Response(JSON.stringify({error:'Synthetic temporary upload outage'}),{status:503,headers:{'content-type':'application/json'}})):window.originalFetch(url,opts)`);
const unblock = () => b.eval(`if(window.originalFetch){window.fetch=window.originalFetch;delete window.originalFetch}`);
const account = () => b.eval(`(async()=>{const a=await import('/js/app.js');a.go('/account');await new Promise(r=>setTimeout(r,100))})()`);
const logout = async () => { await b.eval(`document.querySelector('[data-act="logout"]').click()`); await new Promise(r => setTimeout(r,700)); };
async function fresh() {
  ck = await login('somsak', FIELD_PASS);
  uid = (await read('/api/me')).user.id;
  crew = (await read('/api/field')).crew.find(c => c.name === 'Arun Pillai');
  await b.go('/api/health', 100); await b.cookie(ck); await b.go('/field/' + crew.id, 700);
  // Clear only this synthetic browser profile between independent cases.
  await b.eval(`localStorage.removeItem('cct-outbox-v1');new Promise(resolve=>{const r=indexedDB.open('cct-photos',1);r.onupgradeneeded=()=>r.result.createObjectStore('blobs');r.onsuccess=()=>{const db=r.result,tx=db.transaction('blobs','readwrite');tx.objectStore('blobs').clear();tx.oncomplete=()=>{db.close();resolve()}}})`);
}
async function check(name, fn) {
  try { await fresh(); const evidence = await fn(); results.push({ name, passed: true, ...evidence }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, passed: false, error: e.message }); console.log('FAIL ' + name + ': ' + e.message); }
}
async function anotherTab() {
  const {targetId} = await b.send('Target.createTarget', {url: BASE + '/field/' + crew.id});
  const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9333}/json/list`)).json();
  const ws = new WebSocket(targets.find(t => t.id === targetId).webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open',resolve,{once:true}));
  let id=0; const pending=new Map();
  ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(pending.has(d.id)){pending.get(d.id)(d);pending.delete(d.id)}});
  return {
    async eval(expression) {
      const i=++id, reply=new Promise(resolve=>pending.set(i,resolve));
      ws.send(JSON.stringify({id:i,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
      const r=await reply; if(r.error || r.result.exceptionDetails) throw new Error(JSON.stringify(r));
      return r.result.result.value;
    },
    async close() {ws.close();await b.send('Target.closeTarget',{targetId});}
  };
}
try {
  await b.size(390, 800, true);
  await check('reselecting the same source photo does not stamp and upload it twice', async () => {
    const before = await count();
    const select = () => b.eval(`(async()=>{const v=await import('/js/views/field.js');const input=document.querySelector('[data-chg="f-photo"]');const transfer=new DataTransfer();transfer.items.add(new File([${bytes}],'fixture.jpg',{type:'image/jpeg'}));input.files=transfer.files;await v.changes['f-photo'](input)})()`);
    await select(); await new Promise(r => setTimeout(r,1100)); await select();
    assert.equal(await count(), before + 1);
    assert.equal(await b.eval(`document.querySelector('[data-chg="f-photo"]').disabled`), false);
    await b.shot('duplicate-photo-prevented-390');
    return { selected: 2, addedPhotos: 1 };
  });
  await check('a successful upload with a lost response retries without another record', async () => {
    const before = await count();
    await b.eval(`window.originalFetch=window.fetch;window.lostOnce=false;window.fetch=async(url,opts)=>{const r=await window.originalFetch(url,opts);if(!window.lostOnce&&String(url).includes('/photos?')){window.lostOnce=true;await r.arrayBuffer();throw new TypeError('Synthetic lost response')}return r}`);
    assert.equal((await queuePhoto('lost-response')).queued, true);
    assert.equal((await pending()).length, 1);
    await unblock(); await flush();
    assert.equal(await count(), before + 1);
    assert.equal((await pending()).length, 0); assert.equal(await blobCount(), 0);
    return { addedPhotos: 1, remainingQueue: 0, remainingBlobs: 0 };
  });
  await check('logout blocks for unsent work; save and cancel preserve it; explicit discard clears it', async () => {
    await blockUploads(); assert.equal((await queuePhoto('unsent-protection')).queued, true);
    await account(); await logout();
    assert.equal(await b.eval(`fetch('/api/me').then(r=>r.status)`), 200, 'logout must remain blocked while work cannot be sent');
    assert.equal((await pending()).length, 1); assert.equal(await blobCount(), 1);
    const exported = await b.eval(`(async()=>{const a=await import('/js/api.js'),it=a.pendingItems(${uid})[0],f=await a.pendingFile(a.itemKey(it),${uid});return {size:f.blob.size,type:f.blob.type,name:f.name}})()`);
    assert.equal(exported.size, photo().length); assert.equal(exported.type, 'image/jpeg');
    const downloads=join(OUT,'..','downloads'); mkdirSync(downloads,{recursive:true});
    await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await b.eval(`document.querySelector('[data-act="pending-save"]').click()`);
    const saved=join(downloads,exported.name);
    for(let i=0;i<50&&!existsSync(saved);i++) await new Promise(r=>setTimeout(r,100));
    assert.deepEqual(readFileSync(saved),photo(),'the recovery button downloads the complete original queued bytes');
    assert.equal((await pending()).length, 1, 'saving a copy does not silently discard the original');
    for (const width of [360,1280]) {
      await b.size(width,800,width<700);
      assert.equal(await b.eval(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`),true,'queue controls fit the viewport');
      await b.shot('pending-work-protected-' + width);
    }
    await b.eval(`window.confirm=()=>false;document.querySelector('[data-act="pending-discard"]').click()`);
    await new Promise(r=>setTimeout(r,100)); assert.equal((await pending()).length, 1);
    await b.eval(`window.confirm=()=>true;document.querySelector('[data-act="pending-discard"]').click()`);
    await new Promise(r=>setTimeout(r,200)); assert.equal((await pending()).length, 0); assert.equal(await blobCount(), 0);
    await unblock(); await logout();
    assert.equal(await b.eval(`fetch('/api/me').then(r=>r.status)`), 401);
    return { logoutBlocked: true, savedBytes: exported.size, cancelPreserved: true, explicitDiscardCleared: true };
  });
  await check('default browser fetch cannot display an authenticated photo after logout', async () => {
    const uploaded = await queuePhoto('cache-privacy');
    const path = '/api/photos/' + uploaded.id;
    assert.equal(await b.eval(`fetch(${JSON.stringify(path)}).then(async r=>{await r.arrayBuffer();return r.status})`), 200);
    await account(); await logout();
    const status = await b.eval(`fetch(${JSON.stringify(path)}).then(r=>r.status)`);
    assert.equal(status, 401, 'a default fetch must not reuse the old cached photo');
    await b.size(390,800,true); await b.shot('logout-private-photo-denied-390');
    return { afterLogoutPhotoStatus: status };
  });
  await check('a queue belonging to one user cannot upload using another user session', async () => {
    await blockUploads(); await queuePhoto('account-boundary'); await unblock();
    const other = await login('wichai', FIELD_PASS); await b.cookie(other);
    const outcome = await flush();
    assert.equal(outcome.sent, 0); assert.equal((await pending()).length, 1); assert.equal(await blobCount(), 1);
    await b.cookie(ck); await flush(); assert.equal((await pending()).length, 0);
    return { sentUnderWrongUser: 0, preservedUntilCorrectUser: true };
  });
  await check('logout clears another open tab and waits for its in-flight upload', async () => {
    const tab=await anotherTab();
    try {
      // Establish a loaded second tab before intercepting; a late navigation would discard the interceptor.
      for(let i=0;i<100&&!await tab.eval(`!!document.querySelector('.fieldpage')`);i++)await new Promise(r=>setTimeout(r,100));
      assert.equal(await tab.eval(`!!document.querySelector('.fieldpage')`),true,'second tab must finish its authenticated field navigation');
      await tab.eval(`window.originalFetch=window.fetch;window.releaseUpload=null;window.fetch=(url,opts)=>String(url).includes('/photos?')?new Promise(resolve=>{window.releaseUpload=()=>{const failure=()=>new Response(JSON.stringify({error:'Synthetic outage'}),{status:503,headers:{'content-type':'application/json'}});window.fetch=(url,opts)=>String(url).includes('/photos?')?Promise.resolve(failure()):window.originalFetch(url,opts);resolve(failure())}}):window.originalFetch(url,opts);window.uploadDone=import('/js/api.js').then(a=>a.uploadPhoto(${crew.id},new Blob([${bytes}],{type:'image/jpeg'}),{point:'cross-tab',label:'cross-tab',assignment_revision:${crew.assignment_rev}},${uid}));true`);
      for(let i=0;i<100 && !await tab.eval(`!!window.releaseUpload`);i++) await new Promise(r=>setTimeout(r,50));
      assert.equal(await tab.eval(`!!window.releaseUpload`),true,'second tab upload must be intercepted before logout');
      assert.equal(await tab.eval(`navigator.locks.query().then(s=>s.held.some(l=>l.name==='cct-device-work'))`),true,'upload must hold the cross-tab device lock');
      await blockUploads(); await account();
      await b.eval(`document.querySelector('[data-act="logout"]').click()`);
      await new Promise(r=>setTimeout(r,200));
      assert.equal(await b.eval(`fetch('/api/me').then(r=>r.status)`),200,'logout must wait for the other tab to finish storing its upload');
      await tab.eval(`window.releaseUpload();window.uploadDone`);
      await new Promise(r=>setTimeout(r,500));
      assert.equal((await pending()).length,1); assert.equal(await blobCount(),1);
      assert.equal(await b.eval(`fetch('/api/me').then(r=>r.status)`),200,'a queued photo must block logout across tabs');
      await tab.eval(`window.fetch=window.originalFetch`);
      await unblock(); await flush(); await account(); await logout();
      assert.equal(await b.eval(`fetch('/api/me').then(r=>r.status)`),401,'source tab must complete logout');
      // Navigation and storage-event delivery in a background tab are async.
      // Wait for the outcome with a bound, rather than assuming a 500ms reload.
      for(let i=0;i<50 && await tab.eval(`location.pathname`)!=='/login';i++)await new Promise(r=>setTimeout(r,100));
      assert.equal(await tab.eval(`location.pathname`),'/login');
      assert.equal(await tab.eval(`!!document.querySelector('.pgrid')`),false);
      return { waitedForOtherTab:true, queuePreserved:true, otherTabSignedOut:true };
    } finally {await tab.close();}
  });
  await check('another account can sign out without deleting or revealing someone else\'s unsent work', async () => {
    await blockUploads(); await queuePhoto('private-other-account-work'); await unblock();
    const other=await login('wichai',FIELD_PASS); await b.cookie(other); await b.go('/account',700);
    assert.equal(await b.eval(`document.getElementById('app').textContent.includes('private-other-account-work')`),false);
    assert.equal(await b.eval(`document.querySelectorAll('[data-act="pending-save"]').length`),0);
    await logout(); assert.equal(await b.eval(`fetch('/api/me').then(r=>r.status)`),401);
    assert.equal((await pending()).length,1); assert.equal(await blobCount(),1);
    await b.cookie(ck); await b.go('/account',700); await flush();
    assert.equal((await pending()).length,0); assert.equal(await blobCount(),0);
    return { otherAccountDetailsHidden:true, logoutAllowed:true, ownerRecoveredWork:true };
  });
  await check('a permanent server rejection retains the photo and a recovery copy', async () => {
    await blockUploads(); await queuePhoto('closed-job-recovery'); await unblock();
    const closed = await request('/api/jobs/' + crew.job_id, { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({status:'closed'}) }, admin);
    assert.equal(closed.status, 200);
    const result = await flush();
    assert.equal(result.failed.length, 1);
    assert.equal((await pending()).length, 1, 'rejected unsent work must not be deleted');
    assert.equal(await blobCount(), 1); assert.ok((await pending())[0].error);
    await account(); await b.size(390,800,true); await b.shot('rejected-photo-recovery-390');
    const size = await b.eval(`(async()=>{const a=await import('/js/api.js'),it=a.pendingItems(${uid})[0];return (await a.pendingFile(a.itemKey(it),${uid})).blob.size})()`);
    assert.equal(size, photo().length);
    return { retainedQueue: 1, retainedBlobs: 1, recoverableBytes: size };
  });
} finally { b.close(); }
mkdirSync(OUT, {recursive:true});
writeFileSync(join(OUT, '..', 'privacy-retry-results.json'), JSON.stringify({ results, consoleErrors:b.logs },null,2));
console.log(JSON.stringify({ passed:results.filter(r=>r.passed).length, failed:results.filter(r=>!r.passed).length, consoleErrors:b.logs },null,2));
if (results.some(r=>!r.passed) || b.logs.length) process.exitCode=1;
