import { render } from './core.js';

const DPI = 200;
const mm = v => v * DPI / 25.4;
const pt = v => v * DPI / 72;
const PW = Math.round(mm(210)), PH = Math.round(mm(297));
const A4 = [595.28, 841.89];
const EDGE = 10 * 72 / 25.4;
const FONT = '"IBM Plex Sans Thai","Leelawadee UI",system-ui,sans-serif';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HEAD = ['No.', 'Name', 'Rank', 'Nationality', 'Passport no.', 'EXPIRY DATE', 'SIRB NO.', 'EXPIRY DATE'];
const LEVELS = [{ f: 10.5, lh: 1.5, gap: 1 }, { f: 10.5, lh: 1.42, gap: 0.78 }, { f: 10, lh: 1.36, gap: 0.6 }, { f: 9.5, lh: 1.32, gap: 0.48 }];

const dateParts = s => /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
export const longDate = s => { const m = dateParts(s); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : ''; };
export const shortDate = s => { const m = dateParts(s); return m ? `${m[3]}-${MONTHS[+m[2] - 1].slice(0, 3)}-${m[1].slice(2)}` : ''; };
export const packName = (vessel, date) => `OKTB_${String(vessel || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'VESSEL'}_${String(date || '').replace(/-/g, '')}.pdf`;

export function letterData(job, crew, tpl, o) {
  const vars = { company: o.company || '-', vessel: job.vessel, port: job.port || '-', call_date: longDate(o.call_date) || '-' };
  return {
    rows: [['Date', longDate(o.date)], ['To', o.to || ''], ['Subject', tpl.subject || '']],
    intro: render(tpl.intro, vars),
    guarantee: render(tpl.guarantee, vars),
    crew: crew.map((c, i) => [String(i + 1), c.name, c.rank, c.nationality, c.passport, shortDate(c.passport_exp), c.sirb_no, shortDate(c.sirb_exp)]),
    flights: String(o.flights || '').split('\n').map(s => s.trim()).filter(Boolean),
    pic: [['P.I.C', o.pic_name], ['Mobile', o.pic_mobile]].filter(r => r[1]),
    closing: [tpl.signer_name, tpl.signer_title, tpl.footer].filter(Boolean)
  };
}

export function packFiles(crew) {
  const of = (c, kind) => (c.files || []).filter(f => f.kind === kind).map(f => ({ ...f, crew: c.name }));
  return [...crew.flatMap(c => [...of(c, 'passport'), ...of(c, 'sirb')]), ...crew.flatMap(c => of(c, 'ticket')), ...crew.flatMap(c => of(c, 'other'))];
}

const seg = (granularity, s) => typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter('th', { granularity }).segment(s)].map(x => x.segment) : granularity === 'word' ? [s] : Array.from(s);

