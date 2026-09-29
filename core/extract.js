'use strict';
/**
 * 文件工具箱 - 核心文件操作逻辑
 *
 * 设计要点：
 * 1. 全量处理：一次接收的所有文件夹都会生成独立分组，互不影响；
 * 2. 逐项容错：单个文件/单个文件夹失败只记录到结果里，绝不中断整批操作；
 * 3. 预览先行：先扫描生成"计划"（plan），确认后再执行（execute）；
 * 4. 可撤销：执行后返回操作日志（journal），可整体或按记录回滚；
 * 5. 跨盘支持：rename 失败 EXDEV 时自动回退为复制+删除；
 * 6. Windows 长路径：超过 240 字符自动加 \\?\ 前缀；
 * 7. 重名处理：智能重命名 "name (n).ext" / 跳过 / 覆盖 三种策略。
 *
 * 本模块只依赖 node 的 fs/path，不依赖 uTools，可在 Node 中直接测试。
 */

const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const CASE_FOLD = IS_WIN || process.platform === 'darwin'; // 大小写不敏感文件系统
const LOCK_CODES = ['EBUSY', 'EPERM', 'EACCES', 'EAGAIN'];
const MAX_RENAME_TRIES = 1000;

/** Windows 长路径前缀（仅在需要时添加） */
function lp(p) {
  if (!IS_WIN) return p;
  const s = String(p).replace(/\//g, '\\');
  if (s.startsWith('\\\\?\\')) return s;
  if (s.length < 240 && !s.startsWith('\\\\')) return s;
  if (s.startsWith('\\\\')) return '\\\\?\\UNC\\' + s.slice(2);
  return '\\\\?\\' + s;
}

const keyOf = (p) => (CASE_FOLD ? String(p).toLowerCase() : String(p));

function statSafe(p) {
  try { return fs.lstatSync(lp(p)); } catch { return null; }
}

function existsP(p) {
  return statSafe(p) !== null;
}

function cleanErr(e) {
  const code = e && e.code;
  if (code === 'EBUSY') return '文件正在使用中（可能正被播放器或其他程序占用）';
  if (code === 'EPERM' || code === 'EACCES') return '没有权限，或文件被其他程序占用';
  if (code === 'ENOENT') return '源文件/文件夹不存在（可能已被移动或删除）';
  if (code === 'EXDEV') return '不支持跨磁盘卷移动';
  if (code === 'ENOTEMPTY') return '目录非空，无法删除';
  return (e && e.message) || String(e);
}

/* ---------------------------------------------------------------- 扫描 */

/**
 * 深度遍历文件夹。
 * @returns {{files: Array<{rel:string, abs:string, size:number}>,
 *            dirs: Array<{rel:string, abs:string}>,
 *            errors: Array<{path:string, message:string}>}}
 */
function walk(root) {
  const files = [];
  const dirs = [];
  const errors = [];
  const stack = [{ abs: root, rel: '' }];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(lp(cur.abs), { withFileTypes: true });
    } catch (e) {
      errors.push({ path: cur.abs, message: cleanErr(e) });
      continue;
    }
    for (const d of entries) {
      const abs = path.join(cur.abs, d.name);
      const rel = cur.rel ? path.join(cur.rel, d.name) : d.name;
      let st = null;
      try { st = fs.lstatSync(lp(abs)); } catch (e) {
        errors.push({ path: abs, message: cleanErr(e) });
        continue;
      }
      if (st.isDirectory()) {
        dirs.push({ rel, abs });
        stack.push({ abs, rel });
      } else {
        files.push({ rel, abs, size: st.size });
      }
    }
  }
  dirs.sort((a, b) => b.rel.length - a.rel.length); // 深的在前，便于自底向上删除
  return { files, dirs, errors };
}

