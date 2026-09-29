'use strict';
/**
 * 图床编排层：路径模板、URL 生成、Provider 抽象（当前实现 S3 兼容存储）。
 *
 * 路径模板默认 "图床/{YYYY}-{MM}/{timestamp}.{ext}"，
 * 可用占位符：{YYYY} {MM} {DD} {date} {timestamp}(毫秒) {name}(原文件名去扩展名) {ext} {rand}(6位随机)
 */

const fs = require('fs');
const path = require('path');
const s3 = require('./s3');

const DEFAULT_TEMPLATE = '图床/{YYYY}-{MM}/{timestamp}.{ext}';

const EXT_CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain',
  json: 'application/json',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

function contentTypeFor(ext) {
  return EXT_CONTENT_TYPES[(ext || '').toLowerCase()] || 'application/octet-stream';
}

function extFor(nameOrPath) {
  const ext = path.extname(String(nameOrPath || '')).replace('.', '');
  return ext.toLowerCase();
}

const pad2 = (n) => String(n).padStart(2, '0');
const rand6 = () => Math.random().toString(36).slice(2, 8);

/**
 * 按模板生成对象 key。
 * @param {string} template 路径模板
 * @param {{name?: string, ext?: string, now?: Date}} info
 */
function buildKey(template, info) {
  const now = info.now || new Date();
  const ext = (info.ext || '').toLowerCase();
  const base = info.name ? info.name.replace(/\.[^.]+$/, '') : 'image';
  const vars = {
    YYYY: String(now.getFullYear()),
    MM: pad2(now.getMonth() + 1),
    DD: pad2(now.getDate()),
    date: now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()),
    timestamp: String(now.getTime()),
    name: base,
    ext,
    rand: rand6(),
  };
  let out = String(template || DEFAULT_TEMPLATE);
  for (const [k, v] of Object.entries(vars)) {
    out = out.split('{' + k + '}').join(v);
  }
  if (!out) out = '图床/' + vars.timestamp + '.' + ext;
  return out.replace(/^\//, '').replace(/\/{2,}/g, '/');
}

/** 公开访问 URL：publicBase（如 https://fs.weidows.tech/img）+ key（逐段编码） */
function publicUrl(cfg, key) {
  const base = (cfg && cfg.publicBase ? String(cfg.publicBase) : '').replace(/\/+$/, '');
  if (base) return base + '/' + key.split('/').map(encodeURIComponent).join('/');
  // 未配置 publicBase 时退回 path-style：endpoint/bucket/key
  const ep = s3.parseEndpoint(cfg.endpoint);
  const port = ep.port === (ep.protocol === 'https:' ? 443 : 80) ? '' : ':' + ep.port;
  return (
    ep.protocol + '//' + ep.host + port +
    '/' + encodeURIComponent(cfg.bucket) +
    '/' + key.split('/').map(encodeURIComponent).join('/')
  );
}

/** 规范化配置：填默认值，校验必填 */
function normalizeConfig(cfg) {
  const c = Object.assign({}, cfg || {});
  c.pathTemplate = c.pathTemplate || DEFAULT_TEMPLATE;
  c.region = c.region || 'us-east-1';
  const missing = ['endpoint', 'bucket', 'accessKey', 'secretKey'].filter((k) => !c[k]);
  if (missing.length) {
    const err = new Error('S3 配置缺少：' + missing.join(' / '));
    err.code = 'CONFIG_INCOMPLETE';
    throw err;
  }
  return c;
}

/**
 * 上传 Buffer（Provider: s3）。
 * @returns {Promise<{ok:true, key, url, size, contentType, provider:'s3'}>}
 */
async function uploadBuffer(cfg, buf, info) {
  const c = normalizeConfig(cfg);
  const key = buildKey(c.pathTemplate, info);
  const contentType = contentTypeFor(info.ext);
  const r = await s3.putObject(c, key, buf, contentType);
  return { ok: true, key, url: publicUrl(c, key), size: buf.length, contentType, provider: 's3', status: r.status };
}

/** 上传本地文件 */
async function uploadFile(cfg, filePath, hooks) {
  const buf = fs.readFileSync(filePath);
  return uploadBuffer(cfg, buf, {
    name: path.basename(filePath),
    ext: extFor(filePath),
    now: new Date(),
  });
}

/**
 * 上传 Data URL（ZTools 粘贴图片触发）。
 * @param {string} dataUrl "data:image/png;base64,..."
 */
async function uploadDataUrl(cfg, dataUrl, suggestedName) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('不是合法的 Data URL');
  const mime = m[1];
  const isB64 = !!m[2];
  let body = m[3].replace(/\s/g, '');
  const buf = isB64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  const ext = Object.keys(EXT_CONTENT_TYPES).find((k) => EXT_CONTENT_TYPES[k] === mime) ||
    (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  return uploadBuffer(cfg, buf, {
    name: suggestedName || 'clipboard.' + ext,
    ext,
    now: new Date(),
  });
}

/** 连通性测试：上传探针文件并删除，返回延迟与公开 URL */
async function testConfig(cfg) {
  const c = normalizeConfig(cfg);
  const probeKey = buildKey(c.pathTemplate, {
    name: 'ztools-probe',
    ext: 'txt',
    now: new Date(),
  }).replace(/\.(jpeg|jpg|png|webp)$/i, '.txt');
  const body = Buffer.from('file-kit 连通性测试 ' + new Date().toISOString(), 'utf8');
  const started = Date.now();
  await s3.putObject(c, probeKey, body, 'text/plain');
  const latency = Date.now() - started;
  let deleteOk = true;
  let deleteMsg = '';
  try {
    await s3.deleteObject(c, probeKey);
  } catch (e) {
    deleteOk = false;
    deleteMsg = e.message;
  }
  return {
    ok: true,
    latency,
    key: probeKey,
    url: publicUrl(c, probeKey),
    deleteOk,
    deleteMsg,
    message: '上传成功（' + latency + 'ms）' + (deleteOk ? '，探针已清理' : '，但探针清理失败：' + deleteMsg),
  };
}

/** 从图床删除对象（配合上传记录使用） */
async function removeObject(cfg, key) {
  return s3.deleteObject(normalizeConfig(cfg), key);
}

module.exports = {
  DEFAULT_TEMPLATE,
  EXT_CONTENT_TYPES,
  contentTypeFor,
  extFor,
  buildKey,
  publicUrl,
  normalizeConfig,
  uploadBuffer,
  uploadFile,
  uploadDataUrl,
  testConfig,
  removeObject,
};
