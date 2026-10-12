import { deflateSync, crc32 } from 'node:zlib';

export function png(w, h, pixel = (x, y) => [x * 6 % 256, y * 9 % 256, 160, 255]) {
  const row = w * 4 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * row + 1 + x * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// Reads one sheet of the app's own .xlsx files (stored, not compressed) as rows of cell values.
export function sheetRows(bytes, n) {
  const buf = Buffer.from(bytes), name = `xl/worksheets/sheet${n}.xml`;
  let xml = null;
  for (let p = 0; p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50;) {
    const size = buf.readUInt32LE(18 + p), nameLen = buf.readUInt16LE(26 + p), extra = buf.readUInt16LE(28 + p);
    const start = p + 30 + nameLen + extra;
    if (buf.toString('utf8', p + 30, p + 30 + nameLen) === name) xml = buf.toString('utf8', start, start + size);
    p = start + size;
  }
  if (xml == null) throw new Error('sheet not found: ' + name);
  const un = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const col = ref => [...ref.replace(/[0-9]/g, '')].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/gs)].map(r => {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+[0-9]+)"[^>]*?(?:\/>|>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>)/g)) row[col(c[1])] = c[2] !== undefined ? Number(c[2]) : c[3] !== undefined ? un(c[3]) : '';
    return Array.from(row, v => v === undefined ? '' : v);
  });
}

export function pdf(pages) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  pages.forEach((text, i) => {
    const stream = `BT /F1 13 Tf 56 770 Td (${String(text).replace(/[^ -~]|[()\\]/g, '')}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const at = objs.map((o, i) => { const p = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
