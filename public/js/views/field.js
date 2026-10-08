import { A, go, flushPending } from '../app.js';
import { api, confirmPoint, uploadPhoto, pendingFor } from '../api.js';
import { esc, hm, dhm, fmtD, avatar, pill, nextIdx, status, planCell, expected, doneCount, MIN } from '../core.js';
import { icon, toast, openLb, stampPhoto, getGps } from '../ui.js';
import { roleLabel } from './auth.js';

const app = () => document.getElementById('app');
let F = null;
const late = () => A.settings.late_min;

function overlay() {
  for (const c of F.crew) {
    for (const p of pendingFor(c.id, A.me.id)) {
      const x = c.cps[p.idx];
      if (x && x.actual == null) { x.actual = p.at; x.pending = true; }
    }
  }
}

async function load() {
  await flushPending().catch(() => false);
  F = await api('GET', '/api/field');
  overlay();
}

export async function enter(r, alive) {
  if (!F) app().innerHTML = '<div class="muted">กำลังโหลด...</div>';
  try { await load(); } catch (e) { if (!F) throw e; toast(e.message); }
  if (!alive()) return;
  render();
}

export async function poll() {
  try { await load(); } catch (e) { return; }
  if (A.route.name === 'field' || A.route.name === 'crew') render(true);
}

function render(keep) {
  const y = window.scrollY;
  const old = keep && document.getElementById('noteedit');
  const draft = old && !old.hidden ? old.querySelector('textarea').value : null;
  app().innerHTML = `<div class="fieldpage">${A.route.name === 'crew' ? detail(A.route.params.crew) : list()}</div>`;
  const box = draft != null && document.getElementById('noteedit');
  if (box) { box.hidden = false; box.querySelector('textarea').value = draft; }
  if (keep) window.scrollTo(0, y);
}

function list() {
  const now = Date.now();
  const me = A.me;
  const sts = F.crew.map(c => status(c, now, late()));
  const nLate = sts.filter(x => x.k === 'late').length, done = sts.filter(x => x.k === 'done').length;
  const seeAll = A.isOffice() || me.see_all;
  const groups = F.jobs.map(j => ({ j, crew: F.crew.filter(c => c.job_id === j.id) })).filter(g => g.crew.length);
  const row = c => {
    const st = status(c, now, late()), i = nextIdx(c), dn = doneCount(c);
    const u = A.user(c.agent_id);
    return `<a class="crow" href="/field/${c.id}" data-link>${avatar(c)}<div class="cm"><div class="r1"><span class="nm">${esc(c.name)}</span></div><div class="sub">${i === -1 ? 'ครบทุกจุดแล้ว' : 'ถัดไป: ' + esc(c.cps[i].name) + (c.cps[i].plan ? ' · ' + dhm(expected(c, i, late())) : '')}</div>${seeAll ? `<div class="sub">ดูแลโดย ${u ? 'คุณ' + esc(u.name) : '-'}</div>` : ''}<div class="r3"><div class="mb"><i style="width:${c.cps.length ? Math.round(dn / c.cps.length * 100) : 0}%;background:${st.k === 'late' ? 'var(--red)' : 'var(--green)'}"></i></div>${pill(st.cls, st.label)}</div></div><span class="chev">${icon('right')}</span></a>`;
  };
  const pend = F.crew.reduce((a, c) => a + pendingFor(c.id, me.id).length, 0);
  return `<div class="fa"><div class="fh">
    <a class="me" href="/account" data-link><span class="av">${esc([...me.name][0] || '?')}</span><span class="who3"><b>คุณ${esc(me.name)}</b><small>${esc(me.title || roleLabel(me))}</small></span><span class="sw">บัญชี${icon('right')}</span></a>
    <div class="stats"><div><b>${F.crew.length}</b><span>${seeAll ? 'ทั้งหมด' : 'ที่ดูแล'}</span></div><div><b style="color:${nLate ? 'var(--red)' : 'var(--ink)'}">${nLate}</b><span>ช้ากว่าแผน</span></div><div><b style="color:${done ? 'var(--green)' : 'var(--ink)'}">${done}</b><span>ครบแล้ว</span></div></div>
    ${pend ? `<div class="offline">${icon('wifi')}<span>รอส่ง ${pend} รายการ ระบบส่งเองเมื่อมีสัญญาณ</span></div>` : ''}
  </div>
  <div class="app-b">
    ${groups.length ? groups.map(g => `<div class="vgroup"><div class="vn">${esc(g.j.vessel)}</div><div class="vp">${esc(g.j.port || '')}${g.j.eta ? ' · ETA ' + dhm(g.j.eta) : ''}</div></div>${g.crew.map(row).join('')}`).join('') : `<div class="card empty"><div class="nm">ยังไม่มีลูกเรือที่คุณดูแล</div><div class="sub">สำนักงานมอบหมายได้ที่ขั้นตอนที่ 7 ช่อง "ผู้ดูแล"</div></div>`}
  </div></div>`;
}