/** 读取直接子项（不解开子目录） */
function listTop(folderPath) {
  const files = [];
  const dirs = [];
  const errors = [];
  let entries;
  try {
    entries = fs.readdirSync(lp(folderPath), { withFileTypes: true });
  } catch (e) {
    errors.push({ path: folderPath, message: cleanErr(e) });
    return { files, dirs, errors };
  }
  for (const d of entries) {
    const abs = path.join(folderPath, d.name);
    let st = null;
    try { st = fs.lstatSync(lp(abs)); } catch (e) {
      errors.push({ path: abs, message: cleanErr(e) });
      continue;
    }
    if (st.isDirectory()) dirs.push({ rel: d.name, abs });
    else files.push({ rel: d.name, abs, size: st.size });
  }
  dirs.sort((a, b) => b.rel.length - a.rel.length);
  return { files, dirs, errors };
}

/* ---------------------------------------------------------------- 计划 */

/**
 * 生成解散计划。
 * @param {string[]} folderPaths 选中的文件夹（可多个）
 * @param {object} options
 *   target: 'parent' | 'custom'
 *   customTarget: string（target 为 custom 时生效）
 *   mode: 'top'（仅第一层）| 'flatten'（递归打散到同一目录）
 *   conflict: 'rename' | 'skip' | 'overwrite'
 * @returns {object} plan
 */
function buildPlan(folderPaths, options) {
  const opts = {
    target: options && options.target === 'custom' ? 'custom' : 'parent',
    customTarget: (options && options.customTarget) || '',
    mode: options && options.mode === 'flatten' ? 'flatten' : 'top',
    conflict: (options && options.conflict) || 'rename',
  };

  // 去重（大小写不敏感）
  const seen = new Set();
  const folders = [];
  for (const p of folderPaths || []) {
    if (!p) continue;
    let r;
    try { r = path.resolve(String(p)); } catch { continue; }
    const k = keyOf(r);
    if (!seen.has(k)) { seen.add(k); folders.push(r); }
  }
  // 深的在前：嵌套选择时先处理内层
  folders.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);

  // 若同时选中了外层与内层文件夹，内层交给外层处理，避免重复/冲突
  const nestedSkipped = new Set();
  for (const f of folders) {
    for (const g of folders) {
      if (f === g) continue;
      const rel = path.relative(keyOf(g), keyOf(f));
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        nestedSkipped.add(f);
      }
    }
  }

  const planned = new Set(); // 全计划级占位（跨分组防重名），小写键
  const reserve = (dest, conflict) => {
    const taken = (d) => planned.has(keyOf(d)) || existsP(d);
    if (!taken(dest)) { planned.add(keyOf(dest)); return { dest, conflict: false }; }
    if (conflict === 'skip') return { dest, conflict: true, skip: true };
    if (conflict === 'overwrite') return { dest, conflict: true, overwrite: true };
    const dirp = path.dirname(dest);
    const ext = path.extname(dest);
    const base = path.basename(dest, ext);
    for (let i = 1; i < MAX_RENAME_TRIES; i++) {
      const cand = path.join(dirp, base + ' (' + i + ')' + ext);
      if (!taken(cand)) { planned.add(keyOf(cand)); return { dest: cand, conflict: true, renamed: true }; }
    }
    return { dest, conflict: true, skip: true, reason: '可用重名编号过多' };
  };

  const groups = folders.map((folder) => {
    const name = path.basename(folder);
    const base = {
      source: folder,
      name,
      mode: opts.mode,
      exists: true,
      warning: null,
      ops: [],
      removeDirs: [],
      errors: [],
      summary: { files: 0, dirs: 0, size: 0, conflicts: 0, skipped: 0 },
    };

    if (nestedSkipped.has(folder)) {
      base.exists = false;
      base.skippedByPlan = true;
      base.warning = '该文件夹位于另一个所选文件夹内部，已跳过（处理外层时已包含其内容）';
      return base;
    }

    const st = statSafe(folder);
    if (!st || !st.isDirectory()) {
      base.exists = false;
      base.warning = '文件夹不存在（可能已被移动或删除）';
      return base;
    }

    // 目标目录解析与校验
    let target;
    if (opts.target === 'custom') {
      target = path.resolve(opts.customTarget || path.dirname(folder));
      if (keyOf(target) === keyOf(folder)) {
        base.exists = false;
        base.warning = '目标目录不能是源文件夹本身';
        return base;
      }
      const rel = path.relative(keyOf(target), keyOf(folder));
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        base.exists = false;
        base.warning = '目标目录不能位于源文件夹内部';
        return base;
      }
    } else {
      target = path.dirname(folder);
    }
    base.target = target;

    let scan;
    if (opts.mode === 'flatten') {
      scan = walk(folder);
    } else {
      scan = listTop(folder);
    }
    base.errors = scan.errors;

    for (const f of scan.files) {
      const r = reserve(path.join(target, path.basename(f.abs)), opts.conflict);
      base.ops.push({
        from: f.abs,
        to: r.dest,
        name: path.basename(f.abs),
        isDir: false,
        size: f.size,
        action: r.skip ? 'skip' : 'move',
        renamed: !!r.renamed,
        overwrite: !!r.overwrite,
        reason: r.reason || (r.skip && r.conflict ? '目标已存在同名文件' : null),
      });
    }
    // top 模式下子目录整体移动
    if (opts.mode === 'top') {
      for (const d of scan.dirs) {
        const r = reserve(path.join(target, path.basename(d.abs)), opts.conflict);
        base.ops.push({
          from: d.abs,
          to: r.dest,
          name: path.basename(d.abs),
          isDir: true,
          size: 0,
          action: r.skip ? 'skip' : 'move',
          renamed: !!r.renamed,
          overwrite: !!r.overwrite,
          reason: r.reason || (r.skip && r.conflict ? '目标已存在同名文件夹' : null),
        });
      }
      base.removeDirs = [folder];
    } else {
      base.removeDirs = [...scan.dirs.map((d) => d.abs), folder];
    }

    for (const op of base.ops) {
      if (op.isDir) base.summary.dirs++;
      else { base.summary.files++; base.summary.size += op.size || 0; }
      if (op.renamed || op.overwrite) base.summary.conflicts++;
      if (op.action === 'skip') base.summary.skipped++;
    }
    return base;
  });

  const summary = groups.reduce(
    (acc, g) => {
      acc.folderCount += g.exists && !g.warning ? 1 : 0;
      acc.fileCount += g.summary.files;
      acc.dirCount += g.summary.dirs;
      acc.totalSize += g.summary.size;
      acc.conflictCount += g.summary.conflicts;
      acc.skippedCount += g.summary.skipped;
      acc.errorCount += g.errors.length;
      return acc;
    },
    { folderCount: 0, fileCount: 0, dirCount: 0, totalSize: 0, conflictCount: 0, skippedCount: 0, errorCount: 0 }
  );

  return { createdAt: new Date().toISOString(), options: opts, groups, summary };
}

