import { browser, login, photo, BASE, ADMIN_USER, FIELD_PASS } from './cdp.mjs';

const office = await login(ADMIN_USER, process.env.ADMIN_PASS);
const field = await login('somsak', FIELD_PASS);
const get = async (path, ck = office) => (await fetch(BASE + path, { headers: { cookie: 'cct_s=' + ck } })).json();
const results = [];
const ok = (cond, msg) => { results.push((cond ? 'PASS ' : 'FAIL ') + msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const b = await browser();
const $ = (sel, i = 0) => `document.querySelectorAll(${JSON.stringify(sel)})[${i}]`;
const waitFor = async (sel, i = 0) => { for (let k = 0; k < 50; k++) { if (await b.eval(`!!${$(sel, i)}`)) return true; await sleep(100); } return false; };
const eventually = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) {} await sleep(250); } return false; };
const click = async (sel, i = 0, wait = 700) => { await waitFor(sel, i); const found = await b.eval(`(() => { const e = ${$(sel, i)}; if (!e) return false; e.click(); return true; })()`); if (!found) results.push('FAIL missing ' + sel); await sleep(wait); return found; };
const setVal = async (sel, v, i = 0) => (await waitFor(sel, i)) && b.eval(`(() => { const e = ${$(sel, i)}; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const submit = async sel => { await b.eval(`${$(sel)}.requestSubmit()`); await sleep(900); };
const text = sel => b.eval(`(${$(sel)} || {}).textContent || ''`);

await b.size(1280, 900);
await b.go('/api/health', 200);
await b.cookie(office);

let job = await get('/api/jobs/1');
const arun = job.crew.find(c => c.name === 'Arun Pillai');
const joel = job.crew.find(c => c.name === 'Joel Castillo');

// step 1: doc toggle + add crew + edit + delete
await b.go('/jobs/1/1');
await click(`[data-act="o-doc"][data-id="${arun.id}"][data-doc="Seaman book"]`);
job = await get('/api/jobs/1');
ok(job.crew.find(c => c.id === arun.id).docs['Seaman book'] === 1, 'step1 toggle document saves');
await setVal('#addcrew [name=name]', 'Kenji Sato');
await setVal('#addcrew [name=rank]', '2/O');
await setVal('#addcrew [name=flight]', 'JL 707');
await submit('#addcrew');
job = await get('/api/jobs/1');
const kenji = job.crew.find(c => c.name === 'Kenji Sato');
ok(!!kenji && kenji.cps.length === 8, 'step1 add crew creates 8 checkpoints');
await click(`[data-act="o-editcrew"][data-id="${kenji.id}"]`);
await setVal('#dlg [name=nationality]', 'Japanese');
await submit('#dlg form');
job = await get('/api/jobs/1');
ok(job.crew.find(c => c.id === kenji.id).nationality === 'Japanese', 'step1 edit crew dialog saves');
const miss = await b.eval(`document.querySelector('.card-b.pre').textContent`);
ok(miss.includes('Kenji Sato') && miss.includes('Joel Castillo'), 'step1 missing list updates');

// step 2: schedule
await b.go('/jobs/1/2');
await setVal('#schedf [name=etb]', '2026-10-01T09:30');
await setVal('#schedf [name=source]', 'LCB Marine · email');
await submit('#schedf');
job = await get('/api/jobs/1');
ok(job.job.etb === Date.UTC(2026, 9, 1, 2, 30), 'step2 ETB saved as Bangkok time');
ok(job.activity.some(a => a.kind === 'eta' && a.text.includes('ETB เปลี่ยนจาก')), 'step2 history records change');
const hist = await text('.feed');
ok(hist.includes('ETB เปลี่ยนจาก'), 'step2 history visible');

// step 3: service toggle + mail follows + sent
await b.go('/jobs/1/3');
await click('[data-act="o-svc"][data-svc="Husbandry"]');
let mailTxt = '';
const svcOk = await eventually(async () => { mailTxt = await b.eval(`document.getElementById('mailtext').value`); return mailTxt.includes('Husbandry') && mailTxt.includes('CREW CHANGE / HUSBANDRY'); });
ok(svcOk, 'step3 email follows services' + (svcOk ? '' : ' (' + (mailTxt.split('\n').find(l => l.startsWith('Subject')) || mailTxt.slice(0, 80)) + ')'));
await click('[data-act="o-sent"][data-key="appoint"]');
job = await get('/api/jobs/1');
ok(job.job.sent.appoint > Date.now() - 60000, 'step3 mark sent saves');

// step 4: s4 + deadline
await b.go('/jobs/1/4');
const blocked = await b.eval(`!!document.querySelector('[data-act="o-s4"][data-id="${joel.id}"][data-key="oktb"]')`);
ok(!blocked, 'step4 OKTB button hidden when documents missing');
await click(`[data-act="o-s4"][data-id="${joel.id}"][data-key="meet"]`);
job = await get('/api/jobs/1');
ok(job.crew.find(c => c.id === joel.id).s4.meet === true, 'step4 meeting point toggle saves');
await setVal('#immf [name=imm]', '2026-10-01T06:00');
await submit('#immf');
job = await get('/api/jobs/1');
ok(job.job.imm_deadline === Date.UTC(2026, 9, 1) - 3600000, 'step4 immigration deadline saved');

// step 5: plan dialog autofill
await b.go('/jobs/1/5');
await click(`[data-act="o-plan"][data-id="${kenji.id}"]`);
await setVal('#dlg [name=p0]', '2026-10-01T08:00');
await click('#autofill', 0, 300);
const p1 = await b.eval(`document.querySelector('#dlg [name=p1]').value`);
ok(p1 === '2026-10-01T08:45', 'step5 autofill uses template gaps (' + p1 + ')');
await submit('#dlg form');
job = await get('/api/jobs/1');
ok(job.crew.find(c => c.id === kenji.id).cps.every(x => x.plan), 'step5 plan saved for all checkpoints');

// step 6: gate mail contents
await b.go('/jobs/1/6');
const gate = await b.eval(`document.getElementById('mailtext').value`);
ok(gate.includes('Boarding agent | สมศักดิ์ | ID 3-1001') && gate.includes('Driver | Prasert'), 'step6 gate email lists agents and drivers');

// step 7: assign
await b.go('/jobs/1/7');
await b.eval(`(() => { const s = document.querySelector('select[data-f="agent_id"][data-id="${kenji.id}"]'); s.value = s.options[[...s.options].findIndex(o => o.textContent === 'สมศักดิ์')].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
ok(await eventually(async () => { job = await get('/api/jobs/1'); return job.crew.find(c => c.id === kenji.id).agent_id != null; }), 'step7 assign field staff saves');
const fieldList = await get('/api/field', field);
ok(fieldList.crew.some(c => c.id === kenji.id), 'step7 assigned crew appears on staff phone list');

// step 8: expand row, template switch, owner link
await b.go('/jobs/1/8');
await click(`tr[data-id="${arun.id}"]`);
ok(await b.eval(`!!document.querySelector('td.exp .mini')`), 'step8 row expands with details');
await b.eval(`(() => { const s = document.querySelector('[data-chg="o-tpl"]'); s.value = 'morning'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(400);
ok((await b.eval(`document.getElementById('mailtext').value`)).includes('MORNING UPDATE'), 'step8 morning template');
const oldToken = job.job.owner_token;
await click('[data-act="o-newtoken"]');
await submit('#dlg form');
job = await get('/api/jobs/1');
ok(job.job.owner_token !== oldToken, 'step8 new owner link created');
ok(await eventually(async () => (await text('.linkbox')).includes(job.job.owner_token)), 'step8 new link shown');

// field phone: confirm, note, photo, undo
await b.size(390, 800, true);
await b.cookie(field);
await b.go('/field/' + arun.id, 1800);
const before = (await get('/api/jobs/1')).crew.find(c => c.id === arun.id).cps.filter(x => x.actual).length;
await click('[data-act="f-confirm"]', 0, 2600);
let a2 = (await get('/api/jobs/1')).crew.find(c => c.id === arun.id);
ok(a2.cps.filter(x => x.actual).length === before + 1, 'field confirm records next checkpoint');
await click('[data-act="f-note"]', 0, 300);
await setVal('#noteedit textarea', 'กระเป๋าตกค้าง รอ 30 นาที');
await submit('#noteedit');
a2 = (await get('/api/jobs/1')).crew.find(c => c.id === arun.id);
ok(a2.notes.some(n => n.text.includes('กระเป๋า')), 'field note saved');
await b.eval(`(async () => { const bytes = Uint8Array.from(atob(${JSON.stringify(photo().toString('base64'))}), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'p.jpg', { type: 'image/jpeg' })); const inp = document.querySelectorAll('input[data-chg="f-photo"]')[1]; inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(9000);
a2 = (await get('/api/jobs/1')).crew.find(c => c.id === arun.id);
ok(a2.photos.length === 1, 'field photo uploaded (' + a2.photos.length + ')');
ok(await b.eval(`!!document.querySelector('.pgrid img')`), 'field photo thumbnail shown');
await b.eval(`window.confirm = () => true`);
await click('[data-act="f-undo"]', 0, 1800);
a2 = (await get('/api/jobs/1')).crew.find(c => c.id === arun.id);
ok(a2.cps.filter(x => x.actual).length === before, 'field undo removes last checkpoint');
ok(await b.eval(`!document.querySelector('.mtabs') || getComputedStyle(document.querySelector('.mtabs')).display === 'none'`), 'bottom tabs hidden on crew detail');

// owner page
await b.cookie('none');
await b.go('/t/' + job.job.owner_token, 1800);
const ow = await b.eval(`document.body.innerText`);
ok(ow.includes('MT OCEAN MERIDIAN') && ow.includes('Arun Pillai') && !ow.includes('Z9876543') && !ow.includes('กระเป๋า'), 'owner page shows status without private data');
await b.go('/t/' + oldToken, 2500);
ok((await b.eval(`document.body.innerText`)).includes('not available'), 'old owner link shows not available');

// admin
await b.size(1280, 900);
await b.cookie(office);
await b.go('/admin/users');
await click('[data-act="a-adduser"]');
await setVal('#dlg [name=name]', 'ทดสอบ');
await setVal('#dlg [name=username]', 'tester1');
await setVal('#dlg [name=password]', 'tester-pass-1');
await submit('#dlg form');
const users = await get('/api/users');
ok(users.users.some(u => u.username === 'tester1'), 'admin add user');
await b.go('/admin/points');
await click('[data-act="a-cpadd"][data-key="cp_off"]', 0, 300);
await b.eval(`(() => { const r = [...document.querySelectorAll('.cp-edit[data-key="cp_off"] .cp-row')].pop(); r.querySelector('[name=th]').value = 'ถึงบ้าน'; r.querySelector('[name=en]').value = 'Arrived home'; })()`);
await submit('#cpform');
const me = await get('/api/me');
ok(me.settings.cp_off.length === 8 && me.settings.cp_off[7].en === 'Arrived home', 'admin add checkpoint to template');
await b.go('/admin/general');
await setVal('#genform [name=late_min]', '12');
await submit('#genform');
ok((await get('/api/me')).settings.late_min === 12, 'admin general settings save');

// close + reopen
await b.go('/jobs/1/9');
await click('[data-act="o-close"]');
await submit('#dlg form');
job = await get('/api/jobs/1');
ok(job.job.status === 'closed', 'close job');
await click('[data-act="o-reopen"]', 0, 1200);
job = await get('/api/jobs/1');
ok(job.job.status === 'open', 'reopen job');

results.push(...b.logs.map(l => 'CONSOLE ' + l));
b.close();
const pass = results.filter(r => r.startsWith('PASS ')).length;
const fail = results.filter(r => r.startsWith('FAIL ')).length;
console.log(results.join('\n'));
console.log(`\nPASS ${pass} / FAIL ${fail} / CONSOLE ${b.logs.length}`);
if (fail || b.logs.length) process.exitCode = 1;
