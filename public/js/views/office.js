import { A, go } from '../app.js';
import { api } from '../api.js';
import { esc, words, glue, hm, fmtD, fmtFull, dhm, dur, toInput, fromInput, avatar, pill, typeTag, nextIdx, status, current, lastTime, planCell, expected, missingDocs, prepItems, mail, missText, doneCount, MIN } from '../core.js';
import { icon, toast, copy, openDialog, dlgHead, dlgFoot, openLb } from '../ui.js';
import { jobForm, readJobForm } from './jobs.js';

const app = () => document.getElementById('app');
export const STEPS = [
  { n: 'เอกสารลูกเรือ', t: 'รับอีเมลเปลี่ยนลูกเรือ ตรวจเอกสารและข้อมูล', o: 'เมื่อได้รับเมลจากลูกค้าเรื่องเปลี่ยนลูกเรือ ให้เช็คข้อมูลว่าทางลูกค้าส่งเอกสาร และข้อมูลใดมาให้บ้าง' },
  { n: 'ตารางเรือ', t: 'เช็คตารางเรือกับ Local agent และอัปเดตลูกค้า', o: 'เช็คตารางเรือกับตัวแทนเรือ (Local agent) แล้วอัพเดตให้ทางลูกค้า' },
  { n: 'แจ้ง Local Agent', t: 'แจ้ง Local Agent รับการแต่งตั้งจาก Owner', o: 'ส่งเมลแจ้ง Local Agent ให้รับทราบว่า เราได้รับการแต่งตั้งจาก Owner ให้จัดการเรื่องเปลี่ยนลูกเรือ / หรือเรื่องอื่นๆ เพื่อให้ทางเอเย่นรับทราบ และสอบถามตารางเรือเพื่อเป็นข้อมูลอ้างอิง' },
  { n: 'OKTB / ตม.', t: 'ออก OKTB ส่ง Meeting point และเอกสาร ตม. สนามบิน', o: 'หากเอกสารลูกเรือครบแล้ว ให้ออกเอกสาร OKTB ส่ง Meeting point ให้ทาง owner ประสานงานกับทีม เรื่องส่งเอกสารให้ทาง ตม สนามบิน (ระวังเรื่องเกินเวลากำหนดยื่น)' },
  { n: 'แผน / Time log', t: 'แผนเปลี่ยนลูกเรือและ Time log', o: 'จัดเตรียม แผนในการเปลี่ยนลูกเรือ พร้อมทั้ง time log ตั้งแต่ on signer เครื่องลงคนแรก และ off signer บินกลับเป็นคนสุดท้าย ให้ทาง owner และ กัปตันเรือทราบแผน' },
  { n: 'Gate permission', t: 'อีเมลขอผ่านท่า GATE PERMISSION', o: 'ส่งเมล รายชื่อลูกเรือ / boarding agent / คนขับรถ ให้ทาง local agent เพื่อขอผ่านท่า หัวข้อ : GATE PERMISSION' },
  { n: 'รถ / โรงแรม', t: 'จัดรถ จัดโรงแรม ตามแผน', o: 'จัดรถ จัดโรงแรม ตามแผนที่วางไว้' },
  { n: 'อัปเดต Owner', t: 'ติดตามและอัปเดต Owner แบบเรียลไทม์', o: 'ติดตามการอัพเดตทั้งหมด ตามแผนการที่วางไว้ และอัพเดตผ่านอีเมลให้ทาง Owner ทราบแบบเรียลไทม์ มากที่สุด (ช่วงกลางคืนหากดึกเกินไป ให้แจ้งแผนที่จะเกิดขึ้นในเมลล่าสุดที่อัพเดต และแจ้งอัพเดตจริงอีกครั้ง ในช่วงเช้า)' },
  { n: 'สรุปส่งบัญชี', t: 'สรุปกิจกรรมและรายชื่อลูกเรือส่งฝ่ายบัญชี', o: 'เมื่องานเสร็จสิ้น ให้จัดทำสรุป กิจกรรมและรายชื่อลูกเรือ รวมถึงข้อมูลอื่นๆให้ทาง บัญชี' }
];

let J = null;
const late = () => A.settings.late_min;
const closed = () => J.job.status === 'closed';
const ctx = () => A;

async function load(id) {
  J = await api('GET', `/api/jobs/${id}`);
  A.job = J;
  return J;
}

export async function enter(r, alive) {
  if (!J || J.job.id !== r.params.id) app().innerHTML = '<div class="muted">กำลังโหลดงาน...</div>';
  await load(r.params.id);
  if (!alive()) return;
  if (!r.params.step) {
    const first = J.job.steps.findIndex(x => !x);
    return go(`/jobs/${r.params.id}/${first === -1 ? 9 : first + 1}`, true);
  }
  A.ui.mailEdited = false;
  render();
}

export async function poll(r) {
  if (r.name !== 'job' || A.ui.mailEdited) return;
  await load(r.params.id);
  if (A.route.name === 'job' && A.route.params.id === J.job.id) render(true);
}

async function refresh(msg) {
  await load(J.job.id);
  render(true);
  if (msg) toast(msg);
}

function render(keepScroll) {
  const y = window.scrollY;
  const k = A.route.params.step;
  app().innerHTML = `<div class="office">${side(k)}<section>${head(k)}${body(k, Date.now())}</section></div>`;
  if (keepScroll) window.scrollTo(0, y);
  const cur = app().querySelector('.steplist [aria-current="true"]'), sl = app().querySelector('.steplist');
  if (cur && sl.scrollWidth > sl.clientWidth) sl.scrollLeft += cur.getBoundingClientRect().left - sl.getBoundingClientRect().left - (sl.clientWidth - cur.offsetWidth) / 2;
  const ta = app().querySelector('textarea.mail');
  if (ta) ta.addEventListener('input', () => { A.ui.mailEdited = true; }, { once: true });
}

