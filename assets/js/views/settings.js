'use strict';
/* 视图：设置（主题 / S3 图床配置 / 数据 / 关于） */
(function () {
  const { h, icon, toast, confirmModal } = window.FK_UI;

  const FIELDS = [
    ['endpoint', '服务地址 (Endpoint)', '例如 https://fs.weidows.tech'],
    ['bucket', '存储桶 (Bucket)', '例如 img'],
    ['region', '区域 (Region)', 'S3 签名用，一般 us-east-1'],
    ['accessKey', 'AccessKey', '访问密钥 ID'],
    ['secretKey', 'SecretKey', '访问密钥 Secret（仅保存在本机插件存储中）'],
    ['publicBase', '公开访问前缀 (可选)', '例如 https://fs.weidows.tech/img；留空则用 endpoint/bucket'],
    ['pathTemplate', '路径模板', '占位符：{YYYY} {MM} {DD} {date} {timestamp} {name} {ext} {rand}'],
  ];
  const SECRET_FIELDS = ['secretKey'];

  function mount(root) {
    const settings = window.FK.settings.get();
    const theme = settings.theme || 'dark';

    /* 主题 */
    const seg = h('div', { class: 'seg' }, [
      ['dark', '深色'], ['light', '浅色'], ['auto', '跟随系统'],
    ].map(([v, label]) => h('button', {
      class: 'seg-item' + (theme === v ? ' active' : ''),
      onclick: (e) => {
        window.FK_UI.applyTheme(v);
        window.FK.settings.update({ theme: v });
        seg.querySelectorAll('.seg-item').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    }, label)));

    root.append(h('div', { class: 'card settings-card' },
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-label' }, icon('moon'), '外观主题'),
        seg)));

    /* S3 图床配置 */
    const s3 = Object.assign(
      { pathTemplate: window.FK.imagehost.defaultTemplate, region: 'us-east-1' },
      settings.s3 || {}
    );
    const inputs = {};
    const s3Form = h('div', { class: 's3-form' }, FIELDS.map(([key, label, hint]) => {
      const input = h('input', {
        type: SECRET_FIELDS.includes(key) ? 'password' : 'text',
        class: 'input',
        placeholder: hint,
        value: s3[key] || '',
      });
      inputs[key] = input;
      return h('div', { class: 'field s3-field' },
        h('label', { title: hint }, label),
        input);
    }));

    const cfgSummary = h('div', { class: 'settings-sub' });
    function renderCfgSummary() {
      const c = window.FK.settings.get().s3 || {};
      cfgSummary.textContent = c.endpoint
        ? '当前：' + c.endpoint.replace(/^https?:\/\//, '') + ' / ' + (c.bucket || '?')
        : '未配置';
    }
    renderCfgSummary();

    const testResult = h('div', { class: 'settings-sub' });

    function readForm() {
      const out = {};
      for (const [key] of FIELDS) out[key] = inputs[key].value.trim();
      return out;
    }

    const btnSave = h('button', {
      class: 'btn btn-primary',
      onclick: () => {
        const form = readForm();
        const missing = ['endpoint', 'bucket', 'accessKey', 'secretKey'].filter((k) => !form[k]);
        if (missing.length) { toast('缺少必填项：' + missing.join(' / '), 'warn'); return; }
        window.FK.settings.update({ s3: form });
        renderCfgSummary();
        toast('S3 配置已保存（仅保存在本机）', 'ok');
      },
    }, icon('check'), '保存配置');

    const btnTest = h('button', {
      class: 'btn btn-ghost',
      disabled: false,
      onclick: async () => {
        const form = readForm();
        const saved = window.FK.settings.get().s3 || {};
        const merged = Object.assign({}, saved, form);
        const missing = ['endpoint', 'bucket', 'accessKey', 'secretKey'].filter((k) => !merged[k]);
        if (missing.length) { toast('缺少必填项：' + missing.join(' / '), 'warn'); return; }
        btnTest.disabled = true;
        testResult.textContent = '测试中…（上传探针文件并清理）';
        try {
          const r = await window.FK.imagehost.testConfig(merged);
          testResult.textContent = '✔ ' + r.message + '　探针 URL：' + r.url;
        } catch (err) {
          testResult.textContent = '✘ ' + ((err && err.message) || String(err));
        } finally {
          btnTest.disabled = false;
        }
      },
    }, icon('scan'), '测试连接');

    root.append(h('div', { class: 'card settings-card' },
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-label' }, icon('logo'),
          h('div', null,
            h('div', null, 'S3 图床（兼容 MinIO / RustFS / 阿里云 OSS 等）'),
            cfgSummary))),
      s3Form,
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-sub' }, '密钥只保存在本机插件存储中；开发目录下也可用 config.local.json 提供（已加入 .gitignore）'),
        h('div', { class: 'modal-actions', style: { margin: '0' } }, btnSave, btnTest)),
      testResult));

    /* 数据 */
    const historyCount = window.FK.history.list().length;
    const imageHistoryCount = window.FK.imageHistory.list().length;
    root.append(h('div', { class: 'card settings-card' },
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-label' }, icon('history'),
          h('div', null,
            h('div', null, '操作记录'),
            h('div', { class: 'settings-sub' }, '解散文件夹 ' + historyCount + ' 条 · 图床上传 ' + imageHistoryCount + ' 条'))),
        h('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            const go = await confirmModal({ title: '清空全部记录？', body: '只删除记录，不影响已完成的上传/文件操作。', okText: '清空', okStyle: 'danger', icon: 'trash' });
            if (go) {
              window.FK.history.clear();
              window.FK.imageHistory.clear();
              toast('记录已清空', 'ok');
            }
          },
        }, icon('trash'), '清空'))));

    /* 关于 */
    root.append(h('div', { class: 'card settings-card about-card' },
      h('div', { class: 'about-logo' }, icon('logo', 26)),
      h('div', { class: 'about-text' },
        h('div', { class: 'about-name' }, '文件工具箱 ', h('span', { class: 'settings-sub' }, 'v' + window.FK.version + ' · for ZTools')),
        h('div', { class: 'settings-sub' }, '解散文件夹 · S3 图床上传，持续扩展中。'))));
  }

  window.FK_UI.registerView({
    id: 'settings',
    title: '设置',
    desc: '外观、图床配置与数据管理',
    icon: 'settings',
    ready: true,
    order: 99,
    mount,
  });
})();
