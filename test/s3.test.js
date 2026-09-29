'use strict';
/**
 * core/s3.js 测试：node test/s3.test.js
 * 1) AWS 官方 SigV4 测试向量（GET / PUT Object）
 * 2) 集成测试：真实上传/下载/删除（读取 config.local.json 中的 s3 配置，缺省跳过）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const s3 = require('../core/s3');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✔ ' + name);
  } catch (e) {
    failed++;
    console.error('  ✘ ' + name + '\n    ' + (e && e.message));
  }
}

const AWS_KEY = {
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MD5/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};
const EMPTY = s3._internal.EMPTY_SHA256;

(async () => {
  console.log('S3 核心测试');

  await test('V1 awsUriEncode：特殊字符与中文', () => {
    assert.strictEqual(s3.awsUriEncode('a b+c/d', false), 'a%20b%2Bc/d');
    assert.strictEqual(s3.awsUriEncode('a b+c/d', true), 'a%20b%2Bc%2Fd');
    assert.strictEqual(s3.awsUriEncode('图床', false), '%E5%9B%BE%E5%BA%8A');
    assert.strictEqual(s3.awsUriEncode("!*'()", true), '%21%2A%27%28%29');
  });

  await test('V2 AWS 官方向量：GET Object（规范化请求哈希一致）', () => {
    const signed = s3.signCanonical({
      method: 'GET',
      uri: '/test.txt',
      query: {},
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY,
        'x-amz-date': '20130524T000000Z',
      },
      region: 'us-east-1',
      service: 's3',
      accessKey: AWS_KEY.accessKey,
      secretKey: AWS_KEY.secretKey,
      payloadHash: EMPTY,
      date: new Date('2013-05-24T00:00:00Z'),
    });
    // AWS 文档给出的该规范化请求的 SHA-256
    assert.strictEqual(
      s3._internal.sha256Hex(signed.canonicalRequest),
      '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972'
    );
    assert.strictEqual(signed.amzDate, '20130524T000000Z');
    assert.strictEqual(signed.stringToSign.split('\n')[0], 'AWS4-HMAC-SHA256');
    assert.strictEqual(
      signed.stringToSign.split('\n')[2],
      '20130524/us-east-1/s3/aws4_request'
    );
  });

  await test('V3 PUT 签名头集合：逐头换行、排序、signedHeaders 正确', () => {
    const signed = s3.signCanonical({
      method: 'PUT',
      uri: '/test%24file.text',
      query: {},
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        'content-type': 'text/plain',
        'x-amz-content-sha256': EMPTY,
        'x-amz-date': '20130524T000000Z',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      region: 'us-east-1',
      service: 's3',
      accessKey: AWS_KEY.accessKey,
      secretKey: AWS_KEY.secretKey,
      payloadHash: EMPTY,
      date: new Date('2013-05-24T00:00:00Z'),
    });
    assert.strictEqual(
      signed.canonicalRequest.split('\n')[3],
      'content-type:text/plain'
    );
    assert.strictEqual(
      signed.authorization.match(/SignedHeaders=([^,]+),/)[1],
      'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class'
    );
  });

  await test('V4 规范化 URI：中文 key 分段编码', () => {
    assert.strictEqual(s3.canonicalUriFor('图床/2026-09/1.jpeg'), '%E5%9B%BE%E5%BA%8A/2026-09/1.jpeg');
  });

  /* ---------------- 集成测试（读 config.local.json） ---------------- */
  const cfgPath = path.join(__dirname, '..', 'config.local.json');
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).s3 || null;
  } catch { /* 未配置则跳过 */ }

  if (!cfg || !cfg.endpoint || !cfg.accessKey) {
    console.log('  - 跳过集成测试：config.local.json 中没有 s3 配置');
  } else {
    const probeKey = (cfg.pathTemplate || '图床/{YYYY}-{MM}/{timestamp}.{ext}')
      .replace('{YYYY}', '1970').replace('{MM}', '01').replace('{DD}', '01')
      .replace('{date}', '1970-01-01').replace('{timestamp}', String(Date.now()))
      .replace(/\{name\}/g, 'probe').replace('{ext}', 'txt')
      .replace(/\{rand\}/g, Math.random().toString(36).slice(2, 8));
    const probeBody = Buffer.from('file-kit probe ' + new Date().toISOString(), 'utf8');

    let uploadedUrl = '';
    await test('I1 真实上传 putObject → 200', async () => {
      const r = await s3.putObject(cfg, probeKey, probeBody, 'text/plain');
      assert.strictEqual(r.status, 200);
      uploadedUrl = r.url;
      console.log('    url: ' + uploadedUrl);
    });

    await test('I2 签名 GET 读回内容一致', async () => {
      const r = await s3.getObject(cfg, probeKey);
      assert.strictEqual(r.body.toString('utf8'), probeBody.toString('utf8'));
    });

    await test('I3 匿名 GET（探测公开读）', async () => {
      const st = await s3.publicGet(uploadedUrl);
      console.log('    匿名 GET 状态: ' + st + (st === 200 ? '（公开可读）' : '（私有读，可改用预签名 URL）'));
    });

    await test('I4 删除 deleteObject → 2xx，且读回 404', async () => {
      const r = await s3.deleteObject(cfg, probeKey);
      assert.ok(r.status >= 200 && r.status < 300);
      await assert.rejects(
        () => s3.getObject(cfg, probeKey),
        (e) => /HTTP 404/.test(e.message),
        '删除后 GET 应返回 404'
      );
    });
  }

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})();
