// test/continuable-guard.test.mjs — V2 安全 P0-b（SPEC §7.1）：
// computeContinuableAllow —— continuable 分支的闭集 allow 预加工
// （父集 − run_code − deny，∩ allow；空集 fail-loud throw）。
// 纯函数用例不触碰 index.mjs / fs；文末另加一条经 fake ctx 的 dispatch.execute
// 集成用例：验证 enabled=false 时 continuable 分支在顶部 fail-loud（§7.1 第 2 条）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeContinuableAllow } from '../lib/pure.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';

const mod = await import('../index.mjs');

test('computeContinuableAllow: run_code 恒剔（无 deny/allow）', () => {
  const result = computeContinuableAllow(['read', 'write', 'run_code']);
  assert.deepEqual(result, ['read', 'write']);
  assert.ok(!result.includes('run_code'), 'run_code 必须被恒剔');
});

test('computeContinuableAllow: deny 生效（被剔）', () => {
  const result = computeContinuableAllow(['read', 'write', 'grep'], { deny: ['write'] });
  assert.deepEqual(result, ['read', 'grep']);
});

test('computeContinuableAllow: deny 含 run_code 不产生额外影响（恒剔优先）', () => {
  const result = computeContinuableAllow(['read', 'write', 'run_code'], { deny: ['run_code'] });
  assert.deepEqual(result, ['read', 'write']);
});

test('computeContinuableAllow: allow 交集生效', () => {
  const result = computeContinuableAllow(['read', 'write', 'grep'], { allow: ['read', 'grep'] });
  assert.deepEqual(result, ['read', 'grep']);
});

test('computeContinuableAllow: deny + allow 叠加', () => {
  const result = computeContinuableAllow(
    ['read', 'write', 'grep', 'glob'],
    { deny: ['grep'], allow: ['read', 'grep', 'glob'] }
  );
  // grep 被 deny 剔除，再 ∩ allow ⇒ 只剩 read, glob。
  assert.deepEqual(result, ['read', 'glob']);
});

test('computeContinuableAllow: 空集（仅 run_code）throw', () => {
  assert.throws(
    () => computeContinuableAllow(['run_code']),
    /dispatch: continuable 工具集为空，拒绝派发/
  );
});

test('computeContinuableAllow: 空集（allow 不含父集任何工具）throw', () => {
  assert.throws(
    () => computeContinuableAllow(['read', 'write'], { allow: ['browser_snapshot'] }),
    /dispatch: continuable 工具集为空，拒绝派发/
  );
});

test('computeContinuableAllow: 空集（deny 剔光全部）throw', () => {
  assert.throws(
    () => computeContinuableAllow(['read', 'write'], { deny: ['read', 'write'] }),
    /dispatch: continuable 工具集为空，拒绝派发/
  );
});

test('computeContinuableAllow: 去重（父级含重复）', () => {
  const result = computeContinuableAllow(['read', 'read', 'write', 'run_code']);
  assert.deepEqual(result, ['read', 'write']);
});

test('computeContinuableAllow: 未传 toolFilter（undefined）→ 仅剔 run_code', () => {
  const result = computeContinuableAllow(['read', 'run_code'], undefined);
  assert.deepEqual(result, ['read']);
});

test('computeContinuableAllow: 接受 Set 输入（与分支 new Set(...) 一致）', () => {
  const result = computeContinuableAllow(new Set(['read', 'write', 'run_code']));
  assert.deepEqual(result, ['read', 'write']);
});

// ---- enabled=false 时 continuable 拒绝（dispatch.execute 集成）------------

// 经 HTTP /set-enabled 把插件置为禁用：该路由同步改写 apply 闭包的 `enabled`，
// 使 dispatch.execute 的 continuable 分支顶部 !enabled 检查可被驱动。
function makeSetEnabledRoute() {
  const routes = [];
  const webServer = { register(config) { routes.push(config); return () => {}; } };
  return { webServer, routes };
}

async function postSetEnabled(handler, body) {
  const listeners = { data: [], end: [], error: [] };
  const req = {
    method: 'POST',
    url: 'http://localhost/subagent-profiles/set-enabled',
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    destroy() {},
  };
  const res = {
    state: { code: null, data: '' },
    writeHead(code) { this.state.code = code; },
    end(text) { this.state.data = text; },
  };
  const bodyText = JSON.stringify(body);
  const p = handler(req, res);
  if (bodyText.length > 0) for (const fn of listeners.data) fn(Buffer.from(bodyText));
  for (const fn of listeners.end) fn();
  await p;
  return { code: res.state.code, json: res.state.data ? JSON.parse(res.state.data) : null };
}

test('continuable: enabled=false 时 dispatch 拒绝（插件已禁用）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { webServer, routes } = makeSetEnabledRoute();
    const { ctx, records } = createFakeCtx({ services: { webServer } });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    assert.ok(tool, 'apply() 首次启用时必须注册 dispatch 工具');
    const handler = routes[0].handler;
    const resp = await postSetEnabled(handler, { enabled: false });
    assert.equal(resp.code, 200);
    assert.equal(resp.json.enabled, false);
    // 禁用后走 continuable 分支：分支顶部 !enabled 必须 fail-loud —— 这是对
    // provider start 只拦 `start` 不拦 `startContinuable` 的插件侧兜底（§7.1）。
    const parent = { ctx: { get: () => undefined }, options: {} };
    await assert.rejects(
      () => tool.execute({ prompt: 'x', continuable: true }, { agent: parent, signal: undefined }),
      (err) => {
        assert.match(err.message, /插件已禁用/);
        return true;
      }
    );
  } finally { iso.restore(); iso.teardown(); }
});
