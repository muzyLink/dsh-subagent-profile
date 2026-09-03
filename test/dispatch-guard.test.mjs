// test/dispatch-guard.test.mjs — 总预算守卫 + 在途登记/级联取消 + 卸载清理。
// 覆盖两层：
//   * guard 纯工厂单测（createDispatchGuard）：acquire/release 幂等、token 累计/超限、
//     reset 清账、track/untrack/cancelAll 幂等与 fail-soft。
//   * execute 级（经 fake ctx 的 dispatch.execute 路径）：并发 8 拒第 9 + 完成后不泄漏、
//     token 超限拒、后台结算记账（onSettled 释放 + recordTokens）、禁用触发 cancelAll、
//     continuable 禁用触发 interrupt、管理面禁用后仍可达、卸载清文件。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDispatchGuard } from '../lib/core/dispatch-guard.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';
import { makeRouteHarness, callRoute } from './harness/routes.mjs';

const mod = await import('../index.mjs');

// --- guard 纯工厂单测 ---------------------------------------------------------

test('guard acquire/release：并发计数 +1/-1，release 幂等，归零删键不误拒', () => {
  const guard = createDispatchGuard({ maxConcurrent: 2 });
  const a = guard.acquire('p');
  const b = guard.acquire('p');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(guard.acquire('p').ok, false, '第 3 个并发应被拒');
  a.release();
  a.release(); // 幂等：重复 release 不抛、不越界
  assert.equal(guard.acquire('p').ok, true, '释放一个后应可再 acquire');
  b.release();
});

test('guard acquire：无 parentSessionId 跳过守卫（ok + skipped，不占并发）', () => {
  const guard = createDispatchGuard({ maxConcurrent: 1 });
  const a = guard.acquire(undefined);
  assert.equal(a.ok, true);
  assert.equal(a.skipped, true);
  assert.equal(guard.acquire('').ok, true);
  assert.equal(guard.acquire(null).ok, true);
  // 无 id 不占并发：真实会话仍可 acquire。
  assert.equal(guard.acquire('p').ok, true);
});

test('guard recordTokens：累计并返回是否达上限；非法输入跳过不累计', () => {
  const guard = createDispatchGuard({ maxParentTokens: 100 });
  assert.equal(guard.recordTokens('p', 60), false);
  assert.equal(guard.recordTokens('p', 40), true, '累计 >= 上限返回 true');
  assert.equal(guard.acquire('p').ok, false);
  assert.equal(guard.acquire('p').reason, 'tokens', '超限拒因是 tokens');
  // 非法输入：不影响累计。
  const g2 = createDispatchGuard({ maxParentTokens: 100 });
  g2.recordTokens('p', -1);
  g2.recordTokens('p', 'x');
  g2.recordTokens('p', NaN);
  g2.recordTokens('', 50);
  assert.equal(g2.acquire('p').ok, true, '非法输入不累计，不误拒');
});

test('guard reset：清空并发/累计 token/在途三账，清后可重新派发', () => {
  const guard = createDispatchGuard({ maxConcurrent: 1, maxParentTokens: 50 });
  guard.acquire('p');
  guard.recordTokens('p', 60);
  guard.track('k', () => {});
  guard.reset();
  assert.equal(guard.acquire('p').ok, true, 'reset 后并发额度恢复');
  assert.equal(guard.recordTokens('p', 60), true, 'reset 后累计从零起');
});

test('guard resetParent：只清该父的并发与 token 键，其它父不受影响', () => {
  const guard = createDispatchGuard({ maxConcurrent: 1, maxParentTokens: 100 });
  guard.acquire('p1');
  guard.acquire('p2');
  guard.recordTokens('p1', 100);
  guard.resetParent('p1');
  const p1After = guard.acquire('p1');
  assert.equal(p1After.ok, true, 'p1 释放后额度恢复');
  assert.equal(p1After.reason, undefined, 'p1 恢复后无拒因');
  assert.equal(guard.acquire('p2').ok, false, 'p2 仍被占（不受 p1 释放影响）');
  guard.resetParent('');
  guard.resetParent(undefined);
  guard.resetParent(null);
  assert.equal(guard.acquire('p2').ok, false, '空 id resetParent 为 no-op');
});

test('guard recordTokens：resetParent 后不重插 tokenTotals 键（H2 防无界增长）', () => {
  const guard = createDispatchGuard({ maxConcurrent: 1, maxParentTokens: 100 });
  guard.recordTokens('p', 50);
  guard.resetParent('p');
  // dispose 后 recordTokens 为 no-op：不再把 tokenTotals 键重插回来，累计不复活。
  assert.equal(guard.recordTokens('p', 50), false, 'dispose 后 recordTokens 不累计');
  const a = guard.acquire('p');
  assert.equal(a.ok, true, 'dispose 后 acquire 不被已释放的 token 累计误拒');
});

