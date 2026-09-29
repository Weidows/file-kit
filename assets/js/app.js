'use strict';
/* 应用壳：侧边栏（由视图注册表自动生成）、路由、主题 */
(function () {
  const { h, icon } = window.FK_UI;

  /* ---------------- 主题 ---------------- */
  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    if (window.FK.isUtools) {
      try { return window.utools.isDarkColors() ? 'dark' : 'light'; } catch { /* ignore */ }
    }
    return 'dark';
  }
  function applyTheme(pref) {
    const t = resolveTheme(pref);
    document.documentElement.dataset.theme = t;
  }
  window.FK_UI.applyTheme = applyTheme;

  /* ---------------- 路由 ---------------- */
  let navEl = null;
  let viewEl = null;
  let titleEl = null;
  let descEl = null;
  let activeId = null;
  let activeInstance = null; // mount() 返回的视图实例（可带 onFiles 等钩子）

  function navigate(id) {
    const view = window.FK_UI.views.find((v) => v.id === id && v.ready);
    if (!view) return;
    activeId = id;
    viewEl.replaceChildren();
    viewEl.scrollTop = 0;
    viewEl.classList.remove('view-anim');
    void viewEl.offsetWidth; // 重启动画
    viewEl.classList.add('view-anim');
    titleEl.textContent = view.title;
    descEl.textContent = view.desc || '';
    activeInstance = view.mount(viewEl) || null;
    if (navEl) {
      navEl.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.id === id);
      });
    }
    window.FK.settings.update({ lastView: id });
  }
  window.FK_UI.navigate = navigate;
  window.FK_UI.getActiveView = () => activeInstance;

  /* ---------------- 侧边栏 ---------------- */
  function renderSidebar() {
    const views = [...window.FK_UI.views].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    navEl.replaceChildren(...views.map((v) =>
      h('div', {
        class: 'nav-item' + (v.ready ? '' : ' coming') + (v.id === activeId ? ' active' : ''),
        'data-id': v.id,
        onclick: () => { if (v.ready) navigate(v.id); },
        title: v.ready ? v.title : v.title + '（规划中）',
      }, icon(v.icon), h('span', { class: 'nav-label' }, v.title),
        v.ready ? null : h('span', { class: 'badge-coming' }, '规划中'))));
  }

  /* ---------------- 启动 ---------------- */
  window.addEventListener('DOMContentLoaded', () => {
    navEl = document.getElementById('sidebar');
    viewEl = document.getElementById('view');
    titleEl = document.getElementById('view-title');
    descEl = document.getElementById('view-desc');

    applyTheme(window.FK.settings.get().theme || 'dark');
    renderSidebar();

    const saved = window.FK.settings.get().lastView;
    const firstReady = window.FK_UI.views.filter((v) => v.ready).sort((a, b) => (a.order ?? 50) - (b.order ?? 50))[0];
    navigate(saved && window.FK_UI.views.some((v) => v.id === saved && v.ready) ? saved : firstReady.id);

    /* uTools/ZTools 带文件或图片进入（多选全部生效） */
    window.addEventListener('fk:enter-files', (e) => {
      navigate('extract');
      if (activeInstance && activeInstance.onFiles) activeInstance.onFiles(e.detail.dirs);
    });
    window.addEventListener('fk:enter-image-files', (e) => {
      navigate('imagehost');
      if (activeInstance && activeInstance.onFiles) activeInstance.onFiles(e.detail.paths);
    });
    window.addEventListener('fk:enter-image-data', (e) => {
      navigate('imagehost');
      if (activeInstance && activeInstance.onImageData) activeInstance.onImageData(e.detail.dataUrl);
    });
    /* 关键字进入指定视图 */
    window.addEventListener('fk:navigate', (e) => navigate(e.detail.view));

    /* 版本号 */
    const ver = document.getElementById('sidebar-ver');
    if (ver) ver.textContent = 'v' + window.FK.version;
  });
})();
