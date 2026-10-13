import {checkpointBody,assignmentPath} from '../checkpoint-client.mjs';
// Browser checks for drivers, photo-required points, profile photos, the checkpoint editor, phone cards and keyboard use.
// Run on a freshly seeded local database. ONLY=<regex> runs a subset by check id. All data is synthetic.
import assert from 'node:assert/strict';
import { browser, login, photo, AUDIT, BASE, ADMIN_USER, FIELD_PASS } from './cdp.mjs';

const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tryLogin = (u, p) => login(u, p).catch(() => null);
const admin = await login(ADMIN_USER, process.env.ADMIN_PASS);
const agent = await login('somsak', FIELD_PASS), driver = await tryLogin('prasert', FIELD_PASS);
const call = async (method, path, body, ck = admin) => {
  body = await checkpointBody(BASE,'cct_s='+ck,path,body,method);
    path=await assignmentPath(BASE,'cct_s='+ck,path,method);
  const res = await fetch(BASE + path, { method, headers: { 'x-cct': '1', cookie: 'cct_s=' + ck, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
};
const get = async (path, ck) => (await call('GET', path, undefined, ck)).data;
const me = await get('/api/me'), users = (await get('/api/users')).users;
const uid = name => (users.find(u => u.username === name) || {}).id;
const job = () => get('/api/jobs/1');
const crewRow = async id => (await job()).crew.find(c => c.id === id);
const van1 = me.vehicles.find(v => v.name === 'รถตู้ 1').id;

const b = await browser();
process.on('exit', () => { try { b.close(); } catch (e) {} });
await b.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const results = [];
const js = v => JSON.stringify(v);
const has = sel => b.eval(`!!document.querySelector(${js(sel)})`);
const text = sel => b.eval(`(document.querySelector(${js(sel)}) || {}).textContent || ''`);
const eventually = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) {} await sleep(200); } return false; };
const waitFor = (sel, ms) => eventually(() => has(sel), ms);
const click = async (sel, wait = 400) => { assert.ok(await waitFor(sel), 'missing ' + sel); await b.eval(`document.querySelector(${js(sel)}).click()`); await sleep(wait); };
const type = (sel, v) => b.eval(`(() => { const e = document.querySelector(${js(sel)}); e.value = ${js(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const open = async (path, sel, ck, w = 390) => { await b.size(w, w < 700 ? 844 : 800, w < 700); await b.go('/api/health', 100); await b.cookie(ck); await b.go(path, 300); assert.ok(await waitFor(sel), `page ${path} did not show ${sel}`); await sleep(300); };
const bytes = `Uint8Array.from(atob(${js(photo().toString('base64'))}), c => c.charCodeAt(0))`;
const choose = (sel, name = 'camera.jpg') => b.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${bytes}], ${js(name)}, { type: 'image/jpeg' })); const i = document.querySelector(${js(sel)}); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const outbox = () => b.eval(`JSON.parse(localStorage.getItem('cct-outbox-v1') || '[]')`);
const clearDevice = () => b.eval(`localStorage.removeItem('cct-outbox-v1'); new Promise(resolve => { const r = indexedDB.open('cct-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => { const db = r.result, tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').clear(); tx.oncomplete = () => { db.close(); resolve(true); }; }; })`);
const geo = async setting => {
  await b.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting, origin: BASE });
  if (setting === 'granted') await b.send('Emulation.setGeolocationOverride', { latitude: 13.0897, longitude: 100.8832, accuracy: 14 });
};
const KEYS = { Tab: 9, Enter: 13, Escape: 27, ' ': 32 };
const key = async (k, shift) => {
  const p = { key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: KEYS[k], modifiers: shift ? 8 : 0 };
  await b.send('Input.dispatchKeyEvent', { type: k === 'Enter' || k === ' ' ? 'keyDown' : 'rawKeyDown', ...p, ...(k === 'Enter' ? { text: '\r' } : k === ' ' ? { text: ' ' } : {}) });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
  await sleep(60);
};
const focused = () => b.eval(`(() => { const e = document.activeElement, cs = getComputedStyle(e); const row = e.closest('.cp-row'); return { tag: e.tagName, name: e.getAttribute('name') || e.dataset.act || (e.hasAttribute('data-close') ? 'close' : '') || e.type || '', row: row ? [...row.parentElement.children].indexOf(row) + 1 : 0, ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, dlg: !!e.closest('#dlg') }; })()`);
const overflow = () => b.eval(`(() => { const out = [], W = document.documentElement.clientWidth; if (document.documentElement.scrollWidth > W + 1) out.push('page ' + document.documentElement.scrollWidth + '>' + W); document.querySelectorAll('main .scroll').forEach((s, i) => { if (s.scrollWidth > s.clientWidth + 1) out.push('table ' + i + ' ' + s.scrollWidth + '>' + s.clientWidth); }); return out; })()`);
const pointsBody = (s, change = {}) => ({ cp_on: s.cp_on, cp_off: s.cp_off, cp_on_chain_id: s.cp_on[s.cp_on_chain].id, cp_off_chain_id: s.cp_off[s.cp_off_chain].id, cp_expected: { cp_on: s.cp_on, cp_off: s.cp_off, cp_on_chain: s.cp_on_chain, cp_off_chain: s.cp_off_chain }, ...change });
const restorePoints = async s0 => { const cur = (await get('/api/me')).settings; await call('PUT', '/api/settings', { ...pointsBody(s0), cp_expected: pointsBody(cur).cp_expected }); };
let serial = 0;
// A crew member of the seeded job whose next point (index 2) needs a photo, looked after by the agent and driven by the linked driver.
async function crewAt(name) {
  const full = `${name} ${++serial}`;
  const r = await call('POST', '/api/jobs/1/crew', { crew: [{ name: full, type: 'on', agent_id: uid('somsak') }] });
  assert.equal(r.status, 200, 'cannot add fixture crew');
  const id = r.data.ids[0];
  await call('PATCH', `/api/crew/${id}`, { vehicle_id: van1 });
  const t = Date.now();
  await call('PUT', `/api/crew/${id}/plan`, { plans: [-30, -20, -10, 5, 60, 600, 660, 690].map(m => t + m * 60000) });
  for (const idx of [0, 1]) await call('POST', `/api/crew/${id}/confirm`, { idx, at: t + (idx ? -19 : -29) * 60000, sent_at: Date.now() }, agent);
  return { id, name: full };
}
const cpLines = async name => (await job()).activity.filter(a => a.kind === 'cp' && a.text.startsWith(name + ' · '));

async function check(id, name, fn) {
  if (only && !only.test(id)) return;
  const logs = b.logs.length;
  try {
    await fn();
    if (b.logs.length > logs) throw new Error('console: ' + b.logs.slice(logs).join(' | '));
    results.push(`PASS ${id} ${name}`);
  } catch (e) {
    results.push(`FAIL ${id} ${name}: ${String(e.message).split('\n')[0].slice(0, 300)}`);
    try { await b.shot('evidence-fail-' + id, false); } catch (x) {}
  }
  console.log(results[results.length - 1]);
  try { await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await b.eval(`document.getElementById('dlg').open && document.getElementById('dlg').close()`); } catch (e) {}
}

await check('UI01', 'checkpoint count in the card header follows the rows on screen', async () => {
  await open('/admin/points', '#cpform .cp-row', admin, 1280);
  const state = () => b.eval(`[...document.querySelectorAll('.cp-card')].map(c => [c.querySelector('.cp-count').textContent, c.querySelectorAll('.cp-row').length, [...c.querySelectorAll('.cp-n')].map(n => n.textContent).join(''), c.querySelector('[data-chainsel]').options.length])`);
  assert.deepEqual(await state(), [['8 จุด', 8, '12345678', 8], ['7 จุด', 7, '1234567', 7]]);
  assert.equal(await b.eval(`document.getElementById('cpdirty').hidden`), true);
  await click('[data-act="a-cpadd"][data-key="cp_on"]');
  assert.deepEqual((await state())[0], ['9 จุด', 9, '123456789', 9]);
  assert.equal(await b.eval(`document.getElementById('cpdirty').hidden`), false, 'unsaved marker appears');
  await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] [data-act="a-cpdel"]')[1].click()`);
  await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] [data-act="a-cpdel"]')[1].click()`);
  await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_off"] [data-act="a-cpdel"]')[6].click()`);
  await sleep(200);
  assert.deepEqual(await state(), [['7 จุด', 7, '1234567', 7], ['6 จุด', 6, '123456', 6]]);
  assert.equal(await b.eval(`getComputedStyle(document.querySelector('.savebar')).position`), 'sticky');
  await b.size(390, 844, true);
  await sleep(200);
  const bar = await b.eval(`(() => { const r = document.querySelector('.savebar [type=submit]').getBoundingClientRect(); return [r.top >= 0, r.bottom <= innerHeight, r.height >= 40]; })()`);
  assert.deepEqual(bar, [true, true, true], 'save button stays reachable on a phone');
  assert.ok(await b.eval(`[...document.querySelectorAll('.cp-row .cp-l')].every(l => l.getBoundingClientRect().height > 8)`), 'every input has a visible label on a phone');
  assert.deepEqual(await b.eval(AUDIT), []);
  await click('[data-act="a-cpreset"]');
  assert.deepEqual(await state(), [['8 จุด', 8, '12345678', 8], ['7 จุด', 7, '1234567', 7]], 'cancel restores the saved list');
  assert.equal(await b.eval(`document.getElementById('cpdirty').hidden`), true);
  assert.equal((await get('/api/me')).settings.cp_on.length, 8, 'nothing was saved');
});