test('guard track/untrack/cancelAll：每项 cancel 恰好调用一次，untrack 后不调', () => {
  const guard = createDispatchGuard();
  const calls = [];
  guard.track('k1', () => calls.push('k1'));
  guard.track('k2', () => calls.push('k2'));
  guard.untrack('k2');
  guard.cancelAll();
  assert.deepEqual(calls, ['k1'], 'k2 已 untrack，不调');
  guard.cancelAll(); // 登记表已清空：第二次 cancelAll 不重复调用
  assert.deepEqual(calls, ['k1'], 'cancelAll 幂等');
});

test('guard cancelAll：cancel 为 undefined 跳过；cancel 抛错 warn 但不阻断整体', () => {
  const warns = [];
  const guard = createDispatchGuard({ warn: (m) => warns.push(m) });
  const ok = [];
  guard.track('noop', undefined);
  guard.track('boom', () => { throw new Error('boom'); });
  guard.track('fine', () => ok.push('fine'));
  guard.cancelAll();
  assert.deepEqual(ok, ['fine'], '抛错项不阻断其余项');
  assert.equal(warns.length, 1, '抛错项 warn 一次');
  assert.match(warns[0], /取消在途派发 boom 失败/);
});

// --- execute 级（经 fake ctx 的 dispatch.execute 路径）--------------------------

function dispatchTool(records) {
  const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
  assert.ok(tool, 'apply() 必须注册 dispatch 工具');
  return tool;
}

function makeParent(id = 'parent') {
  return { ctx: { get: () => undefined }, options: {}, session: { header: { id } } };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 0));
  }
}

// 可控制的 subagentsStart：返回 result 不自动 resolve 的 run，测试手动 resolve。
function makeControllableStart() {
  const pending = [];
  const subagentsStart = async () => {
    let resolveResult;
    const result = new Promise((res) => { resolveResult = res; });
    const run = {
      id: `run-${pending.length + 1}`,
      result,
      localAgent: { session: { events: [] } },
      disposeCalls: 0,
      dispose: async () => { run.disposeCalls += 1; },
    };
    pending.push({ run, resolveResult });
    return run;
  };
  return { subagentsStart, pending };
}

// 立即完成的 subagentsStart（completed + 无 usage 事件）。
function makeCompletedStart(id = 'child') {
  return async () => ({
    id,
    result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
    localAgent: { session: { events: [] } },
    dispose: async () => {},
  });
}

