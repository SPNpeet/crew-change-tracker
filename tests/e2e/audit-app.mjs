import { browser, login, AUDIT, BASE, ADMIN_USER, FIELD_PASS } from './cdp.mjs';

const widths = (process.env.WIDTHS || '360,390,768,1024,1280,1440').split(',').map(Number);
const shots = new Set((process.env.SHOTS || '').split(',').filter(Boolean));
const office = await login(ADMIN_USER, process.env.ADMIN_PASS);
const field = await login('somsak', FIELD_PASS);
const lead = await login('napa', FIELD_PASS);
const job = await (await fetch(BASE + '/api/jobs/1', { headers: { cookie: 'cct_s=' + office } })).json();
const token = job.job.owner_token;
const c2 = job.crew.find(c => c.name === 'Arun Pillai').id;
const c5 = job.crew.find(c => c.name === 'Oleg Marchenko').id;

const pages = [
  ['login', null, '/login'],
  ['jobs', office, '/jobs'], ['newjob', office, '/jobs/new'],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => ['step' + k, office, '/jobs/1/' + k]),
  ['report', office, '/jobs/1/report'],
  ...['users', 'vehicles', 'hotels', 'points', 'general', 'backup'].map(t => ['admin-' + t, office, '/admin/' + t]),
  ['account', office, '/account'],
  ['field-office', office, '/field'],
  ['field', field, '/field'], ['crew', field, '/field/' + c2], ['lead', lead, '/field'], ['lead-off', lead, '/field/' + c5],
  ['owner', null, '/t/' + token]
];
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const b = await browser();
const report = [];
for (const w of widths) {
  for (const [name, ck, path] of pages) {
    if (only && !only.test(name)) continue;
    await b.size(w, w < 700 ? 800 : 900, w < 700);
    await b.go('/api/health', 300);
    await b.eval(`document.cookie = 'x=1'`);
    if (ck) await b.cookie(ck); else await b.cookie('none');
    await b.go(path, 1600);
    const res = await b.eval(AUDIT);
    res.forEach(r => report.push(`${w} ${name} ${r}`));
    if (shots.has(name) || shots.has('all')) await b.shot(`${name}-${w}`);
  }
}
report.push(...b.logs.map(l => 'CONSOLE ' + l));
b.close();
console.log(report.length ? report.join('\n') : 'ALL CLEAR');
if (report.length) process.exitCode = 1;