function chunks(m, s, max) {
  const out = [];
  let cur = '';
  for (const ch of seg('grapheme', s)) {
    if (cur && m(cur + ch) > max) { out.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function wrap(m, s, max, indent = 0) {
  const sp = m(' '), lines = [];
  let cur = [], w = 0, lim = max - indent;
  const put = (t, glue) => {
    const tw = m(t), gap = cur.length && !glue ? sp : 0;
    if (cur.length && w + gap + tw > lim) { lines.push({ parts: cur, w }); cur = []; w = 0; lim = max; }
    cur.push({ t, tw, glue: glue && cur.length > 0 });
    w += (cur.length > 1 ? gap : 0) + tw;
  };
  for (const word of String(s == null ? '' : s).split(/\s+/).filter(Boolean)) {
    if (m(word) <= max - indent) { put(word, false); continue; }
    seg('word', word).flatMap(p => m(p) > max - indent ? chunks(m, p, max - indent) : [p]).forEach((p, i) => put(p, i > 0));
  }
  if (cur.length) lines.push({ parts: cur, w });
  return lines;
}

function draw(L, img, lv) {
  const pages = [];
  const M = document.createElement('canvas').getContext('2d');
  const ML = Math.round(mm(22)), CW = PW - ML * 2, MB = mm(13);
  const F = lv.f, GAP = mm(4.2) * lv.gap;
  const lineH = size => Math.round(pt(size) * lv.lh);
  const LH = lineH(F);
  const fontOf = (size, bold) => `${bold ? 700 : 400} ${pt(size)}px ${FONT}`;
  const width = (s, size, bold) => { M.font = fontOf(size, bold); return M.measureText(s).width; };
  let g, y;
  const page = () => {
    const cv = document.createElement('canvas');
    cv.width = PW; cv.height = PH;
    g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, PW, PH);
    g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = 2; g.textBaseline = 'alphabetic'; g.imageSmoothingQuality = 'high';
    pages.push(cv);
    y = mm(pages.length === 1 && img.letterhead ? 9 : 20);
  };
  const room = h => { if (y + h > PH - MB) page(); };
  const base = (top, h, size) => top + h / 2 + pt(size) * 0.36;
  const line = (ln, x, top, h, size, bold, justify) => {
    g.font = fontOf(size, bold);
    const sp = width(' ', size, bold), gaps = ln.parts.filter((p, i) => i && !p.glue).length;
    let extra = justify != null && gaps ? (justify - ln.w) / gaps : 0;
    if (extra < 0 || extra > sp * 2.5) extra = 0;
    ln.parts.forEach((p, i) => { if (i && !p.glue) x += sp + extra; g.fillText(p.t, x, base(top, h, size)); x += p.tw; });
  };
  const para = (s, o = {}) => {
    const size = o.size || F, bold = !!o.bold, x = o.x == null ? ML : o.x, w = o.w || CW, indent = o.indent || 0, h = lineH(size);
    const lines = wrap(t => width(t, size, bold), s, w, indent);
    lines.forEach((ln, i) => {
      if (i || !o.same) room(h);
      line(ln, x + (i ? 0 : indent), y, h, size, bold, o.justify && i < lines.length - 1 ? w - (i ? 0 : indent) : null);
      y += h;
    });
    return lines.length;
  };
  const heading = (s, size, center) => {
    const w = width(s, size, true), h = lineH(size);
    room(h);
    const x = center ? ML + (CW - w) / 2 : ML;
    g.font = fontOf(size, true);
    g.fillText(s, x, base(y, h, size));
    g.fillRect(x, Math.round(base(y, h, size) + pt(size) * 0.16), w, Math.max(2, Math.round(pt(size) * 0.07)));
    return w;
  };
  const labels = (rows, bold) => {
    const lw = Math.max(...rows.map(r => width(r[0], F, bold))) + mm(2), x2 = ML + lw + width(':', F, bold) + mm(2.5);
    for (const [l, v] of rows) {
      room(LH);
      g.font = fontOf(F, bold);
      g.fillText(l, ML, base(y, LH, F));
      g.fillText(':', ML + lw, base(y, LH, F));
      if (!para(v, { bold, x: x2, w: CW - (x2 - ML), same: true })) y += LH;
    }
  };
  const block = s => {
    let first = true;
    for (const p of String(s || '').split('\n')) {
      if (!p.trim()) { y += GAP * 0.7; continue; }
      para(p.trim(), { indent: first ? mm(12) : 0, justify: true });
      first = false;
    }
  };
  const table = rows => {
    let size = Math.min(F, 9.5), pad, w;
    for (;; size -= 0.25) {
      pad = pt(size) * 0.5;
      const nat = HEAD.map((h, i) => Math.max(width(h, size, true), ...rows.map(r => width(r[i] || '', size, false))) + pad * 2 + 2);
      const sum = nat.reduce((a, b) => a + b, 0);
      if (sum <= CW) { w = nat.map(v => v + (CW - sum) * v / sum); break; }
      if (size <= 7) {
        const name = Math.max(CW * 0.2, CW - (sum - nat[1])), f = Math.min(1, (CW - name) / (sum - nat[1]));
        w = nat.map((v, i) => i === 1 ? name : v * f);
        break;
      }
    }
    const xs = w.reduce((a, v) => a.concat(a[a.length - 1] + v), [ML]).map(Math.round);
    xs[xs.length - 1] = ML + CW;
    const th = Math.round(pt(size) * 1.38), vp = Math.round(pt(size) * 0.42);
    const measure = (cells, bold) => {
      const lines = cells.map((s, i) => wrap(t => width(t, size, bold), s || '', xs[i + 1] - xs[i] - pad * 2));
      return { lines, bold, h: Math.max(1, ...lines.map(l => l.length)) * th + vp * 2 };
    };
    const paint = r => {
      const top = Math.round(y);
      r.lines.forEach((ls, i) => {
        const cw = xs[i + 1] - xs[i];
        g.strokeRect(xs[i], top, cw, r.h);
        ls.forEach((ln, k) => line(ln, i === 1 && !r.bold ? xs[i] + pad : xs[i] + (cw - ln.w) / 2, top + (r.h - ls.length * th) / 2 + k * th, th, size, r.bold));
      });
      y = top + r.h;
    };
    const hd = measure(HEAD, true), body = rows.map(r => measure(r, false));
    room(hd.h + (body[0] ? body[0].h : 0));
    paint(hd);
    for (const r of body) {
      if (y + r.h > PH - MB) { page(); paint(hd); }
      paint(r);
    }
  };
  const picture = (im, x, top, maxW, h, rowH) => {
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    const k = Math.min(maxW / iw, h / ih);
    g.drawImage(im, x, top + (rowH - ih * k) / 2, iw * k, ih * k);
    return iw * k;
  };

  page();
  if (img.letterhead) {
    const im = img.letterhead, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    const k = Math.min(CW / iw, mm(46) / ih);
    g.drawImage(im, ML + (CW - iw * k) / 2, y, iw * k, ih * k);
    y += ih * k + GAP * 1.4;
  }
  heading('OK TO BOARD', F + 4.5, true);
  y += lineH(F + 4.5) + GAP * 1.1;
  labels(L.rows, true);
  y += GAP;
  para('Dear Sirs,');
  y += GAP * 0.5;
  block(L.intro);
  y += GAP;
  room(LH * 5);
  heading('Personal Detail :', F);
  y += LH + GAP * 0.45;
  table(L.crew);
  y += GAP;
  room(LH);
  const fx = ML + heading('Flight Detail :-', F) + mm(7);
  L.flights.forEach((s, i) => para(s, { bold: true, x: fx, w: CW - (fx - ML), same: !i }));
  if (!L.flights.length) y += LH;
  y += GAP;
  block(L.guarantee);
  if (L.pic.length) { y += GAP; labels(L.pic, false); }
  y += GAP * 1.2;
  const sigH = mm(21), stampH = mm(28);
  const signH = img.signature || img.stamp ? Math.max(img.signature ? sigH : 0, img.stamp ? stampH : 0) : mm(15) * lv.gap;
  room(LH + signH + L.closing.length * LH + GAP * 0.6);
  para('Yours Faithfully');
  y += GAP * 0.3;
  let sx = ML;
  if (img.signature) sx += picture(img.signature, sx, y, mm(62), sigH, signH) + mm(5);
  if (img.stamp) picture(img.stamp, sx, y, mm(42), stampH, signH);
  y += signH + GAP * 0.3;
  L.closing.forEach(s => para(s));
  return pages;
}

async function loadImage(bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    return im;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasBytes = (cv, type, q) => new Promise((res, rej) => cv.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error('canvas')), type, q));
export const pageBlob = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('canvas')), 'image/png'));