function detail(id) {
  const c = F.crew.find(x => x.id === id);
  if (!c) return `<div class="fa"><div class="fa-bar"><button class="navback" data-act="back" type="button">${icon('left')}กลับ</button></div><div class="fa-body"><div class="card empty"><div class="nm">ไม่พบลูกเรือคนนี้</div><div class="sub">อาจถูกย้ายไปผู้ดูแลคนอื่น หรืองานปิดแล้ว</div></div></div></div>`;
  const job = F.jobs.find(j => j.id === c.job_id) || {};
  if (!c.cps.length) return `<div class="fa"><div class="fa-bar"><button class="navback" data-act="back" type="button">${icon('left')}กลับ</button><span class="ttl">${esc(job.vessel || '')}</span></div><div class="fa-body"><div class="card empty"><div class="nm">${esc(c.name)} ยังไม่มีจุดสถานะ</div><div class="sub">แจ้งสำนักงานให้ตรวจข้อมูลลูกเรือคนนี้</div></div></div></div>`;
  const now = Date.now(), i = nextIdx(c), st = status(c, now, late());
  const veh = A.vehicle(c.vehicle_id);
  const hotel = A.hotels.find(h => h.id === c.hotel_id);
  const dn = doneCount(c), total = c.cps.length;
  const nb = i === -1
    ? `<div class="nextbox dn"><div class="l">สถานะ</div><div class="v">ครบทุกจุดแล้ว</div><div class="t">${esc(c.cps[total - 1].name)} ${hm(c.cps[total - 1].actual)}</div></div>`
    : `<div class="nextbox ${st.k === 'late' ? 'lt' : ''}"><div class="l">จุดถัดไป · ${esc(st.label)}</div><div class="v">${esc(c.cps[i].name)}</div><div class="t">${planCell(c, i, late())}</div></div>`;
  const point = i === -1 ? c.cps[total - 1].name : i === 0 ? 'ก่อน' + c.cps[0].name : c.cps[i - 1].name;
  return `<div class="fa">
    <div class="fa-bar"><button class="navback" data-act="back" type="button">${icon('left')}กลับ</button><span class="ttl">${esc(job.vessel || '')}</span></div>
    <div class="fa-hero"><div class="who-h">${avatar(c, true)}<div style="min-width:0"><div class="nm2">${esc(c.name)}</div><div class="sub">${esc(c.rank || '—')} · ${esc(c.flight || '—')} · ${c.type === 'on' ? 'On signer' : 'Off signer'}</div></div></div>
      <div class="prog"><div class="l"><span>ผ่านแล้ว ${dn} จาก ${total} จุด</span>${pill(st.cls, st.label)}</div><div class="bar"><i style="width:${total ? Math.round(dn / total * 100) : 0}%"></i></div></div></div>
    <div class="fa-body">
      ${nb}
      <div class="act3">
        <label class="btn line">${icon('camera')}ถ่ายรูป<input type="file" accept="image/*" capture="environment" data-chg="f-photo" data-id="${c.id}" data-point="${esc(point)}" hidden></label>
        <label class="btn line">${icon('image')}เลือกรูปในเครื่อง<input type="file" accept="image/*" data-chg="f-photo" data-id="${c.id}" data-point="${esc(point)}" hidden></label>
        <button class="btn line wide" data-act="f-note" type="button">${icon('note')}เขียนหมายเหตุ</button>
      </div>
      <div class="gps-note">${icon('pin')}ทุกรูปพิมพ์เวลา จุด และพิกัด GPS ลงในภาพให้อัตโนมัติ</div>
      <form class="noteedit" id="noteedit" hidden><textarea name="text" rows="3" maxlength="1000" placeholder="เช่น กระเป๋าตกค้าง รอเจ้าหน้าที่สายการบิน 30 นาที" required></textarea><button class="btn block" type="submit" style="margin-top:8px;height:50px">บันทึกหมายเหตุ</button></form>
      ${c.photos.length ? `<div class="sec-l">รูปที่แนบ (${c.photos.length}) · กดเพื่อดูเต็มจอ</div><div class="pgrid">${c.photos.map(p => `<button type="button" data-act="f-photoview" data-src="/api/photos/${p.id}" data-cap="${esc(p.point + ' · ' + fmtD(p.at))}"><img src="/api/photos/${p.id}" alt="รูปที่แนบ" loading="lazy"><span>${esc(p.point)} ${hm(p.at)}</span></button>`).join('')}</div>` : ''}
      ${c.notes.length ? `<div class="notes">${c.notes.map(n => `<div><span class="muted">${dhm(n.at)}</span> ${esc(n.text)}</div>`).join('')}</div>` : ''}
      <div class="sec-l">เส้นทางทั้งหมด</div>
      <div class="tl">${c.cps.map((x, k) => {
        const cls = x.actual != null ? 'd' : (k === i ? 'c' : '');
        const lt = x.actual != null && x.plan != null && (x.actual - x.plan) / MIN > late();
        const right = x.actual != null ? `${dhm(x.actual)}${x.pending ? '<div class="pend">รอส่ง</div>' : ''}${lt ? `<div class="ltxt">ช้า ${Math.round((x.actual - x.plan) / MIN)} น.</div>` : ''}` : `<span class="muted">${planCell(c, k, late())}</span>`;
        return `<div class="tli ${cls}"><span class="dot">${cls === 'd' ? icon('check') : ''}</span><span class="${k === i ? 'cur' : cls === '' ? 'muted' : ''}">${esc(x.name)}</span><span class="tm">${right}</span></div>`;
      }).join('')}</div>
      <div class="infobox"><div><span class="k">รถ</span><span class="v">${veh ? esc(`${veh.name}${veh.plate ? ' · ' + veh.plate : ''}${veh.driver ? ' · ' + veh.driver : ''}`) : 'ยังไม่จัดรถ'}</span>${veh && veh.driver_phone ? `<a class="btn line sm" href="tel:${esc(veh.driver_phone.replace(/[^0-9+]/g, ''))}">${icon('phone')}โทร</a>` : ''}</div><div><span class="k">โรงแรม</span><span class="v">${esc(hotel ? hotel.name : 'ยังไม่มีโรงแรม')}${c.room ? ' · ห้อง ' + esc(c.room) : ''}</span>${hotel && hotel.phone ? `<a class="btn line sm" href="tel:${esc(hotel.phone.replace(/[^0-9+]/g, ''))}">${icon('phone')}โทร</a>` : ''}</div></div>
      ${dn > 0 && !c.cps.some(x => x.pending) ? `<button class="undo2" data-act="f-undo" data-id="${c.id}" type="button">${icon('refresh')}กดผิด ย้อนกลับ 1 จุด</button>` : ''}
    </div>
    <div class="fa-cta">${i === -1 ? `<div class="big done">${icon('check')}ครบทุกจุดแล้ว</div>` : `<button class="big" data-act="f-confirm" data-id="${c.id}" data-idx="${i}" type="button">${icon('check')}ยืนยัน: ${esc(c.cps[i].name)}</button>`}</div>
  </div>`;
}

