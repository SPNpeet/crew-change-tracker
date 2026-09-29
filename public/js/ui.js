import { esc, hms, dateTh } from './core.js';

const ICON = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  send: '<path d="M4 12l16-8-6 16-3-6-7-2z"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  office: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10.5 10.5 0 0 1 14 0M8.5 15.5a5.5 5.5 0 0 1 7 0"/><path d="M12 19h.01"/>'
};
export const icon = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

export function copy(textValue, label) {
  const done = () => toast((label || 'คัดลอก') + 'แล้ว วางในอีเมลหรือ LINE ได้เลย');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = textValue; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    ok ? done() : toast('คัดลอกไม่ได้ในเบราว์เซอร์นี้ กรุณาเลือกข้อความแล้วคัดลอกเอง');
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(textValue).then(done, fallback); else fallback();
}

export function openDialog(html, onSubmit) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = html;
  const form = dlg.querySelector('form');
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const err = form.querySelector('.ferr');
    if (btn) btn.disabled = true;
    if (err) err.textContent = '';
    try {
      const keep = await onSubmit(new FormData(form), form);
      if (keep !== true) close();
    } catch (x) {
      if (err) err.textContent = x.message || 'บันทึกไม่สำเร็จ';
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  dlg.showModal();
  const first = dlg.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
  if (first && window.matchMedia('(pointer:fine)').matches) first.focus();
  return dlg;
}

export const dlgHead = t => `<div class="dlg-h"><h3>${esc(t)}</h3><button type="button" class="iconbtn plain" data-close aria-label="ปิด">${icon('x')}</button></div>`;
export const dlgFoot = (label = 'บันทึก') => `<div class="ferr" role="alert"></div><div class="dlg-f"><button type="button" class="btn line" data-close>ยกเลิก</button><button type="submit" class="btn">${esc(label)}</button></div>`;

export function openLb(src, cap) {
  const lb = document.getElementById('lb');
  document.getElementById('lbimg').src = src;
  document.getElementById('lbcap').textContent = cap || '';
  lb.hidden = false;
}
export function closeLb() { document.getElementById('lb').hidden = true; document.getElementById('lbimg').removeAttribute('src'); }

let gpsCache = null;
export function getGps() {
  return new Promise(resolve => {
    if (gpsCache && Date.now() - gpsCache.t < 120000) return resolve(gpsCache);
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => { gpsCache = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; resolve(gpsCache); },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 120000 }
    );
  });
}

export async function stampPhoto(file, info) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const gps = await getGps();
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const fs = Math.max(14, Math.round(w / 40));
    const now = Date.now();
    const lines = [
      `${info.point} · ${info.name}${info.rank ? ' (' + info.rank + ')' : ''}`,
      `${dateTh(now)} ${hms(now)} · ${info.vessel}`,
      gps ? `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${Math.round(gps.acc)} ม.)` : 'ไม่ได้เปิดตำแหน่ง GPS · บันทึกเวลาและจุดแล้ว'
    ];
    const pad = Math.round(fs * 0.7), lh = Math.round(fs * 1.35);
    const band = pad * 2 + lh * lines.length + Math.round(fs * 0.9);
    g.fillStyle = 'rgba(8,12,24,.78)';
    g.fillRect(0, h - band, w, band);
    g.fillStyle = '#c8102e';
    g.fillRect(0, h - band, w, Math.max(3, Math.round(fs / 5)));
    g.fillStyle = '#fff';
    g.font = `600 ${fs}px "IBM Plex Sans Thai", sans-serif`;
    g.textBaseline = 'top';
    lines.forEach((l, i) => { if (i === 1) g.font = `400 ${fs}px "IBM Plex Sans Thai", sans-serif`; g.fillText(l, pad, h - band + pad + i * lh, w - pad * 2); });
    g.font = `400 ${Math.round(fs * 0.7)}px "IBM Plex Sans Thai", sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText(info.company + ' · Crew Change Tracker', pad, h - pad - Math.round(fs * 0.75), w - pad * 2);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.78));
    return { blob, gps };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function busy() {
  const a = document.activeElement;
  return (a && /TEXTAREA|INPUT|SELECT/.test(a.tagName)) || document.getElementById('dlg').open;
}