export async function renderLetter(L, brand = {}) {
  const img = {};
  for (const k of ['letterhead', 'signature', 'stamp']) {
    if (!brand[k]) continue;
    try { img[k] = await loadImage(brand[k].bytes, brand[k].mime); } catch (e) { throw new Error(`เปิดรูป${{ letterhead: 'หัวจดหมาย', signature: 'ลายเซ็น', stamp: 'ตราประทับ' }[k]}ไม่ได้ ให้ผู้ดูแลระบบอัปโหลดใหม่ที่ตั้งค่าทั่วไป`); }
  }
  if (document.fonts && document.fonts.load) await Promise.all([400, 700].map(w => document.fonts.load(`${w} 20px "IBM Plex Sans Thai"`, JSON.stringify(L) + HEAD.join('')))).catch(() => {});
  for (const lv of LEVELS) {
    const pages = draw(L, img, lv);
    if (pages.length === 1) return pages;
  }
  return draw(L, img, LEVELS[0]);
}

function exifTurn(b) {
  try {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (v.getUint16(0) !== 0xffd8) return false;
    for (let p = 2; p + 4 < b.length;) {
      const mk = v.getUint16(p), len = v.getUint16(p + 2);
      if (mk === 0xffe1 && v.getUint32(p + 4) === 0x45786966) {
        const t = p + 10, le = v.getUint16(t) === 0x4949, ifd = t + v.getUint32(t + 4, le);
        for (let i = 0, n = v.getUint16(ifd, le); i < n; i++) if (v.getUint16(ifd + 2 + i * 12, le) === 0x0112) return v.getUint16(ifd + 10 + i * 12, le) > 1;
        return false;
      }
      if ((mk & 0xff00) !== 0xff00 || mk === 0xffda) return false;
      p += 2 + len;
    }
  } catch (e) {}
  return false;
}

