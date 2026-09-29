'use strict';
/**
 * S3 兼容对象存储客户端（零依赖，手写 AWS Signature V4）
 *
 * 适用于 AWS S3 / MinIO / RustFS / Cloudflare R2 等兼容 S3 协议的服务。
 * 只暴露图床需要的最小能力：putObject / deleteObject / getObject / presignedUrl / testConfig。
 *
 * 本模块只依赖 node 的 crypto/https/http，不依赖 uTools/ZTools，可在 Node 中直接测试。
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha256Hex = (data) =>
  crypto.createHash('sha256').update(data).digest('hex');

const hmac = (key, data) =>
  crypto.createHmac('sha256', key).update(data).digest();

/**
 * AWS 规范的 URI 编码：除 A-Za-z0-9-._~ 外全部转义。
 * @param {string} str
 * @param {boolean} encodeSlash 是否转义斜杠（路径段内为 false）
 */
function awsUriEncode(str, encodeSlash) {
  let out = '';
  for (const ch of String(str)) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      const bytes = Buffer.from(ch, 'utf8');
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

/** 对象 key → 规范化 URI（保留 / 分隔，逐段编码） */
function canonicalUriFor(key) {
  return String(key).split('/').map((s) => awsUriEncode(s, false)).join('/');
}

function amzDates(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStamp =
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
  const amzDate = dateStamp + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z';
  return { dateStamp, amzDate };
}

/**
 * 计算 SigV4 规范请求与签名（导出以便用 AWS 官方测试向量做单元测试）。
 * @param {object} p
 *   method, uri (canonical, 已编码), query (object|null), headers (object, 小写键),
 *   region, service, accessKey, secretKey, payloadHash, date (可选, 用于固定向量)
 * @returns {{canonicalRequest, stringToSign, signature, authorization}}
 */
function signCanonical(p) {
  const { dateStamp, amzDate } = amzDates(p.date);
  const scope = dateStamp + '/' + p.region + '/' + p.service + '/aws4_request';

  // 规范化查询串：按 key 排序，逐个 URI 编码
  const queryKeys = Object.keys(p.query || {}).sort();
  const canonicalQuery = queryKeys
    .map((k) => awsUriEncode(k, true) + '=' + awsUriEncode(String(p.query[k]), true))
    .join('&');

  // 参与签名的头：调用方给出的全部头（小写、排序、值 trim 压缩）。
  // host 与 x-amz-* 由 sigv4Headers 注入；底层 HTTP 库自动补的
  // Content-Length/Connection 等不在 map 内，因此不会被签名。
  const headerNames = Object.keys(p.headers).map((k) => k.toLowerCase());
  const unique = [...new Set(headerNames)].sort();
  const canonicalHeaders = unique
    .map((k) => k + ':' + String(p.headers[k] != null ? p.headers[k] : '').trim().replace(/\s+/g, ' ') + '\n')
    .join('');
  const signedHeaders = unique.join(';');

  const canonicalRequest = [
    p.method,
    p.uri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    p.payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + p.secretKey, dateStamp);
  const kRegion = hmac(kDate, p.region);
  const kService = hmac(kRegion, p.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    'AWS4-HMAC-SHA256 Credential=' + p.accessKey + '/' + scope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature;

  return { canonicalRequest, stringToSign, signature, authorization, amzDate };
}

/** 解析 endpoint URL，补充 host/协议/端口 */
function parseEndpoint(endpoint) {
  const u = new URL(endpoint);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('S3 endpoint 必须以 http:// 或 https:// 开头');
  }
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  return { protocol: u.protocol, host: u.hostname, port, pathPrefix: u.pathname.replace(/\/+$/, '') };
}

/** path-style 请求路径：[endpoint前缀]/{bucket}/{key}（逐段编码，保留 /） */
function requestPathFor(bucket, key, pathPrefix) {
  return (
    (pathPrefix || '') +
    '/' + encodeURIComponent(bucket) +
    (key ? '/' + canonicalUriFor(key) : '')
  );
}

/** 生成一次请求的 SigV4 头 */
function sigv4Headers(opts) {
  const { dateStamp, amzDate } = amzDates(opts.date);
  const payloadHash = opts.payloadHash || EMPTY_SHA256;
  const headers = Object.assign(
    {
      host: opts.hostWithPort,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    },
    opts.extraHeaders || {}
  );
  const signed = signCanonical({
    method: opts.method,
    uri: opts.uri,
    query: opts.query,
    headers,
    region: opts.region,
    service: 's3',
    accessKey: opts.accessKey,
    secretKey: opts.secretKey,
    payloadHash,
    date: opts.date,
  });
  return {
    host: headers.host,
    amzDate,
    payloadHash,
    authorization: signed.authorization,
    _signed: signed,
  };
}

/**
 * 底层请求。返回 {status, headers, body(Buffer)}。
 * 非 2xx 不抛错，由调用方按语义处理（S3 错误响应体含 XML 说明）。
 */
function request(method, urlStr, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        timeout: timeoutMs || 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function normalizeCfg(cfg) {
  if (!cfg || !cfg.endpoint || !cfg.bucket || !cfg.accessKey || !cfg.secretKey) {
    throw new Error('S3 配置不完整（需要 endpoint / bucket / accessKey / secretKey）');
  }
  const ep = parseEndpoint(cfg.endpoint);
  const hostWithPort = ep.host + (ep.port === (ep.protocol === 'https:' ? 443 : 80) ? '' : ':' + ep.port);
  return {
    region: cfg.region || 'us-east-1',
    bucket: cfg.bucket,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    ep,
    hostWithPort,
  };
}

/** 对象 key → path-style 请求 URI 与请求 URL（含 endpoint 自带路径前缀） */
function buildPaths(cfg, key) {
  const c = normalizeCfg(cfg);
  const uri = requestPathFor(c.bucket, key, c.ep.pathPrefix);
  const url = c.ep.protocol + '//' + c.hostWithPort + uri;
  return { c, uri, url };
}

/** 上传对象 */
async function putObject(cfg, key, body, contentType) {
  const { c, uri, url } = buildPaths(cfg, key);
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const sig = sigv4Headers({
    method: 'PUT',
    uri,
    hostWithPort: c.hostWithPort,
    region: c.region,
    accessKey: c.accessKey,
    secretKey: c.secretKey,
    payloadHash: sha256Hex(buf),
    extraHeaders: contentType ? { 'content-type': contentType } : {},
  });
  const headers = {
    Host: sig.host,
    'x-amz-date': sig.amzDate,
    'x-amz-content-sha256': sig.payloadHash,
    Authorization: sig.authorization,
    'Content-Length': buf.length,
  };
  if (contentType) headers['Content-Type'] = contentType;
  const res = await request('PUT', url, headers, buf, cfg.timeoutMs);
  if (res.status < 200 || res.status >= 300) {
    throw new Error('S3 上传失败 HTTP ' + res.status + ': ' + res.body.toString('utf8').slice(0, 300));
  }
  return { status: res.status, url };
}

/** 删除对象（S3 语义：对象不存在也返回 204） */
async function deleteObject(cfg, key) {
  const { c, uri, url } = buildPaths(cfg, key);
  const sig = sigv4Headers({
    method: 'DELETE',
    uri,
    hostWithPort: c.hostWithPort,
    region: c.region,
    accessKey: c.accessKey,
    secretKey: c.secretKey,
  });
  const res = await request('DELETE', url, {
    Host: sig.host,
    'x-amz-date': sig.amzDate,
    'x-amz-content-sha256': sig.payloadHash,
    Authorization: sig.authorization,
  }, null, cfg.timeoutMs);
  if (res.status < 200 || res.status >= 300) {
    throw new Error('S3 删除失败 HTTP ' + res.status + ': ' + res.body.toString('utf8').slice(0, 300));
  }
  return { status: res.status };
}

/** 下载对象（带签名，用于私有读校验） */
async function getObject(cfg, key) {
  const { c, uri, url } = buildPaths(cfg, key);
  const sig = sigv4Headers({
    method: 'GET',
    uri,
    hostWithPort: c.hostWithPort,
    region: c.region,
    accessKey: c.accessKey,
    secretKey: c.secretKey,
  });
  const res = await request('GET', url, {
    Host: sig.host,
    'x-amz-date': sig.amzDate,
    'x-amz-content-sha256': sig.payloadHash,
    Authorization: sig.authorization,
  }, null, cfg.timeoutMs);
  if (res.status < 200 || res.status >= 300) {
    throw new Error('S3 下载失败 HTTP ' + res.status);
  }
  return { status: res.status, body: res.body, contentType: res.headers['content-type'] };
}

/** 匿名 GET（不带签名，探测对象是否可公开读取） */
async function publicGet(url) {
  return (await request('GET', url, {}, null, 15000)).status;
}

/**
 * 生成预签名 URL（私有读时临时可访问）。
 * @param {number} expiresSeconds 有效期，默认 7 天上限 604800
 */
async function presignedUrl(cfg, key, expiresSeconds) {
  const { c, uri, url } = buildPaths(cfg, key);
  const { dateStamp, amzDate } = amzDates();
  const expires = String(Math.min(Math.max(expiresSeconds || 604800, 1), 604800));
  const scope = dateStamp + '/' + c.region + '/s3/aws4_request';
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': c.accessKey + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expires,
    'X-Amz-SignedHeaders': 'host',
  };
  const signed = signCanonical({
    method: 'GET',
    uri,
    query,
    headers: { host: c.hostWithPort },
    region: c.region,
    service: 's3',
    accessKey: c.accessKey,
    secretKey: c.secretKey,
    payloadHash: EMPTY_SHA256,
  });
  const qs = Object.keys(query)
    .map((k) => awsUriEncode(k, true) + '=' + awsUriEncode(String(query[k]), true))
    .join('&');
  return url + '?' + qs + '&X-Amz-Signature=' + signed.signature;
}

module.exports = {
  putObject,
  deleteObject,
  getObject,
  publicGet,
  presignedUrl,
  signCanonical,
  awsUriEncode,
  canonicalUriFor,
  parseEndpoint,
  _internal: { EMPTY_SHA256, sha256Hex, hmac, amzDates },
};
