import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, login, BASE, OUT, ADMIN_USER, FIELD_PASS } from './cdp.mjs';
import { pdf } from '../gen.mjs';
import { PDFDocument } from '../../public/js/vendor/pdf-lib.esm.min.js';

const office = await login(ADMIN_USER, process.env.ADMIN_PASS);
const field = await login('somsak', FIELD_PASS);
const call = async (method, path, body, ck = office) => {
  const res = await fetch(BASE + path, { method, headers: { 'x-cct': '1', cookie: 'cct_s=' + ck, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const get = async (path, ck) => (await call('GET', path, undefined, ck)).data;
const results = [];
const ok = (cond, msg) => { results.push((cond ? 'PASS ' : 'FAIL ') + msg); return !!cond; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DL = join(OUT, 'oktb-download');
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const b = await browser();
process.on('exit', () => { try { b.close(); } catch (e) {} });
const $ = (sel, i = 0) => `document.querySelectorAll(${JSON.stringify(sel)})[${i}]`;
const waitFor = async (sel, i = 0) => { for (let k = 0; k < 50; k++) { if (await b.eval(`!!${$(sel, i)}`)) return true; await sleep(100); } return false; };
const eventually = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) {} await sleep(250); } return false; };
const click = async (sel, i = 0, wait = 700) => { await waitFor(sel, i); const found = await b.eval(`(() => { const e = ${$(sel, i)}; if (!e) return false; e.click(); return true; })()`); if (!found) results.push('FAIL missing ' + sel); await sleep(wait); return found; };
const setVal = async (sel, v, i = 0) => (await waitFor(sel, i)) && b.eval(`(() => { const e = ${$(sel, i)}; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const setChk = (sel, on) => b.eval(`(() => { const e = ${$(sel)}; if (e.checked !== ${on}) e.click(); return e.checked; })()`);
const submit = async (sel, wait = 900) => { await b.eval(`${$(sel)}.requestSubmit()`); await sleep(wait); };
const text = sel => b.eval(`(${$(sel)} || {}).textContent || ''`);
const closeDlg = () => b.eval(`document.getElementById('dlg').close()`);
const open = async (path, sel) => { await b.go(path, 300); if (!(await eventually(() => b.eval(`!!document.querySelector(${JSON.stringify(sel)})`), 15000))) results.push('FAIL page did not render ' + path); await sleep(400); };
const b64 = `async blob => { const a = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }`;
const paint = (w, h, code) => b.eval(`(async () => { const cv = document.createElement('canvas'); cv.width = ${w}; cv.height = ${h}; const g = cv.getContext('2d'); ${code} return (${b64})(await new Promise(r => cv.toBlob(r, 'image/png'))); })()`);
const putFiles = (sel, files) => b.eval(`(() => { const dt = new DataTransfer(); for (const f of ${JSON.stringify(files)}) dt.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, { type: f.type })); const inp = ${$(sel)}; inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const overflow = () => b.eval(`(() => { const out = []; const W = document.documentElement.clientWidth; if (document.documentElement.scrollWidth > W + 1) out.push('page ' + document.documentElement.scrollWidth + '>' + W); const d = document.getElementById('dlg'); if (d.open) { const r = d.getBoundingClientRect(); if (r.right > W + 1 || r.left < -1) out.push('dialog off screen'); d.querySelectorAll('*').forEach(e => { const x = e.getBoundingClientRect(); if (x.width && (x.right > r.right + 1 || x.left < r.left - 1) && !e.closest('[hidden]')) out.push((e.className || e.tagName) + ' sticks out ' + Math.round(x.right - r.right)); }); d.querySelectorAll('.dlg-b, .dlg-f').forEach(e => { if (e.scrollWidth > e.clientWidth + 1) out.push(e.className + ' scrolls sideways'); }); d.querySelectorAll('button, a.btn, label.btn, input:not([type=checkbox]):not([type=file]), select').forEach(e => { const x = e.getBoundingClientRect(); if (x.height && x.height < 34) out.push('small tap ' + (e.textContent || e.name).trim().slice(0, 16) + ' ' + Math.round(x.height)); }); } return out; })()`);
const pngOf = sel => b.eval(`(async () => { const im = ${$(sel)}; await im.decode(); const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); return (${b64})(await new Promise(r => cv.toBlob(r, 'image/png'))); })()`);
const ink = sel => b.eval(`(async () => { const im = ${$(sel)}; await im.decode(); const w = im.naturalWidth, h = im.naturalHeight; const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, w, h).data; let l = w, r = 0, t = h, bt = 0, top = 0, red = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > bt) bt = y; if (y < h * 0.12) top++; if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) red++; } } return { w, h, l: l / w, r: r / w, t: t / h, b: bt / h, top, red }; })()`);
const save = (name, base64) => { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), Buffer.from(base64, 'base64')); };
const download = async name => {
  const file = join(DL, name);
  rmSync(file, { force: true });
  const prior = new Set(b.downloads.keys());
  if (!await eventually(() => b.eval(`!document.querySelector('#oktbf button[type=submit]').disabled`))) return null;
  await b.eval(`${$('#oktbf')}.requestSubmit()`);
  let event;
  const done = await eventually(() => {
    event = [...b.downloads.values()].find(d => !prior.has(d.guid) && d.suggestedFilename === name);
    return event?.state === 'completed' && existsSync(event.filePath || file);
  }, 60000);
  writeFileSync(join(OUT, 'download-events.json'), JSON.stringify([...b.downloads.values()], null, 2));
  if (!done) return null;
  const bytes = readFileSync(event.filePath || file);
  if (event.receivedBytes !== bytes.length) throw Error('Completed download byte count disagrees with the saved PDF');
  return new Uint8Array(bytes);
};

await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));` });
try { await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true }); } catch (e) { await b.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true }); }
const csp = [];
const collect = async () => csp.push(...(await b.eval(`window.__csp || []`)));

await b.size(1280, 900);
await b.go('/api/health', 200);
await b.cookie(office);

const page = await fetch(BASE + '/');
ok((page.headers.get('content-security-policy') || '').includes("script-src 'self'"), 'the local server sends the production Content-Security-Policy');
ok(!readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8').includes('pdf-lib'), 'pdf-lib is not in the service-worker precache');

let job = await get('/api/jobs/1');
const rafael = job.crew.find(c => c.name === 'Rafael Mendoza');
const arun = job.crew.find(c => c.name === 'Arun Pillai');
const joel = job.crew.find(c => c.name === 'Joel Castillo');
const crewOf = id => job.crew.find(c => c.id === id);

// step 1: the three new fields on two crew through the edit dialog, and on a new crew through the add form
await open('/jobs/1/1', '.crewdocs');
const fields = { [rafael.id]: ['2033-01-15', 'SIRB-E2E-0001', '2031-03-20'], [arun.id]: ['2032-11-30', 'SIRB-E2E-0002', '2030-08-05'] };
for (const c of [rafael, arun]) {
  await click(`[data-act="o-editcrew"][data-id="${c.id}"]`);
  await setVal('#dlg [name=passport_exp]', fields[c.id][0]);
  await setVal('#dlg [name=sirb_no]', fields[c.id][1]);
  await setVal('#dlg [name=sirb_exp]', fields[c.id][2]);
  await submit('#dlg form');
}
job = await get('/api/jobs/1');
ok([rafael, arun].every(c => { const x = crewOf(c.id); return x.passport_exp === fields[c.id][0] && x.sirb_no === fields[c.id][1] && x.sirb_exp === fields[c.id][2]; }), 'step1 edit dialog saves passport expiry, SIRB no. and SIRB expiry for two crew');
await setVal('#addcrew [name=name]', 'Maria Santos');
await setVal('#addcrew [name=rank]', 'OS');
await setVal('#addcrew [name=passport]', 'P7654321B');
await setVal('#addcrew [name=passport_exp]', '2034-06-01');
await setVal('#addcrew [name=sirb_no]', 'SIRB-E2E-0003');
await setVal('#addcrew [name=sirb_exp]', '2031-12-31');
await submit('#addcrew');
job = await get('/api/jobs/1');
const maria = job.crew.find(c => c.name === 'Maria Santos');
ok(maria && maria.passport_exp === '2034-06-01' && maria.sirb_no === 'SIRB-E2E-0003' && maria.sirb_exp === '2031-12-31', 'step1 add form saves the three new fields');

// step 1: document files
const passport = name => paint(1000, 700, `g.fillStyle = '#eef3f8'; g.fillRect(0, 0, 1000, 700); g.strokeStyle = '#3b5b8a'; g.lineWidth = 6; g.strokeRect(20, 20, 960, 660); g.fillStyle = '#c9d4e2'; g.fillRect(60, 150, 250, 320); g.fillStyle = '#1f3557'; g.font = '700 34px sans-serif'; g.fillText('SPECIMEN PASSPORT - NOT A REAL DOCUMENT', 60, 90); g.font = '400 30px sans-serif'; g.fillText('Name: ${name}', 350, 200); g.fillText('Generated placeholder for automated tests', 350, 260); g.font = '400 30px monospace'; g.fillText('P<XXXSPECIMEN<<PLACEHOLDER<<<<<<<<<<<<<<<<<<', 60, 560); g.fillText('0000000000XXX0000000X0000000<<<<<<<<<<<<<<00', 60, 610);`);
const ticket = name => Buffer.from(pdf([`SAMPLE E-TICKET RECEIPT (NOT REAL) - ${name} - page 1 of 2`, `SAMPLE E-TICKET RECEIPT (NOT REAL) - ${name} - page 2 of 2`])).toString('base64');
for (const c of [rafael, arun]) {
  await click(`[data-act="o-files"][data-id="${c.id}"]`);
  await putFiles('#dlg input[data-kind="passport"]', [{ name: `passport ${c.name}.png`, type: 'image/png', b64: await passport(c.name) }]);
  ok(await eventually(async () => (await get('/api/jobs/1')).crew.find(x => x.id === c.id).files.length === 1), `step1 passport image uploaded for ${c.name}`);
  ok(await eventually(async () => (await text('#dlg .fgroup .fstat')).includes('แนบแล้ว 1 ไฟล์')), `step1 upload confirmation shown for ${c.name}`);
  await putFiles('#dlg input[data-kind="ticket"]', [{ name: `e-ticket ${c.name}.pdf`, type: 'application/pdf', b64: ticket(c.name) }]);
  ok(await eventually(async () => (await get('/api/jobs/1')).crew.find(x => x.id === c.id).files.length === 2), `step1 e-ticket PDF uploaded for ${c.name}`);
  await closeDlg();
}
await click(`[data-act="o-files"][data-id="${rafael.id}"]`);
await putFiles('#dlg input[data-kind="other"]', [{ name: 'notes.txt', type: 'text/plain', b64: Buffer.from('plain text').toString('base64') }, { name: 'broken.pdf', type: 'application/pdf', b64: Buffer.from('this is not a pdf').toString('base64') }]);
ok(await eventually(async () => { const t = await b.eval(`document.querySelectorAll('#dlg .fgroup')[3].querySelector('.ferr').textContent`); return t.includes('notes.txt: รองรับเฉพาะ') && t.includes('broken.pdf: ไฟล์เสียหาย'); }), 'step1 refused files show a Thai reason per file');
await b.eval(`window.confirm = () => true`);
await putFiles('#dlg input[data-kind="other"]', [{ name: 'extra.png', type: 'image/png', b64: await paint(60, 40, `g.fillStyle = '#888'; g.fillRect(0, 0, 60, 40);`) }]);
ok(await eventually(async () => (await get('/api/jobs/1')).crew.find(x => x.id === rafael.id).files.length === 3), 'step1 extra file uploaded');
const link = await b.eval(`(() => { const a = document.querySelector('#dlg .fname'); return [a.getAttribute('href'), a.target, a.rel].join('|'); })()`);
job = await get('/api/jobs/1');
ok(link === `/api/files/${crewOf(rafael.id).files[0].id}|_blank|noopener`, 'step1 file name opens the file in a new tab');
await click('#dlg [data-act="o-delfile"]', 2, 300);
ok(await eventually(async () => (await get('/api/jobs/1')).crew.find(x => x.id === rafael.id).files.length === 2), 'step1 delete removes the file after confirm');
ok(await eventually(async () => (await b.eval(`document.querySelectorAll('#dlg .fgroup')[3].querySelector('.fstat').textContent`)).includes('ลบไฟล์แล้ว')), 'step1 delete confirmation shown');
await closeDlg();
await sleep(300);
const row = await b.eval(`(() => { const tr = document.querySelector('[data-act="o-files"][data-id="${rafael.id}"]').closest('tr'); return tr.textContent; })()`);
ok(row.includes('ไฟล์เอกสาร (2)') && row.includes('มีไฟล์แนบ 1'), 'step1 row shows the file count and a hint under the document buttons');
ok(await b.eval(`(() => { const s = document.querySelector('.crewdocs').closest('.scroll'); return s.scrollWidth <= s.clientWidth + 1; })()`), 'step1 table still fits a 1280 px screen without sideways scrolling');
job = await get('/api/jobs/1');
ok(crewOf(rafael.id).docs['Passport'] === rafael.docs['Passport'] && crewOf(arun.id).docs['Seaman book'] === arun.docs['Seaman book'], 'step1 uploading does not change the manual document buttons');
const fileId = crewOf(rafael.id).files[0].id;
ok((await fetch(BASE + '/api/files/' + fileId, { headers: { cookie: 'cct_s=' + field } })).status === 403 && (await fetch(BASE + '/api/files/' + fileId)).status === 401, 'field staff and visitors cannot open an uploaded passport');
await collect();

// step 4 before any brand image exists: the two choices are switched off and point to settings
await open('/jobs/1/4', '[data-act="o-oktb"]');
await click('[data-act="o-oktb"]', 0, 1200);
const bare = await b.eval(`(() => { const f = document.getElementById('oktbf'); const a = f.querySelector('.okopts a'); return { lh: [f.elements.letterhead.checked, f.elements.letterhead.disabled], sign: [f.elements.sign.checked, f.elements.sign.disabled], attach: f.elements.attach.checked, hint: f.querySelector('.okopts').textContent, link: a && a.getAttribute('href') }; })()`);
ok(bare.lh.join() === 'false,true' && bare.sign.join() === 'false,true' && bare.attach && bare.hint.includes('ยังไม่ได้อัปโหลดหัวจดหมาย') && bare.hint.includes('ยังไม่ได้อัปโหลดลายเซ็นและตราประทับ') && bare.link === '/admin/general', 'step4 letterhead and signature choices are disabled with a link to settings until images are uploaded');
await closeDlg();

// settings: brand images and letter texts
await open('/admin/general', '#oktbform');
const brand = {
  letterhead: await paint(1800, 300, `g.fillStyle = '#0c1733'; g.fillRect(40, 50, 170, 170); g.fillStyle = '#fff'; g.font = '700 110px sans-serif'; g.fillText('P', 88, 175); g.fillStyle = '#0c1733'; g.font = '700 64px sans-serif'; g.fillText('PLACEHOLDER MARINE AGENCY CO., LTD.', 250, 115); g.fillStyle = '#475569'; g.font = '400 34px sans-serif'; g.fillText('123 Example Road, Sample District, Bangkok 10000 (generated test letterhead)', 250, 170); g.fillText('Tel 02-000-0000  ops@example.com', 250, 215); g.fillStyle = '#0c1733'; g.fillRect(40, 262, 1720, 8); g.fillStyle = '#c8102e'; g.fillRect(40, 262, 300, 8);`),
  signature: await paint(600, 220, `g.strokeStyle = '#1b2f6b'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(40, 150); g.bezierCurveTo(120, 20, 170, 220, 240, 110); g.bezierCurveTo(290, 30, 330, 210, 400, 100); g.bezierCurveTo(440, 50, 500, 160, 560, 90); g.stroke();`),
  stamp: await paint(360, 360, `g.strokeStyle = '#c8102e'; g.fillStyle = '#c8102e'; g.lineWidth = 10; g.beginPath(); g.arc(180, 180, 165, 0, 7); g.stroke(); g.lineWidth = 4; g.beginPath(); g.arc(180, 180, 120, 0, 7); g.stroke(); g.font = '700 40px sans-serif'; g.textAlign = 'center'; g.fillText('SAMPLE', 180, 175); g.fillText('STAMP', 180, 220);`)
};
for (const k of ['letterhead', 'signature', 'stamp']) {
  await putFiles(`input[data-chg="a-brand"][data-kind="${k}"]`, [{ name: k + '.png', type: 'image/png', b64: brand[k] }]);
  ok(await eventually(async () => (await get('/api/me')).brand[k] > 0 && await b.eval(`(() => { const im = document.querySelector('.brand-pv img[src^="/api/brand/${k}"]'); return !!im && im.complete && im.naturalWidth > 0; })()`)), `settings upload ${k} and show its thumbnail`);
}
await putFiles('input[data-chg="a-brand"][data-kind="stamp"]', [{ name: 'stamp.gif', type: 'image/gif', b64: Buffer.from('GIF89a').toString('base64') }]);
ok(await eventually(async () => (await b.eval(`document.querySelectorAll('.brand .ferr')[2].textContent`)).includes('PNG / JPG')), 'settings refuses a wrong image type in Thai');
await setVal('#oktbform [name=pic_name]', 'Khun Somying (test)');
await setVal('#oktbform [name=pic_mobile]', '081-000-0000');
await setVal('#oktbform [name=signer_name]', 'Somying Placeholder');
await setVal('#oktbform [name=intro]', 'changed');
await click('[data-act="a-oktbreset"][data-key="intro"]', 0, 200);
await submit('#oktbform');
let me = await get('/api/me');
ok(me.settings.oktb.pic_name === 'Khun Somying (test)' && me.settings.oktb.pic_mobile === '081-000-0000' && me.settings.oktb.signer_name === 'Somying Placeholder' && me.settings.oktb.intro.startsWith('We are {{company}}'), 'settings save P.I.C, signer and letter texts, reset restores the default paragraph');
ok((await text('#toast')).includes('บันทึกเอกสาร OK TO BOARD แล้ว'), 'settings save shows a toast');
ok((await get('/api/me', field)).brand === undefined && (await fetch(BASE + '/api/brand/signature', { headers: { cookie: 'cct_s=' + field } })).status === 403, 'field staff cannot read the signature image');
await collect();

// step 4: generate the pack
const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const fileName = `OKTB_MT-OCEAN-MERIDIAN_${today.replace(/-/g, '')}.pdf`;
await open('/jobs/1/4', '[data-act="o-oktb"]');
ok((await b.eval(`document.querySelector('main').textContent`)).includes('เอกสาร OK TO BOARD สำหรับ ตม. สนามบิน') && !(await b.eval(`document.querySelector('main').textContent`)).includes('ออกตามวิธีเดิมของบริษัท'), 'step4 shows the document card and no longer says the document is issued the old way');
await click('[data-act="o-oktb"]', 0, 1200);
job = await get('/api/jobs/1');
const on = job.crew.filter(c => c.type === 'on');
const defaults = await b.eval(`(() => { const f = document.getElementById('oktbf'); return { crew: [...f.querySelectorAll('[name=crew]')].map(e => e.checked), date: f.elements.date.value, call: f.elements.call_date.value, flights: f.elements.flights.value, company: f.elements.company.value, pic: f.elements.pic_name.value, mobile: f.elements.pic_mobile.value, lh: [f.elements.letterhead.checked, f.elements.letterhead.disabled], sign: [f.elements.sign.checked, f.elements.sign.disabled], attach: f.elements.attach.checked }; })()`);
const etb = new Date(job.job.etb + 7 * 3600000).toISOString().slice(0, 10);
ok(defaults.crew.length === on.length && defaults.crew.every(Boolean), 'step4 dialog lists every On signer, all ticked');
ok(defaults.date === today && defaults.call === etb, `step4 dates default to today and the ETB date (${defaults.date}, ${defaults.call})`);
ok(defaults.flights === [...new Set(on.map(c => c.flight).filter(Boolean))].join('\n') && defaults.company === me.settings.company.name && defaults.pic === 'Khun Somying (test)' && defaults.mobile === '081-000-0000', 'step4 flights, company and P.I.C come from the crew and settings');
ok(defaults.lh.join() === 'true,false' && defaults.sign.join() === 'true,false' && defaults.attach, 'step4 letterhead, signature and attach are on by default once images exist');
const warn = await b.eval(`[...document.querySelectorAll('#oktbf .okc')].map(e => e.textContent)`);
ok(warn.find(t => t.includes('Joel Castillo')).includes('เลขพาสปอร์ต') && warn.find(t => t.includes('Joel Castillo')).includes('ไฟล์ตั๋วเครื่องบิน') && warn.find(t => t.includes('Rafael Mendoza')).includes('ยังขาด ไฟล์ Seaman book') && !warn.find(t => t.includes('Rafael Mendoza')).includes('ไฟล์พาสปอร์ต'), 'step4 warnings name exactly what each crew member is missing');
for (const c of on) if (c.id !== rafael.id && c.id !== arun.id) await setChk(`#oktbf [name=crew][value="${c.id}"]`, false);
ok((await b.eval(`document.getElementById('oktbf').elements.flights.value`)) === 'PR 732\nAI 332', 'step4 flight list follows the ticked crew until it is edited');
await setVal('#oktbf [name=to]', 'Example Airways Limited');
await setVal('#oktbf [name=flights]', 'EX974 19SEP MNL-HKG 0530-0750 LT.\nEX701 19SEP HKG-BKK 0900-1105 LT.\nEX332 19SEP DEL-BKK 0140-0725 LT.');
await click('[data-act="o-oktbprev"]', 0, 500);
ok(await eventually(() => b.eval(`(() => { const im = document.querySelector('#okprev img'); return !!im && im.complete && im.naturalWidth > 1000; })()`)), 'step4 preview shows the letter page inside the dialog');
ok(await b.eval(`(() => { const im = document.querySelector('#okprev img').getBoundingClientRect(), d = document.querySelector('#oktbf .dlg-b').getBoundingClientRect(); return im.top >= d.top - 2 && im.top < d.bottom - 120; })()`), 'step4 dialog scrolls to the preview so the user sees it');
ok((await text('#oktbf .fstat')).includes('ตัวอย่างหน้าแรก'), 'step4 preview confirmation shown in the dialog');
save('oktb-letter-with-letterhead.png', await pngOf('#okprev img'));
const a = await ink('#okprev img');
ok(a.w === 1654 && a.h === 2339, `letter page is A4 at 200 dpi (${a.w}x${a.h})`);
ok(a.l > 0.08 && a.r < 0.92 && a.t > 0.02 && a.b < 0.96, `letter with letterhead stays inside the page margins (left ${a.l.toFixed(3)} right ${a.r.toFixed(3)} top ${a.t.toFixed(3)} bottom ${a.b.toFixed(3)})`);
ok(a.top > 10000 && a.red > 1500, `letterhead and red stamp are drawn (${a.top} dark pixels in the top band, ${a.red} red)`);
job = await get('/api/jobs/1');
ok(job.job.oktb.to === 'Example Airways Limited' && job.job.oktb.letterhead === true && job.job.oktb.sign === true && job.job.oktb.attach === true && String(job.job.oktb.crew) === String([rafael.id, arun.id]) && job.job.oktb.date === today, 'step4 preview saves the options to the job');
let bytes = await download(fileName);
ok(!!bytes, `step4 download arrives as ${fileName}`);
if (bytes) {
  writeFileSync(join(OUT, 'oktb-pack-with-letterhead.pdf'), bytes);
  ok(Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-', 'pack is a PDF file');
  const doc = await PDFDocument.load(bytes);
  const sizes = doc.getPages().map(p => p.getSize()).map(s => `${Math.round(s.width)}x${Math.round(s.height)}`);
  ok(doc.getPageCount() === 7, `pack with letterhead has 1 letter + 2 passports + 2 x 2 ticket pages = 7 (${doc.getPageCount()})`);
  ok(sizes.slice(0, 3).every(s => s === '595x842'), 'letter and passport pages are A4 (' + sizes.join(' ') + ')');
  ok(bytes.length < 3 * 1024 * 1024, `pack size is reasonable (${Math.round(bytes.length / 1024)} KB)`);
}
ok((await text('#oktbf .fstat')).includes('ดาวน์โหลด ' + fileName), 'step4 download confirmation shown in the dialog');

// step 4: no letterhead, no signature, no attachments
await setChk('#oktbf [name=letterhead]', false);
await setChk('#oktbf [name=sign]', false);
await setChk('#oktbf [name=attach]', false);
await setVal('#oktbf [name=company]', 'Other Shipping Agency Co., Ltd.');
await b.eval(`document.querySelector('#okprev img').remove()`);
await click('[data-act="o-oktbprev"]', 0, 500);
ok(await eventually(() => b.eval(`(() => { const im = document.querySelector('#okprev img'); return !!im && im.complete && im.naturalWidth > 1000; })()`)), 'step4 preview again without letterhead');
save('oktb-letter-plain.png', await pngOf('#okprev img'));
const p = await ink('#okprev img');
ok(p.l > 0.08 && p.r < 0.92 && p.t > 0.05 && p.b < 0.96, `plain letter stays inside the page margins (left ${p.l.toFixed(3)} right ${p.r.toFixed(3)} top ${p.t.toFixed(3)} bottom ${p.b.toFixed(3)})`);
ok(p.red === 0 && p.top < a.top / 2 && p.b < a.b, `plain letter has no letterhead, signature or stamp (${p.top} dark pixels in the top band, ${p.red} red)`);
bytes = await download(fileName);
if (ok(!!bytes, 'step4 second download arrives')) {
  writeFileSync(join(OUT, 'oktb-pack-plain.pdf'), bytes);
  ok((await PDFDocument.load(bytes)).getPageCount() === 1, 'pack without attachments is the letter only: 1 page');
}
await closeDlg();
await click('[data-act="o-oktb"]', 0, 1200);
const again = await b.eval(`(() => { const f = document.getElementById('oktbf'); return [f.elements.to.value, f.elements.company.value, f.elements.letterhead.checked, f.elements.sign.checked, f.elements.attach.checked, [...f.querySelectorAll('[name=crew]:checked')].map(e => e.value).join(), f.elements.flights.value.split('\\n').length].join('|'); })()`);
ok(again === `Example Airways Limited|Other Shipping Agency Co., Ltd.|false|false|false|${rafael.id},${arun.id}|3`, 'step4 reopening the dialog restores the saved options (' + again + ')');
await setChk(`#oktbf [name=crew][value="${rafael.id}"]`, false);
await setChk(`#oktbf [name=crew][value="${arun.id}"]`, false);
await click('[data-act="o-oktbprev"]', 0, 600);
ok((await text('#oktbf .ferr')).includes('เลือกลูกเรืออย่างน้อย 1 คน'), 'step4 refuses to build a letter with nobody ticked');
await closeDlg();

// a broken attachment names the crew member and the file
const bad = new Uint8Array(Buffer.from('%PDF-1.4\nthis file is cut off'));
const up = await fetch(BASE + `/api/crew/${maria.id}/files?kind=ticket&name=cut-off.pdf`, { method: 'POST', headers: { 'x-cct': '1', cookie: 'cct_s=' + office, 'content-type': 'application/pdf' }, body: bad });
ok(up.status === 200, 'a damaged PDF can be stored (only its header is checked)');
await open('/jobs/1/4', '[data-act="o-oktb"]');
await click('[data-act="o-oktb"]', 0, 1200);
for (const c of on) await setChk(`#oktbf [name=crew][value="${c.id}"]`, false);
await setChk(`#oktbf [name=crew][value="${maria.id}"]`, true);
await setChk('#oktbf [name=attach]', true);
await b.eval(`${$('#oktbf')}.requestSubmit()`);
ok(await eventually(async () => { const t = await text('#oktbf .ferr'); return t.includes('เปิดไฟล์ PDF ไม่ได้') && t.includes('Maria Santos') && t.includes('cut-off.pdf'); }), 'a damaged attachment stops the pack with the crew name and file name in Thai');
ok(!(await b.eval(`[...document.querySelectorAll('#oktbf .dlg-f button')].some(e => e.disabled)`)), 'buttons are usable again after the error');
await closeDlg();
await collect();

// a long crew list continues on a second letter page
const longJob = (await call('POST', '/api/jobs', { vessel: 'MV LONG LIST', port: 'Map Ta Phut', etb: Date.now() + 86400000 })).data.id;
const odd = { 3: 'Maximiliano Alejandro Fernandez-Villanueva de la Cruz Santos y Rodriguez-Montenegro Bartholomew Fitzgerald', 7: 'สมชาย วงศ์ดีเลิศประเสริฐศักดิ์', 11: 'Олександр Шевченко', 15: 'Nguyễn Văn Đức', 19: '王小明' };
await call('POST', `/api/jobs/${longJob}/crew`, { crew: Array.from({ length: 48 }, (_, i) => ({ name: odd[i] || `Crew Member ${i + 1}`, rank: 'AB', type: 'on', nationality: i % 2 ? 'Filipino' : 'Vietnamese', passport: 'P' + (1000000 + i), passport_exp: '2031-01-0' + (i % 9 + 1), sirb_no: 'S-' + (5000 + i), sirb_exp: '2030-02-1' + (i % 9), flight: 'EX 10' + (i % 3) })) });
await open(`/jobs/${longJob}/4`, '[data-act="o-oktb"]');
await click('[data-act="o-oktb"]', 0, 1200);
await setVal('#oktbf [name=to]', 'Example Airways Limited');
await click('[data-act="o-oktbprev"]', 0, 500);
ok(await eventually(() => b.eval(`(() => { const im = document.querySelector('#okprev img'); return !!im && im.complete && im.naturalWidth > 1000; })()`)), 'long list preview renders');
const note = await text('#okprev .sub');
const longPages = await b.eval(`(async () => { const M = await import('/js/oktb.js'); const d = await (await fetch('/api/jobs/${longJob}')).json(); const me = await (await fetch('/api/me')).json(); const L = M.letterData(d.job, d.crew, me.settings.oktb, { ...d.job.oktb, company: me.settings.company.name }); const pages = await M.renderLetter(L, {}); const out = []; for (const cv of pages) out.push(await (${b64})(await M.pageBlob(cv))); return out; })()`);
longPages.forEach((x, i) => save(`oktb-letter-long-${i + 1}.png`, x));
ok(longPages.length >= 2 && note.includes(`จดหมายยาว ${longPages.length} หน้า`), `a 48 crew list continues on another letter page and the preview says so (${longPages.length} pages, "${note}")`);
bytes = await download(`OKTB_MV-LONG-LIST_${today.replace(/-/g, '')}.pdf`);
ok(!!bytes && (await PDFDocument.load(bytes)).getPageCount() === longPages.length, 'long list pack has the same number of letter pages');
await closeDlg();
await collect();

// settings: remove an image again
await open('/admin/general', '#oktbform');
await b.eval(`window.confirm = () => true`);
await click('[data-act="a-branddel"][data-kind="stamp"]', 0, 300);
ok(await eventually(async () => (await get('/api/me')).brand.stamp === 0 && (await b.eval(`document.querySelectorAll('.brand')[2].textContent`)).includes('ยังไม่มีรูป')), 'settings remove the stamp image after confirm');
ok((await fetch(BASE + '/api/brand/stamp', { headers: { cookie: 'cct_s=' + office } })).status === 404 && (await fetch(BASE + '/api/brand/signature', { headers: { cookie: 'cct_s=' + office } })).status === 200, 'the removed image is gone from storage, the others stay');
await collect();

// the pack builder itself: turned phone photos, WEBP, oversized and small images, a locked PDF
const locked = Buffer.from(Buffer.from(pdf(['locked'])).toString('latin1').replace('/Root 1 0 R >>', '/Root 1 0 R /Encrypt << /Filter /Standard /V 1 /R 2 /O (00000000000000000000000000000000) /U (00000000000000000000000000000000) /P -44 >> >>'), 'latin1').toString('base64');
const edge = await b.eval(`(async () => {
  const M = await import('/js/oktb.js');
  const make = (w, h, type) => new Promise(r => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#224466'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffcc00'; g.fillRect(0, 0, w / 2, h / 2); c.toBlob(async x => r(new Uint8Array(await x.arrayBuffer())), type, 0.9); });
  const jpg = await make(400, 200, 'image/jpeg');
  const exif = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
  const turned = new Uint8Array(jpg.length + exif.length);
  turned.set(jpg.subarray(0, 2)); turned.set(exif, 2); turned.set(jpg.subarray(2), 2 + exif.length);
  const L = M.letterData({ vessel: 'MV EDGE', port: 'Sample Port' }, [{ name: 'Edge Case', rank: 'AB', nationality: '', passport: '', passport_exp: '', sirb_no: '', sirb_exp: '' }], { subject: 's', intro: 'i {{vessel}}', guarantee: 'g', signer_name: '', signer_title: '', footer: '' }, { company: 'c', date: '2026-01-02', call_date: '', to: '', flights: '' });
  const files = [['turned.jpg', 'image/jpeg', turned], ['pic.webp', 'image/webp', await make(300, 200, 'image/webp')], ['huge.png', 'image/png', await make(4000, 3000, 'image/png')], ['small.png', 'image/png', await make(200, 100, 'image/png')], ['plain.jpg', 'image/jpeg', jpg]].map(([name, mime, bytes]) => ({ crew: 'Edge Case', name, mime, bytes }));
  const out = { pdf: await (${b64})(new Blob([await M.buildPack(L, {}, files, 'edge')])), jpg: jpg.length };
  try { await M.buildPack(L, {}, [{ crew: 'Edge Case', name: 'locked.pdf', mime: 'application/pdf', bytes: Uint8Array.from(atob(${JSON.stringify(locked)}), c => c.charCodeAt(0)) }]); out.locked = 'no error'; } catch (e) { out.locked = e.message; }
  try { await M.buildPack(L, {}, [{ crew: 'Edge Case', name: 'broken.png', mime: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }]); out.broken = 'no error'; } catch (e) { out.broken = e.message; }
  return out;
})()`);
{
  const lib = await import('../../public/js/vendor/pdf-lib.esm.min.js');
  const doc = await lib.PDFDocument.load(Buffer.from(edge.pdf, 'base64'));
  const info = doc.getPages().slice(1).map(pg => {
    const img = doc.context.lookup(pg.node.Resources().lookup(lib.PDFName.of('XObject'), lib.PDFDict).entries()[0][1]);
    const body = pg.node.Contents();
    const ops = Buffer.from(lib.decodePDFRawStream(body instanceof lib.PDFArray ? body.lookup(0) : body).decode()).toString('latin1');
    const cm = [...ops.matchAll(/([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) cm/g)].map(m => m.slice(1).map(Number));
    const n = k => img.dict.lookup(lib.PDFName.of(k)).asNumber();
    return { px: `${n('Width')}x${n('Height')}`, filter: String(img.dict.lookup(lib.PDFName.of('Filter'))), bytes: img.contents.length, x: cm[0][4], y: cm[0][5], w: cm[2][0], h: cm[2][3] };
  });
  const near = (v, want) => Math.abs(v - want) < 0.6;
  ok(doc.getPageCount() === 6, `builder: letter plus one page per image (${doc.getPageCount()})`);
  ok(info[0].px === '200x400' && near(info[0].w, 150) && near(info[0].h, 300), `builder: a phone photo stored sideways is turned upright (${info[0].px}, drawn ${info[0].w}x${info[0].h} pt)`);
  ok(info[1].px === '300x200' && info[1].filter === '/DCTDecode', `builder: WEBP is converted to JPEG (${info[1].px} ${info[1].filter})`);
  ok(info[2].px === '2400x1800' && near(info[2].w, 538.6) && near(info[2].x, 28.3) && near(info[2].h, 403.9), `builder: an oversized image is reduced and fits inside 10 mm margins (${info[2].px}, drawn ${info[2].w.toFixed(1)}x${info[2].h.toFixed(1)} at x ${info[2].x.toFixed(1)})`);
  ok(info[3].px === '200x100' && near(info[3].w, 150) && near(info[3].h, 75) && near(info[3].x, (595.28 - 150) / 2) && near(info[3].y, (841.89 - 75) / 2), `builder: a small image is centred and not enlarged (${info[3].w}x${info[3].h} at ${info[3].x.toFixed(1)},${info[3].y.toFixed(1)})`);
  ok(info[4].px === '400x200' && info[4].bytes === edge.jpg, 'builder: an ordinary JPEG is embedded untouched');
  ok(edge.locked.includes('ถูกล็อกด้วยรหัส') && edge.locked.includes('Edge Case') && edge.locked.includes('locked.pdf'), 'builder: a password-locked PDF is refused in Thai with the crew and file name (' + edge.locked + ')');
  ok(edge.broken.includes('เปิดไฟล์รูปไม่ได้') && edge.broken.includes('broken.png'), 'builder: a damaged image is refused in Thai with the file name (' + edge.broken + ')');
}
await collect();

// phone width: nothing sticks out of the screen
await b.size(390, 800, true);
await open('/jobs/1/1', '.crewdocs');
ok((await overflow()).length === 0, 'step1 page fits 390 px: ' + (await overflow()).join('; '));
await click(`[data-act="o-editcrew"][data-id="${rafael.id}"]`);
let o = await overflow();
ok(o.length === 0, 'edit crew dialog fits 390 px: ' + o.join('; '));
await b.shot('oktb-390-editcrew', false);
await closeDlg();
await click(`[data-act="o-files"][data-id="${rafael.id}"]`);
o = await overflow();
ok(o.length === 0, 'files dialog fits 390 px: ' + o.join('; '));
await b.shot('oktb-390-files', false);
await closeDlg();
await open('/jobs/1/4', '[data-act="o-oktb"]');
ok((await overflow()).length === 0, 'step4 page fits 390 px: ' + (await overflow()).join('; '));
await click('[data-act="o-oktb"]', 0, 1200);
o = await overflow();
ok(o.length === 0, 'OK TO BOARD dialog fits 390 px: ' + o.join('; '));
await b.shot('oktb-390-dialog', false);
await click('[data-act="o-oktbprev"]', 0, 500);
await eventually(() => b.eval(`(() => { const im = document.querySelector('#okprev img'); return !!im && im.complete && im.naturalWidth > 1000; })()`));
await sleep(600);
o = await overflow();
ok(o.length === 0, 'OK TO BOARD dialog with preview fits 390 px: ' + o.join('; '));
await b.shot('oktb-390-dialog-preview', false);
await closeDlg();
await open('/admin/general', '#oktbform');
o = await overflow();
ok(o.length === 0, 'settings page fits 390 px: ' + o.join('; '));
await b.eval(`document.getElementById('oktbform').scrollIntoView()`);
await sleep(300);
await b.shot('oktb-390-settings', false);
await collect();

// field phone and Owner page: nothing about documents
await b.cookie(field);
await open('/field/' + rafael.id, '.fa-hero');
const phone = await b.eval(`document.body.innerText`);
ok(phone.includes('Rafael Mendoza') && !/SIRB|ไฟล์เอกสาร|OK TO BOARD|2033-01-15/.test(phone), 'field phone screen shows no document data');
await b.cookie('none');
await open('/t/' + job.job.owner_token, '.ow-crew');
const owner = await b.eval(`document.body.innerText`);
ok(owner.includes('Rafael Mendoza') && !/SIRB|passport|2033-01-15/i.test(owner), 'Owner page shows no document data');
await collect();

await call('DELETE', `/api/jobs/${longJob}`);
ok(csp.length === 0, 'no Content-Security-Policy violation while uploading, previewing and building the PDF' + (csp.length ? ': ' + csp.join('; ') : ''));
results.push(...b.logs.map(l => 'CONSOLE ' + l));
b.close();
const pass = results.filter(r => r.startsWith('PASS ')).length;
const fail = results.filter(r => r.startsWith('FAIL ')).length;
console.log(results.join('\n'));
console.log(`\nPASS ${pass} / FAIL ${fail} / CONSOLE ${b.logs.length}`);
if (fail || b.logs.length) process.exitCode = 1;