await check('UI02', 'reordering keeps each point\'s name, minutes, photo flag and the forecast choice by id', async () => {
  const s0 = (await get('/api/me')).settings;
  try {
    await open('/admin/points', '#cpform .cp-row', admin, 1280);
    const rows = () => b.eval(`[...document.querySelectorAll('.cp-edit[data-key="cp_on"] .cp-row')].map(r => [r.dataset.id, r.querySelector('[name=th]').value, +r.querySelector('[name=gap]').value, r.querySelector('[name=photo]').checked])`);
    const chain = () => b.eval(`(() => { const s = document.querySelector('[name="cp_on_chain"]'); return [s.value, s.selectedOptions[0].textContent]; })()`);
    const first = await rows();
    assert.deepEqual(first.map(r => r[0]), s0.cp_on.map(x => x.id));
    assert.deepEqual(await chain(), ['on5', '5. ถึงโรงแรม / เช็คอิน']);
    await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] .cp-row')[4].querySelector('[data-act="a-cpup"]').click()`);
    await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] .cp-row')[3].querySelector('[data-act="a-cpup"]').click()`);
    await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] .cp-row')[0].querySelector('[data-act="a-cpdown"]').click()`);
    await sleep(200);
    const want = [first[1], first[0], first[4], first[2], first[3], first[5], first[6], first[7]];
    assert.deepEqual(await rows(), want, 'whole rows move together');
    assert.deepEqual(await chain(), ['on5', '3. ถึงโรงแรม / เช็คอิน'], 'the choice follows its point to the new position');
    await b.eval(`document.querySelector('#cpform').requestSubmit()`);
    assert.ok(await eventually(async () => (await get('/api/me')).settings.cp_on[0].id === 'on2'), 'saved');
    const saved = (await get('/api/me')).settings;
    assert.deepEqual(saved.cp_on.map(x => [x.id, x.th, x.gap, x.photo]), want);
    assert.equal(saved.cp_on_chain, 2);
    await open('/admin/points', '#cpform .cp-row', admin, 1280);
    assert.deepEqual(await rows(), want, 'the saved order is what the page shows after a reload');
    assert.deepEqual(await chain(), ['on5', '3. ถึงโรงแรม / เช็คอิน']);
    await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] .cp-row')[2].querySelector('[data-act="a-cpdel"]').click()`);
    await sleep(200);
    assert.deepEqual(await chain(), ['', 'จุดเดิมถูกลบแล้ว กรุณาเลือกจุดใหม่'], 'deleting the chosen point never picks another one silently');
    await b.eval(`document.querySelector('#cpform').requestSubmit()`);
    assert.ok(await eventually(async () => (await text('#cpform .ferr')).includes('ถูกลบแล้ว')), 'saving is refused with a clear message');
    assert.deepEqual((await get('/api/me')).settings.cp_on.map(x => x.id), saved.cp_on.map(x => x.id), 'nothing was saved');
  } finally { await restorePoints(s0); }
});