async function imagePage(doc, f) {
  let im;
  try { im = await loadImage(f.bytes, f.mime); } catch (e) { throw new Error(`เปิดไฟล์รูปไม่ได้ (ไฟล์เสียหาย): ${f.crew} · ${f.name}`); }
  const w = im.naturalWidth, h = im.naturalHeight;
  let emb = null;
  if (f.mime !== 'image/webp' && Math.max(w, h) <= 3200 && !(f.mime === 'image/jpeg' && exifTurn(f.bytes))) {
    try { emb = f.mime === 'image/png' ? await doc.embedPng(f.bytes) : await doc.embedJpg(f.bytes); } catch (e) {}
  }
  if (!emb) {
    const k = Math.min(1, 2400 / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, cv.width, cv.height);
    try { emb = await doc.embedJpg(await canvasBytes(cv, 'image/jpeg', 0.9)); } catch (e) { throw new Error(`แปลงไฟล์รูปไม่ได้: ${f.crew} · ${f.name}`); }
  }
  const k = Math.min((A4[0] - EDGE * 2) / (w * 0.75), (A4[1] - EDGE * 2) / (h * 0.75), 1);
  const pw = w * 0.75 * k, ph = h * 0.75 * k;
  doc.addPage(A4).drawImage(emb, { x: (A4[0] - pw) / 2, y: (A4[1] - ph) / 2, width: pw, height: ph });
}

async function pdfPages(lib, doc, f) {
  let pages;
  try {
    const src = await lib.PDFDocument.load(f.bytes);
    pages = await doc.copyPages(src, src.getPageIndices());
    if (!pages.length) throw new Error('no pages');
  } catch (e) {
    const locked = /encrypt/i.test(String(e && e.message));
    throw new Error(`${locked ? 'เปิดไฟล์ PDF ไม่ได้ (ไฟล์ถูกล็อกด้วยรหัส ให้เปิดไฟล์แล้วสั่งพิมพ์เป็น PDF ใหม่ก่อนแนบ)' : 'เปิดไฟล์ PDF ไม่ได้ (ไฟล์เสียหาย หรือไม่ใช่ PDF)'}: ${f.crew} · ${f.name}`);
  }
  pages.forEach(p => doc.addPage(p));
}

export async function buildPack(L, brand, files, title) {
  const lib = await import('./vendor/pdf-lib.esm.min.js');
  const doc = await lib.PDFDocument.create();
  for (const cv of await renderLetter(L, brand)) {
    const png = await doc.embedPng(await canvasBytes(cv, 'image/png'));
    doc.addPage(A4).drawImage(png, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  for (const f of files) await (f.mime === 'application/pdf' ? pdfPages(lib, doc, f) : imagePage(doc, f));
  doc.setTitle(title || 'OK TO BOARD');
  doc.setCreator('Crew Change Tracker');
  return doc.save();
}

export async function buildEvidencePack(canvases, files, title) {
  const lib = await import('./vendor/pdf-lib.esm.min.js');
  const doc = await lib.PDFDocument.create();
  for (const cv of canvases) {
    const png = await doc.embedPng(await canvasBytes(cv, 'image/png'));
    doc.addPage(A4).drawImage(png, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  for (const f of files) await (f.mime === 'application/pdf' ? pdfPages(lib, doc, f) : imagePage(doc, f));
  doc.setTitle(title); doc.setCreator('Crew Change Tracker');
  return doc.save();
}