test('execute 并发：8 在途时第 9 个拒绝，全部完成后可再派发不泄漏', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { subagentsStart, pending } = makeControllableStart();
    const { ctx, records } = createFakeCtx({ subagentsStart });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const parent = makeParent('parent-conc');
    const inFlight = [];
    for (let i = 0; i < 8; i++) {
      inFlight.push(tool.execute({ prompt: `task ${i}` }, { agent: parent, signal: undefined }));
    }
    await waitFor(() => pending.length === 8);
    await assert.rejects(
      () => tool.execute({ prompt: 'task 9' }, { agent: parent, signal: undefined }),
      /并发派发数已达上限 8/
    );
    // 全部完成后释放并发额度，再派发不误拒（再次派发的 run 需手动 resolve）。
    for (const p of pending) p.resolveResult({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] });
    await Promise.all(inFlight);
    const againPromise = tool.execute({ prompt: 'task again' }, { agent: parent, signal: undefined });
    await waitFor(() => pending.length === 9);
    pending[8].resolveResult({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] });
    const again = await againPromise;
    assert.equal(again.stopReason, 'completed');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute token 超限：累计达标后拒绝新派发（前台结算记账）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const tokenMeter = { measure: () => ({ totalTokens: 600000 }) };
    const { ctx, records } = createFakeCtx({ subagentsStart: makeCompletedStart('child-t1'), services: { tokenMeter } });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const parent = makeParent('parent-tokens');
    const out = await tool.execute({ prompt: 'task' }, { agent: parent, signal: undefined });
    assert.equal(out.childTotalTokens, 600000);
    await assert.rejects(
      () => tool.execute({ prompt: 'task 2', tokenTier: 'cheap' }, { agent: parent, signal: undefined }),
      /累计派发 token 已达上限 500000/
    );
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 前台完成不泄漏：连续两次派发都成功（释放并发 + 不误记账）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ subagentsStart: makeCompletedStart('child-fg') });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const parent = makeParent('parent-fg');
    const one = await tool.execute({ prompt: 'task 1' }, { agent: parent, signal: undefined });
    const two = await tool.execute({ prompt: 'task 2' }, { agent: parent, signal: undefined });
    assert.equal(one.stopReason, 'completed');
    assert.equal(two.stopReason, 'completed');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 后台结算记账：onSettled 释放 + recordTokens（超限后拒）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const tokenMeter = { measure: () => ({ totalTokens: 600000 }) };
    let captured;
    const jobs = {
      start(spec) { captured = spec.run(); return 'job-1'; },
      kill() { return 'requested'; },
    };
    const { ctx, records } = createFakeCtx({ subagentsStart: makeCompletedStart('child-bg'), services: { jobs, tokenMeter } });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const parent = makeParent('parent-bg');
    const out = await tool.execute({ prompt: 'task', run_in_background: true }, { agent: parent, signal: undefined });
    assert.equal(out.kind, 'background');
    assert.equal(out.jobId, 'job-1');
    const settled = await captured.done;
    assert.equal(settled.status, 'completed');
    assert.equal(settled.childTotalTokens, 600000);
    // 结算后累计 token 已达标 → 下次派发拒绝（证明 onSettled 记账 + 释放）。
    await assert.rejects(
      () => tool.execute({ prompt: 'task 2', tokenTier: 'cheap' }, { agent: parent, signal: undefined }),
      /累计派发 token 已达上限 500000/
    );
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 禁用：syncTool 触发 cancelAll，在途前台 run.dispose 被调', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { subagentsStart, pending } = makeControllableStart();
    const { webServer, routes } = makeRouteHarness();
    const { ctx, records } = createFakeCtx({ subagentsStart, services: { webServer } });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const parent = makeParent('parent-disable');
    const inFlight = tool.execute({ prompt: 'task' }, { agent: parent, signal: undefined });
    await waitFor(() => pending.length === 1);
    const handler = routes[0].handler;
    const resp = await callRoute(handler, 'POST', '/set-enabled', { enabled: false });
    assert.equal(resp.code, 200);
    assert.equal(resp.json.enabled, false);
    assert.equal(pending[0].run.disposeCalls, 1, '禁用必须触发在途前台 run.dispose（cancelAll）');
    // 清理在途：resolve 结果让前台结算（dispose 幂等、finish 对已清空账表无副作用）。
    pending[0].resolveResult({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] });
    await inFlight;
  } finally { iso.restore(); iso.teardown(); }
});