/* ---------------------------------------------------------------- 执行 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renameWithRetry(from, to) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      fs.renameSync(lp(from), lp(to));
      return;
    } catch (e) {
      lastErr = e;
      if (e.code === 'EXDEV') {
        await copyThenRemove(from, to);
        return;
      }
      if (LOCK_CODES.includes(e.code)) {
        await sleep(150 * (i + 1)); // 等待占用释放后重试
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function copyThenRemove(from, to, isDir) {
  const fsp = fs.promises;
  if (isDir) {
    await copyDir(from, to);
    await fsp.rm(lp(from), { recursive: true, force: true });
  } else {
    await fsp.copyFile(lp(from), lp(to));
    await fsp.rm(lp(from), { force: true });
  }
}

async function copyDir(src, dst) {
  const fsp = fs.promises;
  await fsp.mkdir(lp(dst), { recursive: true });
  const entries = fs.readdirSync(lp(src), { withFileTypes: true });
  for (const d of entries) {
    const s = path.join(src, d.name);
    const t = path.join(dst, d.name);
    if (d.isDirectory()) await copyDir(s, t);
    else await fsp.copyFile(lp(s), lp(t));
  }
}

function removeExisting(p) {
  const st = statSafe(p);
  if (!st) return;
  if (st.isDirectory()) fs.rmSync(lp(p), { recursive: true, force: true });
  else fs.rmSync(lp(p), { force: true });
}

/**
 * 执行计划（异步）。任何单项失败都被记录并跳过，不影响其余操作；
 * 周期性让出事件循环，保证前端进度条可以刷新。
 * @returns {Promise<{ok:boolean, results:Array, journal:Array<{from,to}>, summary:object}>}
 */
