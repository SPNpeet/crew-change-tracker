import { A, go, flushPending } from '../app.js';
import { api, confirmPoint, prepareAndUploadPhoto, pendingFor } from '../api.js';
import { esc, hm, dhm, fmtD, avatar, userAv, pill, nextIdx, status, planCell, expected, doneCount, forecast, forecastNote, shiftNote, cpPhotos, photoDue, gpsText, SKIP_REASONS, MIN } from '../core.js';
import { icon, toast, openLb, stampPhoto, getGps, openDialog, dlgHead, dlgFoot } from '../ui.js';
import { roleLabel } from './auth.js';

const app = () => document.getElementById('app');
let F = null;
let snapping = false;
const late = () => A.settings.late_min;
const MINE = { agent: ['ผู้ดูแล'], driver: ['คนขับ'], both: ['ผู้ดูแล', 'คนขับ'] };

function overlay() {
  for (const c of F.crew) {
    for (const p of pendingFor(c.id, A.me.id)) {
      if((p.assignment_revision??1)!==c.assignment_rev)continue;
      if (p.photo) {
        const x = c.cps[p.cp];
        if (x && x.id === p.cp_id && !p.error) { x.queued = (x.queued || 0) + 1; x.queuedId = p.photo; }
        continue;
      }
      const x = c.cps[p.idx];
      if (!p.error && !p.photo && x && x.id === p.cp_id && x.actual == null) { x.actual = p.at; x.pending = true; if (p.skip) x.skip = p.skip; }
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
  if (!A.me || !F || !['field', 'crew'].includes(A.route.name)) return;
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
    const why = i === -1 ? '' : forecastNote(c, i, late());
    const due = c.cps.filter(x => photoDue(c, x) && !x.queued).length;
    const tags = (MINE[c.mine] || []).map(t => `<span class="tag">${t}</span>`).join('');
    return `<a class="crow" href="/field/${c.id}" data-link>${avatar(c)}<div class="cm"><div class="r1"><span class="nm">${esc(c.name)}</span>${tags ? `<span class="mine">${tags}</span>` : ''}</div><div class="sub">${i === -1 ? 'ครบทุกจุดแล้ว' : 'ถัดไป: ' + esc(c.cps[i].name) + (c.cps[i].plan ? ' · ' + (why ? 'แผน ' + dhm(c.cps[i].plan) : dhm(expected(c, i, late()))) : '')}</div>${why ? `<div class="fc">${esc(why)}</div>` : ''}${seeAll ? `<div class="sub">ดูแลโดย ${u ? 'คุณ' + esc(u.name) : '-'}</div>` : ''}${due ? `<div class="sub due">รูปค้าง ${due} จุด</div>` : ''}<div class="r3"><div class="mb"><i style="width:${c.cps.length ? Math.round(dn / c.cps.length * 100) : 0}%;background:${st.k === 'late' ? 'var(--red)' : 'var(--green)'}"></i></div>${pill(st.cls, st.label)}</div></div><span class="chev">${icon('right')}</span></a>`;
  };
  const pend = F.crew.reduce((a, c) => a + pendingFor(c.id, me.id).length, 0);
  return `<div class="fa"><div class="fh">
    <a class="me" href="/account" data-link>${userAv(me)}<span class="who3"><b>คุณ${esc(me.name)}</b><small>${esc(me.title || roleLabel(me))}</small></span><span class="sw">บัญชี${icon('right')}</span></a>
    <div class="stats"><div><b>${F.crew.length}</b><span>${seeAll ? 'ทั้งหมด' : 'ที่ดูแล'}</span></div><div><b style="color:${nLate ? 'var(--red)' : 'var(--ink)'}">${nLate}</b><span>ช้ากว่าแผน</span></div><div><b style="color:${done ? 'var(--green)' : 'var(--ink)'}">${done}</b><span>ครบแล้ว</span></div></div>
    ${pend ? `<div class="offline">${icon('wifi')}<span>รอส่ง ${pend} รายการ ระบบส่งเองเมื่อมีสัญญาณ</span></div>` : ''}
  </div>
  <div class="app-b">
    ${groups.length ? groups.map(g => `<div class="vgroup"><div class="vn">${esc(g.j.vessel)}</div><div class="vp">${esc(g.j.port || '')}${g.j.eta ? ' · ETA ' + dhm(g.j.eta) : ''}</div></div>${g.crew.map(row).join('')}`).join('') : `<div class="card empty"><div class="nm">ยังไม่มีลูกเรือที่คุณดูแล</div><div class="sub">สำนักงานมอบหมายได้ที่ขั้นตอนที่ 7 ช่อง "ผู้ดูแล" หรือจัดรถที่เชื่อมกับบัญชีของคุณ</div></div>`}
  </div></div>`;
}

function evidenceMark(c, x, k) {
  const n = cpPhotos(c, k).length;
  if (n) return `<span class="evi ok">${icon('camera')}มีรูป ${n}</span>`;
  if (x.queued) return `<span class="evi wait">${icon('camera')}รูปรอส่ง ${x.queued}</span>`;
  if (!x.need_photo || x.actual == null) return '';
  return `<label class="evi due">${icon('camera')}รูปค้าง · ถ่ายเพิ่ม<input class="vh" type="file" accept="image/*" capture="environment" data-chg="f-photo" data-id="${c.id}" data-point="${esc(x.name)}" data-cp="${k}" aria-label="ถ่ายรูปของจุด ${esc(x.name)}"></label>${x.skip ? `<span class="why">เหตุผล: ${esc(x.skip)}</span>` : ''}`;
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
  const fc = i === -1 ? null : forecast(c, i, late());
  const nb = i === -1
    ? `<div class="nextbox dn"><div class="l">สถานะ</div><div class="v">ครบทุกจุดแล้ว</div><div class="t">${esc(c.cps[total - 1].name)} ${hm(c.cps[total - 1].actual)}</div></div>`
    : `<div class="nextbox ${st.k === 'late' ? 'lt' : ''}"><div class="l">จุดถัดไป · ${esc(st.label)}</div><div class="v">${esc(c.cps[i].name)}</div><div class="t">${planCell(c, i, late())}</div>${fc ? `<div class="fc">${esc(forecastNote(c, i, late()))}</div>` : ''}</div>`;
  const lastK = i === -1 ? total - 1 : i - 1;
  const point = lastK < 0 ? 'ก่อน' + c.cps[0].name : c.cps[lastK].name;
  const cp = lastK < 0 ? '' : ` data-cp="${lastK}"`;
  const shot = i !== -1 && c.cps[i].need_photo && !cpPhotos(c, i).length && !c.cps[i].queued;
  const off = snapping ? 'disabled' : '';
  const cta = i === -1 ? `<div class="big done">${icon('check')}ครบทุกจุดแล้ว</div>`
    : shot ? `<label class="big snap">${icon('camera')}<span>ถ่ายรูปและยืนยัน: ${esc(c.cps[i].name)}</span><input class="vh" type="file" accept="image/*" capture="environment" data-chg="f-snap" data-id="${c.id}" data-idx="${i}" aria-label="ถ่ายรูปและยืนยัน ${esc(c.cps[i].name)}" ${off}></label><button class="skipbtn" data-act="f-nophoto" data-id="${c.id}" data-idx="${i}" type="button" ${off}>ยืนยันโดยไม่มีรูป</button>`
    : `<button class="big" data-act="f-confirm" data-id="${c.id}" data-idx="${i}" type="button">${icon('check')}ยืนยัน: ${esc(c.cps[i].name)}</button>`;
  return `<div class="fa">
    <div class="fa-bar"><button class="navback" data-act="back" type="button">${icon('left')}กลับ</button><span class="ttl">${esc(job.vessel || '')}</span></div>
    <div class="fa-hero"><div class="who-h">${avatar(c, true)}<div style="min-width:0"><div class="nm2">${esc(c.name)}</div><div class="sub">${esc(c.rank || '—')} · ${esc(c.flight || '—')} · ${c.type === 'on' ? 'On signer' : 'Off signer'}</div></div></div>
      <div class="prog"><div class="l"><span>ผ่านแล้ว ${dn} จาก ${total} จุด</span>${pill(st.cls, st.label)}</div><div class="bar"><i style="width:${total ? Math.round(dn / total * 100) : 0}%"></i></div></div></div>
    <div class="fa-body">
      ${nb}
      <div class="act3">
        <label class="btn line">${icon('camera')}ถ่ายรูป<input class="vh" type="file" accept="image/*" capture="environment" data-chg="f-photo" data-id="${c.id}" data-point="${esc(point)}"${cp} aria-label="ถ่ายรูป"></label>
        <label class="btn line">${icon('image')}เลือกรูปในเครื่อง<input class="vh" type="file" accept="image/*" data-chg="f-photo" data-id="${c.id}" data-point="${esc(point)}"${cp} aria-label="เลือกรูปในเครื่อง"></label>
        <button class="btn line wide" data-act="f-note" type="button">${icon('note')}เขียนหมายเหตุ</button>
      </div>
      <div class="gps-note">${icon('pin')}<span>ทุกรูปพิมพ์เวลา จุด และพิกัดจากมือถือลงในภาพให้อัตโนมัติ · ปุ่มถ่ายรูปด้านบนแนบรูปกับจุดล่าสุดที่ยืนยันแล้ว</span></div>
      <form class="noteedit" id="noteedit" hidden><textarea name="text" rows="3" maxlength="1000" placeholder="เช่น กระเป๋าตกค้าง รอเจ้าหน้าที่สายการบิน 30 นาที" required></textarea><button class="btn block" type="submit" style="margin-top:8px;height:50px">บันทึกหมายเหตุ</button></form>
      ${c.photos.length ? `<div class="sec-l">รูปที่แนบ (${c.photos.length}) · กดเพื่อดูเต็มจอ</div><div class="pgrid">${c.photos.map(p => `<button type="button" data-act="f-photoview" data-src="/api/photos/${p.id}" data-cap="${esc(p.point + ' · ' + fmtD(p.at) + ' · ' + gpsText(p))}"><img src="/api/photos/${p.id}" alt="รูปที่แนบ" loading="lazy"><span>${esc(p.point)} ${hm(p.at)}</span></button>`).join('')}</div>` : ''}
      ${c.notes.length ? `<div class="notes">${c.notes.map(n => `<div><span class="muted">${dhm(n.at)}</span> ${esc(n.text)}</div>`).join('')}</div>` : ''}
      <div class="sec-l">เส้นทางทั้งหมด</div>
      ${shiftNote(c, late()) ? `<div class="fc">${esc(shiftNote(c, late()))}</div>` : ''}
      <div class="tl">${c.cps.map((x, k) => {
        const cls = x.actual != null ? 'd' : (k === i ? 'c' : '');
        const lt = x.actual != null && x.plan != null && (x.actual - x.plan) / MIN > late();
        const right = x.actual != null ? `${dhm(x.actual)}${x.pending ? '<div class="pend">รอส่ง</div>' : ''}${lt ? `<div class="ltxt">ช้า ${Math.round((x.actual - x.plan) / MIN)} น.</div>` : ''}` : `<span class="muted">${planCell(c, k, late())}</span>`;
        const ev = evidenceMark(c, x, k);
        return `<div class="tli ${cls}"><span class="dot">${cls === 'd' ? icon('check') : ''}</span><span class="tn"><span class="${k === i ? 'cur' : cls === '' ? 'muted' : ''}">${esc(x.name)}</span>${ev ? `<span class="evs">${ev}</span>` : ''}</span><span class="tm">${right}</span></div>`;
      }).join('')}</div>
      <div class="infobox"><div><span class="k">รถ</span><span class="v">${veh ? esc(`${veh.name}${veh.plate ? ' · ' + veh.plate : ''}${veh.driver ? ' · ' + veh.driver : ''}`) : 'ยังไม่จัดรถ'}</span>${veh && veh.driver_phone ? `<a class="btn line sm" href="tel:${esc(veh.driver_phone.replace(/[^0-9+]/g, ''))}">${icon('phone')}โทร</a>` : ''}</div><div><span class="k">โรงแรม</span><span class="v">${esc(hotel ? hotel.name : 'ยังไม่มีโรงแรม')}${c.room ? ' · ห้อง ' + esc(c.room) : ''}</span>${hotel && hotel.phone ? `<a class="btn line sm" href="tel:${esc(hotel.phone.replace(/[^0-9+]/g, ''))}">${icon('phone')}โทร</a>` : ''}</div></div>
      ${dn > 0 && !c.cps.some(x => x.pending) ? `<button class="undo2" data-act="f-undo" data-id="${c.id}" type="button">${icon('refresh')}กดผิด ย้อนกลับ 1 จุด</button>` : ''}
    </div>
    <div class="fa-cta">${cta}</div>
  </div>`;
}

const crewOf = id => F.crew.find(c => c.id === +id);
const quickGps = () => Promise.race([getGps(), new Promise(r => setTimeout(() => r(null), 1500))]);

async function confirmNow(c, idx, extra) {
  const x = c.cps[idx];
  const r = await confirmPoint(c.id, idx, { assignment_revision:c.assignment_rev, cp_id: c.cps[idx].id, ...extra, label: `"${x.name}" ของ ${c.name}` }, A.me.id);
  x.actual = r.at;
  if (extra.skip) x.skip = extra.skip;
  if (r.queued) x.pending = true;
  return r;
}

export const actions = {
  async 'f-confirm'(t) {
    if (t.disabled) return;
    t.disabled = true;
    const c = crewOf(t.dataset.id), idx = +t.dataset.idx;
    const gps = await quickGps();
    try {
      const r = await confirmNow(c, idx, { ...(gps ? { lat: gps.lat, lng: gps.lng } : {}), upload: c.cps[idx].queuedId });
      if (r.queued) toast(`ไม่มีสัญญาณ บันทึกเวลา ${hm(r.at)} ไว้ในเครื่องแล้ว ระบบส่งเองเมื่อมีสัญญาณ`, 4000);
      else toast(`บันทึก "${c.cps[idx].name}" เวลา ${hm(r.at)} แล้ว สำนักงานเห็นทันที`);
      render(true);
      if (!r.queued) poll();
    } catch (e) {
      t.disabled = false;
      toast(e.message);
      if (e.status === 409) poll();
    }
  },
  'f-nophoto'(t) {
    if (t.disabled) return;
    const c = crewOf(t.dataset.id), idx = +t.dataset.idx, x = c.cps[idx];
    openDialog(`<form class="dlg-form" id="skipf">${dlgHead('ยืนยันโดยไม่มีรูป')}<div class="dlg-b">
      <p>จุด <b>${esc(x.name)}</b> ของ ${esc(c.name)} ต้องถ่ายรูป ถ้าถ่ายไม่ได้ให้เลือกเหตุผล สำนักงานจะเห็นว่าจุดนี้ "รูปค้าง" จนกว่าจะแนบรูป</p>
      <fieldset class="reasons"><legend>เหตุผลที่ไม่มีรูป</legend>
        ${SKIP_REASONS.map((r, k) => `<label class="f chk"><input type="radio" name="why" value="${esc(r)}" ${k ? '' : 'required'}><span>${esc(r)}</span></label>`).join('')}
        <label class="f chk"><input type="radio" name="why" value=""><span>อื่น ๆ (พิมพ์เหตุผล)</span></label>
      </fieldset>
      <label class="f" id="skipother" hidden><span>เหตุผลอื่น</span><input name="other" type="text" minlength="3" maxlength="120" autocomplete="off"><span class="fhelp">พิมพ์สั้น ๆ 3–120 ตัวอักษร เช่น ฝนตกหนัก ลูกเรือรีบขึ้นรถ</span></label>
      </div>${dlgFoot('ยืนยันโดยไม่มีรูป')}</form>`, async fd => {
      const why = String(fd.get('why') || fd.get('other') || '').trim();
      if (why.length < 3 || why.length > 120) throw new Error('กรุณาเลือกเหตุผล หรือพิมพ์เหตุผล 3–120 ตัวอักษร');
      const gps = await quickGps();
      try {
        const r = await confirmNow(c, idx, { ...(gps ? { lat: gps.lat, lng: gps.lng } : {}), skip: why });
        if (r.queued) toast(`ไม่มีสัญญาณ บันทึกเวลา ${hm(r.at)} ไว้ในเครื่องแล้ว ระบบส่งเองเมื่อมีสัญญาณ`, 4000);
        else toast(`บันทึก "${x.name}" เวลา ${hm(r.at)} แล้ว จุดนี้ยังรูปค้าง`, 4000);
        render(true);
        if (!r.queued) poll();
      } catch (e) {
        toast(e.message);
        if (e.status === 409) poll();
      }
    });
    const form = document.getElementById('skipf'), other = document.getElementById('skipother');
    form.addEventListener('change', e => {
      if (e.target.name !== 'why') return;
      other.hidden = e.target.value !== '';
      other.querySelector('input').required = !other.hidden;
      if (!other.hidden) other.querySelector('input').focus();
    });
  },
  async 'f-undo'(t) {
    const c = crewOf(t.dataset.id);
    const last = [...c.cps].reverse().find(x => x.actual != null);
    if (!last || !window.confirm(`ย้อนกลับ "${last.name}" ?`)) return;
    await api('POST', `/api/crew/${c.id}/undo`, { idx: last.idx, cp_id: last.id, assignment_revision:c.assignment_rev });
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

const stampInfo = (c, point) => ({ point, name: c.name, rank: c.rank, vessel: (F.jobs.find(j => j.id === c.job_id) || {}).vessel || '', company: A.settings.company.name });

export const changes = {
  async 'f-photo'(t) {
    if (t.disabled) return;
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('กรุณาเลือกรูปภาพ');
    const c = crewOf(t.dataset.id);
    const inputs = [...document.querySelectorAll('[data-chg="f-photo"]')];
    inputs.forEach(input => { input.disabled = true; });
    const uid = A.me.id, point = t.dataset.point, cp = t.dataset.cp === undefined ? undefined : +t.dataset.cp;
    toast('กำลังเตรียมรูป...', 8000);
    try {
      const r = await prepareAndUploadPhoto(c.id, file, { assignment_revision:c.assignment_rev, point, cp, cp_id: c.cps[cp]?.id, label: `"${point}" ของ ${c.name}` },
        () => stampPhoto(file, stampInfo(c, point)), uid);
      if (r.repeated) return toast('รูปนี้ถูกบันทึกหรืออยู่ในคิวส่งแล้ว ไม่ได้เพิ่มรูปซ้ำ');
      if (r.error) return toast(`${r.error} · เก็บสำเนาไว้แล้ว ดูที่บัญชี > งานที่ยังส่งไม่สำเร็จ`, 8000);
      if (r.queued) { toast('เก็บรูปไว้ในเครื่องแล้ว จะส่งให้อัตโนมัติเมื่อออนไลน์ ดูรายการได้ที่บัญชีของฉัน', 4000); overlayAgain(); return; }
      toast(r.gps ? 'บันทึกรูปพร้อมเวลาและพิกัดแล้ว' : 'บันทึกรูปพร้อมเวลาแล้ว (ไม่มีพิกัดจากมือถือ)');
      await poll();
    } finally { inputs.forEach(input => { input.disabled = false; }); }
  },
  async 'f-snap'(t) {
    if (t.disabled || snapping) return;
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('กรุณาเลือกรูปภาพ');
    const c = crewOf(t.dataset.id), idx = +t.dataset.idx, x = c && c.cps[idx];
    if (!x || x.actual != null) return;
    const point = x.name;
    snapping = true;
    render(true);
    toast('กำลังเตรียมรูป...', 8000);
    try {
      const p = await prepareAndUploadPhoto(c.id, file, { assignment_revision:c.assignment_rev, point, cp: idx, cp_id: x.id, label: `"${point}" ของ ${c.name}` },
        () => stampPhoto(file, stampInfo(c, point)), A.me.id);
      // The checkpoint is confirmed with the capture time even when the photo is still queued or was refused.
      const r = await confirmNow(c, idx, { at: p.at, upload: p.uploadId, ...(p.lat != null ? { lat: p.lat, lng: p.lng } : {}) });
      snapping = false;
      if (p.error) toast(`ยืนยัน "${point}" เวลา ${hm(r.at)} แล้ว แต่รูปส่งไม่สำเร็จ จุดนี้ยังรูปค้าง · เก็บสำเนารูปไว้ที่บัญชี > งานที่ยังส่งไม่สำเร็จ`, 9000);
      else if (p.queued || r.queued) toast(`ไม่มีสัญญาณ เก็บรูปและเวลา ${hm(r.at)} ไว้ในเครื่องแล้ว ระบบส่งเองเมื่อมีสัญญาณ`, 5000);
      else toast(`บันทึกรูปและยืนยัน "${point}" เวลา ${hm(r.at)} แล้ว สำนักงานเห็นทันที`);
      overlayAgain();
      if (!r.queued) poll();
    } catch (e) {
      snapping = false;
      toast(e.message || 'ทำรายการไม่สำเร็จ', 6000);
      overlayAgain();
      if (e.status === 409) poll();
    }
  }
};

function overlayAgain() {
  for (const c of F.crew) for (const x of c.cps) { delete x.queued; delete x.queuedId; }
  overlay();
  render(true);
}

document.addEventListener('cancel', e => {
  if (e.target.matches && e.target.matches('[data-chg="f-snap"]')) toast('ยังไม่ได้ถ่ายรูป จุดนี้ยังไม่ถูกยืนยัน', 4000);
}, true);

document.addEventListener('submit', async e => {
  if (e.target.id !== 'noteedit') return;
  e.preventDefault();
  const c = crewOf(A.route.params.crew);
  const text = e.target.text.value.trim();
  if (!text) return toast('กรุณาพิมพ์หมายเหตุ');
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    await api('POST', `/api/crew/${c.id}/notes`, { text, assignment_revision:c.assignment_rev });
    toast('บันทึกหมายเหตุแล้ว');
    document.activeElement.blur();
    e.target.reset();
    e.target.hidden = true;
    await poll();
  } catch (x) { toast(x.message); btn.disabled = false; }
});
