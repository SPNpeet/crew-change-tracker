import { A, go } from '../app.js';
import { api } from '../api.js';
import { esc, fmtD, dateTh, toInput, fromInput } from '../core.js';
import { icon } from '../ui.js';

const app = () => document.getElementById('app');

export function jobForm(j = {}) {
  const f = (name, label, help, attrs = '') => `<label class="f"><span>${label}</span><input name="${name}" value="${esc(j[name] || '')}" ${attrs}><span class="fhelp">${help}</span></label>`;
  const t = (name, label, help) => `<label class="f"><span>${label}</span><input type="datetime-local" name="${name}" value="${toInput(j[name])}"><span class="fhelp">${help}</span></label>`;
  return `<div class="form form-h">
    ${f('vessel', 'ชื่อเรือ <b class="req">ต้องกรอก</b>', 'ช่องเดียวที่ต้องมีก่อนเปิดงาน', 'required maxlength="120" placeholder="เช่น MT OCEAN MERIDIAN" autocapitalize="characters"')}
    ${f('port', 'ท่าเรือ', 'ท่าที่เรือเข้าเทียบ ใช้ในร่างอีเมลและรายงาน', 'maxlength="120" placeholder="เช่น Laem Chabang B3"')}
    ${f('owner', 'Owner · เจ้าของเรือหรือผู้ว่าจ้าง', 'ชื่อบริษัท ใช้ขึ้นต้นร่างอีเมลถึง Owner', 'maxlength="120" placeholder="เช่น Blue Harbour Shipping"')}
    ${f('owner_email', 'อีเมล Owner', 'ระบบใส่ให้ในบรรทัด To ของร่างอีเมลถึง Owner', 'type="email" maxlength="200" placeholder="เช่น ops@owner.com"')}
    ${f('agent', 'Local agent · ตัวแทนเรือที่ท่า', 'ใช้ในอีเมลแจ้งแต่งตั้งและอีเมลขอผ่านท่า', 'maxlength="120" placeholder="เช่น LCB Marine Agency"')}
    ${f('agent_email', 'อีเมล Local agent', 'ระบบใส่ให้ในบรรทัด To ของร่างอีเมลถึง Local agent', 'type="email" maxlength="200" placeholder="เช่น ops@agent.com"')}
    ${t('eta', 'ETA · เวลาเรือถึง (เวลาไทย)', 'ยังไม่รู้เว้นว่างได้ แก้ได้ที่ขั้นตอนที่ 2')}${t('etb', 'ETB · เวลาเทียบท่า (เวลาไทย)', 'ยังไม่รู้เว้นว่างได้')}${t('etd', 'ETD · เวลาเรือออก (เวลาไทย)', 'ยังไม่รู้เว้นว่างได้')}
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
      <p class="muted s14" style="margin:0 0 14px">กรอกแค่ <b>ชื่อเรือ</b> ก็เปิดงานได้ ช่องอื่นเติมหรือแก้ทีหลังได้ทุกช่อง</p>
      <form id="newjob">${jobForm()}<div class="ferr" role="alert"></div><div class="row" style="margin-top:14px"><button class="btn" type="submit">${icon('plus')}เปิดงาน</button><a class="btn line" href="/jobs" data-link>ยกเลิก</a></div></form></div></div></div>`;
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
  if (status === 'open' && A.isAdmin()) {
    const nUsers = A.users.filter(u => u.active).length, nVeh = A.vehicles.length, nHot = A.hotels.length;
    if (nUsers < 2 || !nVeh || !nHot) {
      const li = (ok, href, name, note) => `<li class="${ok ? 'done' : ''}"><span class="st">${ok ? icon('check') : ''}</span><span><a href="${href}" data-link>${name}</a><span class="sub">${note}</span></span></li>`;
      el.insertAdjacentHTML('beforebegin', `<div class="card start"><div class="card-h"><h3>เริ่มใช้งานระบบ</h3><span class="sub">ทำครั้งเดียว แล้วกล่องนี้จะหายไป</span></div><div class="card-b"><ol>
        ${li(nUsers >= 2, '/admin/users', 'เพิ่มผู้ใช้', nUsers >= 2 ? `มีแล้ว ${nUsers} บัญชี` : 'สร้างบัญชีให้พนักงานสำนักงานและพนักงานภาคสนาม')}
        ${li(nVeh > 0, '/admin/vehicles', 'เพิ่มรถและคนขับ', nVeh ? `มีแล้ว ${nVeh} คัน` : 'ใช้เลือกในขั้นตอนที่ 7 และอีเมลขอผ่านท่า')}
        ${li(nHot > 0, '/admin/hotels', 'เพิ่มโรงแรม', nHot ? `มีแล้ว ${nHot} แห่ง` : 'ใช้เลือกในขั้นตอนที่ 7')}
        <li><span class="st"></span><span><a href="/jobs/new" data-link>เปิดงานแรก</a><span class="sub">กรอกแค่ชื่อเรือก็เริ่มได้</span></span></li>
      </ol></div></div>`);
    }
  }
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
