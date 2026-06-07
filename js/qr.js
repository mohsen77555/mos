/* =====================================================================
   QR.js — مولّد رمز QR مستقل (Byte mode, الإصدارات 1‑10، مستوى تصحيح L)
   يكفي لرمز فاتورة ZATCA. لا يعتمد على أي مكتبة خارجية ويعمل دون اتصال.
   الواجهة:  QR.svg(text, scale, margin) -> نص SVG
            QR.matrix(text) -> { size, modules:boolean[][] }
   ===================================================================== */
(function (global) {
  'use strict';

  /* --- حقل غالوا GF(256) --- */
  const EXP = new Array(256), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    EXP[255] = EXP[0];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

  function rsGenPoly(deg) {
    let p = [1];
    for (let i = 0; i < deg; i++) {
      const np = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) { np[j] ^= p[j]; np[j + 1] ^= gmul(p[j], EXP[i]); }
      p = np;
    }
    return p;
  }
  function rsEncode(data, ecLen) {
    const gen = rsGenPoly(ecLen);
    const res = new Array(ecLen).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      for (let j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }

  /* --- جداول الإصدارات لمستوى L --- */
  const DCW = [19, 34, 55, 80, 108, 136, 156, 194, 232, 274];   // إجمالي كلمات البيانات
  const ECB = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];           // كلمات التصحيح لكل كتلة
  const BLOCKS = [                                                // [عدد الكتل, كلمات بيانات الكتلة]...
    [[1, 19]], [[1, 34]], [[1, 55]], [[1, 80]], [[1, 108]],
    [[2, 68]], [[2, 78]], [[2, 97]], [[2, 116]], [[2, 68], [2, 69]],
  ];
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  function utf8Bytes(str) {
    const out = [];
    for (const ch of unescape(encodeURIComponent(str))) out.push(ch.charCodeAt(0));
    return out;
  }

  function chooseVersion(len) {
    for (let v = 1; v <= 10; v++) {
      const ccBits = v < 10 ? 8 : 16;
      const cap = Math.floor((DCW[v - 1] * 8 - 4 - ccBits) / 8);
      if (len <= cap) return v;
    }
    throw new Error('QR: البيانات أكبر من الحد المدعوم');
  }

  function buildData(bytes, version) {
    const ccBits = version < 10 ? 8 : 16;
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);                 // وضع البايت
    push(bytes.length, ccBits);
    bytes.forEach(b => push(b, 8));
    const total = DCW[version - 1] * 8;
    for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0);  // منهٍ
    while (bits.length % 8 !== 0) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      cw.push(b);
    }
    const pads = [0xec, 0x11]; let pi = 0;
    while (cw.length < DCW[version - 1]) cw.push(pads[pi++ % 2]);
    return cw;
  }

  function interleave(dataCW, version) {
    const ecLen = ECB[version - 1];
    const groups = [];
    let pos = 0;
    BLOCKS[version - 1].forEach(([n, dc]) => {
      for (let i = 0; i < n; i++) {
        const data = dataCW.slice(pos, pos + dc); pos += dc;
        groups.push({ data, ec: rsEncode(data, ecLen) });
      }
    });
    const maxData = Math.max(...groups.map(g => g.data.length));
    const out = [];
    for (let i = 0; i < maxData; i++) groups.forEach(g => { if (i < g.data.length) out.push(g.data[i]); });
    for (let i = 0; i < ecLen; i++) groups.forEach(g => out.push(g.ec[i]));
    return out;
  }

  /* --- بناء المصفوفة --- */
  function makeMatrix(finalCW, version) {
    const size = 17 + version * 4;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, v) => { m[r][c] = v; fn[r][c] = true; };

    function finder(r, c) {
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const rr = r + i, cc = c + j;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inq = i >= 0 && i <= 6 && j >= 0 && j <= 6;
        const ring = inq && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        set(rr, cc, inq ? ring : false);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // التوقيت
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

    // أنماط المحاذاة
    const centers = ALIGN[version - 1];
    centers.forEach(r => centers.forEach(c => {
      if ((r <= 7 && c <= 7) || (r <= 7 && c >= size - 8) || (r >= size - 8 && c <= 7)) return;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++)
        set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
    }));

    // وحدة داكنة + حجز معلومات الصيغة/الإصدار
    set(size - 8, 8, true);
    for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
    for (let i = size - 8; i < size; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
    if (version >= 7) {
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
        set(size - 11 + j, i, false); set(i, size - 11 + j, false);
      }
    }

    // وضع البيانات (زجزاج)
    let bitIdx = 0;
    const bitAt = i => (finalCW[i >> 3] >> (7 - (i & 7))) & 1;
    const totalBits = finalCW.length * 8;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      const upward = ((col + 1) & 2) === 0;          // اتجاه الزجزاج (يتناوب مع تخطّي عمود التوقيت)
      for (let r = 0; r < size; r++) {
        const row = upward ? size - 1 - r : r;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (fn[row][cc]) continue;
          let dark = bitIdx < totalBits ? bitAt(bitIdx) === 1 : false;
          bitIdx++;
          m[row][cc] = dark;
        }
      }
    }
    return { m, fn, size };
  }

  function applyMask(m, fn, size, mask) {
    const out = m.map(r => r.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (fn[r][c]) continue;
      let inv = false;
      switch (mask) {
        case 0: inv = (r + c) % 2 === 0; break;
        case 1: inv = r % 2 === 0; break;
        case 2: inv = c % 3 === 0; break;
        case 3: inv = (r + c) % 3 === 0; break;
        case 4: inv = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: inv = ((r * c) % 2) + ((r * c) % 3) === 0; break;
        case 6: inv = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
        case 7: inv = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
      }
      if (inv) out[r][c] = !out[r][c];
    }
    return out;
  }

  function penalty(m, size) {
    let p = 0;
    // القاعدة 1: تتابعات
    for (let r = 0; r < size; r++) for (let dir = 0; dir < 2; dir++) {
      let run = 1, prev = null;
      for (let i = 0; i < size; i++) {
        const v = dir === 0 ? m[r][i] : m[i][r];
        if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
        else { run = 1; prev = v; }
      }
    }
    // القاعدة 2: كتل 2x2
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
    // القاعدة 4: نسبة الداكن
    let dark = 0; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    const ratio = (dark * 100) / (size * size);
    p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return p;
  }

  function fmtBits(mask) {
    const data = (0b01 << 3) | mask;             // مستوى L = 01
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function verBits(version) {
    let rem = version << 12;
    for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
    return (version << 12) | rem;
  }

  function placeFormat(m, size, mask) {
    const bits = fmtBits(mask);
    for (let i = 0; i < 15; i++) {
      const b = (bits >> i) & 1 ? true : false;
      // نسخة حول الزاوية اليسرى العليا
      if (i < 6) m[8][i] = b;
      else if (i < 8) m[8][i + 1] = b;
      else if (i === 8) m[7][8] = b;
      else m[14 - i][8] = b;
      // نسخة على الجانبين
      if (i < 8) m[size - 1 - i][8] = b;
      else m[8][size - 15 + i] = b;
    }
  }
  function placeVersion(m, size, version) {
    if (version < 7) return;
    const bits = verBits(version);
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1 ? true : false;
      const r = Math.floor(i / 3), c = i % 3;
      m[size - 11 + c][r] = b;
      m[r][size - 11 + c] = b;
    }
  }

  function matrix(text) {
    const bytes = utf8Bytes(text);
    const version = chooseVersion(bytes.length);
    const dataCW = buildData(bytes, version);
    const finalCW = interleave(dataCW, version);
    const { m, fn, size } = makeMatrix(finalCW, version);
    let best = null, bestScore = Infinity, bestMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      const masked = applyMask(m, fn, size, mask);
      const s = penalty(masked, size);
      if (s < bestScore) { bestScore = s; best = masked; bestMask = mask; }
    }
    placeFormat(best, size, bestMask);
    placeVersion(best, size, version);
    return { size, modules: best };
  }

  function svg(text, scale, margin) {
    scale = scale || 4; margin = margin == null ? 4 : margin;
    const { size, modules } = matrix(text);
    const dim = (size + margin * 2) * scale;
    let path = '';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c])
      path += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">` +
      `<rect width="${dim}" height="${dim}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  global.QR = { matrix, svg };
})(typeof window !== 'undefined' ? window : this);