test('execute continuable 禁用：触发宿主 interrupt 取消在途子', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const interrupts = [];
    const startContinuable = async () => ({ childId: 'child-1' });
    const { webServer, routes } = makeRouteHarness();
    const { ctx, records } = createFakeCtx({ startContinuable, services: { webServer } });
    ctx.subagents.interrupt = (id, authority) => interrupts.push({ id, authority });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const parent = {
      ctx: { get: () => undefined, tools: { schemas: () => [{ name: 'read' }, { name: 'write' }] } },
      options: {},
      session: { header: { id: 'parent-cont' } },
    };
    const out = await tool.execute({ prompt: 'task', continuable: true }, { agent: parent, signal: undefined });
    assert.equal(out.kind, 'continuable');
    assert.equal(out.subagentId, 'child-1');
    const handler = routes[0].handler;
    const resp = await callRoute(handler, 'POST', '/set-enabled', { enabled: false });
    assert.equal(resp.code, 200);
    assert.equal(interrupts.length, 1, '禁用必须级联 interrupt 在途 continuable 子');
    assert.equal(interrupts[0].id, 'child-1');
    assert.equal(interrupts[0].authority.parentSessionId, 'parent-cont');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 管理面：禁用后 GET /list 可达、set-enabled 可重开', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { webServer, routes } = makeRouteHarness();
    const { ctx } = createFakeCtx({ services: { webServer } });
    await mod.apply(ctx);
    const handler = routes[0].handler;
    const off = await callRoute(handler, 'POST', '/set-enabled', { enabled: false });
    assert.equal(off.code, 200);
    assert.equal(off.json.enabled, false);
    const list = await callRoute(handler, 'GET', '/list');
    assert.equal(list.code, 200, '禁用后 GET /list 仍可达');
    assert.equal(list.json.ok, true);
    const on = await callRoute(handler, 'POST', '/set-enabled', { enabled: true });
    assert.equal(on.code, 200, '禁用后 set-enabled 可重开');
    assert.equal(on.json.enabled, true);
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 卸载：清 3 数据文件 + orchestrator-v2 目录，不碰其它目录', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    // 手动落 3 个数据文件 + 一个非本插件目录，模拟卸载前的磁盘状态。
    for (const file of ['subagent-profiles.json', 'subagent-profiles.state.json', 'subagent-profiles.failed-traces.json']) {
      writeFileSync(join(iso.dir, file), '{}', 'utf8');
    }
    const otherDir = join(iso.dir, '.agent-presets', 'other-plugin');
    mkdirSync(otherDir, { recursive: true });
    const orchDir = join(iso.dir, '.agent-presets', 'orchestrator-v2');
    assert.ok(existsSync(orchDir), 'apply 已自装 orchestrator-v2 预设目录');
    // 卸载语义 = 全部 effect disposers 依次执行（含守卫清理/清文件、off 挂钩等；
    // 不依赖 effect 注册顺序的位置性假设）。
    for (const effect of records.effects) {
      if (typeof effect.disposer === 'function') effect.disposer();
    }
    for (const file of ['subagent-profiles.json', 'subagent-profiles.state.json', 'subagent-profiles.failed-traces.json']) {
      assert.ok(!existsSync(join(iso.dir, file)), `${file} 必须被卸载清理删除`);
    }
    assert.ok(!existsSync(orchDir), 'orchestrator-v2 预设目录必须被删除');
    // 卸载是改名备份（orchestrator-v2.removed-<stamp>），数据不硬删、可恢复。
    const backups = readdirSync(join(iso.dir, '.agent-presets')).filter((e) => e.startsWith('orchestrator-v2.removed-'));
    assert.equal(backups.length, 1, '卸载必须留下 orchestrator-v2.removed-<stamp> 改名备份');
    assert.ok(existsSync(otherDir), '非本插件目录不被删除');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 前台 start reject：并发槽不泄漏（catch 幂等 release，下次派发仍成功）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    let calls = 0;
    const flakyStart = async () => {
      calls += 1;
      if (calls === 1) throw new Error('start failed');
      return {
        id: 'child-ok',
        result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
        localAgent: { session: { events: [] } },
        dispose: async () => {},
      };
    };
    const { ctx, records } = createFakeCtx({ subagentsStart: flakyStart });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    await assert.rejects(
      () => tool.execute({ prompt: 'x' }, { agent: makeParent(), signal: undefined }),
      /start failed/
    );
    // 错误路径必须已释放并发槽：第二次派发（同一父会话）应成功。
    const out = await tool.execute({ prompt: 'y' }, { agent: makeParent(), signal: undefined });
    assert.equal(out.stopReason, 'completed', 'start reject 后并发槽不泄漏');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 后台 jobs 缺失：并发槽不泄漏（catch 幂等 release，8 次失败判别）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ subagentsStart: makeCompletedStart('child-bg') });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    // 连续 8 次后台 jobs 缺失失败：若 catch 不 release，8 个并发槽全部泄漏，
    // 第 9 次（前台）会被并发上限拒绝——单次失败判别不出 1 槽泄漏。
    for (let i = 0; i < 8; i += 1) {
      await assert.rejects(
        () => tool.execute({ prompt: 'x', run_in_background: true }, { agent: makeParent(), signal: undefined }),
        /后台派发不可用/
      );
    }
    // 8 次失败后槽必须已全部释放：第 9 次派发（同一父会话）应成功。
    const out = await tool.execute({ prompt: 'y' }, { agent: makeParent(), signal: undefined });
    assert.equal(out.stopReason, 'completed', 'jobs 缺失路径并发槽不泄漏');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute agent/disposed：父会话结束时按父释放记账（token 超限后可再派发）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const tokenMeter = { measure: () => ({ totalTokens: 600000 }) };
    const { ctx, records } = createFakeCtx({ subagentsStart: makeCompletedStart('child-d'), services: { tokenMeter } });
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    // 第一次派发结算 600000 token → 超过 500000 上限 → 后续被拒。
    const first = await tool.execute({ prompt: 'x' }, { agent: makeParent('parent-d'), signal: undefined });
    assert.equal(first.stopReason, 'completed');
    await assert.rejects(
      () => tool.execute({ prompt: 'y', tokenTier: 'cheap' }, { agent: makeParent('parent-d'), signal: undefined }),
      /token 已达上限/
    );
    // 模拟宿主 agent/disposed：apply 挂钩的监听器收到父会话结束事件。
    const disposed = records.ons.find((entry) => entry.name === 'agent/disposed');
    assert.ok(disposed, 'apply 必须挂钩 agent/disposed');
    disposed.callback({ agent: { session: { header: { id: 'parent-d' } } } });
    // 按父释放后同一父会话可再派发。
    const out = await tool.execute({ prompt: 'z' }, { agent: makeParent('parent-d'), signal: undefined });
    assert.equal(out.stopReason, 'completed', 'agent/disposed 后记账释放');
  } finally { iso.restore(); iso.teardown(); }
});
