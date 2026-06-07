/* مولّد أيقونات PNG لـ MOS ERP — يُشغّل بـ Node ويكتب icons/icon-192.png و icon-512.png */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function drawIcon(size) {
  const s = size / 512;
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  // خلفية بنفسجية
  const bg = [0x71, 0x4b, 0x67];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, bg[0], bg[1], bg[2]);
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c[0], c[1], c[2]); };
  const disc = (cx, cy, r, c) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(cx + x, cy + y, c[0], c[1], c[2]); };
  const seg = (x0, y0, x1, y1, w, c) => {
    const steps = Math.hypot(x1 - x0, y1 - y0);
    for (let t = 0; t <= steps; t++) { const x = x0 + (x1 - x0) * t / steps, y = y0 + (y1 - y0) * t / steps; disc(x, y, w / 2, c); }
  };
  const white = [255, 255, 255], teal = [0x00, 0xa0, 0x9d], yellow = [0xff, 0xd9, 0x66];
  // أعمدة بيضاء
  rect(120 * s, 300 * s, 56 * s, 110 * s, white);
  rect(228 * s, 232 * s, 56 * s, 178 * s, white);
  rect(336 * s, 170 * s, 56 * s, 240 * s, white);
  // خط الاتجاه الصاعد
  seg(120 * s, 300 * s, 256 * s, 210 * s, 20 * s, teal);
  seg(256 * s, 210 * s, 392 * s, 140 * s, 20 * s, teal);
  disc(392 * s, 140 * s, 20 * s, yellow);

  // بناء PNG
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'icons');
fs.writeFileSync(path.join(dir, 'icon-192.png'), drawIcon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), drawIcon(512));
console.log('تم إنشاء icon-192.png و icon-512.png');
