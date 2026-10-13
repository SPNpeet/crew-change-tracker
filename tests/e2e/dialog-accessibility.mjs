import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, login, BASE, OUT, ADMIN_USER } from './cdp.mjs';

const token = await login(ADMIN_USER, process.env.ADMIN_PASS);
async function api(path, body) {
  const response = await fetch(BASE + path, { method: 'POST', headers: { cookie: 'cct_s=' + token, 'x-cct': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
}
// Reproduce the reported route using a fresh synthetic database only.
await api('/api/jobs', { vessel: 'SYNTHETIC DIALOG FILLER 2' });
await api('/api/jobs', { vessel: 'SYNTHETIC DIALOG FILLER 3' });
const job = await api('/api/jobs', { vessel: 'SYNTHETIC DIALOG AUDIT' });
assert.equal(job.id, 4);
for (const name of ['Synthetic Dialog Alpha', 'Synthetic Dialog Beta']) await api('/api/jobs/4/crew', { name, type: 'on' });

const b = await browser(), results = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
  for (let i = 0; i < 80; i++) { if (await b.eval(expression)) return; await pause(100); }
  throw Error('Timed out: ' + expression);
}
function check(name, passed, detail = {}) {
  results.push({ name, passed, ...detail });
  console.log((passed ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail));
}
async function key(key, code, modifiers = 0) {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'Tab' ? 9 : 27, modifiers });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === 'Tab' ? 9 : 27, modifiers });
}
async function inspectName(label, expected) {
  const root = await b.send('DOM.getDocument');
  const found = await b.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#dlg' });
  const node = await b.send('DOM.describeNode', { nodeId: found.nodeId });
  const tree = await b.send('Accessibility.getPartialAXTree', { backendNodeId: node.node.backendNodeId, fetchRelatives: false });
  const ax = tree.nodes.find(n => n.backendDOMNodeId === node.node.backendNodeId);
  const dom = await b.eval(`(() => { const d = document.querySelector('#dlg'), h = d.querySelector('.dlg-h h3'); return { heading: h?.textContent, headingVisible: !!h && h.getBoundingClientRect().height > 0, labelledby: d.getAttribute('aria-labelledby'), uniqueHeading: !!h?.id && document.querySelectorAll('[id="' + h.id + '"]').length === 1 }; })()`);
  check(label + ' has the current visible heading as its accessible name', ax?.role?.value === 'dialog' && ax?.name?.value === expected && dom.heading === expected && dom.headingVisible && dom.uniqueHeading, { expected, computedName: ax?.name?.value || '', ...dom });
}
try {
  await b.size(1180, 757);
  await b.go('/api/health', 50);
  await b.cookie(token);
  await b.send('Accessibility.enable');
  await b.go('/jobs/4/5', 100);
  await until('document.querySelectorAll("[data-act=o-plan]").length >= 2');
  for (const name of ['Synthetic Dialog Alpha', 'Synthetic Dialog Beta']) {
    await b.eval(`(() => { const e = [...document.querySelectorAll('[data-act=o-plan]')].find(e => e.textContent === ${JSON.stringify(name)}); if (!e) throw Error('Plan trigger missing'); window.dialogTestTrigger = e; e.focus(); e.click(); })()`);
    await until('document.querySelector("#dlg").open');
    await inspectName('Plan editor for ' + name, 'เวลาตามแผน · ' + name);
    // Native modals must keep focus off background controls and restore the opener.
    // Chrome can report body while Tab passes through browser chrome.
    let contained = true;
    const tabs = await b.eval('document.querySelectorAll("#dlg input, #dlg button, #dlg select, #dlg textarea").length * 4');
    for (let i = 0; i < tabs; i++) { await key('Tab', 'Tab', i < tabs / 2 ? 0 : 8); contained &&= await b.eval('document.activeElement === document.body || document.querySelector("#dlg").contains(document.activeElement)'); }
    check('Tab and Shift+Tab do not reach background controls for ' + name, contained);
    await key('Escape', 'Escape');
    await until('!document.querySelector("#dlg").open');
    await until('document.activeElement === window.dialogTestTrigger');
    check('Escape restores the plan trigger focus for ' + name, true);
  }
  await b.eval('document.querySelector("[data-act=o-editjob]").click()');
  await until('document.querySelector("#dlg").open');
  await inspectName('Shared job editor after plan editor reuse', 'แก้ไขข้อมูลงาน');
  await key('Escape', 'Escape');
  check('No browser runtime errors', b.logs.length === 0, { logs: b.logs });
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'dialog-accessibility.json'), JSON.stringify({ route: '/jobs/4/5', results }, null, 2));
  b.close();
}
if (results.some(r => !r.passed)) process.exitCode = 1;
