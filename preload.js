'use strict';
/**
 * 文件工具箱 - ZTools preload 桥接层
 *
 * 职责：
 *  - 把核心逻辑（core/extract.js、core/s3.js、core/imagehost.js）以 window.FK.* 暴露给前端；
 *  - 适配 ZTools API（ztools.*）：存储、对话框、剪贴板、onPluginEnter 分发等；
 *  - onPluginEnter 收到的全部文件/图片都会交给页面（多选全处理）；
 *  - 注册 MCP 工具 upload_image，供 ZTools 的 AI 能力调用。
 */
(function () {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const core = require('./core/extract');
  const s3 = require('./core/s3');
  const imagehost = require('./core/imagehost');

  const hasZtools = typeof ztools !== 'undefined';
  const HKEY = 'fk_history';
  const IKEY = 'fk_image_history';
  const SKEY = 'fk_settings';

  /* ------------------------------------------------ 存储优先 ZTools dbStorage，浏览器回退 localStorage */
  const store = hasZtools
    ? {
        get: (k) => {
          try { return ztools.dbStorage.getItem(k); } catch { return null; }
        },
        set: (k, v) => {
          try { ztools.dbStorage.setItem(k, v); } catch { /* ignore */ }
        },
      }
    : {
        get: (k) => {
          try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
        },
        set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
      };

  /* 读取本地密钥配置（gitignore，不随仓库/安装包提交）：
     1) 开发目录下的 config.local.json（开发者模式）
     2) ~/.file-kit/config.local.json（zip 安装后的零配置途径，升级插件不丢失） */
  let localConfig = {};
  (function loadLocalConfig() {
    const candidates = [
      path.join(__dirname, 'config.local.json'),
      path.join(os.homedir(), '.file-kit', 'config.local.json'),
    ];
    for (const file of candidates) {
      try {
        if (fs.existsSync(file)) {
          localConfig = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
          return;
        }
      } catch { /* 尝试下一个 */ }
    }
  })();

  function getSettings() {
    const stored = store.get(SKEY) || {};
    // 首次使用时以 config.local.json 的 s3 配置作为缺省（保存后会持久化到 ZTools 存储）
    if (!stored.s3 && localConfig.s3) stored.s3 = localConfig.s3;
    return stored;
  }
  function updateSettings(patch) {
    const next = Object.assign({}, getSettings(), patch);
    store.set(SKEY, next);
    return next;
  }

  /* ------------------------------------------------ 历史（解散文件夹 / 图床上传共用） */
  function listHistory() { return store.get(HKEY) || []; }
  function pushHistory(record) {
    const list = listHistory();
    list.unshift(record);
    store.set(HKEY, list.slice(0, 30));
    return list;
  }
  function replaceHistory(list) {
    store.set(HKEY, Array.isArray(list) ? list.slice(0, 30) : []);
  }
  function clearHistory() { store.set(HKEY, []); }

  function listImageHistory() { return store.get(IKEY) || []; }
  function pushImageHistory(record) {
    const list = listImageHistory();
    list.unshift(record);
    store.set(IKEY, list.slice(0, 100));
    return list;
  }
  function replaceImageHistory(list) {
    store.set(IKEY, Array.isArray(list) ? list.slice(0, 100) : []);
  }
  function clearImageHistory() { store.set(IKEY, []); }

  /* ------------------------------------------------ 系统交互 */
  function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }
  function isImageFile(p) {
    return imagehost.EXT_CONTENT_TYPES[imagehost.extFor(p)] !== undefined &&
      /^image\//.test(imagehost.contentTypeFor(imagehost.extFor(p)));
  }

  async function pickFolders() {
    if (!hasZtools) return [];
    let res = ztools.showOpenDialog({
      title: '选择要解散的文件夹（可多选）',
      properties: ['openDirectory', 'multiSelections'],
      buttonLabel: '选择',
    });
    if (res && typeof res.then === 'function') res = await res;
    return (Array.isArray(res) ? res : []).filter(isDir);
  }

  async function pickImages() {
    if (!hasZtools) return [];
    let res = ztools.showOpenDialog({
      title: '选择要上传的图片（可多选）',
      properties: ['openFile', 'multiSelections'],
      buttonLabel: '选择',
    });
    if (res && typeof res.then === 'function') res = await res;
    return (Array.isArray(res) ? res : []);
  }

  /** 把系统剪贴板中的文件/文件夹路径解析出来（复制文件后可直接导入） */
  function clipboardFileItems() {
    if (!hasZtools) return [];
    try { return ztools.getCopyedFiles() || []; } catch { return []; }
  }
  function readClipboardFolders() {
    return clipboardFileItems()
      .filter((f) => f && f.isDirectory && f.path)
      .map((f) => f.path);
  }
  function readClipboardImagePaths() {
    return clipboardFileItems()
      .filter((f) => f && f.isFile && f.path && isImageFile(f.path))
      .map((f) => f.path);
  }
  function readClipboardText() {
    if (hasZtools) {
      try {
        const { clipboard } = require('electron');
        return clipboard.readText() || '';
      } catch { /* fallthrough */ }
    }
    return '';
  }

  /** 校验一批路径的类型（拖拽导入用） */
  function filterDirs(paths) {
    return (paths || []).map((p) => ({ path: p, isDir: isDir(p) }));
  }
  function filterImages(paths) {
    return (paths || []).filter((p) => isImageFile(p));
  }

  function revealInFolder(p) {
    if (!hasZtools) return;
    try { ztools.shellShowItemInFolder(p); } catch { /* ignore */ }
  }
  function openPath(p) {
    if (!hasZtools) return;
    try { ztools.shellOpenPath(p); } catch { /* ignore */ }
  }
  function copyText(text) {
    if (hasZtools) {
      try { return !!ztools.copyText(text); } catch { /* fallthrough */ }
    }
    return false;
  }
  /** 拖放 File 对象 → 本地路径（Electron 41 中 File.path 已移除，必须走 webUtils） */
  function pathForFile(file) {
    if (hasZtools) {
      try { return ztools.getPathForFile(file); } catch { /* fallthrough */ }
    }
    return file && file.path;
  }

  /** 文件元信息 + 小图预览 Data URL（图床列表用） */
  async function fileMeta(p) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return null;
      let dataUrl = null;
      if (st.size <= 20 * 1024 * 1024 && isImageFile(p)) {
        dataUrl = 'data:' + imagehost.contentTypeFor(imagehost.extFor(p)) + ';base64,' +
          fs.readFileSync(p).toString('base64');
      }
      return { size: st.size, dataUrl };
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------ 对外 API（前端统一从这里调用） */
  window.FK = {
    version: '0.2.0',
    host: hasZtools ? 'ztools' : 'browser',
    platform: process.platform,

    extract: {
      scan: (paths, options) => core.buildPlan(paths, options),
      execute: (plan, onProgress) => core.executePlan(plan, { onProgress }),
      undo: (journal, onProgress) => core.undoOperations(journal, { onProgress }),
    },

    imagehost: {
      /** 上传本地图片文件 */
      async uploadFile(cfg, filePath) {
        return imagehost.uploadFile(cfg, filePath);
      },
      /** 上传 Data URL（ZTools 粘贴图片 / 页内粘贴） */
      async uploadDataUrl(cfg, dataUrl, suggestedName) {
        return imagehost.uploadDataUrl(cfg, dataUrl, suggestedName);
      },
      /** 连通性测试（上传探针并清理） */
      testConfig: (cfg) => imagehost.testConfig(cfg),
      /** 从图床删除对象 */
      removeObject: (cfg, key) => imagehost.removeObject(cfg, key),
      /** 生成公开 URL（不实际上传，预览用） */
      publicUrl: (cfg, key) => imagehost.publicUrl(cfg, key),
      defaultTemplate: imagehost.DEFAULT_TEMPLATE,
      isImageFile,
    },

    dialogs: { pickFolders, pickImages, readClipboardFolders, readClipboardImagePaths, readClipboardText, filterDirs, filterImages },
    util: { revealInFolder, openPath, copyText, isDir, pathForFile, fileMeta },

    history: { list: listHistory, push: pushHistory, clear: clearHistory, replace: replaceHistory },
    imageHistory: { list: listImageHistory, push: pushImageHistory, clear: clearImageHistory, replace: replaceImageHistory },
    settings: { get: getSettings, update: updateSettings },
  };

  /* ------------------------------------------------ MCP 工具：上传图片（供 ZTools AI 调用） */
  if (hasZtools && typeof ztools.registerTool === 'function') {
    ztools.registerTool('upload_image', async (input) => {
      const cfg = getSettings().s3;
      try {
        let r;
        if (input && input.path) r = await imagehost.uploadFile(cfg, input.path);
        else if (input && input.dataUrl) r = await imagehost.uploadDataUrl(cfg, input.dataUrl);
        else return { ok: false, error: '需要提供 path 或 dataUrl' };
        return { ok: true, url: r.url, key: r.key, size: r.size };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    });
  }

  /* ------------------------------------------------ 插件入口：全部文件/图片都交给页面 */
  if (hasZtools) {
    try { ztools.setExpendHeight(648); } catch { /* 忽略不支持的宿主 */ }

    ztools.onPluginEnter(({ code, type, payload }) => {
      if (type === 'files' && Array.isArray(payload)) {
        // ★ 修复点：全部文件/文件夹都交给页面，而不是只处理第一个
        const dirs = payload.filter((f) => f && f.isDirectory && f.path).map((f) => f.path);
        const files = payload.filter((f) => f && f.isFile && f.path).map((f) => f.path);
        if (code === 'image-host') {
          window.dispatchEvent(new CustomEvent('fk:enter-image-files', { detail: { paths: files } }));
        } else if (code === 'extract-folder') {
          window.dispatchEvent(new CustomEvent('fk:enter-files', { detail: { dirs } }));
        }
        return;
      }
      if (type === 'img' && typeof payload === 'string' && payload) {
        window.dispatchEvent(new CustomEvent('fk:enter-image-data', { detail: { dataUrl: payload } }));
        return;
      }
      // 关键字进入：按 code 路由视图
      const viewByCode = { 'extract-folder': 'extract', 'image-host': 'imagehost' };
      window.dispatchEvent(new CustomEvent('fk:navigate', { detail: { view: viewByCode[code] || 'extract' } }));
    });
  }
})();