const crewOf = id => F.crew.find(c => c.id === +id);

export const actions = {
  async 'f-confirm'(t) {
    if (t.disabled) return;
    t.disabled = true;
    const c = crewOf(t.dataset.id), idx = +t.dataset.idx;
    const gps = await Promise.race([getGps(), new Promise(r => setTimeout(() => r(null), 1500))]);
    try {
      const r = await confirmPoint(c.id, idx, { ...(gps ? { lat: gps.lat, lng: gps.lng } : {}), label: `"${c.cps[idx].name}" ของ ${c.name}` }, A.me.id);
      c.cps[idx].actual = r.at;
      if (r.queued) { c.cps[idx].pending = true; toast(`ไม่มีสัญญาณ บันทึกเวลา ${hm(r.at)} ไว้ในเครื่องแล้ว ระบบส่งเองเมื่อมีสัญญาณ`, 4000); }
      else toast(`บันทึก "${c.cps[idx].name}" เวลา ${hm(r.at)} แล้ว สำนักงานเห็นทันที`);
      render(true);
      if (!r.queued) poll();
    } catch (e) {
      t.disabled = false;
      toast(e.message);
      if (e.status === 409) poll();
    }
  },
  async 'f-undo'(t) {
    const c = crewOf(t.dataset.id);
    const last = [...c.cps].reverse().find(x => x.actual != null);
    if (!last || !window.confirm(`ย้อนกลับ "${last.name}" ?`)) return;
    await api('POST', `/api/crew/${c.id}/undo`, { idx: last.idx });
    toast(`ย้อนกลับ "${last.name}" แล้ว`);
    await poll();
  },
  'f-note'() {
    const box = document.getElementById('noteedit');
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('textarea').focus();
  },
  'f-photoview'(t) { openLb(t.dataset.src, t.dataset.cap); }
};