await check('UI03', 'unsaved checkpoint edits ask before leaving and survive a concurrent save', async () => {
  const s0 = (await get('/api/me')).settings;
  try {
    await open('/admin/points', '#cpform .cp-row', admin, 1280);
    await type('.cp-edit[data-key="cp_on"] .cp-row [name=th]', 'เครื่องลงจอด');
    await click('a[href="/admin/users"]');
    assert.ok((await text('#dlg .dlg-h h3')).includes('ยังไม่ได้บันทึก'), 'leaving asks first');
    await click('#dlg .dlg-f [data-close]');
    assert.deepEqual([await b.eval('location.pathname'), await b.eval(`document.querySelector('.cp-row [name=th]').value`)], ['/admin/points', 'เครื่องลงจอด'], 'staying keeps the edit');
    const other = s0.cp_on.map((x, i) => i === 1 ? { ...x, gap: 44 } : x);
    assert.equal((await call('PUT', '/api/settings', pointsBody(s0, { cp_on: other }))).status, 200);
    await b.eval(`document.querySelector('#cpform').requestSubmit()`);
    assert.ok(await eventually(async () => (await text('#cpform .ferr')).includes('มีผู้แก้จุดสถานะ')), 'the stale save is refused');
    assert.equal(await b.eval(`document.querySelector('.cp-row [name=th]').value`), 'เครื่องลงจอด', 'the draft stays on screen');
    const cur = (await get('/api/me')).settings;
    assert.deepEqual([cur.cp_on[0].th, cur.cp_on[1].gap], ['เครื่องลง', 44], 'the other admin\'s save is intact');
    await click('a[href="/admin/users"]');
    await click('#dlg [type=submit]', 800);
    assert.equal(await b.eval('location.pathname'), '/admin/users', 'leaving without saving is still possible');
  } finally { await restorePoints(s0); }
});

