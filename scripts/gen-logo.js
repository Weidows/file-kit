'use strict';
/* 生成 logo.png（256×256，渐变圆角方块 + 白色文件夹），纯 Node 无依赖 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;          // 输出尺寸
const SS = 4;           // 超采样倍数
const N = S * SS;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}
function cover(sdf) { return clamp01(0.5 - sdf * SS); } // 1px 抗锯齿过渡

const lerp = (a, b, t) => a + (b - a) * t;

function pixel(x, y) {
  // 背景渐变（对角线）: #6D7CFF -> #A05BFF
  const t = clamp01((x + y) / (2 * S));
  let r = lerp(0x6d, 0xa0, t) / 255;
  let g = lerp(0x7c, 0x5b, t) / 255;
  let b = lerp(0xff, 0xff, t) / 255;

  const px = (x + 0.5) / SS, py = (y + 0.5) / SS;
  // 圆角方块背景
  const bgA = cover(sdRoundRect(px, py, S / 2, S / 2, S / 2 - 4, S / 2 - 4, 56));
  r *= bgA; g *= bgA; b *= bgA;

  // 白色文件夹：盖板 + 主体（并集）
  const tab = sdRoundRect(px, py, 100, 88, 34, 15, 12);
  const body = sdRoundRect(px, py, 128, 138, 62, 40, 14);
  const folderA = Math.max(cover(tab), cover(body));
  // 底部轻微投影感：主体下缘渐隐一点点
  const shade = 1 - 0.06 * clamp01((py - 120) / 60);
  const a = folderA * shade;
  r = lerp(r, 1, a);
  g = lerp(g, 1, a);
  b = lerp(b, 1, a);
  return [r, g, b, Math.max(bgA, 0.0)];
}

/* ---- PNG 编码 ---- */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  const rowStart = y * (S * 4 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    // 像素级超采样（4x4）
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = pixel(x * SS + sx, y * SS + sy);
        // 以背景 alpha 与前景合成结果直接平均
        r += pr; g += pg; b += pb;
        const px = (x * SS + sx + 0.5) / SS, py = (y * SS + sy + 0.5) / SS;
        a += cover(sdRoundRect(px, py, S / 2, S / 2, S / 2 - 4, S / 2 - 4, 56));
      }
    }
    const n = SS * SS;
    const o = rowStart + 1 + x * 4;
    raw[o] = Math.round(clamp01(r / n) * 255);
    raw[o + 1] = Math.round(clamp01(g / n) * 255);
    raw[o + 2] = Math.round(clamp01(b / n) * 255);
    raw[o + 3] = Math.round(clamp01(a / n) * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'logo.png');
fs.writeFileSync(out, png);
console.log('written', out, png.length, 'bytes');
