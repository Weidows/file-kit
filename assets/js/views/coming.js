'use strict';
/* 视图：规划中的功能占位页 —— 每个功能对应一个已预留的接口位 */
(function () {
  const { h, icon } = window.FK_UI;

  const PLANNED = [
    {
      id: 'rename',
      title: '批量重命名',
      icon: 'rename',
      desc: '按序号、正则替换、查找替换等规则批量重命名文件，支持实时预览。',
    },
    {
      id: 'dedupe',
      title: '重复文件清理',
      icon: 'dedupe',
      desc: '按大小 + 哈希扫描重复文件，按规则保留一份，其余安全删除。',
    },
    {
      id: 'stats',
      title: '文件夹统计',
      icon: 'stats',
      desc: '统计文件夹大小分布、文件类型占比，快速找到占空间的目录。',
    },
  ];

  function mount(root) {
    root.append(h('div', { class: 'coming-grid' }, PLANNED.map((f) =>
      h('div', { class: 'card coming-card', id: 'feature-' + f.id },
        h('div', { class: 'coming-icon' }, icon(f.icon, 22)),
        h('div', { class: 'coming-title' }, f.title,
          h('span', { class: 'badge b-plan' }, '规划中')),
        h('div', { class: 'coming-desc' }, f.desc)))));

    root.append(h('div', { class: 'card dev-note' },
      h('div', { class: 'dev-note-title' }, icon('info'), '给未来功能的接口已预留'),
      h('div', { class: 'dev-note-body' },
        h('div', null, '· 视图层：在 ', h('code', null, 'assets/js/views/'), ' 下新建视图并调用 ',
          h('code', null, 'FK_UI.registerView({...})'), '，侧边栏自动出现入口；'),
        h('div', null, '· 后端层：在 ', h('code', null, 'core/'), ' 下新增纯 Node 逻辑模块，经 ',
          h('code', null, 'preload.js'), ' 挂到 ', h('code', null, 'window.FK'), '；'),
        h('div', null, '· 触发入口：在 ', h('code', null, 'plugin.json'),
          ' 的 features 中添加关键字或文件类型即可被 uTools 检索与拖入触发。'))));
  }

  window.FK_UI.registerView({
    id: 'more',
    title: '更多功能',
    desc: '已预留扩展位，逐步建设',
    icon: 'layers',
    ready: true,
    order: 90,
    mount,
  });
})();
