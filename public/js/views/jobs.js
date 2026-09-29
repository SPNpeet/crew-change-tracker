import { A, go } from '../app.js';
import { api } from '../api.js';
import { esc, fmtD, dateTh, toInput, fromInput } from '../core.js';
import { icon } from '../ui.js';

const app = () => document.getElementById('app');

export function jobForm(j = {}) {
  const f = (name, label, attrs = '') => `<label class="f">${label}<input name="${name}" value="${esc(j[name] || '')}" ${attrs}></label>`;
  const t = (name, label) => `<label class="f">${label}<input type="datetime-local" name="${name}" value="${toInput(j[name])}"></label>`;
  return `<div class="form">
    ${f('vessel', 'ชื่อเรือ', 'required maxlength="120" placeholder="เช่น MT OCEAN MERIDIAN" autocapitalize="characters"')}
    ${f('port', 'ท่าเรือ', 'maxlength="120" placeholder="เช่น Laem Chabang B3"')}
    ${f('owner', 'Owner', 'maxlength="120"')}
    ${f('owner_email', 'อีเมล Owner', 'type="email" maxlength="200"')}
    ${f('agent', 'Local agent', 'maxlength="120"')}
    ${f('agent_email', 'อีเมล Local agent', 'type="email" maxlength="200"')}
    ${t('eta', 'ETA (เวลาไทย)')}${t('etb', 'ETB (เวลาไทย)')}${t('etd', 'ETD (เวลาไทย)')}
  </div>`;
}

export function readJobForm(fd) {
  const o = {};
  for (const k of ['vessel', 'port', 'owner', 'owner_email', 'agent', 'agent_email']) o[k] = String(fd.get(k) || '').trim();
  for (const k of ['eta', 'etb', 'etd']) o[k] = fromInput(fd.get(k));
  return o;
}

export async function enter(r, alive) {
  if (r.name === 'newjob') {
    app().innerHTML = `<div class="narrow2"><a class="back" href="/jobs" data-link>${icon('left')}งานทั้งหมด</a>
      <div class="card" style="margin-top:10px"><div class="card-h"><h3>เปิดงานเปลี่ยนลูกเรือใหม่</h3></div><div class="card-b">
      <form id="newjob">${jobForm()}<div class="ferr" role="alert"></div><div class="row" style="margin-top:14px"><button class="btn" type="submit">${icon('plus')}เปิดงาน</button><a class="btn line" href="/jobs" data-link>ยกเลิก</a></div></form>
      <p class="muted s13" style="margin:12px 0 0">ข้อมูลที่ยังไม่รู้เว้นว่างไว้ก่อนได้ แก้ไขภายหลังได้ทุกช่อง</p></div></div></div>`;
    document.getElementById('newjob').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const d = await api('POST', '/api/jobs', readJobForm(new FormData(e.target)));
        go(`/jobs/${d.id}/1`, true);
      } catch (x) { e.target.querySelector('.ferr').textContent = x.message; btn.disabled = false; }
    });
    return;
  }
  const status = r.params.status === 'closed' ? 'closed' : 'open';
  app().innerHTML = `<div class="page-h"><div><h1>งานเปลี่ยนลูกเรือ</h1><div class="muted s14">${status === 'open' ? 'งานที่กำลังดำเนินการ' : 'งานที่ปิดแล้ว'}</div></div><div class="row"><div class="seg" role="tablist"><a href="/jobs" data-link aria-current="${status === 'open'}">กำลังทำ</a><a href="/jobs?status=closed" data-link aria-current="${status === 'closed'}">ปิดแล้ว</a></div>${status === 'open' ? `<a class="btn" href="/jobs/new" data-link>${icon('plus')}เปิดงานใหม่</a>` : ''}</div></div><div id="joblist" class="muted">กำลังโหลด...</div>`;
  const d = await api('GET', `/api/jobs?status=${status}`);
  if (!alive()) return;
  const el = document.getElementById('joblist');
  if (!d.jobs.length) {
    el.innerHTML = `<div class="card empty"><div class="nm">${status === 'open' ? 'ยังไม่มีงานที่กำลังทำ' : 'ยังไม่มีงานที่ปิดแล้ว'}</div>${status === 'open' ? `<div class="sub">เริ่มจากกด "เปิดงานใหม่" เมื่อได้รับอีเมลเปลี่ยนลูกเรือจากลูกค้า</div><a class="btn" href="/jobs/new" data-link style="margin-top:14px">${icon('plus')}เปิดงานใหม่</a>` : ''}</div>`;
    return;
  }
  el.className = 'jobgrid';
  el.innerHTML = d.jobs.map(j => {
    const done = j.steps.filter(Boolean).length;
    return `<a class="card jobtile" href="/jobs/${j.id}" data-link>
      <div class="jt-top"><div class="v">${esc(j.vessel)}</div>${j.status === 'closed' ? '<span class="pill gray">ปิดแล้ว</span>' : `<span class="pill ${done === 9 ? 'ok' : 'info'}">${done} / 9 ขั้นตอน</span>`}</div>
      <div class="p">${esc(j.port || 'ยังไม่ระบุท่าเรือ')}${j.owner ? ' · ' + esc(j.owner) : ''}</div>
      <dl><div><dt>ETA</dt><dd>${j.eta ? fmtD(j.eta) : '—'}</dd></div><div><dt>ลูกเรือ</dt><dd>On ${j.n_on} · Off ${j.n_off}</dd></div><div><dt>${j.status === 'closed' ? 'ปิดงาน' : 'เปิดงาน'}</dt><dd>${dateTh(j.closed_at || j.created_at)}</dd></div></dl>
      <div class="bar"><i style="width:${Math.round(done / 9 * 100)}%"></i></div></a>`;
  }).join('');
}
