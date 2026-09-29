'use strict';
/* 视图：解散文件夹（extract-folder） */
(function () {
  const { h, icon, fmtSize, fmtTime, ellipsizeMiddle, toast, confirmModal } = window.FK_UI;

  const OPT_KEY_DEFAULTS = { target: 'parent', customTarget: '', mode: 'top', conflict: 'rename' };
  const MAX_OP_ROWS = 80;

  function mount(root) {
    const state = {
      paths: [], // 去重后的文件夹路径
      options: Object.assign({}, OPT_KEY_DEFAULTS, (window.FK.settings.get().extract) || {}),
      plan: null,
      lastResult: null, // { result, historyId }
      busy: false,
    };

    const saveOptions = () => window.FK.settings.update({ extract: state.options });

    /* ---------------- 顶部步骤 ---------------- */
    const stepsBox = h('div', { class: 'steps' });

    function renderSteps() {
      const phase = state.lastResult ? 3 : state.plan ? 2 : 1;
      const items = [['添加文件夹', 'folder'], ['预览确认', 'scan'], ['执行完成', 'check']];
      stepsBox.replaceChildren(...items.map(([label, ic], i) => {
        const idx = i + 1;
        return h('div', { class: 'step' + (idx === phase ? ' active' : '') + (idx < phase ? ' done' : '') },
          h('span', { class: 'step-num' }, idx < phase ? icon('check', 12) : String(idx)),
          h('span', null, label),
          idx < 3 ? h('span', { class: 'step-line' }) : null);
      }));
    }

    /* ---------------- 添加文件夹 ---------------- */
    const chipsBox = h('div', { class: 'chiplist' });
    const adderHint = h('div', { class: 'adder-hint' });

    function renderChips() {
      adderHint.textContent = state.paths.length
        ? '已添加 ' + state.paths.length + ' 个文件夹，可继续拖入或从剪贴板追加'
        : '';
      if (!state.paths.length) {
        chipsBox.replaceChildren(h('div', { class: 'chips-empty' }, '尚未添加文件夹'));
        return;
      }
      chipsBox.replaceChildren(...state.paths.map((p) =>
        h('div', { class: 'chip', title: p },
          icon('folder'),
          h('div', { class: 'chip-text' },
            h('div', { class: 'chip-name' }, p.split('\\').pop().split('/').pop()),
            h('div', { class: 'chip-path' }, ellipsizeMiddle(p, 64))),
          h('button', {
            class: 'chip-btn', title: '在资源管理器中显示',
            onclick: () => window.FK.util.revealInFolder(p),
          }, icon('reveal')),
          h('button', {
            class: 'chip-btn chip-btn-x', title: '移除',
            onclick: () => { state.paths = state.paths.filter((x) => x !== p); state.plan = null; state.lastResult = null; renderAll(); },
          }, icon('x')))));
    }

    async function addPaths(dirs) {
      try {
        const checked = window.FK.dialogs.filterDirs(dirs);
        const bad = checked.filter((c) => !c.isDir).length;
        if (bad) toast(bad + ' 个路径不是文件夹，已忽略', 'warn');
        const valid = checked.filter((c) => c.isDir).map((c) => c.path);
        let added = 0;
        for (const p of valid) {
          const k = p.replace(/[\\/]+$/, '').toLowerCase();
          if (!state.paths.some((x) => x.replace(/[\\/]+$/, '').toLowerCase() === k)) {
            state.paths.push(p.replace(/[\\/]+$/, ''));
            added++;
          }
        }
        if (added) { state.plan = null; state.lastResult = null; renderAll(); toast('已添加 ' + added + ' 个文件夹', 'ok'); }
        else if (valid.length) toast('这些文件夹已在列表中', 'info');
      } catch (e) {
        toast('添加失败：' + (e && e.message), 'err');
        console.error(e);
      }
    }

    /* 拖拽导入 */
    const dropzone = h('div', { class: 'dropzone' },
      h('div', { class: 'dropzone-icon' }, icon('folder', 30)),
      h('div', { class: 'dropzone-main' },
        h('div', { class: 'dropzone-title' }, '把文件夹拖到这里'),
        h('div', { class: 'dropzone-sub' }, '支持一次拖入多个，也可以点击下方按钮选择')));
    ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); dropzone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); dropzone.classList.remove('over');
    }));
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const paths = new Set();
      for (const f of dt.files || []) {
        const p = window.FK.util.pathForFile(f);
        if (p) paths.add(p);
      }
      if (!paths.size) {
        for (const item of dt.items || []) {
          const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
          if (entry && entry.fullPath) paths.add(entry.fullPath);
        }
      }
      if (!paths.size) { toast('未获取到文件夹路径，请改用按钮选择', 'warn'); return; }
      addPaths([...paths]);
    });

    const btnPick = h('button', {
      class: 'btn btn-primary',
      onclick: async () => { const dirs = await window.FK.dialogs.pickFolders(); if (dirs.length) addPaths(dirs); },
    }, icon('plus'), '选择文件夹');
    const btnClipboard = h('button', {
      class: 'btn btn-ghost',
      onclick: () => { const dirs = window.FK.dialogs.readClipboardFolders(); if (dirs.length) addPaths(dirs); else toast('剪贴板中没有可识别的文件夹路径', 'info'); },
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

    const customTargetRow = h('div', { class: 'opt-extra' });

    function renderCustomTarget() {
      customTargetRow.replaceChildren();
      if (state.options.target !== 'custom') return;
      customTargetRow.append(h('div', { class: 'field' },
        h('label', null, '目标目录'),
        h('input', {
          type: 'text', class: 'input', placeholder: '例如 F:\\Movies\\Output',
          value: state.options.customTarget || '',
          onchange: (e) => {
            state.options.customTarget = e.target.value.trim();
            saveOptions(); invalidate();
          },
        })));
    }

    const optionsBox = h('div', { class: 'opt-grid' },
      h('div', { class: 'opt' },
        h('div', { class: 'opt-label' }, icon('target'), '目标位置'),
        seg([
          ['parent', '上级目录', '把文件移动到每个文件夹的上一级目录'],
          ['custom', '指定目录', '把所有文件夹的文件移动到同一个目录'],
        ], state.options.target, (v) => { state.options.target = v; saveOptions(); invalidate(); renderCustomTarget(); })),
      h('div', { class: 'opt' },
        h('div', { class: 'opt-label' }, icon('layers'), '解散方式'),
        seg([
          ['top', '仅第一层', '只把文件夹直接包含的内容移出去，子文件夹整体保留'],
          ['flatten', '递归打散', '把所有层级的文件都移到目标目录，然后删除空文件夹'],
        ], state.options.mode, (v) => { state.options.mode = v; saveOptions(); invalidate(); })),
      h('div', { class: 'opt' },
        h('div', { class: 'opt-label' }, icon('dedupe'), '重名处理'),
        seg([
          ['rename', '智能重命名', '重名文件自动命名为 "name (1).ext"'],
          ['skip', '跳过', '保留目标目录已有的同名文件'],
          ['overwrite', '覆盖', '用源文件替换目标同名文件（不可恢复）'],
        ], state.options.conflict, (v) => { state.options.conflict = v; saveOptions(); invalidate(); })));
    renderCustomTarget();

    /* ---------------- 预览 ---------------- */
    const previewBox = h('div', { class: 'section' });

    function statTile(num, label, cls) {
      return h('div', { class: 'stat' + (cls ? ' stat-' + cls : '') },
        h('div', { class: 'stat-num' }, num), h('div', { class: 'stat-label' }, label));
    }

    function opRow(op) {
      const badges = [];
      if (op.renamed) badges.push(h('span', { class: 'badge b-rename' }, '重命名'));
      if (op.overwrite) badges.push(h('span', { class: 'badge b-overwrite' }, '覆盖'));
      if (op.action === 'skip') badges.push(h('span', { class: 'badge b-skip' }, '跳过'));
      return h('div', { class: 'op-row' + (op.action === 'skip' ? ' op-skip' : '') },
        icon(op.isDir ? 'folder' : 'file'),
        h('span', { class: 'op-name', title: op.from + '  →  ' + op.to }, op.name),
        badges,
        h('span', { class: 'op-size' }, op.isDir ? '文件夹' : fmtSize(op.size)));
    }

    function groupCard(g, extraHeader) {
      const warn = (!g.exists && g.warning) || (g.errors && g.errors.length
        ? g.errors.length + ' 个条目读取失败'
        : null);
      const head = h('div', { class: 'group-head' },
        icon(g.exists ? 'folder' : 'warn'),
        h('div', { class: 'group-title' },
          h('div', { class: 'group-name', title: g.source }, g.name),
          h('div', { class: 'group-meta' },
            warn
              ? h('span', { class: 'badge b-warn' }, warn)
              : [
                  h('span', null, g.summary.files + ' 个文件'),
                  g.summary.dirs ? h('span', null, ' · ' + g.summary.dirs + ' 个子文件夹') : null,
                  h('span', null, ' · ' + fmtSize(g.summary.size)),
                  g.summary.conflicts ? h('span', { class: 'conflict-hint' }, ' · ' + g.summary.conflicts + ' 个重名') : null,
                ])),
        extraHeader);
      const body = h('div', { class: 'group-body' });
      const rows = (g.ops || []).slice(0, MAX_OP_ROWS).map(opRow);
      if ((g.ops || []).length > MAX_OP_ROWS) {
        rows.push(h('div', { class: 'op-more' }, '…还有 ' + (g.ops.length - MAX_OP_ROWS) + ' 项，此处省略'));
      }
      if (warn && g.exists) body.append(h('div', { class: 'group-errors' },
        g.errors.slice(0, 3).map((e) => h('div', { class: 'error-line', title: e.path }, ellipsizeMiddle(e.message, 60)))));
      body.append(...rows);
      return h('details', { class: 'group' + (warn ? ' group-warn' : '') }, h('summary', null, head), body);
    }

    function renderPreview() {
      previewBox.replaceChildren();
      if (!state.plan) return;
      const s = state.plan.summary;
      previewBox.append(
        h('div', { class: 'stats' },
          statTile(s.folderCount, '个文件夹'),
          statTile(s.fileCount, '个文件'),
          statTile(fmtSize(s.totalSize), '总大小'),
          s.conflictCount ? statTile(s.conflictCount, '个重名', 'warn') : statTile('0', '个重名')),
        h('div', { class: 'groups' }, state.plan.groups.map((g) => groupCard(g))));
    }

    /* ---------------- 扫描 / 执行 ---------------- */
    const actionsBox = h('div', { class: 'actions' });

    function setBusy(b) {
      state.busy = b;
      actionsBox.querySelectorAll('button').forEach((btn) => { btn.disabled = b; });
    }

    const btnScan = h('button', {
      class: 'btn btn-primary btn-lg',
      onclick: () => {
        if (!state.paths.length) return;
        setBusy(true);
        setTimeout(() => {
          try {
            state.plan = window.FK.extract.scan(state.paths, state.options);
            state.lastResult = null;
            renderAll();
            const s = state.plan.summary;
            toast('预览就绪：' + s.folderCount + ' 个文件夹，' + s.fileCount + ' 个文件', 'ok');
          } catch (e) {
            toast('扫描失败：' + (e && e.message), 'err');
          } finally {
            setBusy(false);
          }
        }, 30);
      },
    }, icon('scan'), '扫描预览');

    const btnClear = h('button', {
      class: 'btn btn-ghost',
      onclick: () => { state.paths = []; state.plan = null; state.lastResult = null; renderAll(); },
    }, icon('trash'), '清空');

    async function execute() {
      const plan = state.plan;
      if (!plan) return;
      const overwriteCount = plan.groups.reduce((n, g) => n + g.ops.filter((o) => o.overwrite).length, 0);
      if (overwriteCount) {
        const go = await confirmModal({
          title: '确认覆盖 ' + overwriteCount + ' 个同名文件？',
          body: h('div', null, '被覆盖的文件无法通过撤销恢复，请确认这是你想要的操作。'),
          okText: '覆盖并解散', okStyle: 'danger', icon: 'warn',
        });
        if (!go) return;
      }
      setBusy(true);
      const bar = h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill' }));
      const label = h('div', { class: 'progress-label' }, '准备中…');
      const progressBox = h('div', { class: 'progress' }, bar, label);
      actionsBox.replaceChildren(progressBox);

      try {
        const result = await window.FK.extract.execute(plan, (p) => {
          bar.firstChild.style.width = (p.total ? (p.done / p.total) * 100 : 0) + '%';
          label.textContent = '正在解散 ' + p.done + ' / ' + p.total + '　' + ellipsizeMiddle(p.label || '', 40);
        });
        const historyId = 'op-' + Date.now();
        window.FK.history.push({
          id: historyId,
          time: new Date().toISOString(),
          label: plan.groups.length === 1
            ? plan.groups[0].name
            : plan.groups[0].name + ' 等 ' + plan.groups.length + ' 个文件夹',
          moved: result.summary.moved,
          failed: result.summary.failed,
          undone: false,
          entries: result.journal,
        });
        state.lastResult = { result, historyId };
        renderAll();
        if (result.ok) toast('解散完成，共移动 ' + result.summary.moved + ' 项', 'ok');
        else toast('已部分完成：' + result.summary.failed + ' 项失败，详见结果', 'warn');
      } catch (e) {
        toast('执行失败：' + (e && e.message), 'err');
        renderAll();
      } finally {
        setBusy(false);
      }
    }

    const btnExecute = h('button', { class: 'btn btn-primary btn-lg', onclick: execute }, icon('play'), '立即解散');
    const btnBack = h('button', {
      class: 'btn btn-ghost',
      onclick: () => { state.plan = null; renderAll(); },
    }, '返回修改');

    /* ---------------- 结果 ---------------- */
    const resultBox = h('div', { class: 'section' });

    function renderResult() {
      resultBox.replaceChildren();
      const last = state.lastResult;
      if (!last) return;
      const { result, historyId } = last;
      const allTargets = [...new Set(result.results.map((r) => r.target).filter(Boolean))];
      const failedRows = result.results.flatMap((r) => r.failed.map((f) => ({ ...f, group: r.name })));

      resultBox.append(h('div', { class: 'result-banner ' + (result.ok ? 'rb-ok' : 'rb-warn') },
        icon(result.ok ? 'check' : 'warn'),
        h('div', null,
          h('div', { class: 'rb-title' }, result.ok ? '解散完成' : '部分完成'),
          h('div', { class: 'rb-sub' },
            '移动 ' + result.summary.moved + ' 项'
            + (result.summary.failed ? '，失败 ' + result.summary.failed + ' 项' : '')
            + (result.summary.skipped ? '，跳过 ' + result.summary.skipped + ' 项' : '')))));

      if (allTargets.length) {
        resultBox.append(h('div', { class: 'result-targets' },
          icon('folder'),
          h('span', null, allTargets.length === 1 ? '目标目录：' + allTargets[0] : '目标目录：' + allTargets.length + ' 个（见下方明细）'),
          allTargets.length === 1 ? h('button', { class: 'btn btn-mini btn-ghost', onclick: () => window.FK.util.openPath(allTargets[0]) }, '打开') : null));
      }

      resultBox.append(h('div', { class: 'groups' }, result.results.map((r) => {
        const head = h('div', { class: 'group-head' },
          icon(r.error ? 'warn' : r.failed.length ? 'warn' : 'check'),
          h('div', { class: 'group-title' },
            h('div', { class: 'group-name', title: r.source }, r.name),
            h('div', { class: 'group-meta' },
              r.skippedByPlan ? h('span', { class: 'badge b-skip' }, r.skippedByPlan)
                : r.error ? h('span', { class: 'badge b-overwrite' }, r.error)
                  : [h('span', null, '移动 ' + r.moved + ' 项'),
                     r.failed.length ? h('span', { class: 'conflict-hint' }, ' · 失败 ' + r.failed.length) : null,
                     r.residual.length ? h('span', { class: 'conflict-hint' }, ' · ' + r.residual.length + ' 个目录残留') : null])),
          h('button', { class: 'btn btn-mini btn-ghost', title: r.source, onclick: () => window.FK.util.revealInFolder(r.source) }, icon('reveal')));
        const body = h('div', { class: 'group-body' },
          r.failed.map((f) => h('div', { class: 'error-line', title: f.from }, '✕ ' + f.name + '：' + f.message)),
          r.residual.map((d) => h('div', { class: 'error-line', title: d }, '未删除（目录非空）：' + ellipsizeMiddle(d, 56))));
        return h('details', { class: 'group' + ((r.error || r.failed.length) ? ' group-warn' : '') }, h('summary', null, head), body);
      })));

      const actions = h('div', { class: 'actions' });
      if (result.summary.moved > 0) {
        actions.append(h('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            const go = await confirmModal({
              title: '撤销本次操作？',
              body: h('div', null, '将把已移动的 ' + result.summary.moved + ' 个文件移回原位。'),
              okText: '撤销', icon: 'undo',
            });
            if (!go) return;
            setBusy(true);
            try {
              const undo = await window.FK.extract.undo(result.journal, () => {});
              const records = window.FK.history.list().map((r) => r.id === historyId ? { ...r, undone: true } : r);
              window.FK.history.replace(records);
              renderHistory();
              state.lastResult = null;
              state.plan = null;
              renderAll();
              toast(undo.ok ? '已撤销，文件已移回原位' : '撤销完成，但有 ' + undo.failed.length + ' 项失败', undo.ok ? 'ok' : 'warn');
            } catch (e) {
              toast('撤销失败：' + (e && e.message), 'err');
            } finally { setBusy(false); }
          },
        }, icon('undo'), '撤销本次操作'));
      }
      actions.append(h('button', {
        class: 'btn btn-primary',
        onclick: () => { state.lastResult = null; state.plan = null; renderAll(); },
      }, '继续处理下一批'));
      resultBox.append(actions);
    }

    /* ---------------- 历史 ---------------- */
    const historyBox = h('div', { class: 'section' });

    function renderHistory() {
      historyBox.replaceChildren();
      const records = window.FK.history.list();
      if (!records.length) return;
      historyBox.append(h('div', { class: 'section-title' }, icon('history'), '最近操作',
        h('button', {
          class: 'btn btn-mini btn-ghost', style: { marginLeft: 'auto' },
          onclick: async () => {
            const go = await confirmModal({ title: '清空操作记录？', body: '只删除记录，不影响已完成的文件操作。', okText: '清空', okStyle: 'danger', icon: 'trash' });
            if (go) { window.FK.history.clear(); renderHistory(); }
          },
        }, '清空记录')));
      historyBox.append(h('div', { class: 'history-list' }, records.map((rec) =>
        h('div', { class: 'history-row' },
          icon(rec.undone ? 'undo' : 'folder'),
          h('div', { class: 'history-text' },
            h('div', { class: 'history-label' }, rec.label),
            h('div', { class: 'history-meta' }, fmtTime(rec.time) + ' · 移动 ' + rec.moved + ' 项' + (rec.failed ? ' · 失败 ' + rec.failed : ''))),
          rec.undone ? h('span', { class: 'badge b-skip' }, '已撤销') : h('button', {
            class: 'btn btn-mini btn-ghost',
            onclick: async () => {
              const go = await confirmModal({
                title: '撤销该次操作？',
                body: h('div', null, '将把该次移动的 ' + rec.moved + ' 个文件移回原位。'),
                okText: '撤销', icon: 'undo',
              });
              if (!go) return;
              try {
                const undo = await window.FK.extract.undo(rec.entries, () => {});
                window.FK.history.replace(window.FK.history.list().map((r) => r.id === rec.id ? { ...r, undone: true } : r));
                renderHistory();
                toast(undo.ok ? '已撤销 ' + undo.restored + ' 项' : '撤销完成，' + undo.failed.length + ' 项失败', undo.ok ? 'ok' : 'warn');
              } catch (e) {
                toast('撤销失败：' + (e && e.message), 'err');
              }
            },
          }, icon('undo'), '撤销')))));
    }

    /* ---------------- 组装与刷新 ---------------- */
    const adderCard = h('div', { class: 'card' }, dropzone, chipsBox, adderHint,
      h('div', { class: 'adder-actions' }, btnPick, btnClipboard));
    const optionsCard = h('div', { class: 'card' }, optionsBox);

    root.append(stepsBox, adderCard, optionsCard, actionsBox, previewBox, resultBox, historyBox);

    function invalidate() {
      state.plan = null;
      state.lastResult = null;
      renderAll();
    }

    function renderAll() {
      renderSteps();
      renderChips();
      btnScan.disabled = state.busy || !state.paths.length;
      btnClear.disabled = state.busy;
      previewBox.replaceChildren();
      resultBox.replaceChildren();
      if (!state.lastResult && state.plan) {
        renderPreview();
        actionsBox.replaceChildren(btnExecute, btnBack);
      } else {
        renderResult();
        actionsBox.replaceChildren(btnScan, btnClear);
      }
      renderHistory();
      btnScan.disabled = state.busy || !state.paths.length;
    }

    renderAll();

    return {
      onFiles: (dirs) => addPaths(dirs || []),
    };
  }

  window.FK_UI.registerView({
    id: 'extract',
    title: '解散文件夹',
    desc: '把文件夹里的文件提取到上级目录或指定目录',
    icon: 'extract',
    ready: true,
    order: 0,
    mount,
  });
})();
