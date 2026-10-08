#!/usr/bin/env node
/* Generates the PWA icons (icons/icon-192.png, icon-512.png, icon.svg)
 * with zero dependencies — hand-encoded PNG via zlib. Amber tile, dark "TP".
 * Run after changing colors:  node tools/build-icons.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLUE = [0x1f, 0x6f, 0xce];
const INK = [0xff, 0xff, 0xff];

// 5x7 glyphs
const GLYPHS = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000']
};

function makePng(size) {
  const px = Buffer.alloc(size * size * 3);
  const put = (x, y, c) => { const o = (y * size + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };

  // steel-blue tile with rounded corners (transparent-ish corners drawn as white
  // would show on dark docks, so keep square fill — launchers mask anyway)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, BLUE);

  // "TP" centered: two 5x7 glyphs + 1 col gap = 11x7 cells
  const cell = Math.floor(size / 16);
  const w = 11 * cell, h = 7 * cell;
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
  const text = ['T', 'P'];
  text.forEach((ch, gi) => {
    const g = GLYPHS[ch];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '1') continue;
      const x0 = ox + (gi * 6 + c) * cell, y0 = oy + r * cell;
      for (let y = y0; y < y0 + cell; y++) for (let x = x0; x < x0 + cell; x++) put(x, y, INK);
    }
  });

  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(dir, `icon-${size}.png`), makePng(size));
  console.log(`icons/icon-${size}.png`);
}
fs.writeFileSync(path.join(dir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#1f6fce"/><text x="16" y="22" font-family="monospace" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">TP</text></svg>\n`);
console.log('icons/icon.svg');
