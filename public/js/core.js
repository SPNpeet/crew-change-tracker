export const MIN = 60000;
const TZ = 7 * 3600000;
const pad = n => String(n).padStart(2, '0');
const parts = ms => { const d = new Date(ms + TZ); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }; };

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const words = s => esc(s).replace(/(Local|GATE|Time|on|off|On|Off|Meeting|Boarding) (agent|Agent|PERMISSION|log|signer|point)/g, '$1&nbsp;$2').split(' ').map(w => /[ก-๙]/.test(w) && w.length <= 26 ? `<span class="nw">${w}</span>` : w).join(' ');
export const glue = s => esc(s).replace(/ช้ากว่าแผน [^·]+/g, m => `<span class="nw">${m.trim()}</span> `).replace(/คุณ[ก-๙]+/g, m => `<span class="nw">${m}</span>`);

export function hm(ms) { if (ms == null) return '—'; const p = parts(ms); return pad(p.h) + ':' + pad(p.mi); }
export function hms(ms) { const p = parts(ms); return pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.s); }
export function fmtD(ms) { if (ms == null) return '—'; const p = parts(ms); return pad(p.d) + '/' + pad(p.mo) + ' ' + hm(ms); }
export function fmtFull(ms) { if (ms == null) return '—'; const p = parts(ms); return `${pad(p.d)}/${pad(p.mo)}/${p.y + 543} ${hm(ms)}`; }
export function dateTh(ms) { const p = parts(ms); return `${pad(p.d)}/${pad(p.mo)}/${p.y + 543}`; }
const sameDay = (a, b) => { const x = parts(a), y = parts(b); return x.y === y.y && x.mo === y.mo && x.d === y.d; };
export function dhm(ms) { if (ms == null) return '—'; return sameDay(ms, Date.now()) ? hm(ms) : fmtD(ms); }
export function dur(min) { min = Math.max(0, Math.round(min)); if (min < 60) return min + ' นาที'; return Math.floor(min / 60) + ' ชม. ' + (min % 60) + ' นาที'; }
export function toInput(ms) { if (ms == null) return ''; const p = parts(ms); return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; }
export function fromInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - TZ : null;
}