async function executePlan(plan, hooks) {
  const onProgress = hooks && hooks.onProgress;
  const total = plan.groups.reduce(
    (n, g) => n + g.ops.filter((o) => o.action === 'move').length, 0
  );
  let done = 0;
  let lastYield = Date.now();
  const journal = [];

  const results = [];
  for (const g of plan.groups) {
    const r = {
      source: g.source,
      name: g.name,
      target: g.target,
      moved: 0,
      skipped: g.summary.skipped,
      failed: [],
      removed: [],
      residual: [],
      error: null,
    };
    results.push(r);
    if (!g.exists) {
      if (g.skippedByPlan) {
        r.skippedByPlan = g.warning; // 计划期主动跳过（如嵌套选择），不算错误
      } else {
        r.error = g.warning || '文件夹不存在';
      }
      continue;
    }
    try {
      for (const op of g.ops) {
        if (op.action !== 'move') continue;
        if (onProgress) onProgress({ done, total, label: op.name, group: g.name });
        try {
          if (op.overwrite) removeExisting(op.to);
          fs.mkdirSync(lp(path.dirname(op.to)), { recursive: true });
          await renameWithRetry(op.from, op.to);
          journal.push({ from: op.from, to: op.to });
          r.moved++;
        } catch (e) {
          r.failed.push({ from: op.from, to: op.to, name: op.name, message: cleanErr(e) });
        }
        done++;
        if (Date.now() - lastYield > 16) {
          await sleep(0); // 让出事件循环，刷新进度
          lastYield = Date.now();
        }
      }
      for (const d of g.removeDirs) {
        try {
          fs.rmdirSync(lp(d)); // 仅删除空目录
          r.removed.push(d);
        } catch {
          r.residual.push(d);
        }
      }
    } catch (e) {
      r.error = cleanErr(e);
    }
  }

  const summary = results.reduce(
    (acc, r) => {
      acc.moved += r.moved;
      acc.failed += r.failed.length;
      acc.skipped += r.skipped;
      return acc;
    },
    { moved: 0, failed: 0, skipped: 0 }
  );

  return {
    ok: summary.failed === 0 && results.every((r) => !r.error),
    results,
    journal,
    summary,
    at: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- 撤销 */

function uniqueBeside(dest) {
  const dirp = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  for (let i = 1; i < MAX_RENAME_TRIES; i++) {
    const cand = path.join(dirp, base + ' (恢复 ' + i + ')' + ext);
    if (!existsP(cand)) return cand;
  }
  return dest;
}

/**
 * 按执行顺序的逆序回滚操作日志（异步）。
 * @param {Array<{from:string,to:string}>} journal
 */
async function undoOperations(journal, hooks) {
  const onProgress = hooks && hooks.onProgress;
  const res = { restored: 0, skipped: [], failed: [] };
  const list = Array.isArray(journal) ? journal : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const { from, to } = list[i];
    if (onProgress) onProgress({ done: list.length - i, total: list.length, label: path.basename(to) });
    try {
      if (!existsP(to)) {
        res.skipped.push({ to, reason: '目标文件已不存在，可能已被手动处理' });
        continue;
      }
      let dst = from;
      if (existsP(from)) dst = uniqueBeside(from);
      fs.mkdirSync(lp(path.dirname(dst)), { recursive: true });
      await renameWithRetry(to, dst);
      res.restored++;
    } catch (e) {
      res.failed.push({ to, message: cleanErr(e) });
    }
  }
  res.ok = res.failed.length === 0;
  return res;
}

module.exports = {
  buildPlan,
  executePlan,
  undoOperations,
  _internal: { lp, walk, listTop, existsP, cleanErr },
};