function side(k) {
  const j = J.job, done = j.steps.filter(Boolean).length;
  return `<aside class="side">
    <div class="card jobcard"><div class="jc-h"><div class="v">${esc(j.vessel)}</div>${closed() ? pill('gray', 'ปิดแล้ว') : `<button class="iconbtn plain" type="button" data-act="o-editjob" title="แก้ไขข้อมูลงาน" aria-label="แก้ไขข้อมูลงาน">${icon('edit')}</button>`}</div><div class="p">${esc(j.port || 'ยังไม่ระบุท่าเรือ')}</div>
      <dl><dt>Owner</dt><dd>${esc(j.owner || '—')}</dd><dt>Local agent</dt><dd>${esc(j.agent || '—')}</dd><dt>ETA</dt><dd>${fmtD(j.eta)}</dd><dt>ETB</dt><dd>${fmtD(j.etb)}</dd></dl>
      <div class="prog"><div class="l"><span>ความคืบหน้า</span><span>${done} / 9 ขั้นตอน</span></div><div class="bar"><i style="width:${Math.round(done / 9 * 100)}%"></i></div></div>
    </div>
    <nav class="card steplist" aria-label="ขั้นตอนการทำงาน"><div class="h">ขั้นตอนการทำงาน</div>${STEPS.map((s, i) => `<a class="st ${j.steps[i] ? 'done' : ''}" href="/jobs/${j.id}/${i + 1}" data-link aria-current="${k === i + 1}"><span class="mk">${j.steps[i] ? icon('check') : i + 1}</span><span class="tx">${esc(s.n)}</span></a>`).join('')}</nav>
    <a class="back side-back" href="/jobs" data-link>${icon('left')}งานทั้งหมด</a>
  </aside>`;
}

function head(k) {
  const s = STEPS[k - 1], done = !!J.job.steps[k - 1], j = J.job;
  return `<div class="sh">
    <div class="crumb">ขั้นตอนที่ ${k} จาก 9 ${done ? pill('ok', 'เสร็จแล้ว') : ''}</div>
    <div class="sh-row"><h1>${words(s.t)}</h1><div class="sh-act">
      ${k > 1 ? `<a class="btn line${k === 9 ? ' solo' : ''}" href="/jobs/${j.id}/${k - 1}" data-link>${icon('left')}ก่อนหน้า</a>` : ''}
      ${closed() ? '' : `<button class="btn ${done ? 'line' : ''}" data-act="o-step" type="button">${done ? icon('refresh') + 'เปิดขั้นนี้ใหม่' : icon('check') + 'ทำขั้นนี้เสร็จแล้ว'}</button>`}
      ${k < 9 ? `<a class="btn line${k === 1 ? ' solo' : ''}" href="/jobs/${j.id}/${k + 1}" data-link>ถัดไป${icon('right')}</a>` : ''}
    </div></div>
    <p class="orig"><b>ขั้นตอนเดิมของบริษัท</b>${words(s.o)}</p>
  </div>`;
}

const sentLine = key => J.job.sent[key] ? `ส่งล่าสุด ${dhm(J.job.sent[key])}` : 'ยังไม่ได้บันทึกว่าส่ง';
const mailCard = (title, kind, sentKey, extra = '') => `<div class="card"><div class="card-h"><h3>${esc(title)}</h3><span class="sub">${sentLine(sentKey)}</span><div class="act">${extra}<button class="btn" data-act="o-copymail" type="button">${icon('copy')}คัดลอกอีเมล</button>${closed() ? '' : `<button class="btn line" data-act="o-sent" data-key="${sentKey}" type="button">${icon('send')}บันทึกว่าส่งแล้ว</button>`}</div></div>
  <div class="card-b"><textarea class="mail" id="mailtext" spellcheck="false">${esc(mail(kind, J.job, J.crew, ctx()))}</textarea><div class="muted s13" style="margin-top:6px">แก้ข้อความได้ก่อนคัดลอก · ระบบไม่ได้ส่งอีเมลเอง ให้วางในอีเมลบริษัทแล้วส่ง</div></div></div>`;
const hint = t => `<div class="hint">${icon('info')}<span>${t}</span></div>`;
const who = c => `<div class="who2">${avatar(c)}<div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.rank || '—')} · ${esc(c.flight || 'ยังไม่มีเที่ยวบิน')}</div></div></div>`;
const noCrew = () => `<div class="card empty"><div class="nm">ยังไม่มีลูกเรือในงานนี้</div><div class="sub">เพิ่มรายชื่อได้ที่ขั้นตอนที่ 1</div><a class="btn" href="/jobs/${J.job.id}/1" data-link style="margin-top:12px">ไปขั้นตอนที่ 1</a></div>`;