export const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('').toUpperCase();
const AV = [['#e0e7ff', '#3730a3'], ['#dcfce7', '#166534'], ['#fef3c7', '#92400e'], ['#fce7f3', '#9d174d'], ['#e0f2fe', '#075985'], ['#ede9fe', '#5b21b6']];
export function avatar(c, big) { const k = [...String(c.name)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV.length; return `<span class="av" style="background:${AV[k][0]};color:${AV[k][1]}${big ? ';width:44px;height:44px;font-size:15px' : ''}">${esc(initials(c.name))}</span>`; }
export const pill = (cls, t) => `<span class="pill ${cls}">${esc(t)}</span>`;
export const typeTag = c => `<span class="tag ${c.type}">${c.type === 'on' ? 'On signer' : 'Off signer'}</span>`;

export const nextIdx = c => c.cps.findIndex(x => x.actual == null);
const lastDone = c => { const i = nextIdx(c); return i === -1 ? c.cps.length - 1 : i - 1; };
export function lastDelay(c) { const k = lastDone(c); const x = c.cps[k]; return k >= 0 && x.plan != null ? (x.actual - x.plan) / MIN : 0; }
export function expected(c, j, late) { const p = c.cps[j].plan; if (p == null) return null; const d = lastDelay(c); return j <= c.chain_end && d > late ? p + d * MIN : p; }
export function status(c, now, late) {
  const i = nextIdx(c);
  if (!c.cps.length) return { k: 'plan', label: 'ยังไม่มีจุด', cls: 'gray' };
  if (i === -1) return { k: 'done', label: 'ครบทุกจุด', cls: 'ok' };
  const plan = c.cps[i].plan;
  if (plan == null) return { k: 'noplan', label: 'ยังไม่วางแผน', cls: 'gray' };
  const exp = expected(c, i, late);
  const overdue = (now - exp) / MIN;
  const vsPlan = (now - plan) / MIN;
  const d = lastDelay(c);
  if (overdue > late || (vsPlan > late && d <= late)) { const l = Math.max(vsPlan, overdue); return { k: 'late', label: 'ช้า ' + dur(l), cls: 'late', late: l, waiting: true }; }
  if (i <= c.chain_end && d > late) return { k: 'late', label: 'ช้ากว่าแผน ' + dur(d), cls: 'late', late: d, eta: exp };
  const until = (exp - now) / MIN;
  if (until <= 60) return { k: 'soon', label: until > 0 ? 'อีก ' + dur(until) : 'ถึงเวลาแล้ว', cls: 'warn-c', until };
  return { k: 'plan', label: i === 0 ? 'รอ ' + dhm(plan) : 'ตามแผน', cls: i === 0 ? 'gray' : 'ok' };
}
export function statusEn(c, now, late) {
  const st = status(c, now, late);
  if (st.k === 'done') return { label: 'Completed', cls: 'ok' };
  if (st.k === 'late') return { label: 'Delayed ' + Math.round(st.late) + ' min', cls: 'late' };
  if (nextIdx(c) === 0) return { label: c.type === 'on' ? 'Awaiting arrival' : 'On board', cls: 'gray' };
  return { label: 'On schedule', cls: 'ok' };
}
export function current(c) { const i = nextIdx(c); if (i === 0) return 'ยังไม่เริ่ม'; return c.cps[(i === -1 ? c.cps.length : i) - 1].name; }
export function currentEn(c) { const i = nextIdx(c); if (i === 0) return c.type === 'on' ? 'Awaiting arrival' : 'On board'; return c.cps[(i === -1 ? c.cps.length : i) - 1].name_en; }
export function lastTime(c) { const k = lastDone(c); return k >= 0 ? c.cps[k].actual : null; }
export function planCell(c, j, late) {
  const p = c.cps[j].plan;
  if (p == null) return 'ยังไม่มีแผน';
  const e = expected(c, j, late);
  return e !== p ? `แผน ${dhm(p)} · <b style="color:var(--red)">คาดว่า ${dhm(e)}</b>` : `แผน ${dhm(p)}`;
}
export const missingDocs = (c, docs) => docs.filter(d => !c.docs[d]);
export const doneCount = c => c.cps.filter(x => x.actual != null).length;

export function prepItems(job, crew, now, ctx) {
  const out = [];
  const late = ctx.settings.late_min;
  for (const c of crew) {
    const st = status(c, now, late), i = nextIdx(c);
    if (i === -1) continue;
    const n = c.cps[i].name;
    const veh = ctx.vehicle(c.vehicle_id);
    let who = 'พนักงานภาคสนาม';
    if (/โรงแรม/.test(n)) who = c.hotel_id ? 'โรงแรม ' + ctx.hotelName(c.hotel_id) : 'จองโรงแรม (ยังไม่มีห้อง)';
    else if (/รถ|ท่าเรือ|สนามบิน/.test(n)) who = veh ? `${veh.name} ${veh.driver}` : 'จัดรถ (ยังไม่มีรถ)';
    else if (/Gate|เรือ/.test(n)) who = job.agent || 'Local agent';
    if (st.k === 'late' && st.waiting) out.push({ w: 0, cls: 'late', tag: 'ด่วน', text: `${c.name} ยังไม่ถึงจุด "${n}" ช้ากว่าแผน ${dur(st.late)} · ตามพนักงานภาคสนาม และแจ้ง ${who}` });
    else if (st.k === 'late') out.push({ w: 0, cls: 'late', tag: 'ด่วน', text: `${c.name} ช้ากว่าแผน ${dur(st.late)} · แจ้ง ${who} ว่าจะถึง "${n}" ราว ${dhm(st.eta)}` });
    else if (st.k === 'soon') out.push({ w: 1, cls: 'warn-c', tag: 'ภายใน ' + dur(st.until), text: `${c.name} ใกล้ถึง "${n}" (${dhm(expected(c, i, late))}) · เตรียม ${who}` });
    else if (st.k === 'noplan') out.push({ w: 2, cls: 'warn-c', tag: 'แผน', text: `${c.name} ยังไม่ได้ใส่เวลาตามแผน` });
    if (c.type === 'on' && i === 0 && missingDocs(c, ctx.settings.docs).length) out.push({ w: 2, cls: 'warn-c', tag: 'เอกสาร', text: `${c.name} ยังขาด ${missingDocs(c, ctx.settings.docs).join(', ')}` });
    if (c.type === 'on' && i <= c.chain_end && !c.hotel_id) out.push({ w: 2, cls: 'warn-c', tag: 'โรงแรม', text: `${c.name} ยังไม่มีห้องพัก` });
    if (i <= c.chain_end && !c.vehicle_id) out.push({ w: 2, cls: 'warn-c', tag: 'รถ', text: `${c.name} ยังไม่ได้จัดรถ` });
    if (!c.agent_id) out.push({ w: 2, cls: 'warn-c', tag: 'ผู้ดูแล', text: `${c.name} ยังไม่มีพนักงานผู้ดูแล` });
  }
  if (job.imm_deadline) {
    const left = (job.imm_deadline - now) / MIN;
    const pend = crew.filter(c => c.type === 'on' && !c.s4.imm);
    if (pend.length && left < 360) out.push({ w: left < 0 ? 0 : 1, cls: left < 0 ? 'late' : 'warn-c', tag: 'ตม.', text: left < 0 ? `เกินกำหนดยื่นเอกสาร ตม. (${pend.map(c => c.name).join(', ')})` : `อีก ${dur(left)} ถึงกำหนดยื่นเอกสาร ตม. (${pend.map(c => c.name).join(', ')})` });
  }
  return out.sort((a, b) => a.w - b.w);
}

export function mail(kind, job, crew, ctx) {
  const late = ctx.settings.late_min;
  const on = crew.filter(c => c.type === 'on'), off = crew.filter(c => c.type === 'off');
  const sig = ctx.settings.company.signature;
  const port = job.port || '-';
  const to = e => e ? `To: ${e}\n` : '';
  if (kind === 'appoint') {
    const svc = job.services.length ? job.services : ['Crew change'];
    return `${to(job.agent_email)}Subject: APPOINTMENT – ${svc.join(' / ').toUpperCase()} / ${job.vessel} / ${port.toUpperCase()}\n\nDear ${job.agent || 'Sir/Madam'},\n\nWe are pleased to inform you that we have been appointed by ${job.owner || 'the Owner'} to handle the following for ${job.vessel} at ${port}:\n${svc.map(s => '- ' + s).join('\n')}\n\nOn signers: ${on.length} / Off signers: ${off.length}\n\nKindly advise the latest vessel schedule (ETA / ETB / ETD) for our reference.\n\n${sig}`;
  }
  if (kind === 'sched') return `${to(job.owner_email)}Subject: ${job.vessel} – UPDATED SCHEDULE\n\nDear ${job.owner || 'Sir/Madam'},\n\nPlease be advised the updated schedule of ${job.vessel} at ${port} (local time):\nETA ${fmtD(job.eta)}\nETB ${fmtD(job.etb)}\nETD ${fmtD(job.etd)}\n\nCrew change plan remains as scheduled.\n\n${sig}`;
  if (kind === 'gate') {
    const lines = on.concat(off).map(c => `${c.type === 'on' ? 'On signer ' : 'Off signer'} | ${c.name} | ${c.rank || '-'} | ${c.nationality || '-'} | ${c.passport || '(pending)'}`);
    [...new Set(crew.map(c => c.agent_id).filter(Boolean))].forEach(id => { const u = ctx.user(id); if (u) lines.push(`Boarding agent | ${u.name} | ID ${u.id_card || '-'}`); });
    [...new Set(crew.map(c => c.vehicle_id).filter(Boolean))].forEach(id => { const v = ctx.vehicle(id); if (v) lines.push(`Driver | ${v.driver_en || v.driver} | ${v.driver_id || '-'} | Van ${v.plate || '-'}`); });
    return `${to(job.agent_email)}Subject: GATE PERMISSION – ${job.vessel} / ${port.toUpperCase()}${job.etb ? ' / ' + fmtD(job.etb).slice(0, 5) : ''}\n\nDear ${job.agent || 'Sir/Madam'},\n\nPlease arrange gate permission for the following persons:\n\n${lines.join('\n')}\n\n${sig}`;
  }
  if (kind === 'plan') {
    const rows = crew.map(c => `${c.name} (${c.rank || '-'}) ${c.type === 'on' ? 'On signer' : 'Off signer'}${c.flight ? ' ' + c.flight : ''}:\n` + c.cps.map((x, j) => `  ${x.name_en} ${x.actual != null ? fmtD(x.actual) + ' (done)' : fmtD(expected(c, j, late))}`).join('\n'));
    return `${to(job.owner_email)}Subject: ${job.vessel} – CREW CHANGE PLAN\n\nDear ${job.owner || 'Sir/Madam'} / Captain,\n\nPlease find the crew change plan at ${port} (local time):\n\n${rows.join('\n\n')}\n\n${sig}`;
  }
  const now = Date.now();
  const lineOf = c => {
    const i = nextIdx(c), lt = lastTime(c), d = lastDelay(c);
    const note = c.notes.length ? ` (remark: ${c.notes[c.notes.length - 1].text})` : '';
    return `- ${c.name} (${c.rank || '-'}): ${currentEn(c)}${lt ? ' at ' + hm(lt) : ''}${d > late && i !== -1 && i <= c.chain_end ? ` (delayed ${Math.round(d)} min)` : ''}${i !== -1 && c.cps[i].plan != null ? `, next: ${c.cps[i].name_en} ${dhm(expected(c, i, late))}` : ''}${note}`;
  };
  if (kind === 'night') {
    const until = now + 12 * 3600000;
    const upcoming = crew.flatMap(c => c.cps.map((x, j) => ({ c, x, t: x.actual == null ? expected(c, j, late) : null }))).filter(e => e.t != null && e.t <= until).sort((a, b) => a.t - b.t);
    const plan = upcoming.length ? upcoming.map(e => `- ${fmtD(e.t)} ${e.c.name}: ${e.x.name_en}`).join('\n') : '- No movement planned until morning.';
    return `${to(job.owner_email)}Subject: ${job.vessel} – NIGHT UPDATE ${hm(now)}\n\nDear ${job.owner || 'Sir/Madam'},\n\nCurrent status of crew change at ${port}:\n${crew.map(lineOf).join('\n')}\n\nPlanned until morning (local time):\n${plan}\n\nNext update will be sent at 07:00 LT.\n\n${sig}`;
  }
  if (kind === 'morning') {
    const since = now - 12 * 3600000;
    const done = crew.flatMap(c => c.cps.filter(x => x.actual != null && x.actual >= since).map(x => ({ c, x }))).sort((a, b) => a.x.actual - b.x.actual);
    const list = done.length ? done.map(e => `- ${fmtD(e.x.actual)} ${e.c.name}: ${e.x.name_en}`).join('\n') : '- No movement overnight.';
    return `${to(job.owner_email)}Subject: ${job.vessel} – MORNING UPDATE\n\nDear ${job.owner || 'Sir/Madam'},\n\nActual progress overnight (local time):\n${list}\n\nCurrent status:\n${crew.map(lineOf).join('\n')}\n\n${sig}`;
  }
  return `${to(job.owner_email)}Subject: ${job.vessel} – CREW CHANGE UPDATE ${hm(now)}\n\nDear ${job.owner || 'Sir/Madam'},\n\n${crew.map(lineOf).join('\n')}\n\n${sig}`;
}

export function missText(crew, docs) {
  return crew.filter(c => missingDocs(c, docs).length).map((c, i) => `${i + 1}. ${c.name} (${c.rank || '-'}) — ${missingDocs(c, docs).join(', ')}`).join('\n');
}
