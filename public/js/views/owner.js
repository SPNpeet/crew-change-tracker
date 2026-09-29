import { A } from '../app.js';
import { api } from '../api.js';
import { esc, hm, fmtD, dhm, avatar, pill, nextIdx, statusEn, currentEn, lastTime, expected, MIN } from '../core.js';

const app = () => document.getElementById('app');
let D = null, token = null;

export async function enter(r) {
  token = r.params.token;
  document.title = 'Crew change tracking';
  document.documentElement.lang = 'en';
  try {
    D = await api('GET', `/api/public/${token}`, undefined, { allow401: true });
  } catch (e) {
    app().innerHTML = `<div class="owner"><div class="card card-b empty"><div class="nm">This tracking link is not available</div><div class="sub">The link may have been replaced. Please ask your agent for the latest link.</div></div></div>`;
    return;
  }
  render();
}

export async function poll() {
  try { D = await api('GET', `/api/public/${token}`, undefined, { allow401: true }); render(); } catch (e) {}
}

function render() {
  const j = D.job, now = Date.now(), late = D.late_min;
  const crew = D.crew.map(c => ({ ...c, notes: [], cps: c.cps.map(x => ({ ...x, name: x.name_en })) }));
  const all = crew.flatMap(c => c.cps.filter(x => x.actual != null).map(x => x.actual));
  const total = crew.reduce((a, c) => a + c.cps.length, 0);
  const card = c => {
    const i = nextIdx(c), st = statusEn(c, now, late), lt = lastTime(c);
    const segs = c.cps.map((x, k) => { const cl = x.actual != null ? (x.plan != null && (x.actual - x.plan) / MIN > late ? 'l' : 'd') : (k === i ? 'c' : ''); return `<i class="${cl}" title="${esc(x.name_en)}"></i>`; }).join('');
    const nextT = i !== -1 ? expected(c, i, late) : null;
    return `<div class="card ow-crew"><div class="top2">${avatar(c)}<div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.rank || '—')}${c.flight ? ' · ' + esc(c.flight) : ''}</div></div>${pill(st.cls, st.label)}</div>
      <div class="segs" style="grid-template-columns:repeat(${c.cps.length},1fr)">${segs}</div>
      <div class="meta"><span>Current <b>${esc(currentEn(c))}</b>${lt ? ' · ' + hm(lt) : ''}</span><span>${i === -1 ? 'Completed' : `Next <b>${esc(c.cps[i].name_en)}</b>${nextT ? ' · ' + dhm(nextT) : ''}`}</span></div></div>`;
  };
  const on = crew.filter(c => c.type === 'on'), off = crew.filter(c => c.type === 'off');
  app().innerHTML = `<div class="owner">
    <div class="ow-head"><div class="ow-top"><span>${esc(D.company)}<span class="xs-hide"> · Crew change tracking</span></span>${j.status === 'closed' ? '<span class="live off">Completed</span>' : '<span class="live">Live</span>'}</div>
      <h2>${esc(j.vessel)}</h2><div class="ow-sub">${j.port ? `<span>${esc(j.port)}</span>` : ''}${j.owner ? `<span>Owner ${esc(j.owner)}</span>` : ''}</div>
      <div class="ow-tiles"><div><span>ETA</span><b>${fmtD(j.eta)}</b></div><div><span>ETB</span><b>${fmtD(j.etb)}</b></div><div><span>Crew</span><b>${on.length} on · ${off.length} off</b></div><div><span>Progress</span><b>${total ? Math.round(all.length / total * 100) : 0}%</b></div></div>
    </div>
    ${on.length ? `<div class="ow-sec">ON SIGNERS</div>${on.map(card).join('')}` : ''}
    ${off.length ? `<div class="ow-sec">OFF SIGNERS</div>${off.map(card).join('')}` : ''}
    ${crew.length ? '' : '<div class="card card-b empty"><div class="sub">Crew list will appear here once confirmed.</div></div>'}
    <div class="ow-foot">All times are Thailand local time (UTC+7) · Last movement ${all.length ? hm(Math.max(...all)) : '—'} · This page refreshes automatically</div>
  </div>`;
}
