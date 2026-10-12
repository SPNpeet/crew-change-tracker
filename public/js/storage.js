import { esc } from './core.js';

const size = bytes => bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`;

// The quota counts job photos, crew document files and profile photos still recorded in the app, not R2 backups.
export function storageCard(s, admin = false) {
  if (!s) return '<div class="card storage-status" role="status"><div class="card-b">ตรวจพื้นที่เก็บไฟล์ไม่ได้ในขณะนี้ เปิดหน้านี้ใหม่เพื่อลองอีกครั้ง</div></div>';
  const needsAction = s.level === 'warning' || s.level === 'full';
  const title = s.level === 'full' ? 'พื้นที่เก็บไฟล์เต็มแล้ว' : needsAction ? 'พื้นที่เก็บไฟล์ใกล้เต็ม' : 'พื้นที่เก็บรูปและไฟล์เอกสาร';
  return `<section class="card storage-status ${needsAction ? 'storage-warn' : ''}" data-storage-level="${esc(s.level)}" role="status" aria-live="polite">
    <div class="card-b"><div class="storage-head"><strong>${title}</strong><span>${size(s.usedBytes)} / ${size(s.limitBytes)} (${s.percent}%)</span></div>
      <progress max="100" value="${Math.min(100, s.percent)}" aria-label="พื้นที่เก็บไฟล์ที่ใช้ไป ${s.percent}%"></progress>
      <p class="muted s13">เตือนที่ ${s.warningPercent}% · นับรูปและไฟล์เอกสารที่ยังอยู่ในระบบ ไม่รวมสำเนาสำรอง</p>
      ${needsAction ? '<p>แจ้งผู้ดูแลก่อนพื้นที่เต็ม หากต้องเพิ่มพื้นที่ ให้เสนอค่าใช้จ่ายและขออนุมัติบริษัทก่อน ไม่มีการเพิ่มพื้นที่หรือคิดเงินอัตโนมัติ</p>' : ''}
      ${admin ? '<a href="/admin/general" data-link>ตั้งค่าเปอร์เซ็นต์แจ้งเตือน</a>' : ''}
    </div></section>`;
}
