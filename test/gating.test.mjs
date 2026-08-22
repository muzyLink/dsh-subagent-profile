// test/gating.test.mjs — V2 Token P0（SPEC §8.1）：
// 系统提示门控——`dispatch:profiles` / `orchestrator:mode` 两段 section 仅在
// 「当前席 Agent 的 composedPreset === 'orchestrator'（预设特征主判据）且插件启用」
// 时非空；否则返回 ''。
//
// 判据（以源码为准确认，见 test/README.md）：
//   section.text(context) 收到 `{ agent, scope, signal }`（host 经由
//   assembleContextFor(agent, signal) 调用）。dispatch 工具由本 host 行注册，经
//   dsh-tools schemas(scope) 的 global 继承起点对每个 agent 恒可见，故
//   「schemas(agent) 含 dispatch」恒真，**不能**作为主判据。
//   主判据 = `composedPreset(agentCtx) === 'orchestrator'`（preset 特征）；
//   schemas 判据降为**否决**——schemas(agent) 明确不含 dispatch → 必空（防御性，
//   生产恒含 dispatch，正常路径不触发）。
//
// 快照更新说明（规格评审预告过的 T5 快照变化）：characterization.test.mjs 的
// systemPrompt.section 快照改为「composedPreset 桩返回 orchestrator + dispatch-
// capable toolSchemas 下 text({ agent }) 非空」——主判据由 schemas 改为 preset
// 特征后，默认 fake（无 agentPresets 桩）会命中「无 agentPresets → 空」分支，
// 故快照需提供 composedPreset 桩。详见报告。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';

const mod = await import('../index.mjs');

// 取 apply() 注册的某两个 section 的 text 回调。
function sectionsOf(records) {
  const profiles = records.sectionCalls.find((s) => s.name === 'dispatch:profiles');
  const orchestrator = records.sectionCalls.find((s) => s.name === 'orchestrator:mode');
  assert.ok(profiles, 'dispatch:profiles section must be registered');
  assert.ok(orchestrator, 'orchestrator:mode section must be registered');
  return { profiles, orchestrator };
}

// 经 HTTP /set-enabled 把插件置为禁用：该路由同步改写 apply 闭包的 `enabled`。
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
async function disablePlugin(routes) {
  const handler = routes[0].handler;
  const resp = await postSetEnabled(handler, { enabled: false });
  assert.equal(resp.code, 200);
  assert.equal(resp.json.enabled, false);
}

const ORCHESTRATOR_STUB = { composedPreset: () => 'orchestrator' };
const STANDARD_STUB = { composedPreset: () => 'standard' };

test('§8.1 gate: composedPreset=orchestrator + schemas 含 dispatch → 两段非空', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ services: { agentPresets: ORCHESTRATOR_STUB } });
    await mod.apply(ctx);
    const { profiles, orchestrator } = sectionsOf(records);
    // agent.ctx 供主判据 composedPreset(agentCtx) 使用（stub 忽略入参返回 orchestrator）。
    assert.ok(profiles.text({ agent: { ctx: {} } }).length > 0, 'orchestrator → profiles 非空');
    assert.ok(orchestrator.text({ agent: { ctx: {} } }).length > 0, 'orchestrator → mode 非空');
  } finally { iso.restore(); iso.teardown(); }
});

test('§8.1 gate: schemas 含 dispatch 但 composedPreset=standard → 空（主判据拒绝）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    // default toolSchemas=[{name:'dispatch'}]（含 dispatch），但 preset 非 orchestrator。
    const { ctx, records } = createFakeCtx({ services: { agentPresets: STANDARD_STUB } });
    await mod.apply(ctx);
    const { profiles, orchestrator } = sectionsOf(records);
    assert.equal(profiles.text({ agent: {} }), '', 'composedPreset=standard → profiles 空');
    assert.equal(orchestrator.text({ agent: {} }), '', 'composedPreset=standard → mode 空');
  } finally { iso.restore(); iso.teardown(); }
});

test('§8.1 gate: schemas 明确不含 dispatch → 空（否决，即便 composedPreset=orchestrator）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ toolSchemas: [], services: { agentPresets: ORCHESTRATOR_STUB } });
    await mod.apply(ctx);
    const { profiles, orchestrator } = sectionsOf(records);
    assert.equal(profiles.text({ agent: {} }), '', 'schemas 无 dispatch → profiles 空（否决）');
    assert.equal(orchestrator.text({ agent: {} }), '', 'schemas 无 dispatch → mode 空（否决）');
  } finally { iso.restore(); iso.teardown(); }
});

test('§8.1 gate: 无 agentPresets → 两段空（无法判别 preset 特征，保守不注入）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx(); // 默认 services 无 agentPresets
    await mod.apply(ctx);
    const { profiles, orchestrator } = sectionsOf(records);
    assert.equal(profiles.text({ agent: { ctx: {} } }), '', '无 agentPresets → profiles 空');
    assert.equal(orchestrator.text({ agent: { ctx: {} } }), '', '无 agentPresets → mode 空');
  } finally { iso.restore(); iso.teardown(); }
});

test('§8.1 gate: context 缺省（无 agent）但 composedPreset=orchestrator → 非空（回退插件 ctx）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ services: { agentPresets: ORCHESTRATOR_STUB } });
    await mod.apply(ctx);
    const { profiles, orchestrator } = sectionsOf(records);
    // context 缺省 → 主判据 agentCtx 取插件 ctx；stub 忽略入参返回 orchestrator。
    assert.ok(profiles.text().length > 0, 'context 缺省 + orchestrator 桩 → profiles 非空');
    assert.ok(orchestrator.text().length > 0, 'context 缺省 + orchestrator 桩 → mode 非空');
  } finally { iso.restore(); iso.teardown(); }
});

test('§8.1 gate: enabled=false（composedPreset=orchestrator）→ 两段仍为空（第一道门）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { webServer, routes } = makeSetEnabledRoute();
    const { ctx, records } = createFakeCtx({ services: { webServer, agentPresets: ORCHESTRATOR_STUB } });
    await mod.apply(ctx);
    await disablePlugin(routes);
    const { profiles, orchestrator } = sectionsOf(records);
    assert.equal(profiles.text({ agent: {} }), '', 'enabled=false → profiles 空');
    assert.equal(orchestrator.text({ agent: {} }), '', 'enabled=false → mode 空');
  } finally { iso.restore(); iso.teardown(); }
});
