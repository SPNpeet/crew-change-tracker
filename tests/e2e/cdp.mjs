import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const BASE = process.env.BASE || 'http://127.0.0.1:8787';
export const OUT = process.env.OUT || fileURLToPath(new URL('./out/', import.meta.url));
const PORT = Number(process.env.CDP_PORT || 9333);

export const ADMIN_USER = process.env.ADMIN_USER || 'somying';
export const FIELD_PASS = 'field-pass-2569';
export const photo = () => readFileSync(new URL('./photo.jpg', import.meta.url));

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw new Error('e2e tests only run against a local dev server');

export async function login(username, password) {
  if (!password) throw new Error('set ADMIN_PASS');
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'x-cct': '1', 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new Error('login failed ' + username + ' (' + res.status + ')');
  return res.headers.get('set-cookie').split(';')[0].split('=')[1];
}

export async function browser() {
  if (!existsSync(CHROME)) throw new Error('Chrome not found at ' + CHROME + ' (set CHROME to the chrome executable)');
  const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (ver.length) break; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  const page = ver.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + d.params.exceptionDetails.exception?.description?.split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map(a => a.value || a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const b = {
    logs,
    async cookie(value) { await send('Network.setCookie', { name: 'cct_s', value, url: BASE, httpOnly: true }); },
    async size(w, h, mobile) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile }); await send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile }); },
    async go(path, wait = 1500) { await send('Page.navigate', { url: BASE + path }); await new Promise(r => setTimeout(r, wait)); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error'); return r.result.value; },
    async shot(name, full = true) {
      const m = await send('Page.getLayoutMetrics');
      const h = Math.min(6000, Math.ceil(m.cssContentSize.height));
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: full ? { x: 0, y: 0, width: m.cssLayoutViewport.clientWidth, height: h, scale: 1 } : undefined });
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    },
    send,
    close() { ws.close(); proc.kill(); }
  };
  return b;
}

export const AUDIT = `(() => {
  const out = [];
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push('OVERFLOW ' + document.documentElement.scrollWidth + '>' + W);
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const SEL = '.pill,.btn,.tag,.doc,.svc button,.tabs a,.mtabs a span,.st .tx,.crumb,.nm,.who3 b,.who3 small,.vn,.vp,.stats span,.stats b,.kpis span,.kpis b,.card-h h3,.card-h .sub,.jobcard dt,.jobcard dd,.t th,.navback,.fa-bar .ttl,.nextbox .l,.nextbox .v,.logo b,.ow-tiles span,.ow-tiles b,.ow-sec,.live,.sec-l,.me .sw,.prog .l span,.crow .sub,.big,.act3 .btn,.seg a,.jobtile .v,.jobtile dt,.jobtile dd,label.f,.dlg-h h3,.me-btn .nm,.linkbtn';
  document.querySelectorAll(SEL).forEach(e => {
    if (!vis(e)) return; const cs = getComputedStyle(e); const txt = e.textContent.trim(); if (!txt || txt.length > 60) return;
    if (e.matches('label.f') && e.querySelector('input,select,textarea')) { const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(''); if (!t) return; }
    const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const tops = []; let n;
    while ((n = tw.nextNode())) { if (!n.textContent.trim() || n.parentElement.closest('select,option,textarea')) continue; const r = document.createRange(); r.selectNodeContents(n); [...r.getClientRects()].forEach(x => { if (x.width > 1) tops.push(x.top + x.height / 2); }); }
    tops.sort((a, b) => a - b); let lines = tops.length ? 1 : 0; for (let k = 1; k < tops.length; k++) if (tops[k] - tops[k - 1] > parseFloat(cs.fontSize) * 0.9) lines++;
    const clipped = e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflow !== 'visible' && !e.matches('.seg,.tabs');
    if (lines > 1 || clipped) out.push('WRAP ' + (e.className || e.tagName) + ' "' + txt.slice(0, 40) + '" lines=' + lines + (clipped ? ' CLIPPED' : ''));
  });
  if (W < 700) document.querySelectorAll('main button, main a.btn, main label.btn, main select, main input:not([type=file]):not([type=checkbox]):not([type=radio]), .mtabs a').forEach(e => { if (!vis(e)) return; const r = e.getBoundingClientRect(); if (r.height < 34) out.push('SMALL-TAP ' + e.tagName + '.' + e.className + ' "' + (e.textContent || e.value || '').trim().slice(0, 20) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
  const small = new Set(); const tw = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n;
  while ((n = tw.nextNode())) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (!vis(el)) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 12) small.add((el.className || el.tagName) + '(' + fs + ')'); }
  small.forEach(s => out.push('SMALL-TEXT ' + s));
  return out;
})()`;