export const changes = {
  async 'f-photo'(t) {
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('เลือกได้เฉพาะไฟล์รูป');
    const c = crewOf(t.dataset.id);
    const job = F.jobs.find(j => j.id === c.job_id) || {};
    toast('กำลังบันทึกรูป...', 8000);
    let out;
    try {
      out = await stampPhoto(file, { point: t.dataset.point, name: c.name, rank: c.rank, vessel: job.vessel || '', company: A.settings.company.name });
    } catch (e) { return toast('เปิดไฟล์รูปนี้ไม่ได้'); }
    const point = t.dataset.point;
    const r = await uploadPhoto(c.id, out.blob, { point, lat: out.gps ? out.gps.lat.toFixed(6) : null, lng: out.gps ? out.gps.lng.toFixed(6) : null, label: `"${point}" ของ ${c.name}` }, A.me.id);
    if (r.queued) return toast('ไม่มีสัญญาณ เก็บรูปไว้ในเครื่องแล้ว ระบบส่งเองเมื่อมีสัญญาณ', 4000);
    toast(out.gps ? 'บันทึกรูปพร้อมเวลาและพิกัดแล้ว' : 'บันทึกรูปพร้อมเวลาแล้ว (ไม่ได้เปิด GPS)');
    await poll();
  }
};

document.addEventListener('submit', async e => {
  if (e.target.id !== 'noteedit') return;
  e.preventDefault();
  const c = crewOf(A.route.params.crew);
  const text = e.target.text.value.trim();
  if (!text) return toast('กรุณาพิมพ์หมายเหตุ');
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    await api('POST', `/api/crew/${c.id}/notes`, { text });
    toast('บันทึกหมายเหตุแล้ว');
    document.activeElement.blur();
    e.target.reset();
    e.target.hidden = true;
    await poll();
  } catch (x) { toast(x.message); btn.disabled = false; }
});
