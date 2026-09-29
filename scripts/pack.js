'use strict';
/**
 * 打包安装用 ZIP（零依赖，标准 deflate ZIP，条目名一律正斜杠、plugin.json 在根目录）。
 * 用法：node scripts/pack.js [输出路径]
 * 默认输出 ../file-kit-<version>.zip
 *
 * 注意：不要用 tar -a 生成 zip（Git Bash 的 GNU tar 会输出 tar 包），一律用本脚本。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUT = process.argv[2] || path.join(ROOT, '..', 'file-kit-' + (pkg.version || '0.0.0') + '.zip');

const INCLUDE = [
  'plugin.json',
  'preload.js',
  'index.html',
  'logo.png',
  'core',
  'assets',
];

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/* ---------------- 收集文件 ---------------- */
function collect(rel) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    const out = [];
    for (const name of fs.readdirSync(abs).sort()) {
      out.push(...collect(path.join(rel, name)));
    }
    return out;
  }
  return [rel];
}
const files = INCLUDE.flatMap((rel) => collect(rel)).filter(
  (rel) => path.basename(rel) !== 'config.local.json' // 密钥绝不进包
);
if (!files.includes('plugin.json')) {
  console.error('plugin.json 不在打包列表中，中止');
  process.exit(1);
}

/* ---------------- 组装 ZIP ---------------- */
const chunks = [];
const central = [];
let offset = 0;

const utf8Flag = 0x0800;
for (const rel of files) {
  const nameBuf = Buffer.from(rel.replace(/\\/g, '/'), 'utf8');
  const data = fs.readFileSync(path.join(ROOT, rel));
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = compressed.length < data.length;
  const payload = useDeflate ? compressed : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(utf8Flag, 6); // flags: UTF-8 名字
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10); // mod time
  local.writeUInt16LE(0x21, 12); // mod date（1980-01-01，构建可复现）
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18); // compressed size
  local.writeUInt32LE(data.length, 22); // uncompressed size
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // extra length

  chunks.push(local, nameBuf, payload);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); // central directory signature
  cd.writeUInt16LE(20, 4); // version made by
  cd.writeUInt16LE(20, 6); // version needed
  cd.writeUInt16LE(utf8Flag, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(0, 12); // time
  cd.writeUInt16LE(0x21, 14); // date
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(payload.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  // extra/comment/disk/attrs 全 0
  cd.writeUInt32LE(offset, 42); // local header offset
  central.push(Buffer.concat([cd, nameBuf]));

  offset += local.length + nameBuf.length + payload.length;
}

const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

fs.writeFileSync(OUT, Buffer.concat([...chunks, centralBuf, eocd]));
console.log('打包完成: ' + OUT + ' (' + files.length + ' 个文件, ' + fs.statSync(OUT).size + ' 字节)');
console.log(files.join('\n'));
