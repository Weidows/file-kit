'use strict';
/* 视图：图床上传（image-host）——拖入/粘贴/选择图片，上传到 S3 兼容图床并复制链接 */
(function () {
  const { h, icon, fmtSize, fmtTime, ellipsizeMiddle, toast, confirmModal } = window.FK_UI;

  const OPT_DEFAULTS = { autoUpload: true, autoCopy: 'url' }; // autoCopy: 'none' | 'url' | 'markdown'
  let uidSeed = 1;
  let pasteBound = false; // 页内粘贴监听只挂一次，靠 isImageHost 钩子判断归属

  function mount(root) {
    const state = {
      options: Object.assign({}, OPT_DEFAULTS, (window.FK.settings.get().imagehost) || {}),
      items: [], // {id, name, size, previewUrl, source:'file'|'data', path?, dataUrl?, status, url?, key?, error?}
      uploading: false,
    };
    const saveOptions = () => window.FK.settings.update({ imagehost: state.options });
    const cfg = () => (window.FK.settings.get().s3 || null);
    const cfgReady = () => {
      const c = cfg();
      return !!(c && c.endpoint && c.bucket && c.accessKey && c.secretKey);
    };

    /* ---------------- 配置提示 ---------------- */
    const cfgBanner = h('div', { class: 'card cfg-banner' });
    function renderCfgBanner() {
      if (cfgReady()) {
        cfgBanner.classList.add('hidden');
        cfgBanner.replaceChildren();
        return;
      }
      cfgBanner.classList.remove('hidden');
      cfgBanner.replaceChildren(
        h('div', { class: 'cfg-banner-row' },
          icon('warn'),
          h('div', { class: 'cfg-banner-text' },
            h('div', { class: 'rb-title' }, '还没有配置 S3 图床'),
            h('div', { class: 'rb-sub' }, '需要 endpoint、bucket、AccessKey、SecretKey，可在「设置 → S3 图床」中填写')),
          h('button', { class: 'btn btn-primary', onclick: () => window.FK_UI.navigate('settings') }, icon('settings'), '去配置')));
    }

    /* ---------------- 添加区 ---------------- */
    const queueBox = h('div', { class: 'chiplist' });
    const adderHint = h('div', { class: 'adder-hint' });

    function renderItem(it) {
      const badges = {
        pending: h('span', { class: 'badge b-skip' }, '待上传'),
        uploading: h('span', { class: 'badge b-warn' }, '上传中…'),
        ok: h('span', { class: 'badge b-ok' }, '成功'),
        fail: h('span', { class: 'badge b-overwrite' }, '失败'),
      };
      const actions = [];
      if (it.status === 'fail' || it.status === 'pending') {
        actions.push(h('button', {
          class: 'btn btn-mini ' + (it.status === 'fail' ? 'btn-primary' : 'btn-ghost'),
          onclick: () => uploadItems([it]),
        }, icon('play'), it.status === 'fail' ? '重试' : '上传'));
      }
      if (it.status === 'ok') {
        actions.push(
          h('button', { class: 'btn btn-mini btn-ghost', onclick: () => copyLink(it, 'url') }, '复制链接'),
          h('button', { class: 'btn btn-mini btn-ghost', title: '复制 Markdown', onclick: () => copyLink(it, 'markdown') }, 'MD'),
          h('button', { class: 'btn btn-mini btn-ghost', onclick: () => window.FK.util.openPath(it.url) }, '打开'));
      }
      actions.push(h('button', {
        class: 'chip-btn chip-btn-x', title: '移除',
        onclick: () => {
          state.items = state.items.filter((x) => x.id !== it.id);
          renderQueue();
        },
      }, icon('x')));
      return h('div', { class: 'chip up-item up-' + it.status },
        h('div', { class: 'up-thumb' }, it.previewUrl
          ? h('img', { src: it.previewUrl, alt: '' })
          : icon('file', 20)),
        h('div', { class: 'chip-text' },
          h('div', { class: 'chip-name', title: it.name }, it.name),
          h('div', { class: 'chip-path' },
            it.status === 'ok' ? ellipsizeMiddle(it.url || '', 64) + ' · ' + fmtSize(it.size)
              : fmtSize(it.size) + (it.error ? ' · ' + ellipsizeMiddle(it.error, 40) : ''))),
        badges[it.status],
        h('div', { class: 'up-actions' }, actions));
    }

    function renderQueue() {
      adderHint.textContent = state.items.length
        ? '共 ' + state.items.length + ' 个待处理图片'
        : '';
      if (!state.items.length) {
        queueBox.replaceChildren(h('div', { class: 'chips-empty' }, '尚未添加图片'));
        return;
      }
      queueBox.replaceChildren(...state.items.map(renderItem));
    }

    function addFiles(paths) {
      let added = 0;
      for (const p of paths || []) {
        state.items.push({
          id: 'it-' + uidSeed++,
          name: p.split(/[\\/]/).pop(),
          size: 0,
          previewUrl: null,
          source: 'file',
          path: p,
          status: 'pending',
        });
        added++;
        // 读取大小与缩略图（失败不阻塞）
        const it = state.items[state.items.length - 1];
        window.FK.util.fileMeta(p).then((meta) => {
          if (!meta) return;
          it.size = meta.size;
          if (meta.dataUrl && meta.size <= 20 * 1024 * 1024) it.previewUrl = meta.dataUrl;
          renderQueue();
        });
      }
      if (added) { renderQueue(); renderActions(); if (state.options.autoUpload) uploadAll(); }
      return added;
    }

    function addDataUrl(dataUrl, suggestedName) {
      const m = /^data:([^;,]+)(;base64)?,/i.exec(String(dataUrl || ''));
      if (!m) { toast('不是合法的图片数据', 'warn'); return 0; }
      const mime = m[1].toLowerCase();
      if (!mime.startsWith('image/')) { toast('剪贴板内容不是图片', 'warn'); return 0; }
      const b64 = String(dataUrl).slice(m[0].length).replace(/\s/g, '');
      const size = m[2] ? Math.floor(b64.length * 3 / 4) : b64.length;
      const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpeg');
      state.items.push({
        id: 'it-' + uidSeed++,
        name: suggestedName || 'clipboard-' + Date.now() + '.' + (mime === 'image/jpeg' ? 'jpg' : ext),
        size,
        previewUrl: dataUrl,
        source: 'data',
        dataUrl,
        status: 'pending',
      });
      renderQueue(); renderActions();
      if (state.options.autoUpload) uploadAll();
      return 1;
    }

    /* 拖拽 + 粘贴 */
    const dropzone = h('div', { class: 'dropzone', tabindex: '0' },
      h('div', { class: 'dropzone-icon' }, icon('file', 30)),
      h('div', { class: 'dropzone-main' },
        h('div', { class: 'dropzone-title' }, '把图片拖到这里，或直接 Ctrl+V 粘贴'),
        h('div', { class: 'dropzone-sub' }, '截图后在 ZTools 主输入框粘贴并选择「上传图床」也可以')));
    ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); dropzone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); dropzone.classList.remove('over');
    }));
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const paths = [];
      for (const f of dt.files || []) {
        const p = window.FK.util.pathForFile(f);
        if (p) paths.push(p);
      }
      const images = paths.filter((p) => window.FK.imagehost.isImageFile(p));
      if (images.length) { addFiles(images); toast('已添加 ' + images.length + ' 张图片', 'ok'); return; }
      // 非文件拖拽（如网页图片）
      const html = dt.getData && dt.getData('text/html');
      const m = html && /<img[^>]+src=["']([^"']+)["']/i.exec(html);
      if (m && /^data:image\//i.test(m[1])) { addDataUrl(m[1]); return; }
      if (paths.length) toast('拖入的内容不是图片文件', 'warn');
    });
    // 页内粘贴：截图位图 / 复制的图片文件（监听只挂一次）
    if (!pasteBound) {
      pasteBound = true;
      document.addEventListener('paste', (e) => {
        const active = window.FK_UI.getActiveView();
        if (!active || !active.isImageHost) return;
        const dt = e.clipboardData;
        if (!dt) return;
        let handled = false;
        for (const item of dt.items || []) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const f = item.getAsFile();
            const p = f && window.FK.util.pathForFile(f);
            if (p && window.FK.imagehost.isImageFile(p)) { active.onFiles([p]); handled = true; }
            else if (f) {
              const reader = new FileReader();
              reader.onload = () => active.onImageData(String(reader.result));
              reader.readAsDataURL(f);
              handled = true;
            }
          }
        }
        if (handled) e.preventDefault();
      });
    }

    const btnPick = h('button', {
      class: 'btn btn-primary',
      onclick: async () => {
        const paths = await window.FK.dialogs.pickImages();
        if (paths && paths.length) { addFiles(paths); toast('已添加 ' + paths.length + ' 张图片', 'ok'); }
      },
    }, icon('plus'), '选择图片');
    const btnClipboard = h('button', {
      class: 'btn btn-ghost',
      onclick: () => {
        const paths = window.FK.dialogs.readClipboardImagePaths();
        if (paths.length) { addFiles(paths); toast('已从剪贴板添加 ' + paths.length + ' 张图片', 'ok'); }
        else toast('剪贴板中没有图片文件（截图请用 Ctrl+V 粘贴）', 'info');
      },
    }, icon('clipboard'), '从剪贴板导入');

    /* ---------------- 选项 ---------------- */
    function seg(values, current, onChange) {
      return h('div', { class: 'seg' }, values.map(([v, label, title]) =>
        h('button', {
          class: 'seg-item' + (v === current ? ' active' : ''),
          title: title || '',
          onclick: () => onChange(v),
        }, label)));
    }
    const targetDesc = h('div', { class: 'adder-hint' });
    function renderTargetDesc() {
      const c = cfg();
      targetDesc.textContent = cfgReady()
        ? '目标：' + c.endpoint.replace(/^https?:\/\//, '') + ' / ' + c.bucket + '　·　路径模板：' + (c.pathTemplate || window.FK.imagehost.defaultTemplate)
        : '尚未配置图床';
    }
    const optionsBox = h('div', { class: 'opt-grid opt-grid-2' },
      h('div', { class: 'opt' },
        h('div', { class: 'opt-label' }, icon('play'), '上传方式'),
        seg([['auto', '添加后自动上传'], ['manual', '手动逐个上传']],
          state.options.autoUpload ? 'auto' : 'manual',
          (v) => { state.options.autoUpload = v === 'auto'; saveOptions(); })),
      h('div', { class: 'opt' },
        h('div', { class: 'opt-label' }, icon('check'), '上传成功后自动复制'),
        seg([['none', '不复制'], ['url', '链接'], ['markdown', 'Markdown']],
          state.options.autoCopy,
          (v) => { state.options.autoCopy = v; saveOptions(); })));
    const optionsCard = h('div', { class: 'card' }, optionsBox, targetDesc);

    /* ---------------- 上传 ---------------- */
    async function uploadItems(items) {
      if (!cfgReady()) { toast('请先在设置中配置 S3 图床', 'warn'); return; }
      for (const it of items) {
        if (it.status === 'ok' || it.status === 'uploading') continue;
        it.status = 'uploading';
        renderQueue();
        try {
          const r = it.source === 'file'
            ? await window.FK.imagehost.uploadFile(cfg(), it.path)
            : await window.FK.imagehost.uploadDataUrl(cfg(), it.dataUrl, it.name);
          it.status = 'ok';
          it.url = r.url;
          it.key = r.key;
          it.size = r.size;
          window.FK.imageHistory.push({
            id: 'up-' + Date.now() + '-' + it.id,
            time: new Date().toISOString(),
            name: it.name,
            url: r.url,
            key: r.key,
            size: r.size,
          });
          renderHistory();
          if (state.options.autoCopy !== 'none') copyLink(it, state.options.autoCopy, true);
          else toast('上传成功：' + it.name, 'ok');
        } catch (e) {
          it.status = 'fail';
          it.error = (e && e.message) || String(e);
          if ((e && e.code) === 'CONFIG_INCOMPLETE') toast(it.error, 'err');
          else toast('上传失败：' + it.name + '（' + it.error + '）', 'err');
        }
        renderQueue();
      }
      renderActions();
    }

    async function uploadAll() {
      if (state.uploading) return;
      state.uploading = true;
      renderActions();
      await uploadItems(state.items.filter((it) => it.status === 'pending' || it.status === 'fail'));
      state.uploading = false;
      renderActions();
      const okCount = state.items.filter((i) => i.status === 'ok').length;
      if (okCount) toast('本批完成：' + okCount + '/' + state.items.length + ' 张成功', okCount === state.items.length ? 'ok' : 'warn');
    }

    function copyLink(it, format, quiet) {
      if (it.status !== 'ok' || !it.url) return;
      const text = format === 'markdown'
        ? '![' + it.name.replace(/\.[^.]+$/, '') + '](' + it.url + ')'
        : it.url;
      if (!window.FK.util.copyText(text)) {
        toast('复制失败，请手动复制', 'err');
        return;
      }
      if (!quiet) toast(format === 'markdown' ? '已复制 Markdown' : '已复制链接', 'ok');
    }

    /* ---------------- 操作行 ---------------- */
    const actionsBox = h('div', { class: 'actions' });
    function renderActions() {
      const pending = state.items.some((it) => it.status === 'pending' || it.status === 'fail');
      const btnUpload = h('button', {
        class: 'btn btn-primary btn-lg',
        disabled: state.uploading || !pending || !state.items.length,
        onclick: uploadAll,
      }, icon('play'), '上传全部');
      const btnClear = h('button', {
        class: 'btn btn-ghost',
        onclick: () => { state.items = []; renderQueue(); renderActions(); },
      }, icon('trash'), '清空列表');
      actionsBox.replaceChildren(btnUpload, btnClear);
    }

    /* ---------------- 历史 ---------------- */
    const historyBox = h('div', { class: 'section' });
    function renderHistory() {
      historyBox.replaceChildren();
      const records = window.FK.imageHistory.list();
      if (!records.length) return;
      historyBox.append(h('div', { class: 'section-title' }, icon('history'), '上传记录',
        h('button', {
          class: 'btn btn-mini btn-ghost', style: { marginLeft: 'auto' },
          onclick: async () => {
            const go = await confirmModal({ title: '清空上传记录？', body: '只删除记录，不会删除图床上的文件。', okText: '清空', okStyle: 'danger', icon: 'trash' });
            if (go) { window.FK.imageHistory.clear(); renderHistory(); }
          },
        }, '清空记录')));
      historyBox.append(h('div', { class: 'history-list' }, records.map((rec) =>
        h('div', { class: 'history-row' },
          icon('file'),
          h('div', { class: 'history-text' },
            h('div', { class: 'history-label', title: rec.url }, rec.name + '　' + fmtSize(rec.size)),
            h('div', { class: 'history-meta' }, fmtTime(rec.time) + ' · ' + ellipsizeMiddle(rec.url, 72))),
          h('button', { class: 'btn btn-mini btn-ghost', onclick: () => {
            window.FK.util.copyText(rec.url)
              ? toast('已复制链接', 'ok')
              : toast('复制失败', 'err');
          } }, '复制'),
          h('button', { class: 'btn btn-mini btn-ghost', title: '复制 Markdown', onclick: () => {
            window.FK.util.copyText('![' + rec.name.replace(/\.[^.]+$/, '') + '](' + rec.url + ')')
              ? toast('已复制 Markdown', 'ok')
              : toast('复制失败', 'err');
          } }, 'MD'),
          h('button', {
            class: 'btn btn-mini btn-ghost', title: '从图床删除该文件并移除记录',
            onclick: async (e) => {
              const delBtn = e.currentTarget; // 同步阶段先捕获，await 之后事件对象会失效
              const go = await confirmModal({
                title: '删除这张图？',
                body: h('div', null, '将从图床删除文件并移除本地记录：', h('br'), ellipsizeMiddle(rec.url, 60)),
                okText: '删除', okStyle: 'danger', icon: 'trash',
              });
              if (!go) return;
              delBtn.disabled = true;
              delBtn.textContent = '删除中…';
              try {
                await window.FK.imagehost.removeObject(cfg(), rec.key);
                window.FK.imageHistory.replace(window.FK.imageHistory.list().filter((r) => r.id !== rec.id));
                renderHistory();
                toast('已删除：' + rec.name, 'ok');
              } catch (err) {
                toast('删除失败：' + (err && err.message), 'err');
                delBtn.disabled = false;
                delBtn.textContent = '删除';
              }
            },
          }, icon('trash'))))));
    }

    /* ---------------- 组装 ---------------- */
    const adderCard = h('div', { class: 'card' }, dropzone, queueBox, adderHint,
      h('div', { class: 'adder-actions' }, btnPick, btnClipboard));

    root.append(cfgBanner, adderCard, optionsCard, actionsBox, historyBox);

    function renderAll() {
      renderCfgBanner();
      renderQueue();
      renderActions();
      renderTargetDesc();
      renderHistory();
    }
    renderAll();

    return {
      isImageHost: true,
      onFiles: (paths) => { addFiles(window.FK.dialogs.filterImages(paths || [])); },
      onImageData: (dataUrl, name) => { addDataUrl(dataUrl, name); },
    };
  }

  window.FK_UI.registerView({
    id: 'imagehost',
    title: '图床上传',
    desc: '把图片上传到 S3 兼容图床，复制公开链接',
    icon: 'file',
    ready: true,
    order: 1,
    mount,
  });
})();