await check('UI04', 'settings lists are stacked cards on a phone with no sideways scrolling', async () => {
  assert.equal((await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('0 19 * * *')}`)).status,200,'local scheduled-test endpoint enabled');
  assert.ok(await eventually(async () => ((await get('/api/backups')).backups || []).length > 0),'local synthetic backup created');
  for (const w of [390, 360]) {
    for (const tab of ['users', 'vehicles', 'hotels', 'backup']) {
      await open('/admin/' + tab, 'table.t.cards', admin, w);
      assert.deepEqual(await overflow(), [], `${tab} at ${w}`);
      const card = await b.eval(`(() => { const tr = document.querySelector('table.t.cards tbody tr'), btn = tr.querySelector('.acts .btn').getBoundingClientRect(); const tds = [...tr.children]; return { display: getComputedStyle(tr).display, stacked: tds.every((td, i) => !i || td.getBoundingClientRect().top >= tds[i - 1].getBoundingClientRect().bottom - 1), labels: tds.filter(td => td.dataset.l).map(td => getComputedStyle(td, '::before').content.replace(/"/g, '')), btn: [btn.left >= 0, btn.right <= innerWidth, btn.width >= innerWidth - 80, btn.height >= 40], font: Math.min(...tds.map(td => parseFloat(getComputedStyle(td).fontSize))), head: getComputedStyle(document.querySelector('table.t.cards thead')).display }; })()`);
      assert.deepEqual([card.display, card.stacked, card.head], ['grid', true, 'none'], `${tab} at ${w} is a stacked card`);
      assert.deepEqual(card.btn, [true, true, true, true], `${tab} at ${w}: the action is full width and on screen`);
      assert.ok(card.font >= 14, `${tab} at ${w}: text is not shrunk (${card.font}px)`);
      if (tab === 'users') assert.deepEqual(card.labels, ['รหัสพนักงาน', 'ชื่อผู้ใช้', 'สิทธิ์', 'เบอร์โทร', 'สถานะ']);
      if (tab === 'vehicles') assert.deepEqual(card.labels, ['ทะเบียน', 'คนขับ', 'ชื่อคนขับ (อังกฤษ)', 'เลขบัตร', 'เบอร์โทร', 'บัญชีคนขับ', 'สถานะ']);
      assert.deepEqual(await b.eval(AUDIT), [], `${tab} at ${w}`);
    }
  }
  await open('/admin/users', 'table.t.cards', admin, 390);
  const cards = await b.eval(`[...document.querySelectorAll('table.t.cards tbody tr')].map(tr => [!!tr.querySelector('.av'), tr.querySelector('.nm').textContent, ['รหัสพนักงาน', 'ชื่อผู้ใช้', 'สิทธิ์', 'เบอร์โทร'].every(l => { const td = tr.querySelector('td[data-l="' + l + '"]'); return !!td && td.textContent.trim() !== '' && td.getBoundingClientRect().height > 10; }), !!tr.querySelector('.pill'), tr.querySelector('.acts .btn').textContent.trim()])`);
  assert.ok(cards.length >= 6 && cards.every(c => c[0] && c[1] && c[2] && c[3] && c[4] === 'แก้ไข'), JSON.stringify(cards));
  await open('/admin/users', 'table.t.cards', admin, 1280);
  assert.deepEqual(await b.eval(`[getComputedStyle(document.querySelector('table.t.cards')).display, getComputedStyle(document.querySelector('table.t.cards thead')).display, getComputedStyle(document.querySelector('table.t.cards tbody tr')).display]`), ['table', 'table-header-group', 'table-row'], 'desktop keeps the table');
});

await check('UI05', 'a user sets, sees and removes the profile photo from the account page', async () => {
  await open('/account', '#pwf', agent, 390);
  assert.ok(await has('[data-chg="me-avatar"]'), 'the account page offers a profile photo');
  assert.equal(await has('.av.lg img'), false);
  await choose('[data-chg="me-avatar"]');
  assert.ok(await eventually(async () => (await get('/api/me', agent)).user.avatar_at > 0), 'uploaded');
  const at = (await get('/api/me', agent)).user.avatar_at, id = uid('somsak');
  assert.ok(await eventually(() => b.eval(`(() => { const a = document.querySelector('.who-row .av.lg img'), h = document.querySelector('#mebtn .av img'); return !!a && !!h && a.complete && h.complete && a.naturalWidth === 256 && a.naturalHeight === 256 && h.naturalWidth === 256; })()`)), 'the 256 px square shows on the account page and in the header at once');
  assert.ok((await text('#avedit .fstat')).includes('เปลี่ยนรูปโปรไฟล์แล้ว'));
  assert.equal(await b.eval(`document.querySelector('.who-row .av.lg img').getAttribute('src')`), `/api/avatar/${id}?v=${at}`);
  const res = await fetch(`${BASE}/api/avatar/${id}`, { headers: { cookie: 'cct_s=' + admin } }), body = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([res.status, res.headers.get('content-type'), body[0], body[1], body.length < 60000], [200, 'image/jpeg', 0xff, 0xd8, true]);
  assert.equal(Buffer.from(body).includes(Buffer.from('Exif')), false, 'the browser sends no camera metadata');
  assert.equal((await fetch(`${BASE}/api/avatar/${id}`)).status, 401);
  assert.deepEqual(await overflow(), []);
  await open('/field', '.fh .me', agent, 390);
  assert.ok(await eventually(() => b.eval(`(() => { const i = document.querySelector('.me .av img'); return !!i && i.complete && i.naturalWidth === 256; })()`)), 'field list header');
  await open('/admin/users', 'table.t.cards', admin, 1280);
  assert.ok(await eventually(() => b.eval(`(() => { const i = document.querySelector('table.t.cards img.avimg[src^="/api/avatar/${id}?"]'); return !!i && i.complete && i.naturalWidth === 256; })()`)), 'settings users list');
  await click(`[data-act="a-edituser"][data-id="${id}"]`);
  assert.equal(await b.eval(`!!document.querySelector('#dlg input[type=file]') || /รูปโปรไฟล์/.test(document.getElementById('dlg').textContent)`), false, 'an admin gets no control over someone else\'s photo');
  await b.eval(`document.getElementById('dlg').close()`);
  await b.eval(`(() => { const i = document.querySelector('table.t.cards img.avimg'); i.src = '/api/avatar/999999'; })()`);
  assert.ok(await eventually(() => b.eval(`!document.querySelector('table.t.cards img.avimg[src="/api/avatar/999999"]')`)), 'a photo that fails to load falls back to the initial');
  await open('/account', '#pwf', agent, 390);
  await click('[data-act="me-avatardel"]');
  await click('#dlg [type=submit]', 800);
  assert.ok(await eventually(async () => (await get('/api/me', agent)).user.avatar_at === 0), 'deleted');
  assert.deepEqual([await has('.av.lg img'), await has('#mebtn .av img'), (await text('.who-row .av.lg')).trim()], [false, false, 'ส']);
  assert.equal((await fetch(`${BASE}/api/avatar/${id}`, { headers: { cookie: 'cct_s=' + admin } })).status, 404);
});

await check('UI06', 'the linked driver sees the crew of the vehicle on a phone, marked as driver', async () => {
  assert.ok(driver, 'the seed has no driver account');
  await open('/field', '.crow', driver, 390);
  const rows = await b.eval(`[...document.querySelectorAll('.crow')].map(r => [r.querySelector('.nm').textContent, [...r.querySelectorAll('.mine .tag')].map(t => t.textContent).join('+')])`);
  for (const n of ['Rafael Mendoza', 'Arun Pillai', 'Tran Minh Duc']) assert.ok(rows.some(r => r[0] === n && r[1] === 'คนขับ'), n + ' ' + JSON.stringify(rows));
  assert.ok(!rows.some(r => ['Joel Castillo', 'Oleg Marchenko'].includes(r[0])), 'crew of other vehicles are not listed');
  assert.deepEqual(await overflow(), []);
  assert.deepEqual(await b.eval(AUDIT), []);
  const page = await b.eval('document.body.innerText'), api = JSON.stringify(await get('/api/field', driver));
  assert.ok(!/P1234567A|Z9876543|B0123456|2032-04-17/.test(page + api), 'no passport or seaman book data reaches the driver');
  await open('/field', '.crow', agent, 390);
  assert.ok((await b.eval(`[...document.querySelectorAll('.crow .mine .tag')].map(t => t.textContent)`)).every(t => t === 'ผู้ดูแล'), 'the agent\'s cards say agent');
});

await check('UI07', 'photo and confirm: one tap takes the photo, stores it on the point and confirms with the capture time', async () => {
  assert.ok(driver, 'the seed has no driver account');
  const c = await crewAt('E2E Snap');
  await open('/field/' + c.id, '.fa-cta', driver, 390);
  await geo('granted');
  assert.equal((await text('label.big.snap')).trim(), 'ถ่ายรูปและยืนยัน: พบ Meeting point');
  assert.deepEqual([await has('[data-act="f-confirm"]'), (await text('[data-act="f-nophoto"]')).trim()], [false, 'ยืนยันโดยไม่มีรูป']);
  const tap = await b.eval(`[...document.querySelectorAll('.fa-cta label.big, .fa-cta .skipbtn')].map(e => Math.round(e.getBoundingClientRect().height))`);
  assert.ok(tap.every(h => h >= 40), 'tap targets ' + tap);
  assert.deepEqual(await overflow(), []);
  assert.deepEqual(await b.eval(AUDIT), []);
  await b.shot('evidence-photo-confirm-390', false);
  const t0 = Date.now();
  await choose('[data-chg="f-snap"]');
  assert.ok(await eventually(async () => (await crewRow(c.id)).cps[2].actual != null && (await crewRow(c.id)).photos.length === 1, 20000), 'confirmed with a photo');
  const row = await crewRow(c.id), p = row.photos[0], x = row.cps[2];
  assert.deepEqual([x.by, x.role, x.skip, p.cp_idx, p.point, p.gps, p.acc, p.by], [uid('prasert'), 'driver', '', 2, 'พบ Meeting point', 'ok', 14, uid('prasert')]);
  assert.ok(Math.abs(p.lat - 13.0897) < 0.001 && Math.abs(p.lng - 100.8832) < 0.001);
  assert.ok(Math.abs(p.at - x.actual) < 2000 && x.actual >= t0 - 2000 && x.actual <= Date.now(), 'photo and checkpoint carry the same capture time');
  assert.equal((await cpLines(c.name)).length, 3);
  assert.ok(await eventually(async () => (await text('.tl')).includes('มีรูป 1')), 'the route shows the photo on that point');
  assert.equal((await outbox()).length, 0);
  await open('/jobs/1/8', 'tr.click', admin, 1280);
  await click(`tr.click[data-id="${c.id}"]`, 600);
  const box = await b.eval(`[...document.querySelectorAll('td.exp .mini > div')].map(d => d.innerText)`);
  assert.ok(box[2].includes('ยืนยันโดย ประเสริฐ (คนขับ)') && box[2].includes('มีรูป 1') && box[0].includes('ยืนยันโดย สมศักดิ์ (ผู้ดูแล)'), box[2]);
  assert.ok(await eventually(() => b.eval(`(() => { const i = document.querySelector('td.exp .pth img'); return !!i && i.complete && i.naturalWidth > 0; })()`)), 'thumbnail');
  assert.ok((await text(`tr.click[data-id="${c.id}"]`)).includes('รูป 1/1'));
  assert.ok((await b.eval(`document.querySelector('td.exp .pth').dataset.cap`)).includes('พิกัดจากมือถือ 13.08970, 100.88320 (±14 ม.)'));
  await click('td.exp .pth');
  assert.equal(await b.eval(`document.getElementById('lb').hidden`), false, 'the existing lightbox opens');
});

await check('UI08', 'cancelling the camera or having no file confirms nothing; a refused location is recorded as such', async () => {
  const c = await crewAt('E2E Cancel');
  await open('/field/' + c.id, '.fa-cta', agent, 390);
  await clearDevice();
  await b.eval(`document.querySelector('[data-chg="f-snap"]').dispatchEvent(new Event('cancel', { bubbles: true }))`);
  await sleep(300);
  assert.ok((await text('#toast')).includes('ยังไม่ได้ถ่ายรูป'), 'the user is told nothing was confirmed');
  await b.eval(`document.querySelector('[data-chg="f-snap"]').dispatchEvent(new Event('change', { bubbles: true }))`);
  await sleep(1200);
  assert.deepEqual([(await crewRow(c.id)).cps[2].actual, (await crewRow(c.id)).photos.length, (await outbox()).length, (await cpLines(c.name)).length], [null, 0, 0, 2]);
  assert.equal((await text('label.big.snap')).trim(), 'ถ่ายรูปและยืนยัน: พบ Meeting point', 'the photo button is still there');
  await geo('denied');
  await b.go('/field/' + c.id, 1200);
  await choose('[data-chg="f-snap"]');
  assert.ok(await eventually(async () => (await crewRow(c.id)).photos.length === 1 && (await crewRow(c.id)).cps[2].actual != null, 20000));
  const p = (await crewRow(c.id)).photos[0];
  assert.deepEqual([p.gps, p.lat, p.lng, p.acc, p.cp_idx], ['denied', null, null, null, 2]);
  await open('/jobs/1/8', 'tr.click', admin, 1280);
  await click(`tr.click[data-id="${c.id}"]`, 600);
  assert.ok((await b.eval(`document.querySelector('td.exp .pth').dataset.cap`)).includes('ไม่มีพิกัด (ไม่อนุญาตตำแหน่ง)'));
});

await check('UI09', 'confirming without a photo needs a reason and leaves the point marked until a photo is attached', async () => {
  const c = await crewAt('E2E Reason');
  await open('/field/' + c.id, '.fa-cta', agent, 390);
  await geo('granted');
  await click('[data-act="f-nophoto"]');
  assert.deepEqual(await b.eval(`[...document.querySelectorAll('#dlg [name=why]')].map(r => r.value)`), ['กล้องใช้ไม่ได้', 'พื้นที่ห้ามถ่ายรูป', 'ลูกเรือไม่สะดวก', '']);
  assert.deepEqual(await overflow(), []);
  await b.shot('evidence-no-photo-reason-390', false);
  await b.eval(`document.querySelector('#dlg form').requestSubmit()`);
  await sleep(700);
  assert.deepEqual([await b.eval(`document.getElementById('dlg').open`), (await crewRow(c.id)).cps[2].actual], [true, null], 'no reason, no confirmation');
  await b.eval(`document.querySelectorAll('#dlg [name=why]')[3].click()`);
  assert.equal(await b.eval(`document.getElementById('skipother').hidden`), false, 'free text appears for "other"');
  await type('#dlg [name=other]', 'ab');
  await b.eval(`document.querySelector('#dlg form').requestSubmit()`);
  await sleep(700);
  assert.equal((await crewRow(c.id)).cps[2].actual, null, 'two characters are not a reason');
  await type('#dlg [name=other]', 'ฝนตกหนัก ลูกเรือรีบขึ้นรถ');
  await b.eval(`document.querySelector('#dlg form').requestSubmit()`);
  assert.ok(await eventually(async () => (await crewRow(c.id)).cps[2].actual != null), 'confirmed with the reason');
  let x = (await crewRow(c.id)).cps[2];
  assert.deepEqual([x.skip, x.role, (await crewRow(c.id)).photos.length], ['ฝนตกหนัก ลูกเรือรีบขึ้นรถ', 'agent', 0]);
  assert.ok((await cpLines(c.name)).some(a => a.text.endsWith('ยืนยันโดยไม่มีรูป: ฝนตกหนัก ลูกเรือรีบขึ้นรถ') && a.who === 'สมศักดิ์'));
  assert.ok(await eventually(async () => (await text('.tl')).includes('รูปค้าง') && (await text('.tl')).includes('เหตุผล: ฝนตกหนัก')), 'the phone shows the photo as pending with the reason');
  await open('/jobs/1/8', 'tr.click', admin, 1280);
  assert.ok((await text(`tr.click[data-id="${c.id}"]`)).includes('รูป 0/1'));
  assert.ok((await b.eval(`[...document.querySelectorAll('.prep')].map(p => p.textContent)`)).some(t => t.includes(c.name + ' · พบ Meeting point รูปค้าง')), 'the office to-do list names it');
  await click(`tr.click[data-id="${c.id}"]`, 600);
  const box = await b.eval(`document.querySelectorAll('td.exp .mini > div')[2].innerText`);
  assert.ok(box.includes('รูปค้าง') && box.includes('เหตุผลที่ยืนยันโดยไม่มีรูป: ฝนตกหนัก ลูกเรือรีบขึ้นรถ') && box.includes('ยืนยันโดย สมศักดิ์ (ผู้ดูแล)'), box);
  await open('/field/' + c.id, '.tl label.evi.due', agent, 390);
  await choose('.tl label.evi.due input');
  assert.ok(await eventually(async () => (await crewRow(c.id)).photos.some(p => p.cp_idx === 2), 20000), 'a photo added later lands on that point');
  x = (await crewRow(c.id)).cps[2];
  assert.equal(x.skip, 'ฝนตกหนัก ลูกเรือรีบขึ้นรถ', 'the reason stays on record');
  assert.ok(await eventually(async () => (await text('.tl')).includes('มีรูป 1') && !(await has('.tl label.evi.due'))), 'the pending mark is gone');
});

await check('UI10', 'a photo the server refuses for good: the confirmation stays, the point is pending, the photo is kept for recovery', async () => {
  const c = await crewAt('E2E Refused');
  await open('/field/' + c.id, '.fa-cta', agent, 390);
  await clearDevice();
  await geo('granted');
  await b.eval(`window.realFetch = window.fetch; window.fetch = (url, opts) => String(url).includes('/photos?') ? Promise.resolve(new Response(JSON.stringify({ error: 'Synthetic permanent refusal' }), { status: 415, headers: { 'content-type': 'application/json' } })) : window.realFetch(url, opts)`);
  await choose('[data-chg="f-snap"]');
  assert.ok(await eventually(async () => (await crewRow(c.id)).cps[2].actual != null, 20000), 'the checkpoint is confirmed');
  const row = await crewRow(c.id), box = await outbox();
  assert.deepEqual([row.photos.length, row.cps[2].skip, box.length, !!box[0].photo, /Synthetic permanent refusal/.test(box[0].error), box[0].cp], [0, '', 1, true, true, 2]);
  assert.ok(await eventually(async () => (await text('.tl')).includes('รูปค้าง')), 'the phone shows the photo as pending');
  const size = await b.eval(`(async () => { const a = await import('/js/api.js'), s = await import('/js/app.js'); const it = a.pendingItems(s.A.me.id)[0]; return (await a.pendingFile(a.itemKey(it), s.A.me.id)).blob.size; })()`);
  assert.ok(size > 1000, 'the stamped photo can still be saved from the account page');
  await b.eval(`window.fetch = window.realFetch`);
  await b.eval(`import('/js/app.js').then(a => a.go('/account'))`);
  assert.ok(await waitFor('[data-act="pending-save"]'), 'recovery copy offered on the account page');
  await open('/jobs/1/8', 'tr.click', admin, 1280);
  assert.ok((await text(`tr.click[data-id="${c.id}"]`)).includes('รูป 0/1'), 'the office sees the point without a photo');
  await b.cookie(agent);
  await b.go('/account', 800);
  await clearDevice();
});

await check('UI11', 'no network: photo and confirmation are queued, sent later once, and retries create no duplicates', async () => {
  const c = await crewAt('E2E Offline');
  await open('/field/' + c.id, '.fa-cta', agent, 390);
  await clearDevice();
  await geo('granted');
  await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const t0 = Date.now();
  await choose('[data-chg="f-snap"]');
  assert.ok(await eventually(async () => (await outbox()).length === 2, 20000), 'two items queued');
  const box = await outbox();
  assert.deepEqual([!!box[0].photo, box[0].cp, box[0].gps, box[1].idx, box[1].upload, box[1].at], [true, 2, 'ok', 2, box[0].photo, box[0].at], 'the confirmation carries the photo\'s id and capture time');
  assert.ok(await eventually(async () => { const t = await text('.tl'); return t.includes('รอส่ง') && t.includes('รูปรอส่ง 1'); }), 'the phone shows both as waiting');
  assert.ok((await text('#toast')).includes('ไม่มีสัญญาณ'));
  assert.deepEqual([(await crewRow(c.id)).cps[2].actual, (await crewRow(c.id)).photos.length], [null, 0], 'nothing reached the server while offline');
  const flush = () => b.eval(`(async () => { const a = await import('/js/api.js'), s = await import('/js/app.js'); return a.flushOutbox(s.A.me.id); })()`);
  // The first answer to the photo and the first answer to the confirmation are lost after the server stored them.
  await b.eval(`window.realFetch = window.fetch; window.lost = { photos: 0, confirm: 0 }; window.fetch = async (url, opts) => { const r = await window.realFetch(url, opts); const k = String(url).includes('/photos?') ? 'photos' : String(url).includes('/confirm') ? 'confirm' : ''; if (k && r.ok && !window.lost[k]++) { await r.arrayBuffer(); throw new TypeError('Synthetic lost response'); } return r; }`);
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const sizes = [];
  for (let i = 0; i < 4 && (await outbox()).length; i++) { await flush(); sizes.push((await outbox()).length); }
  assert.deepEqual([await b.eval('window.lost.photos >= 1 && window.lost.confirm >= 1'), (await outbox()).length], [true, 0], 'both items were sent again after a lost answer: ' + sizes);
  await b.eval(`window.fetch = window.realFetch`);
  const row = await crewRow(c.id);
  assert.deepEqual([row.photos.length, row.photos[0].cp_idx, (await cpLines(c.name)).length, (await job()).activity.filter(a => a.kind === 'photo' && a.text.startsWith(c.name)).length], [1, 2, 3, 1], 'one photo, one checkpoint event, one activity line each');
  assert.ok(Math.abs(row.photos[0].at - row.cps[2].actual) < 2000 && Math.abs(row.cps[2].actual - t0) < 5000, 'both keep the time of capture, not the time of sending');
  assert.ok(row.cps[2].received >= row.cps[2].actual);
});

await check('UI12', 'keyboard only: add-user dialog and checkpoint editor in order, visible focus, Escape returns focus', async () => {
  await open('/admin/users', '[data-act="a-adduser"]', admin, 1280);
  await b.eval(`document.querySelector('[data-act="a-adduser"]').focus()`);
  await key('Enter');
  assert.ok(await waitFor('#dlg[open] [name=name]'), 'Enter opens the dialog');
  const seen = [await focused()];
  for (let i = 0; i < 9; i++) { await key('Tab'); seen.push(await focused()); }
  assert.deepEqual(seen.map(f => f.name), ['name', 'username', 'role', 'emp_code', 'title', 'phone', 'id_card', 'password', 'close', 'submit']);
  assert.ok(seen.every(f => f.ring && f.dlg), 'every stop shows a focus ring inside the dialog ' + JSON.stringify(seen.filter(f => !f.ring).map(f => f.name)));
  await key('Tab', true); await key('Tab', true);
  assert.equal((await focused()).name, 'password', 'Shift+Tab walks back');
  for (let i = 0; i < 5; i++) { await key('Tab'); const at = await focused(); assert.ok(at.dlg || at.tag === 'BODY' || at.tag === 'HTML', 'focus never reaches the page behind the dialog: ' + at.tag + ' ' + at.name); }
  assert.ok(['auto', 'menulist'].includes(await b.eval(`getComputedStyle(document.querySelector('#dlg [name=role]')).appearance`)), 'the role list is the native control');
  await key('Escape');
  await sleep(200);
  assert.deepEqual([await b.eval(`document.getElementById('dlg').open`), await b.eval(`document.activeElement.dataset.act`)], [false, 'a-adduser'], 'Escape closes and returns focus to the button');

  await open('/admin/points', '#cpform .cp-row', admin, 1280);
  await b.eval(`document.querySelector('[name="cp_on_chain"]').focus()`);
  await key('Tab'); await key('Tab', true);
  const path = [await focused()];
  for (let i = 0; i < 12; i++) { await key('Tab'); path.push(await focused()); }
  assert.deepEqual(path.map(f => `${f.row}:${f.name}`), ['0:cp_on_chain', '1:th', '1:en', '1:gap', '1:photo', '1:a-cpdown', '1:a-cpdel', '2:th', '2:en', '2:gap', '2:photo', '2:a-cpup', '2:a-cpdown']);
  assert.ok(path.every(f => f.ring), 'focus ring on every stop ' + JSON.stringify(path.filter(f => !f.ring).map(f => f.name)));
  const row2 = await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] .cp-row')[1].dataset.id`);
  await key('Enter');
  assert.deepEqual([await b.eval(`document.querySelectorAll('.cp-edit[data-key="cp_on"] .cp-row')[2].dataset.id`), (await focused()).name, (await focused()).row], [row2, 'a-cpdown', 3], 'Enter moves the row and focus follows it');
  await key('Tab', true); await key('Tab', true);
  assert.equal((await focused()).name, 'photo');
  const was = await b.eval('document.activeElement.checked');
  await key(' ');
  assert.equal(await b.eval('document.activeElement.checked'), !was, 'Space toggles the native checkbox');
  assert.ok(['auto', 'checkbox'].includes(await b.eval(`getComputedStyle(document.activeElement).appearance`)), 'the checkbox is the native control');
  await b.eval(`document.querySelector('[data-act="a-cpreset"]').focus()`);
  await key('Enter');
  await sleep(300);
  assert.equal(await b.eval(`document.getElementById('cpdirty').hidden`), true);
  const small = await b.eval(`[...document.querySelectorAll('#cpform button, #cpform select, #cpform input:not([type=checkbox])')].filter(e => e.getBoundingClientRect().height < 40).map(e => e.outerHTML.slice(0, 60))`);
  assert.deepEqual(small, [], 'controls are at least 40 px tall');
  assert.ok(await b.eval(`[...document.querySelectorAll('#cpform .iconbtn')].every(e => e.title && e.getAttribute('aria-label'))`), 'icon buttons have a name and a tooltip');
});

await check('UI13', 'a forecast time says where it comes from; no plan means no forecast', async () => {
  const c = await crewAt('E2E Late'), t = Math.floor(Date.now() / 60000) * 60000;
  await call('PUT', `/api/crew/${c.id}/plan`, { plans: [-90, -80, 20, 40, 60, 600, 660, 690].map(m => t + m * 60000) });
  for (const idx of [1, 0]) await call('POST', `/api/crew/${c.id}/undo`, { idx }, agent);
  await call('POST', `/api/crew/${c.id}/confirm`, { idx: 0, at: t - 88 * 60000 }, agent);
  assert.equal((await call('POST', `/api/crew/${c.id}/confirm`, { idx: 1, at: t - 40 * 60000 }, agent)).status, 200);
  const none = await crewAt('E2E No Plan');
  await call('PUT', `/api/crew/${none.id}/plan`, { plans: [null, null, null, null, null, null, null, null] });
  await open('/field/' + c.id, '.nextbox', agent, 390);
  const why = /คาดว่า [0-9/ :]+ = แผน [0-9/ :]+ \+ ช้า 40 นาที จากจุด ผ่าน ตม\./;
  assert.match(await text('.nextbox .fc'), why);
  assert.ok((await text('.fa-body')).includes('เวลา "คาดว่า" = เวลาตามแผน + ช้า 40 นาที จากจุด ผ่าน ตม. · เลื่อนถึงจุด ถึงโรงแรม / เช็คอิน'));
  assert.deepEqual(await overflow(), []);
  await b.go('/field', 900);
  assert.match(await b.eval(`[...document.querySelectorAll('.crow')].find(r => r.textContent.includes(${js(c.name)})).querySelector('.fc').textContent`), why, 'field list');
  await b.go('/field/' + none.id, 900);
  assert.deepEqual([await has('.fc'), (await text('.nextbox .t')).trim()], [false, 'ยังไม่มีแผน']);
  await open('/jobs/1/8', 'tr.click', admin, 1280);
  assert.ok((await text(`tr.click[data-id="${c.id}"] .fwhy`)).includes('+ ช้า 40 นาที จากจุด ผ่าน ตม.'), 'office step 8');
  assert.equal(await has(`tr.click[data-id="${none.id}"] .fwhy`), false);
  assert.ok((await b.eval(`[...document.querySelectorAll('.prep')].map(p => p.textContent)`)).some(x => x.includes(c.name) && x.includes('+ ช้า 40 นาที จากจุด ผ่าน ตม.)')), 'office to-do list');
  await b.go('/jobs/1/5', 900);
  assert.ok((await b.eval(`[...document.querySelectorAll('.fcnotes div')].map(d => d.textContent)`)).some(x => x.includes(c.name) && x.includes('ช้า 40 นาที จากจุด ผ่าน ตม.')), 'office step 5');
});

await check('UI14', 'office step 7 shows drivers without an account and never switches a driver by itself', async () => {
  assert.ok(driver, 'the seed has no driver account');
  const c = await crewAt('E2E Relink');
  try {
    await open('/jobs/1/7', 'select[data-f="vehicle_id"]', admin, 1280);
    const cell = id => b.eval(`document.querySelector('select[data-f="vehicle_id"][data-id="${id}"]').closest('td').innerText`);
    const joel = (await job()).crew.find(x => x.name === 'Joel Castillo');
    assert.ok((await cell(joel.id)).includes('คนขับยังไม่มีบัญชี จะไม่เห็นลูกเรือในมือถือ'));
    assert.ok((await cell(c.id)).includes('คนขับในมือถือ: ประเสริฐ'));
    assert.deepEqual(await overflow(), []);
    assert.equal((await call('PATCH', `/api/vehicles/${van1}`, { user_id: uid('wichai') })).status, 200);
    await b.go('/jobs/1/7', 1200);
    assert.ok((await cell(c.id)).includes('คนขับของรถคันนี้เปลี่ยนเป็น วิชัย แล้ว'), await cell(c.id));
    assert.equal((await crewRow(c.id)).driver_id, uid('prasert'), 'nothing changed by itself');
    await click(`[data-act="o-driver"][data-id="${c.id}"]`, 900);
    assert.ok(await eventually(async () => (await crewRow(c.id)).driver_id === uid('wichai')), 'the office switches one crew member explicitly');
    assert.ok(await eventually(async () => (await cell(c.id)).includes('คนขับในมือถือ: วิชัย')));
    await b.go('/admin/vehicles', 1000);
    await click('[data-act="a-res"][data-kind="vehicles"]:not([data-id])');
    const opts = await b.eval(`[...document.querySelector('#dlg [name=user_id]').options].map(o => o.textContent)`);
    assert.ok(opts[0] === 'ยังไม่มีบัญชี' && opts.some(o => o.startsWith('ประเสริฐ')) && !opts.some(o => /Somying|ปราณี/.test(o)), 'only field accounts are offered ' + opts);
    assert.ok((await text('#dlg .fhelp')).includes('จะขึ้นในมือถือของคนขับคนนั้น'));
    await b.eval(`(() => { const s = document.querySelector('#dlg [name=user_id]'); s.value = [...s.options].find(o => o.textContent.startsWith('ประเสริฐ')).value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.deepEqual(await b.eval(`['driver', 'driver_phone', 'driver_id'].map(n => document.querySelector('#dlg [name=' + n + ']').value)`), ['ประเสริฐ', '089-000-2002', '3-2002-00000-00-1'], 'empty boxes are filled from the account');
    await type('#dlg [name=name]', 'รถทดสอบ E2E');
    await b.eval(`document.querySelector('#dlg form').requestSubmit()`);
    assert.ok(await eventually(async () => ((await get('/api/me')).vehicles.find(v => v.name === 'รถทดสอบ E2E') || {}).user_id === uid('prasert')), 'the link is saved');
    assert.ok(await eventually(async () => (await b.eval(`[...document.querySelectorAll('table.t.cards tbody tr')].map(tr => tr.innerText)`)).some(x => x.includes('รถทดสอบ E2E') && x.includes('ประเสริฐ'))), 'the list shows the linked account');
  } finally {
    await call('PATCH', `/api/vehicles/${van1}`, { user_id: uid('prasert') });
    const extra = (await get('/api/me')).vehicles.find(v => v.name === 'รถทดสอบ E2E');
    if (extra) await call('PATCH', `/api/vehicles/${extra.id}`, { active: false, user_id: null });
  }
});

await check('UI15', 'nothing on the changed screens claims that a photo or a location proves anything', async () => {
  const words = /พิสูจน์|หลักฐาน|ยืนยันตัวตน|พิกัด GPS/;
  const seen = [];
  for (const [ck, path, sel, w] of [[agent, '/field', '.fh', 390], [agent, '/field/1', '.fa-cta', 390], [admin, '/jobs/1/8', 'tr.click', 1280], [admin, '/admin/points', '#cpform', 1280], [admin, '/admin/vehicles', 'table.t.cards', 1280], [agent, '/account', '#pwf', 390]]) {
    await open(path, sel, ck, w);
    if (path === '/jobs/1/8') await click('tr.click', 500);
    const t = await b.eval(`document.body.innerText + [...document.querySelectorAll('[title],[data-cap],[aria-label]')].map(e => (e.title || '') + (e.dataset.cap || '') + (e.getAttribute('aria-label') || '')).join(' ')`);
    if (words.test(t)) seen.push(path + ': ' + t.match(words)[0]);
  }
  assert.deepEqual(seen, []);
  await open('/field/1', '.gps-note', agent, 390);
  assert.ok((await text('.gps-note')).includes('พิกัดจากมือถือ'));
});

b.close();
const pass = results.filter(r => r.startsWith('PASS ')).length, fail = results.filter(r => r.startsWith('FAIL ')).length;
console.log(`\nPASS ${pass} / FAIL ${fail} / CONSOLE ${b.logs.length}`);
if (fail || !pass) process.exitCode = 1;
