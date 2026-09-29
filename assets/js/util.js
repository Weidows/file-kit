'use strict';
/* 通用工具：DOM 构建、图标、格式化、toast、确认弹窗 */
(function () {
  /** 构建 DOM 元素；attrs.class/style/on*；children 递归展开，文本安全 */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v; // 仅用于可信的内置 SVG
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function icon(name, size) {
    const path = window.FK_ICONS[name] || window.FK_ICONS.file;
    const svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
    return h('span', { class: 'icon' + (size ? ' icon-' + size : ''), html: svg });
  }

  function fmtSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '-';
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let i = -1;
    do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
    return (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function ellipsizeMiddle(s, max) {
    s = String(s);
    if (s.length <= max) return s;
    const half = Math.floor((max - 1) / 2);
    return s.slice(0, half) + '…' + s.slice(s.length - half);
  }

  /* ---------------- toast ---------------- */
  let toastBox = null;
  const TOAST_STYLE = {
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    err: 'var(--err)',
    info: 'var(--acc)',
  };
  function toast(message, type) {
    if (!toastBox) {
      toastBox = h('div', { id: 'toasts' });
      document.body.append(toastBox);
    }
    const item = h('div', { class: 'toast toast-' + (type || 'info') },
      h('span', { class: 'toast-dot', style: { background: TOAST_STYLE[type] || TOAST_STYLE.info } }),
      h('span', null, message));
    toastBox.append(item);
    setTimeout(() => {
      item.classList.add('out');
      setTimeout(() => item.remove(), 300);
    }, type === 'err' ? 5000 : 2600);
  }

  /* ---------------- 确认弹窗 ---------------- */
  /**
   * confirmModal({title, body, okText, okStyle:'danger'|'primary', cancelText})
   * @returns {Promise<boolean>}
   */
  function confirmModal(opts) {
    return new Promise((resolve) => {
      const overlay = h('div', { class: 'modal-overlay' });
      const close = (val) => {
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 160);
        resolve(val);
      };
      const card = h('div', { class: 'modal' },
        h('div', { class: 'modal-title' },
          icon(opts.icon || 'info'), h('span', null, opts.title || '确认操作')),
        h('div', { class: 'modal-body' }, opts.body || ''),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn btn-ghost', onclick: () => close(false) }, opts.cancelText || '取消'),
          h('button', {
            class: 'btn ' + (opts.okStyle === 'danger' ? 'btn-danger' : 'btn-primary'),
            onclick: () => close(true),
          }, opts.okText || '确定')));
      overlay.append(card);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.body.append(overlay);
    });
  }

  window.FK_UI = {
    h, icon, fmtSize, fmtTime, ellipsizeMiddle, toast, confirmModal,
    views: [], // 视图注册表，app.js 消费
    registerView(view) { window.FK_UI.views.push(view); },
  };
})();