function body(k, now) {
  const j = J.job, crew = J.crew, docs = A.settings.docs;
  if (k === 1) {
    const rows = crew.map(c => `<tr class="${missingDocs(c, docs).length ? 'bad' : ''}"><td>${who(c)}</td><td>${typeTag(c)}</td>${docs.map(d => `<td><button class="doc ${c.docs[d] ? 'ok' : 'late'}" data-act="o-doc" data-id="${c.id}" data-doc="${esc(d)}" type="button" ${closed() ? 'disabled' : ''}>${c.docs[d] ? icon('check') + 'ได้รับ' : icon('x') + 'ยังไม่มี'}</button></td>`).join('')}<td>${missingDocs(c, docs).length ? pill('late', 'ขาด ' + missingDocs(c, docs).length) : pill('ok', 'ครบ')}</td><td class="acts">${closed() ? '' : `<button class="iconbtn plain" data-act="o-editcrew" data-id="${c.id}" type="button" title="แก้ไข" aria-label="แก้ไข ${esc(c.name)}">${icon('edit')}</button><button class="iconbtn" data-act="o-delcrew" data-id="${c.id}" type="button" title="ลบ" aria-label="ลบ ${esc(c.name)}">${icon('trash')}</button>`}</td></tr>`).join('');
    const miss = missText(crew, docs);
    return `<div class="stack">
      <div class="card"><div class="card-h"><h3>รายชื่อลูกเรือและเอกสาร</h3><span class="sub">${crew.length} คน</span><div class="act"><button class="btn line sm" data-act="o-copymiss" type="button">${icon('copy')}คัดลอกรายการที่ขาด</button></div></div>
        ${crew.length ? `<div class="scroll"><table class="t"><thead><tr><th>ลูกเรือ</th><th>ประเภท</th>${docs.map(d => `<th>${esc(d)}</th>`).join('')}<th>สรุป</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="card-b muted">ยังไม่มีลูกเรือ เพิ่มจากแบบฟอร์มด้านล่าง</div>'}</div>
      <div class="cols">
        ${closed() ? '' : `<div class="card"><div class="card-h"><h3>เพิ่มลูกเรือในงานนี้</h3></div><div class="card-b"><form class="form" id="addcrew" style="grid-template-columns:1fr 1fr">
          <label class="f" style="grid-column:1 / -1">ชื่อ-นามสกุล<input name="name" required maxlength="120" placeholder="เช่น Kenji Sato"></label>
          <label class="f">ตำแหน่ง<input name="rank" maxlength="40" placeholder="เช่น 2/O"></label>
          <label class="f">ประเภท<select name="type"><option value="on">On signer (ขึ้นเรือ)</option><option value="off">Off signer (ลงเรือ)</option></select></label>
          <label class="f">เที่ยวบิน<input name="flight" maxlength="40" placeholder="เช่น JL 707"></label>
          <label class="f">สัญชาติ<input name="nationality" maxlength="60"></label>
          <label class="f" style="grid-column:1 / -1">เลขพาสปอร์ต<input name="passport" maxlength="40"></label>
          <div class="ferr" role="alert" style="grid-column:1 / -1"></div>
          <button class="btn" type="submit" style="grid-column:1 / -1">${icon('plus')}เพิ่มลูกเรือ</button>
        </form></div></div>`}
        <div class="card"><div class="card-h"><h3>รายการที่ต้องขอเพิ่มจากลูกค้า</h3></div><div class="card-b pre" style="color:${miss ? 'var(--ink2)' : 'var(--green)'}">${esc(miss || (crew.length ? 'เอกสารครบทุกคนแล้ว' : 'ยังไม่มีลูกเรือ'))}</div></div>
      </div>
    </div>`;
  }
  if (k === 2) {
    const hist = J.activity.filter(a => a.kind === 'eta');
    return `<div class="cols">
      <div class="card"><div class="card-h"><h3>ตารางเรือปัจจุบัน</h3><span class="sub">${esc(j.port || '')}</span></div><div class="card-b">
        <div class="kpis kpi3">${[['ETA', j.eta], ['ETB', j.etb], ['ETD', j.etd]].map(([l, v]) => `<div><span>${l}</span><b style="font-size:20px">${v ? hm(v) : '—'}</b><span>${v ? fmtD(v).slice(0, 5) : 'ยังไม่ทราบ'}</span></div>`).join('')}</div>
        ${closed() ? '' : `<form class="form form-t" id="schedf">
          ${['eta', 'etb', 'etd'].map(f => `<label class="f">${f.toUpperCase()}<input type="datetime-local" name="${f}" value="${toInput(j[f])}"></label>`).join('')}
          <label class="f" style="grid-column:1 / -1">แจ้งโดย / แหล่งที่มา<input name="source" maxlength="120" placeholder="เช่น ${esc(j.agent || 'Local agent')} · อีเมล"></label>
          <div class="ferr" role="alert" style="grid-column:1 / -1"></div>
          <button class="btn line" type="submit" style="grid-column:1 / -1">${icon('check')}บันทึกตารางเรือ</button></form>`}
        <div class="row" style="margin-top:12px"><button class="btn" data-act="o-copykind" data-kind="sched" type="button">${icon('copy')}คัดลอกข้อความอัปเดตลูกค้า</button>${closed() ? '' : `<button class="btn line" data-act="o-sent" data-key="sched" type="button">${icon('send')}บันทึกว่าแจ้งแล้ว</button>`}</div>
        <div class="muted s13" style="margin-top:8px">${sentLine('sched')}</div>
      </div></div>
      <div class="card"><div class="card-h"><h3>ประวัติการเปลี่ยนแปลง</h3></div><div class="card-b feed">${hist.length ? hist.map(l => `<div><span class="tm">${hm(l.at)}</span><span>${esc(l.text)}<div class="sub">${esc(l.who || '')} · ${fmtD(l.at).slice(0, 5)}</div></span></div>`).join('') : '<div class="muted">ยังไม่มีการบันทึกตารางเรือ</div>'}</div></div>
    </div>`;
  }
  if (k === 3) {
    const svc = A.settings.services;
    return `<div class="stack"><div class="card"><div class="card-h"><h3>เรื่องที่ได้รับแต่งตั้งจาก Owner</h3></div><div class="card-b"><div class="svc">${svc.map(s => `<button type="button" data-act="o-svc" data-svc="${esc(s)}" aria-pressed="${j.services.includes(s)}" ${closed() ? 'disabled' : ''}>${j.services.includes(s) ? icon('check') : ''}${esc(s)}</button>`).join('')}</div></div></div>
      ${mailCard('ร่างอีเมลแจ้ง Local Agent', 'appoint', 'appoint')}</div>`;
  }
  if (k === 4) {
    const on = crew.filter(c => c.type === 'on');
    const left = j.imm_deadline ? (j.imm_deadline - now) / MIN : null;
    const color = left == null ? 'var(--muted)' : left < 0 ? 'var(--red)' : left < 360 ? 'var(--amber)' : 'var(--green)';
    const rows = on.map(c => {
      const miss = missingDocs(c, A.settings.docs).length > 0;
      const cell = (key, yes, no) => miss && key === 'oktb' && !c.s4.oktb ? pill('gray', 'รอเอกสารครบ') : `<button class="doc ${c.s4[key] ? 'ok' : 'late'}" data-act="o-s4" data-id="${c.id}" data-key="${key}" type="button" ${closed() ? 'disabled' : ''}>${c.s4[key] ? icon('check') + yes : icon('x') + no}</button>`;
      return `<tr class="${!c.s4.imm ? 'warnrow' : ''}"><td><div class="who2">${avatar(c)}<div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.flight || '—')} · ถึง ${c.cps[0] && c.cps[0].plan ? dhm(c.cps[0].plan) : 'ยังไม่มีแผน'}</div></div></div></td><td>${cell('oktb', 'ออกแล้ว', 'ยังไม่ออก')}</td><td>${cell('meet', 'ส่งแล้ว', 'ยังไม่ส่ง')}</td><td>${cell('imm', 'ยื่นแล้ว', 'ยังไม่ยื่น')}</td></tr>`;
    }).join('');
    return `${hint('ลูกเรือที่เอกสารยังไม่ครบ ระบบยังไม่ให้บันทึกว่าออก OKTB · ตัวเอกสาร OKTB ออกตามวิธีเดิมของบริษัท')}<div class="stack">
      <div class="card"><div class="card-h"><h3>OKTB และเอกสาร ตม. สนามบิน</h3><span class="sub">On signer ${on.length} คน</span></div>${on.length ? `<div class="scroll"><table class="t"><thead><tr><th>ลูกเรือ</th><th>OKTB</th><th>Meeting point</th><th>ตม. สนามบิน</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="card-b muted">ยังไม่มี On signer</div>'}</div>
      <div class="card"><div class="card-h"><h3>กำหนดยื่นเอกสาร ตม.</h3></div><div class="card-b">
        <div class="muted s14">${j.imm_deadline ? fmtFull(j.imm_deadline) : 'ยังไม่ได้ตั้งกำหนด'}</div>
        <div class="big-num" style="color:${color}">${left == null ? '—' : left < 0 ? 'เกินกำหนด ' + dur(-left) : 'อีก ' + dur(left)}</div>
        ${left != null ? `<div class="bar" style="margin:12px 0"><i style="width:${Math.max(4, Math.min(100, 100 - left / 7.2))}%;background:${color}"></i></div>` : ''}
        ${closed() ? '' : `<form class="row" id="immf" style="margin-top:10px"><input type="datetime-local" name="imm" value="${toInput(j.imm_deadline)}" aria-label="กำหนดยื่นเอกสาร ตม." style="flex:1;min-width:0"><button class="btn line" type="submit">บันทึก</button></form>`}
        <div class="muted s13" style="margin-top:8px">ระบบเตือนบนแดชบอร์ดล่วงหน้า <span class="nw">6 ชั่วโมง</span> และเมื่อ<span class="nw">เกินเวลา</span></div>
      </div></div>
    </div>`;
  }
  if (k === 5) {
    if (!crew.length) return noCrew();
    const table = list => {
      if (!list.length) return '';
      const n = Math.max(...list.map(c => c.cps.length));
      const rows = Array.from({ length: n }, (_, jx) => `<tr><td>${esc((list.find(c => c.cps[jx]) || {}).cps[jx].name)}</td>${list.map(c => { const x = c.cps[jx]; if (!x) return '<td></td>'; const lt = x.actual != null && x.plan != null && (x.actual - x.plan) / MIN > late(); return `<td>${x.actual != null ? `<b>${dhm(x.actual)}</b>${lt ? ` <span class="pill late" style="margin-left:4px">ช้า ${Math.round((x.actual - x.plan) / MIN)} น.</span>` : ''}` : `<span class="sub">${planCell(c, jx, late())}</span>`}</td>`; }).join('')}</tr>`).join('');
      return `<div class="scroll"><table class="t nw"><thead><tr><th>จุด</th>${list.map(c => `<th><button class="linkbtn" type="button" data-act="o-plan" data-id="${c.id}" ${closed() ? 'disabled' : ''}>${esc(c.name.split(' ')[0])}${closed() ? '' : icon('edit')}</button></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    };
    const on = crew.filter(c => c.type === 'on'), off = crew.filter(c => c.type === 'off');
    const firstOn = on.map(c => c.cps[0] && c.cps[0].plan).filter(Boolean);
    const lastOff = off.map(c => c.cps.length && c.cps[c.cps.length - 1].plan).filter(Boolean);
    const noplan = crew.filter(c => c.cps.some(x => x.plan == null));
    return `${hint('กดชื่อลูกเรือที่หัวตารางเพื่อใส่ / แก้เวลาตามแผน · เวลาจริงมาจากพนักงานที่กดยืนยันในมือถือ')}<div class="stack">
      ${noplan.length ? `<div class="card card-b warnbox">${icon('alert')}<span>ยังไม่ได้ใส่เวลาตามแผน: ${noplan.map(c => `<button class="linkbtn" type="button" data-act="o-plan" data-id="${c.id}">${esc(c.name)}</button>`).join(', ')}</span></div>` : ''}
      ${on.length ? `<div class="card"><div class="card-h"><h3>แผนเทียบเวลาจริง</h3><span class="sub">On signer</span></div>${table(on)}</div>` : ''}
      ${off.length ? `<div class="card"><div class="card-h"><h3>แผนเทียบเวลาจริง</h3><span class="sub">Off signer</span></div>${table(off)}</div>` : ''}
      <div class="card kpis kpi2"><div><span>On signer เครื่องลงคนแรก</span><b style="font-size:20px">${firstOn.length ? fmtD(Math.min(...firstOn)) : '—'}</b></div><div><span>Off signer บินกลับคนสุดท้าย</span><b style="font-size:20px">${lastOff.length ? fmtD(Math.max(...lastOff)) : '—'}</b></div></div>
      ${mailCard('ร่างอีเมลแผนส่ง Owner / กัปตัน', 'plan', 'plan')}
    </div>`;
  }
  if (k === 6) {
    const agents = crew.filter(c => c.agent_id).length, vans = crew.filter(c => c.vehicle_id).length;
    return `${crew.length && (agents < crew.length || vans < crew.length) ? hint(`ลูกเรือบางคนยังไม่มีผู้ดูแลหรือรถ รายชื่อในอีเมลจะไม่ครบ · จัดได้ที่ <a href="/jobs/${j.id}/7" data-link>ขั้นตอนที่ 7</a>`) : ''}${mailCard('ร่างอีเมล GATE PERMISSION', 'gate', 'gate')}`;
  }
  if (k === 7) {
    if (!crew.length) return noCrew();
    const veh = A.vehicles.filter(v => v.active || crew.some(c => c.vehicle_id === v.id));
    const hot = A.hotels.filter(h => h.active || crew.some(c => c.hotel_id === h.id));
    const agents = A.users.filter(u => u.role === 'field' && (u.active || crew.some(c => c.agent_id === u.id)));
    const dis = closed() ? 'disabled' : '';
    const rows = crew.map(c => { const bad = !c.hotel_id || !c.vehicle_id || !c.agent_id; return `<tr class="${bad ? 'warnrow' : ''}"><td><div class="who2">${avatar(c)}<div><div class="nm">${esc(c.name)}</div><div class="sub">${c.type === 'on' ? 'On signer' : 'Off signer'}</div></div></div></td>
      <td><select data-chg="o-set" data-id="${c.id}" data-f="vehicle_id" aria-label="รถ" ${dis}><option value="">ยังไม่จัดรถ</option>${veh.map(v => `<option value="${v.id}" ${c.vehicle_id === v.id ? 'selected' : ''}>${esc(v.name + (v.driver ? ' (' + v.driver + ')' : ''))}</option>`).join('')}</select></td>
      <td><select data-chg="o-set" data-id="${c.id}" data-f="hotel_id" aria-label="โรงแรม" ${dis}><option value="">ยังไม่จอง</option>${hot.map(h => `<option value="${h.id}" ${c.hotel_id === h.id ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></td>
      <td><input type="text" data-chg="o-set" data-id="${c.id}" data-f="room" value="${esc(c.room)}" size="4" maxlength="20" placeholder="ห้อง" aria-label="เลขห้อง" ${dis}></td>
      <td><select data-chg="o-set" data-id="${c.id}" data-f="agent_id" aria-label="ผู้ดูแล" ${dis}><option value="">ยังไม่มอบหมาย</option>${agents.map(u => `<option value="${u.id}" ${c.agent_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></td>
      <td>${bad ? pill('warn-c', 'ยังไม่ครบ') : pill('ok', 'ครบ')}</td></tr>`; }).join('');
    return `${hint('เลือกแล้วบันทึกทันที · ลูกเรือจะไปขึ้นในมือถือของพนักงานผู้ดูแลคนนั้น')}<div class="stack"><div class="card"><div class="card-h"><h3>รถ คนขับ โรงแรม และผู้ดูแล</h3>${closed() ? '' : `<div class="act"><button class="btn line sm" data-act="o-addres" data-kind="vehicles" type="button">${icon('plus')}เพิ่มรถ</button><button class="btn line sm" data-act="o-addres" data-kind="hotels" type="button">${icon('plus')}เพิ่มโรงแรม</button></div>`}</div><div class="scroll"><table class="t nw tight"><thead><tr><th>ลูกเรือ</th><th>รถ / คนขับ</th><th>โรงแรม</th><th>ห้อง</th><th>ผู้ดูแล (มือถือ)</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      ${agents.length ? '' : `<div class="card card-b warnbox">${icon('alert')}<span>ยังไม่มีบัญชีพนักงานภาคสนาม ${A.isAdmin() ? '<a href="/admin/users" data-link>เพิ่มผู้ใช้</a>' : 'แจ้งผู้ดูแลระบบให้เพิ่มผู้ใช้'}</span></div>`}</div>`;
  }
  if (k === 8) {
    const sts = crew.map(c => status(c, now, late()));
    const moving = crew.filter(c => nextIdx(c) > 0).length;
    const nLate = sts.filter(s => s.k === 'late').length, soon = sts.filter(s => s.k === 'soon').length;
    const prep = prepItems(j, crew, now, ctx());
    const rows = crew.map((c, i) => {
      const st = sts[i], n = nextIdx(c);
      const ex = A.ui.expand === c.id ? `<tr><td colspan="4" class="exp"><div class="mini">${c.cps.map((x, jx) => `<div class="${x.actual != null ? 'done' : ''}"><b>${esc(x.name)}</b><br><span class="sub">แผน ${dhm(x.plan)} · จริง ${dhm(x.actual)}</span></div>`).join('')}</div>${c.notes.length ? `<div class="s14" style="margin-top:8px">${c.notes.map(x => `<div><span class="muted">${hm(x.at)}</span> ${esc(x.text)}</div>`).join('')}</div>` : ''}${c.photos.length ? `<div class="pgrid pg6" style="margin-top:8px">${c.photos.map(p => `<button type="button" data-act="o-photo" data-src="/api/photos/${p.id}" data-cap="${esc(c.name + ' · ' + p.point + ' · ' + fmtD(p.at))}"><img src="/api/photos/${p.id}" alt="" loading="lazy"><span>${esc(p.point)} ${hm(p.at)}</span></button>`).join('')}</div>` : ''}</td></tr>` : '';
      const u = A.user(c.agent_id);
      return `<tr class="click ${st.k === 'late' ? 'bad' : ''}" data-act="o-expand" data-id="${c.id}"><td><div class="who2">${avatar(c)}<div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.rank || '—')} · ดูแลโดย ${esc(u ? u.name : '-')}</div></div></div></td><td>${esc(current(c))}<div class="sub">${lastTime(c) ? hm(lastTime(c)) : '—'}</div></td><td>${n === -1 ? '—' : esc(c.cps[n].name) + '<div class="sub">' + planCell(c, n, late()) + '</div>'}</td><td>${pill(st.cls, st.label)}</td></tr>${ex}`;
    }).join('');
    const link = `${location.origin}/t/${j.owner_token}`;
    const tpl = A.ui.tpl || 'night';
    return `<div class="card kpis"><div><span>ลูกเรือในงานนี้</span><b>${crew.length}</b></div><div><span>กำลังเดินทาง</span><b>${moving}</b></div><div><span>ช้ากว่าแผน</span><b style="color:${nLate ? 'var(--red)' : 'var(--ink)'}">${nLate}</b></div><div><span>เตรียมภายใน 1 ชม.</span><b style="color:${soon ? 'var(--amber)' : 'var(--ink)'}">${soon}</b></div></div>
    ${crew.length ? `<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>สถานะลูกเรือ</h3>${pill('ok', 'อัปเดต ' + hm(J.now))}<span class="sub">กดแถวเพื่อดูรายละเอียด รูป และหมายเหตุ</span></div><div class="scroll"><table class="t nw"><thead><tr><th>ลูกเรือ</th><th>จุดล่าสุด</th><th>จุดถัดไป</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table></div></div>` : noCrew()}
    <div class="cols"><div class="stack">
      <div class="card"><div class="card-h"><h3>ต้องเตรียมตอนนี้</h3><span class="sub">${prep.length} รายการ</span></div><div class="card-b tight-y">${prep.length ? prep.map(p => `<div class="prep">${pill(p.cls, p.tag)}<span>${glue(p.text)}</span></div>`).join('') : '<div class="muted pad-y">ยังไม่มีอะไรต้องเตรียม</div>'}</div></div>
      <div class="card"><div class="card-h"><h3>อีเมลอัปเดต Owner</h3><span class="sub">${sentLine('owner')}</span><div class="act"><select data-chg="o-tpl" aria-label="เลือกข้อความ"><option value="night" ${tpl === 'night' ? 'selected' : ''}>สรุปแผนคืนนี้</option><option value="morning" ${tpl === 'morning' ? 'selected' : ''}>สรุปผลเช้านี้</option><option value="update" ${tpl === 'update' ? 'selected' : ''}>อัปเดตสถานะตอนนี้</option></select><button class="btn" data-act="o-copymail" type="button">${icon('copy')}คัดลอก</button>${closed() ? '' : `<button class="btn line" data-act="o-sent" data-key="owner" type="button">${icon('send')}บันทึกว่าส่งแล้ว</button>`}</div></div>
        <div class="card-b"><textarea class="mail" id="mailtext" spellcheck="false" style="min-height:240px">${esc(mail(tpl, j, crew, ctx()))}</textarea></div></div>
    </div><div class="stack">
      <div class="card"><div class="card-h"><h3>ลิงก์ติดตามสำหรับ Owner</h3></div><div class="card-b">
        <div class="linkbox"><code>${esc(link)}</code></div>
        <div class="row" style="margin-top:10px"><button class="btn" data-act="o-copylink" data-link="${esc(link)}" type="button">${icon('copy')}คัดลอกลิงก์</button><a class="btn line" href="${esc(link)}" target="_blank" rel="noopener">${icon('eye')}เปิดดู</a>${closed() ? '' : `<button class="btn line" data-act="o-newtoken" type="button">${icon('refresh')}สร้างลิงก์ใหม่</button>`}</div>
        <div class="muted s13" style="margin-top:8px">Owner เปิดดูได้อย่างเดียว ไม่ต้องสมัครบัญชี ไม่เห็นเลขพาสปอร์ต หมายเหตุ และรูป · กด "สร้างลิงก์ใหม่" ลิงก์เดิมจะใช้ไม่ได้ทันที</div>
      </div></div>
      <div class="card"><div class="card-h"><h3>ความเคลื่อนไหวล่าสุด</h3></div><div class="card-b feed tight-y">${J.activity.slice(0, 25).map(l => `<div><span class="tm">${hm(l.at)}</span><span>${esc(l.text)}<div class="sub">${esc(l.who || '')}${J.now - l.at > 20 * 3600000 ? ' · ' + fmtD(l.at).slice(0, 5) : ''}</div></span></div>`).join('') || '<div class="muted">ยังไม่มีความเคลื่อนไหว</div>'}</div></div>
    </div></div>`;
  }
  if (k === 9) {
    const on = crew.filter(c => c.type === 'on').length, off = crew.length - on;
    const vans = new Set(crew.map(c => c.vehicle_id).filter(Boolean)).size;
    const rooms = crew.filter(c => c.hotel_id).length;
    const nLate = crew.reduce((a, c) => a + c.cps.filter(x => x.actual != null && x.plan != null && (x.actual - x.plan) / MIN > late()).length, 0);
    const pending = crew.filter(c => nextIdx(c) !== -1).length;
    const rows = crew.map(c => c.cps.map((x, jx) => `<tr><td>${jx === 0 ? `<div class="who2">${avatar(c)}<div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.rank || '—')}</div></div></div>` : ''}</td><td>${esc(x.name)}</td><td>${dhm(x.plan)}</td><td>${dhm(x.actual)}</td><td>${x.actual != null && x.plan != null ? (() => { const d = Math.round((x.actual - x.plan) / MIN); return d > late() ? pill('late', 'ช้า ' + d + ' นาที') : pill('ok', 'ตามแผน'); })() : ''}</td></tr>`).join('')).join('');
    return `<div class="stack">
      <div class="card kpis"><div><span>ลูกเรือ (On ${on} / Off ${off})</span><b>${crew.length}</b></div><div><span>รถที่ใช้</span><b>${vans}</b></div><div><span>ห้องพัก</span><b>${rooms}</b></div><div><span>จุดที่ช้ากว่าแผน</span><b>${nLate}</b></div></div>
      ${pending && !closed() ? `<div class="card card-b warnbox">${icon('alert')}<span>ลูกเรือ ${pending} คนยังไม่ครบทุกจุด ตรวจก่อนปิดงาน</span></div>` : ''}
      <div class="card"><div class="card-h"><h3>Time log · ${esc(j.vessel)}</h3><div class="act"><a class="btn" href="/api/jobs/${j.id}/export.xlsx" download>${icon('download')}ดาวน์โหลด Excel</a><a class="btn line" href="/jobs/${j.id}/report" target="_blank" rel="noopener">${icon('print')}พิมพ์ / บันทึก PDF</a></div></div>
        ${crew.length ? `<div class="scroll"><table class="t nw"><thead><tr><th>ลูกเรือ</th><th>จุด</th><th>แผน</th><th>เวลาจริง</th><th>ผล</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="card-b muted">ยังไม่มีลูกเรือ</div>'}</div>
      <div class="card"><div class="card-h"><h3>${closed() ? 'งานนี้ปิดแล้ว' : 'ปิดงาน'}</h3></div><div class="card-b">
        <div class="muted s14" style="margin-bottom:12px">${closed() ? `ปิดงานเมื่อ ${fmtFull(j.closed_at)} · ข้อมูลทั้งหมดยังดูและดาวน์โหลดได้ตลอด` : 'ปิดงานเมื่อส่งสรุปให้ฝ่ายบัญชีแล้ว งานจะย้ายไปแท็บ "ปิดแล้ว" และพนักงานภาคสนามจะไม่เห็นลูกเรือของงานนี้อีก'}</div>
        <div class="row">${closed() ? `<button class="btn line" data-act="o-reopen" type="button">${icon('refresh')}เปิดงานอีกครั้ง</button>` : `<button class="btn" data-act="o-close" type="button">${icon('check')}ปิดงาน</button>`}${A.isAdmin() ? `<button class="btn line danger" data-act="o-deljob" type="button">${icon('trash')}ลบงานนี้ถาวร</button>` : ''}</div>
      </div></div>
    </div>`;
  }
  return '';
}

/* ---------- plan editor ---------- */
function planDialog(c) {
  const tpl = c.type === 'on' ? A.settings.cp_on : A.settings.cp_off;
  openDialog(`<form class="dlg-form wide">${dlgHead('เวลาตามแผน · ' + c.name)}
    <div class="dlg-b"><p class="muted s14" style="margin-top:0">เวลาไทย · ใส่เวลาจุดแรกแล้วกด "เติมเวลาที่เหลือ" ระบบคำนวณตามระยะเวลามาตรฐาน แล้วแก้ทีละจุดได้</p>
    <div class="planrows">${c.cps.map((x, i) => `<label class="f pr"><span><b>${i + 1}.</b> ${esc(x.name)}${x.actual != null ? ` <span class="pill ok">จริง ${dhm(x.actual)}</span>` : ''}</span><input type="datetime-local" name="p${i}" value="${toInput(x.plan)}"></label>`).join('')}</div>
    <button class="btn line sm" type="button" id="autofill">${icon('clock')}เติมเวลาที่เหลือจากจุดก่อนหน้า</button></div>
    ${dlgFoot('บันทึกแผน')}</form>`, async fd => {
    const plans = c.cps.map((x, i) => fromInput(fd.get('p' + i)));
    await api('PUT', `/api/crew/${c.id}/plan`, { plans });
    await refresh('บันทึกแผนเวลาแล้ว');
  });
  document.getElementById('autofill').addEventListener('click', () => {
    const inputs = [...document.querySelectorAll('.planrows input')];
    let t = null;
    inputs.forEach((inp, i) => {
      const v = fromInput(inp.value);
      if (v != null) { t = v; return; }
      if (t != null) { t += (tpl[i] && tpl[i].th === c.cps[i].name ? tpl[i].gap : 30) * MIN; inp.value = toInput(t); }
    });
    if (t == null) toast('ใส่เวลาจุดแรกก่อน');
  });
}

function crewDialog(c) {
  openDialog(`<form class="dlg-form">${dlgHead('แก้ไขข้อมูลลูกเรือ')}<div class="dlg-b form" style="grid-template-columns:1fr 1fr">
    <label class="f" style="grid-column:1 / -1">ชื่อ-นามสกุล<input name="name" required maxlength="120" value="${esc(c.name)}"></label>
    <label class="f">ตำแหน่ง<input name="rank" maxlength="40" value="${esc(c.rank)}"></label>
    <label class="f">ประเภท<select name="type" ${c.cps.some(x => x.actual != null) ? 'disabled' : ''}><option value="on" ${c.type === 'on' ? 'selected' : ''}>On signer</option><option value="off" ${c.type === 'off' ? 'selected' : ''}>Off signer</option></select></label>
    <label class="f">เที่ยวบิน<input name="flight" maxlength="40" value="${esc(c.flight)}"></label>
    <label class="f">สัญชาติ<input name="nationality" maxlength="60" value="${esc(c.nationality)}"></label>
    <label class="f" style="grid-column:1 / -1">เลขพาสปอร์ต<input name="passport" maxlength="40" value="${esc(c.passport)}"></label>
    ${c.type === 'on' || c.type === 'off' ? `<p class="muted s13" style="grid-column:1 / -1;margin:0">${c.cps.some(x => x.actual != null) ? 'เริ่มบันทึกเวลาแล้ว เปลี่ยนประเภทไม่ได้' : 'เปลี่ยนประเภทแล้ว จุดสถานะและแผนเวลาจะเริ่มใหม่'}</p>` : ''}
    </div>${dlgFoot()}</form>`, async fd => {
    const b = Object.fromEntries(['name', 'rank', 'flight', 'nationality', 'passport'].map(k => [k, fd.get(k)]));
    if (fd.get('type')) b.type = fd.get('type');
    await api('PATCH', `/api/crew/${c.id}`, b);
    await refresh('บันทึกแล้ว');
  });
}

const findCrew = id => J.crew.find(c => c.id === +id);
const patchJob = async (b, msg) => { await api('PATCH', `/api/jobs/${J.job.id}`, b); await refresh(msg); };

export const actions = {
  async 'o-step'() {
    const k = A.route.params.step;
    const steps = J.job.steps.slice();
    steps[k - 1] = steps[k - 1] ? 0 : 1;
    await patchJob({ steps }, steps[k - 1] ? `ขั้นตอนที่ ${k} เสร็จแล้ว` : `เปิดขั้นตอนที่ ${k} ใหม่`);
  },
  'o-editjob'() {
    openDialog(`<form class="dlg-form wide">${dlgHead('แก้ไขข้อมูลงาน')}<div class="dlg-b">${jobForm(J.job)}</div>${dlgFoot()}</form>`, async fd => {
      await patchJob(readJobForm(fd), 'บันทึกข้อมูลงานแล้ว');
    });
  },
  async 'o-doc'(t) {
    const c = findCrew(t.dataset.id);
    const docs = { ...c.docs, [t.dataset.doc]: c.docs[t.dataset.doc] ? 0 : 1 };
    await api('PATCH', `/api/crew/${c.id}`, { docs });
    await refresh();
  },
  async 'o-s4'(t) {
    const c = findCrew(t.dataset.id);
    const s4 = { ...c.s4, [t.dataset.key]: !c.s4[t.dataset.key] };
    await api('PATCH', `/api/crew/${c.id}`, { s4 });
    await refresh();
  },
  'o-editcrew'(t) { crewDialog(findCrew(t.dataset.id)); },
  'o-delcrew'(t) {
    const c = findCrew(t.dataset.id);
    openDialog(`<form class="dlg-form">${dlgHead('ลบลูกเรือ')}<div class="dlg-b"><p>ลบ <b>${esc(c.name)}</b> ออกจากงานนี้? เวลา หมายเหตุ และรูปของลูกเรือคนนี้จะถูกลบด้วย</p></div>${dlgFoot('ลบลูกเรือ')}</form>`, async () => {
      await api('DELETE', `/api/crew/${c.id}`);
      await refresh('ลบลูกเรือแล้ว');
    });
  },
  'o-copymiss'() { const m = missText(J.crew, A.settings.docs); if (!m) return toast('เอกสารครบทุกคนแล้ว ไม่มีรายการที่ขาด'); copy(m, 'คัดลอกรายการที่ขาด'); },
  'o-copymail'() { copy(document.getElementById('mailtext').value, 'คัดลอกอีเมล'); },
  'o-copykind'(t) { copy(mail(t.dataset.kind, J.job, J.crew, ctx()), 'คัดลอกข้อความ'); },
  async 'o-sent'(t) { A.ui.mailEdited = false; await patchJob({ sent: { [t.dataset.key]: true } }, 'บันทึกว่าส่งแล้ว'); },
  async 'o-svc'(t) {
    const s = t.dataset.svc, L = J.job.services;
    A.ui.mailEdited = false;
    await patchJob({ services: L.includes(s) ? L.filter(x => x !== s) : L.concat(s) });
  },
  'o-plan'(t) { if (!closed()) planDialog(findCrew(t.dataset.id)); },
  'o-expand'(t, e) { if (e.target.closest('[data-act="o-photo"]')) return; A.ui.expand = A.ui.expand === +t.dataset.id ? null : +t.dataset.id; render(true); },
  'o-photo'(t) { openLb(t.dataset.src, t.dataset.cap); },
  'o-copylink'(t) { copy(t.dataset.link, 'คัดลอกลิงก์'); },
  'o-newtoken'() {
    openDialog(`<form class="dlg-form">${dlgHead('สร้างลิงก์ Owner ใหม่')}<div class="dlg-b"><p>ลิงก์เดิมที่ส่งให้ Owner ไปแล้วจะเปิดไม่ได้ทันที ต้องส่งลิงก์ใหม่ให้ Owner อีกครั้ง</p></div>${dlgFoot('สร้างลิงก์ใหม่')}</form>`, async () => {
      await api('POST', `/api/jobs/${J.job.id}/token`);
      await refresh('สร้างลิงก์ใหม่แล้ว');
    });
  },
  'o-addres'(t) {
    const veh = t.dataset.kind === 'vehicles';
    openDialog(`<form class="dlg-form">${dlgHead(veh ? 'เพิ่มรถ' : 'เพิ่มโรงแรม')}<div class="dlg-b form" style="grid-template-columns:1fr 1fr">${veh
      ? `<label class="f">ชื่อรถ<input name="name" required maxlength="60" placeholder="เช่น รถตู้ 1"></label><label class="f">ทะเบียน<input name="plate" maxlength="30"></label><label class="f">คนขับ<input name="driver" maxlength="80" placeholder="เช่น คุณประเสริฐ"></label><label class="f">ชื่อคนขับ (อังกฤษ)<input name="driver_en" maxlength="80"></label><label class="f">เลขบัตรคนขับ<input name="driver_id" maxlength="30"></label><label class="f">เบอร์โทร<input name="driver_phone" maxlength="30" inputmode="tel"></label>`
      : `<label class="f" style="grid-column:1 / -1">ชื่อโรงแรม<input name="name" required maxlength="120"></label><label class="f" style="grid-column:1 / -1">เบอร์โทร<input name="phone" maxlength="30" inputmode="tel"></label>`}</div>${dlgFoot('เพิ่ม')}</form>`, async fd => {
      await api('POST', `/api/${t.dataset.kind}`, Object.fromEntries(fd));
      const { reloadRefs } = await import('../app.js');
      await reloadRefs();
      render(true);
      toast('เพิ่มแล้ว เลือกได้ในตารางทันที');
    });
  },
  async 'o-close'() {
    const pending = J.crew.filter(c => nextIdx(c) !== -1).length;
    openDialog(`<form class="dlg-form">${dlgHead('ปิดงาน ' + J.job.vessel)}<div class="dlg-b"><p>${pending ? `ยังมีลูกเรือ ${pending} คนที่ยังไม่ครบทุกจุด ` : ''}ปิดงานแล้วจะแก้ไขไม่ได้ จนกว่าจะเปิดงานอีกครั้ง</p></div>${dlgFoot('ปิดงาน')}</form>`, async () => {
      const steps = J.job.steps.slice(); steps[8] = 1;
      await patchJob({ status: 'closed', steps }, 'ปิดงานแล้ว');
    });
  },
  async 'o-reopen'() { await patchJob({ status: 'open' }, 'เปิดงานอีกครั้งแล้ว'); },
  'o-deljob'() {
    openDialog(`<form class="dlg-form">${dlgHead('ลบงานถาวร')}<div class="dlg-b"><p>ลบงาน <b>${esc(J.job.vessel)}</b> พร้อมลูกเรือ เวลา และรูปทั้งหมด กู้คืนไม่ได้ (ข้อมูลที่อยู่ในไฟล์สำรองรายเดือนยังอยู่)</p><label class="f">พิมพ์ชื่อเรือเพื่อยืนยัน<input name="confirm" required autocomplete="off"></label></div>${dlgFoot('ลบถาวร')}</form>`, async fd => {
      if (String(fd.get('confirm')).trim().toUpperCase() !== J.job.vessel) throw new Error('ชื่อเรือไม่ตรง');
      await api('DELETE', `/api/jobs/${J.job.id}`);
      J = null;
      go('/jobs', true);
      toast('ลบงานแล้ว');
    });
  }
};

export const changes = {
  async 'o-set'(t) {
    const f = t.dataset.f;
    const v = f === 'room' ? t.value.trim() : t.value ? +t.value : null;
    await api('PATCH', `/api/crew/${t.dataset.id}`, { [f]: v });
    await refresh(f === 'agent_id' ? (v ? 'มอบหมายแล้ว ลูกเรือขึ้นในมือถือของผู้ดูแลทันที' : 'ยกเลิกการมอบหมายแล้ว') : 'บันทึกแล้ว');
  },
  'o-tpl'(t) { A.ui.tpl = t.value; A.ui.mailEdited = false; render(true); }
};

document.addEventListener('submit', async e => {
  const f = e.target;
  if (!['addcrew', 'schedf', 'immf'].includes(f.id)) return;
  e.preventDefault();
  const fd = new FormData(f);
  const err = f.querySelector('.ferr');
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    if (f.id === 'addcrew') {
      await api('POST', `/api/jobs/${J.job.id}/crew`, { crew: [Object.fromEntries(fd)] });
      await refresh(`เพิ่ม ${fd.get('name')} แล้ว`);
      const n = document.querySelector('#addcrew [name=name]');
      if (n) n.focus();
    } else if (f.id === 'schedf') {
      await patchJob({ eta: fromInput(fd.get('eta')), etb: fromInput(fd.get('etb')), etd: fromInput(fd.get('etd')), source: fd.get('source') }, 'บันทึกตารางเรือแล้ว');
    } else {
      await patchJob({ imm_deadline: fromInput(fd.get('imm')) }, 'บันทึกกำหนดยื่นแล้ว');
    }
  } catch (x) {
    if (err) err.textContent = x.message; else toast(x.message);
  } finally { btn.disabled = false; }
});
