'use strict';
/**
 * core/extract.js 的纯 Node 测试（无依赖，node test/extract.test.js 直接运行）
 * 其中 T7 是批量隔离的回归测试：批量中某文件夹出错，其余必须继续处理。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('../core/extract');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-test-'));
let passed = 0;
let failed = 0;

function mkfile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content == null ? 'x' : content);
}

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

const IS_WIN = process.platform === 'win32';

(async () => {
  console.log('文件工具箱核心逻辑测试 @ ' + TMP);

  await test('T1 仅第一层：文件与子文件夹移动到上级，源目录删除', async () => {
    const root = path.join(TMP, 't1');
    mkfile(path.join(root, 'src', 'a.txt'), 'A');
    mkfile(path.join(root, 'src', 'b.txt'), 'B');
    mkfile(path.join(root, 'src', 'sub', 'c.txt'), 'C');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'top' });
    assert.strictEqual(plan.groups.length, 1);
    assert.strictEqual(plan.summary.fileCount, 2);
    assert.strictEqual(plan.summary.dirCount, 1);
    const res = await core.executePlan(plan);
    assert.ok(res.ok, JSON.stringify(res.results));
    assert.strictEqual(res.summary.moved, 3);
    assert.ok(fs.existsSync(path.join(root, 'a.txt')));
    assert.ok(fs.existsSync(path.join(root, 'sub', 'c.txt')));
    assert.ok(!fs.existsSync(path.join(root, 'src')));
  });

  await test('T2 重名智能重命名：x.txt → x (1).txt', async () => {
    const root = path.join(TMP, 't2');
    mkfile(path.join(root, 'src', 'x.txt'), 'new');
    mkfile(path.join(root, 'x.txt'), 'old');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'top' });
    const op = plan.groups[0].ops[0];
    assert.ok(op.renamed);
    assert.strictEqual(path.basename(op.to), 'x (1).txt');
    const res = await core.executePlan(plan);
    assert.ok(res.ok);
    assert.strictEqual(fs.readFileSync(path.join(root, 'x.txt'), 'utf8'), 'old');
    assert.strictEqual(fs.readFileSync(path.join(root, 'x (1).txt'), 'utf8'), 'new');
  });

  await test('T3 重名跳过：跳过冲突文件，源目录残留并如实上报', async () => {
    const root = path.join(TMP, 't3');
    mkfile(path.join(root, 'src', 'x.txt'), 'new');
    mkfile(path.join(root, 'x.txt'), 'old');
    mkfile(path.join(root, 'src', 'y.txt'), 'Y');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'top', conflict: 'skip' });
    const res = await core.executePlan(plan);
    assert.strictEqual(res.summary.skipped, 1);
    assert.strictEqual(res.summary.moved, 1);
    assert.strictEqual(fs.readFileSync(path.join(root, 'x.txt'), 'utf8'), 'old'); // 未被覆盖
    assert.ok(fs.existsSync(path.join(root, 'y.txt')));
    assert.ok(fs.existsSync(path.join(root, 'src', 'x.txt')), '被跳过的文件应留在源目录');
    assert.ok(res.results[0].residual.includes(path.join(root, 'src')), '源目录应如实上报为残留');
  });

  await test('T4 重名覆盖：目标内容被替换', async () => {
    const root = path.join(TMP, 't4');
    mkfile(path.join(root, 'src', 'x.txt'), 'new');
    mkfile(path.join(root, 'x.txt'), 'old');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'top', conflict: 'overwrite' });
    assert.ok(plan.groups[0].ops[0].overwrite);
    const res = await core.executePlan(plan);
    assert.ok(res.ok);
    assert.strictEqual(fs.readFileSync(path.join(root, 'x.txt'), 'utf8'), 'new');
    assert.ok(!fs.existsSync(path.join(root, 'src')));
  });

  await test('T5 递归打散：所有层级文件平铺到目标目录', async () => {
    const root = path.join(TMP, 't5');
    mkfile(path.join(root, 'src', 'a', '1.txt'), '1');
    mkfile(path.join(root, 'src', 'b', 'c', '2.txt'), '2');
    mkfile(path.join(root, 'src', '3.txt'), '3');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'flatten' });
    assert.strictEqual(plan.summary.fileCount, 3);
    const res = await core.executePlan(plan);
    assert.ok(res.ok, JSON.stringify(res.results));
    assert.ok(fs.existsSync(path.join(root, '1.txt')));
    assert.ok(fs.existsSync(path.join(root, '2.txt')));
    assert.ok(fs.existsSync(path.join(root, '3.txt')));
    assert.ok(!fs.existsSync(path.join(root, 'src')));
  });

  await test('T6 递归打散重名：不同子目录同名文件自动编号', async () => {
    const root = path.join(TMP, 't6');
    mkfile(path.join(root, 'src', 'a', 'dup.txt'), 'A');
    mkfile(path.join(root, 'src', 'b', 'dup.txt'), 'B');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'flatten' });
    const res = await core.executePlan(plan);
    assert.ok(res.ok);
    // walk 顺序不保证 a/b 先后，只验证两个内容都完整落到目标且没有丢失
    const contents = new Set(
      [path.join(root, 'dup.txt'), path.join(root, 'dup (1).txt')].map((p) =>
        fs.readFileSync(p, 'utf8')
      )
    );
    assert.deepStrictEqual([...contents].sort(), ['A', 'B']);
  });

  await test('T7 批量隔离：一个文件夹失败，其余照常处理', async () => {
    const root = path.join(TMP, 't7');
    for (const n of ['A', 'B', 'C', 'D']) {
      mkfile(path.join(root, n, 'f.txt'), n);
    }
    const paths = ['A', 'B', 'C', 'D'].map((n) => path.join(root, n));
    const plan = core.buildPlan(paths, { mode: 'top' });
    // 模拟执行阶段 B 文件夹"消失"（如被占用后删除、网络盘掉线等）
    fs.rmSync(path.join(root, 'B'), { recursive: true, force: true });
    const res = await core.executePlan(plan);
    const byName = Object.fromEntries(res.results.map((r) => [r.name, r]));
    assert.ok(byName.B.error || byName.B.failed.length, 'B 应报告失败');
    assert.strictEqual(byName.A.moved, 1, 'A 不受影响');
    assert.strictEqual(byName.C.moved, 1, 'C 不受影响');
    assert.strictEqual(byName.D.moved, 1, 'D 不受影响');
    assert.ok(fs.existsSync(path.join(root, 'A', '..', 'f.txt')) === false || true); // A 的文件已移到 root
    assert.ok(fs.existsSync(path.join(root, 'f.txt')));
  });

  await test('T8 撤销：journal 逆序回滚，文件回到原位', async () => {
    const root = path.join(TMP, 't8');
    mkfile(path.join(root, 'src', 'a.txt'), 'A');
    mkfile(path.join(root, 'src', 'sub', 'b.txt'), 'B');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'top' });
    const res = await core.executePlan(plan);
    assert.ok(res.journal.length === 2);
    const undo = await core.undoOperations(res.journal);
    assert.ok(undo.ok);
    assert.strictEqual(undo.restored, 2);
    assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'a.txt'), 'utf8'), 'A');
    assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'sub', 'b.txt'), 'utf8'), 'B');
  });

  await test('T9 嵌套选择：内层文件夹跳过并给出提示', async () => {
    const root = path.join(TMP, 't9');
    mkfile(path.join(root, 'outer', 'inner', 'i.txt'), 'I');
    mkfile(path.join(root, 'outer', 'o.txt'), 'O');
    const plan = core.buildPlan(
      [path.join(root, 'outer', 'inner'), path.join(root, 'outer')],
      { mode: 'flatten' }
    );
    const inner = plan.groups.find((g) => g.name === 'inner');
    assert.ok(inner.warning, '内层应有提示');
    assert.strictEqual(plan.summary.fileCount, 2, '外层 flatten 已包含内层文件');
    const res = await core.executePlan(plan);
    assert.ok(res.ok, JSON.stringify(res.results));
    const innerRes = res.results.find((r) => r.name === 'inner');
    assert.ok(innerRes.skippedByPlan, '内层应标记为计划期跳过而非错误');
    assert.ok(fs.existsSync(path.join(root, 'i.txt')));
    assert.ok(fs.existsSync(path.join(root, 'o.txt')));
  });

  await test('T10 跨盘回退：rename 抛 EXDEV 时自动复制+删除', async () => {
    const root = path.join(TMP, 't10');
    mkfile(path.join(root, 'src', 'big.bin'), 'DATA');
    const plan = core.buildPlan([path.join(root, 'src')], { mode: 'top' });
    const realRename = fs.renameSync;
    let calls = 0;
    fs.renameSync = function (from, to) {
      calls++;
      const e = new Error('cross-device');
      e.code = 'EXDEV';
      throw e;
    };
    try {
      const res = await core.executePlan(plan);
      assert.ok(res.ok, JSON.stringify(res.results));
    } finally {
      fs.renameSync = realRename;
    }
    assert.strictEqual(fs.readFileSync(path.join(root, 'big.bin'), 'utf8'), 'DATA');
    assert.ok(!fs.existsSync(path.join(root, 'src', 'big.bin')));
  });

  if (IS_WIN) {
    await test('T11 Windows 长路径（>240 字符）移动', async () => {
      const root = path.join(TMP, 't11');
      let deep = root;
      for (let i = 0; i < 12; i++) deep = path.join(deep, 'level-' + i + '-with-some-length');
      const longFile = path.join(deep, 'file.txt');
      mkfile(longFile, 'LONG');
      assert.ok(longFile.length > 240, '测试路径需超过 240 字符，实际 ' + longFile.length);
      const plan = core.buildPlan([deep], { mode: 'top' });
      const res = await core.executePlan(plan);
      assert.ok(res.ok, JSON.stringify(res.results));
      assert.ok(fs.existsSync(path.join(path.dirname(deep), 'file.txt')), '文件应落到源目录的上级');
    });
  }

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  if (failed > 0) {
    console.log('（测试数据保留在 ' + TMP + ' 以便排查）');
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
})();
