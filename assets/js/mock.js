'use strict';
/**
 * 演示模式：仅在浏览器中直接打开页面（无 preload、无 window.FK）时生效。
 * ZTools 环境下 preload.js 会先定义 window.FK，此脚本自动跳过。
 * 演示数据采用典型的"图片/视频合集文件夹"场景，用于界面预览与调试。
 */
(function () {
  if (window.FK) return;

  const DEMO_DIRS = [
    'F:\\Movies\\#夏夏子 #Natsuko\\Natsuko夏夏子 &星澜是澜澜叫澜妹呀 补习老师的惩罚 [126P1V-1.18GB]',
    'F:\\Movies\\#夏夏子 #Natsuko\\Natsuko夏夏子 &星澜是澜澜叫澜妹呀 双人泡泡浴 [83P-506MB]',
    'F:\\Movies\\#夏夏子 #Natsuko\\Natsuko夏夏子 2022圣诞 [30P1V-491MB]',
    'F:\\Movies\\#夏夏子 #Natsuko\\Natsuko夏夏子 JK&花嫁 豪华版 [131P-1.17GB]',
  ];
  const DEMO_NAMES = ['cover.jpg', '001.jpg', '002.jpg', '003.jpg', 'preview.mp4', 'info.txt', 'poster.png'];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  // 1x1 透明像素 PNG，作为演示缩略图
  const DEMO_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  function fakePlan(paths, options) {
    const groups = paths.map((p, gi) => {
      const name = p.split('\\').pop();
      const n = rand(4, 9);
      const ops = [];
      for (let i = 0; i < n; i++) {
        const base = DEMO_NAMES[i % DEMO_NAMES.length];
        const dup = i === 0 && gi > 0; // 从第二个文件夹起制造重名，演示智能重命名
        ops.push({
          from: p + '\\' + base,
          to: 'F:\\Movies\\#夏夏子 #Natsuko\\' + (dup ? base.replace('.', ' (1).') : base),
          name: base,
          isDir: false,
          size: base.endsWith('.mp4') ? rand(300, 900) * 1024 * 1024 : rand(80, 5200) * 1024,
          action: 'move',
          renamed: dup,
          overwrite: false,
          reason: null,
        });
      }
      const summary = {
        files: n, dirs: 0,
        size: ops.reduce((s, o) => s + o.size, 0),
        conflicts: ops.filter((o) => o.renamed).length,
        skipped: 0,
      };
      return { source: p, name, target: 'F:\\Movies\\#夏夏子 #Natsuko', mode: options.mode || 'top', exists: true, warning: null, ops, removeDirs: [p], errors: [], summary };
    });
    const summary = groups.reduce((a, g) => ({
      folderCount: a.folderCount + 1,
      fileCount: a.fileCount + g.summary.files,
      dirCount: a.dirCount + g.summary.dirs,
      totalSize: a.totalSize + g.summary.size,
      conflictCount: a.conflictCount + g.summary.conflicts,
      skippedCount: 0, errorCount: 0,
    }), { folderCount: 0, fileCount: 0, dirCount: 0, totalSize: 0, conflictCount: 0, skippedCount: 0, errorCount: 0 });
    return { createdAt: new Date().toISOString(), options, groups, summary };
  }

  const DEMO_S3 = {
    endpoint: 'https://fs.weidows.tech',
    bucket: 'img',
    region: 'us-east-1',
    accessKey: 'demo',
    secretKey: 'demo',
    publicBase: 'https://fs.weidows.tech/img',
    pathTemplate: '图床/{YYYY}-{MM}/{timestamp}.{ext}',
  };

  window.FK = {
    version: '0.2.0 (demo)',
    host: 'browser',
    platform: 'win32',
    extract: {
      scan: (paths, options) => fakePlan(paths, options),
      async execute(plan, onProgress) {
        const ops = plan.groups.reduce((n, g) => n + g.ops.length, 0);
        for (let i = 0; i <= ops; i++) {
          onProgress && onProgress({ done: i, total: ops, label: i < ops ? plan.groups[0].ops[0].name : '', group: '' });
          await sleep(ops > 40 ? 18 : 70);
        }
        return {
          ok: true,
          results: plan.groups.map((g) => ({ source: g.source, name: g.name, target: g.target, moved: g.ops.length, skipped: 0, failed: [], removed: [g.source], residual: [], error: null })),
          journal: plan.groups.flatMap((g) => g.ops.map((o) => ({ from: o.from, to: o.to }))),
          summary: { moved: ops, failed: 0, skipped: 0 },
          at: new Date().toISOString(),
        };
      },
      async undo(journal, onProgress) {
        for (let i = 0; i <= journal.length; i++) {
          onProgress && onProgress({ done: i, total: journal.length, label: '' });
          await sleep(40);
        }
        return { ok: true, restored: journal.length, skipped: [], failed: [] };
      },
    },
    imagehost: {
      async uploadFile(cfg, filePath) {
        await sleep(rand(500, 1200));
        const name = filePath.split(/[\\/]/).pop();
        const ext = (name.split('.').pop() || 'png').toLowerCase();
        const d = new Date();
        const key = '图床/' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
          '/' + Date.now() + '.' + ext;
        return { ok: true, key, url: cfg.publicBase + '/' + encodeURIComponent(key), size: rand(20, 900) * 1024, contentType: 'image/' + ext };
      },
      async uploadDataUrl(cfg, dataUrl, suggestedName) {
        await sleep(rand(400, 900));
        const ext = suggestedName ? (suggestedName.split('.').pop() || 'png') : 'png';
        const d = new Date();
        const key = '图床/' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
          '/' + Date.now() + '.' + ext;
        return { ok: true, key, url: cfg.publicBase + '/' + encodeURIComponent(key), size: rand(20, 900) * 1024, contentType: 'image/png' };
      },
      async testConfig() {
        await sleep(600);
        return { ok: true, latency: rand(80, 400), url: DEMO_S3.publicBase + '/图床/probe.txt', message: '上传成功（演示）' };
      },
      async removeObject() { await sleep(300); return { ok: true }; },
      publicUrl: (cfg, key) => cfg.publicBase + '/' + encodeURIComponent(key),
      defaultTemplate: '图床/{YYYY}-{MM}/{timestamp}.{ext}',
      isImageFile: (p) => /\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|jfif)$/i.test(p),
    },
    dialogs: {
      async pickFolders() { return []; },
      async pickImages() { return []; },
      readClipboardFolders() { return DEMO_DIRS.slice(0, 2); },
      readClipboardImagePaths() { return []; },
      readClipboardText() { return ''; },
      filterDirs(paths) { return (paths || []).map((p) => ({ path: p, isDir: true })); },
      filterImages(paths) { return (paths || []).filter((p) => window.FK.imagehost.isImageFile(p)); },
    },
    util: {
      revealInFolder() {}, openPath() {}, isDir: () => true,
      pathForFile: (f) => f && f.path,
      async fileMeta(p) {
        const name = p.split(/[\\/]/).pop();
        return { size: name.endsWith('.mp4') ? 4e8 : rand(30, 3000) * 1024, dataUrl: DEMO_PNG };
      },
      copyText(text) {
        try { navigator.clipboard.writeText(text); return true; } catch { return false; }
      },
    },
    history: {
      list() {
        return [{
          id: 'demo-1', time: new Date(Date.now() - 3600e3).toISOString(),
          label: 'Natsuko夏夏子 FGO 源赖光 僵尸同人 [51P-409MB] 等 3 个文件夹',
          moved: 128, failed: 0, undone: false,
          entries: DEMO_DIRS.map((p) => ({ from: p + '\\cover.jpg', to: 'F:\\Movies\\#夏夏子 #Natsuko\\cover.jpg' })),
        }];
      },
      push() {}, clear() {}, replace() {},
    },
    imageHistory: {
      list() {
        return [{
          id: 'img-demo-1', time: new Date(Date.now() - 1800e3).toISOString(),
          name: 'screenshot-2026-09-29.png',
          url: 'https://fs.weidows.tech/img/%E5%9B%BE%E5%BA%8A/2026-09/1787551822029.png',
          key: '图床/2026-09/1787551822029.png',
          size: 284 * 1024,
        }];
      },
      push() {}, clear() {}, replace() {},
    },
    settings: {
      get() {
        try { return JSON.parse(localStorage.getItem('fk_demo_settings')) || {}; } catch { return {}; }
      },
      update(patch) {
        const next = Object.assign({}, this.get(), patch);
        try { localStorage.setItem('fk_demo_settings', JSON.stringify(next)); } catch {}
        return next;
      },
    },
  };

  // 演示模式下预置一份 S3 配置，便于浏览界面
  window.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('demo-mode');
    const badge = document.createElement('div');
    badge.className = 'demo-badge';
    badge.textContent = '演示模式（浏览器预览，数据为模拟）';
    document.body.append(badge);
    const s = window.FK.settings.get();
    if (!s.s3) window.FK.settings.update({ s3: DEMO_S3 });
  });
})();
