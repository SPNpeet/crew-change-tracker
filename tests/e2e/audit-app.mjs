import { browser, login, AUDIT, BASE, ADMIN_USER, FIELD_PASS } from './cdp.mjs';

const widths = (process.env.WIDTHS || '360,390,430,768,1024,1280,1440').split(',').map(Number);
const shots = new Set((process.env.SHOTS || '').split(',').filter(Boolean));
const office = await login(ADMIN_USER, process.env.ADMIN_PASS);
const field = await login('somsak', FIELD_PASS);
const lead = await login('napa', FIELD_PASS);
const driver = await login('prasert', FIELD_PASS);
const job = await (await fetch(BASE + '/api/jobs/1', { headers: { cookie: 'cct_s=' + office } })).json();
const token = job.job.owner_token;
const id = name => job.crew.find(c => c.name === name).id;
const c1 = id('Rafael Mendoza'), c2 = id('Arun Pillai'), c5 = id('Oleg Marchenko');
const press = sel => `document.querySelector(${JSON.stringify(sel)}).click()`;

// name, session, path, what must be on screen before measuring, optional action (and what it must show)
const pages = [
  ['login', null, '/login', '#loginf'],
  ['jobs', office, '/jobs', '.jobtile'], ['newjob', office, '/jobs/new', '#newjob'],
  ...[1, 2, 3, 4, 5, 6, 7, 9].map(k => ['step' + k, office, '/jobs/1/' + k, '.office section .card']),
  ['step8', office, '/jobs/1/8', '[data-act="o-expand"]', press(`[data-act="o-expand"][data-id="${c1}"]`), '.exp .mini'],
  ['step1-files', office, '/jobs/1/1', '[data-act="o-files"]', press('[data-act="o-files"]'), '#dlg[open] .fgroups'],
  ['step1-editcrew', office, '/jobs/1/1', '[data-act="o-editcrew"]', press('[data-act="o-editcrew"]'), '#dlg[open] [name=sirb_exp]'],
  ['step4-oktb', office, '/jobs/1/4', '[data-act="o-oktb"]', press('[data-act="o-oktb"]'), '#dlg[open] #oktbf'],
  ['step5-plan', office, '/jobs/1/5', '[data-act="o-plan"]', press('[data-act="o-plan"]'), '#dlg[open] .planrows'],
  ['report', office, '/jobs/1/report', '.rp-page'],
  ...['users', 'vehicles', 'hotels', 'points', 'general', 'backup'].map(t => ['admin-' + t, office, '/admin/' + t, '#adm .card']),
  ['admin-user-add', office, '/admin/users', '[data-act="a-adduser"]', press('[data-act="a-adduser"]'), '#dlg[open] [name=username]'],
  ['admin-user-edit', office, '/admin/users', '[data-act="a-edituser"]', press('[data-act="a-edituser"]'), '#dlg[open] [name=active]'],
  ['admin-vehicle-add', office, '/admin/vehicles', '[data-act="a-res"]', press('[data-act="a-res"]:not([data-id])'), '#dlg[open] [name=user_id]'],
  ['admin-vehicle-edit', office, '/admin/vehicles', '[data-act="a-res"][data-id]', press('[data-act="a-res"][data-id]'), '#dlg[open] [name=user_id]'],
  ['account', office, '/account', '#pwf'],
  ['field-office', office, '/field', '.fh'],
  ['field', field, '/field', '.crow'], ['crew', field, '/field/' + c2, '.fa-cta'], ['field-account', field, '/account', '#pwf'],
  ['lead', lead, '/field', '.crow'], ['lead-off', lead, '/field/' + c5, '.fa-cta'],
  ['driver', driver, '/field', '.crow'], ['driver-crew', driver, '/field/' + c1, '.fa-cta'], ['driver-account', driver, '/account', '#pwf'],
  ['owner', null, '/t/' + token, '.ow-crew']
];

// Anything the user can scroll sideways: the page itself, or a visible box with overflow-x auto/scroll whose content is wider.
const SIDEWAYS = `(() => {
  const out = [], W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push('SIDE-SCROLL page ' + document.documentElement.scrollWidth + '>' + W);
  for (const e of document.querySelectorAll('body *')) {
    if (e.scrollWidth <= e.clientWidth + 1) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if ((cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') || r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue;
    const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '';
    out.push('SIDE-SCROLL ' + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + cls + ' ' + e.scrollWidth + '>' + e.clientWidth);
  }
  return out;
})()`;

const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const b = await browser();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await b.eval(expr)) return true; } catch (e) {} await sleep(100); } return false; };
const report = [];
for (const w of widths) {
  for (const [name, ck, path, ready, act, shown] of pages) {
    if (only && !only.test(name)) continue;
    await b.size(w, w < 700 ? 800 : 900, w < 700);
    // The health page is loaded first so the session cookie can be changed on this origin before the page under test opens.
    let home = false;
    for (let i = 0; i < 3 && !home; i++) { await b.go('/api/health', 0); home = await until(`location.pathname === '/api/health' && document.readyState === 'complete'`, 8000); }
    if (!home) { report.push(`${w} ${name} NOT-LOADED /api/health`); continue; }
    await b.eval(`document.cookie = 'x=1'`);
    if (ck) await b.cookie(ck); else await b.cookie('none');
    await b.go(path, 0);
    let ok = await until(`location.pathname === ${JSON.stringify(path)} && !!document.querySelector(${JSON.stringify(ready)})`);
    if (ok && act) { await b.eval(act); ok = await until(`!!document.querySelector(${JSON.stringify(shown)})`); }
    if (!ok) { report.push(`${w} ${name} NOT-READY ${act ? shown : ready}`); continue; }
    await b.eval(`document.fonts.ready.then(() => true)`);
    await sleep(250);
    const res = [...await b.eval(AUDIT), ...await b.eval(SIDEWAYS)];
    res.forEach(r => report.push(`${w} ${name} ${r}`));
    if (shots.has(name) || shots.has('all')) await b.shot(`${name}-${w}`);
  }
}
report.push(...b.logs.map(l => 'CONSOLE ' + l));
b.close();
console.log(report.length ? report.join('\n') : 'ALL CLEAR');
if (report.length) process.exitCode = 1;
