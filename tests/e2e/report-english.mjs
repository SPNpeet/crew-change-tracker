import assert from 'node:assert/strict';
import {checkpointBody} from '../checkpoint-client.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, login, BASE, OUT, ADMIN_USER, FIELD_PASS } from './cdp.mjs';

// cdp.mjs rejects non-local URLs. These are isolated synthetic fixtures only.
const token = await login(ADMIN_USER, process.env.ADMIN_PASS);
const checks = [];
const ok = (condition, label) => { assert.ok(condition, label); checks.push(label); };
async function call(method, path, body) {
  body = await checkpointBody(BASE, 'cct_s=' + token, path, body, method);
  const r = await fetch(BASE + path, { method, headers: { cookie: 'cct_s=' + token, 'x-cct': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, 200, `${method} ${path}`);
  return r;
}
const get = async path => (await call('GET', path)).json();
const initial = await get('/api/jobs/1');
const crewId = initial.crew[0].id;
const note = 'บันทึกทดสอบ <crew> & "original"';
await call('PATCH', '/api/jobs/1', { vessel: 'TEST ENGLISH REPORT', port: 'TEST PORT', owner: 'TEST OWNER', agent: 'TEST AGENT', eta: Date.UTC(2026, 11, 31, 18, 30) });
await call('PATCH', `/api/crew/${crewId}`, { name: 'TEST CREW <A>', docs: { Passport: 1, 'Seaman book': 1, 'ตั๋วเครื่องบิน': 0 } });
await call('POST', `/api/crew/${crewId}/notes`, { text: note });

const b = await browser();
async function report(id) {
  await b.go(`/jobs/${id}/report`, 300);
  for (let i = 0; i < 60; i++) {
    if (await b.eval('!!document.querySelector(".rp-page")')) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Report did not render');
}
try {
  await b.size(1280, 1000);
  await b.go('/api/health', 100);
  await b.cookie(token);
  await b.go('/jobs/1/9');
  ok(await b.eval('!!document.querySelector(\'a[href="/jobs/1/report"]\') && !!document.querySelector(\'a[href="/api/jobs/1/export.xlsx"]\')'), 'step9 links still expose PDF and Excel');
  await report(1);
  const view = await b.eval(`(() => { const p = document.querySelector('.rp-page'); return {text:p.innerText,lang:p.lang,title:document.title,controls:document.querySelector('.rp-bar').innerText,headers:[...p.querySelectorAll('h1,h2,th')].map(x=>x.textContent),embeddedCrewTag:!!p.querySelector('crew')}; })()`);
  ok(view.lang === 'en' && view.title.startsWith('Crew change report'), 'report language and document title are English');
  ok(view.headers.every(s => !/[ก-๙]/.test(s)) && view.text.includes('Crew list') && view.text.includes('Job status') && view.text.includes('In progress'), 'report-generated headings and open status are English');
  ok(view.text.includes('Landed') && view.text.includes('Flight ticket') && !view.text.includes('เครื่องลง') && !view.text.includes('ตั๋วเครื่องบิน'), 'English checkpoint and built-in document names');
  ok(view.text.includes('2027-01-01 01:30') && view.text.includes('Thailand time (UTC+7)'), 'Gregorian dates preserve Bangkok timezone across a year boundary');
  ok(view.text.includes(note) && view.text.includes('TEST CREW <A>') && !view.embeddedCrewTag, 'entered notes and names remain intact and escaped');
  ok(view.controls.includes('พิมพ์ / บันทึก PDF') && view.controls.includes('กลับ'), 'Thai application print/back controls remain available');
  await b.shot('report-english-desktop');

  const workbook = Buffer.from(await (await call('GET', '/api/jobs/1/export.xlsx')).arrayBuffer());
  const xml = workbook.toString('utf8');
  ok(workbook[0] === 0x50 && workbook[1] === 0x4b && xml.includes('Doc: Flight ticket') && xml.includes('Checkpoint (EN)') && xml.includes('Landed'), 'job Excel remains valid with English headings and checkpoint translation');
  const roundtrip = await get('/api/jobs/1');
  ok(roundtrip.crew.find(c => c.id === crewId).docs['ตั๋วเครื่องบิน'] === 0, 'English export does not rewrite the stored document key');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report-english.xlsx'), workbook);

  await b.size(390, 844, true);
  await b.shot('report-english-mobile');
  ok(await b.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), 'mobile report keeps horizontal scrolling within the report container');
  await b.size(718, 1000);
  await b.send('Emulation.setEmulatedMedia', { media: 'print' });
  ok(await b.eval('getComputedStyle(document.querySelector(".rp-bar")).display === "none"'), 'Thai controls are excluded from print');
  const printBounds = await b.eval('(() => { const p=document.querySelector(".rp-page");return {width:p.clientWidth,content:p.scrollWidth}; })()');
  ok(printBounds.content <= printBounds.width + 1, 'A4 report content fits printable width');
  const pdf = await b.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  const pdfBytes = Buffer.from(pdf.data, 'base64');
  writeFileSync(join(OUT, 'report-english.pdf'), pdfBytes);
  ok((pdfBytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length === 2, 'six-crew A4 fixture uses two pages without a footer-only page');
  await b.send('Emulation.setEmulatedMedia', { media: '' });
  await b.size(1280, 1000);

  await call('PATCH', '/api/jobs/1', { status: 'closed' });
  await report(1);
  ok(await b.eval('document.querySelector(".rp-page").innerText.includes("Closed ")'), 'closed report status is English');
  const empty = await (await call('POST', '/api/jobs', { vessel: 'TEST EMPTY REPORT' })).json();
  await report(empty.id);
  const emptyText = await b.eval('document.querySelector(".rp-page").innerText');
  ok(emptyText.includes('Crew (On 0 / Off 0)') && !emptyText.includes('NaN'), 'empty report and missing dates render safely');

  await b.cookie(await login('somsak', FIELD_PASS));
  await b.go('/jobs/1/report');
  ok(await b.eval('location.pathname === "/field" && !document.querySelector(".rp-page")'), 'field role cannot open the office report page');
  ok(b.logs.length === 0, 'no browser console errors');
  writeFileSync(join(OUT, 'report-checks.json'), JSON.stringify({localOnly:true,checks,passed:checks.length,failed:0},null,2));
  console.log(checks.map(c=>'PASS '+c).join('\n'));
  console.log(`PASS ${checks.length} / FAIL 0 / CONSOLE ${b.logs.length}`);
} finally { b.close(); }
