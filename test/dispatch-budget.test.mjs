// test/dispatch-budget.test.mjs — 派发预算可配置 + 预算中止提醒：
//   * guard 默认值 500000/8 与 configure 原子更新/非法值忽略；
//   * state.json dispatchBudget 坏值回退默认（fail-soft）与持久化往返；
//   * token 上限拒绝时 mint P1「派发被预算上限中止」提醒（含数值），通过路径不 mint、
//     mint 失败不阻断 throw；
//   * 未采纳提醒 cause 分支文案（无 cause 原文 / budget-limit 归因版）；
//   * 设置保存即时生效（同一进程 guard.snapshot 反映新值，无需重启）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDispatchGuard } from '../lib/core/dispatch-guard.mjs';
import { applyBudgetGate } from '../lib/core/dispatch-gates.mjs';
import { mintUnadoptedReminder } from '../lib/core/adoption-reminder.mjs';
import { createProfileStore } from '../lib/core/profiles-store.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';
import { makeRouteHarness, callRoute } from './harness/routes.mjs';

const mod = await import('../index.mjs');

const PARENT = { session: { header: { id: 's1' } } };

function makeGateDeps(guard, reminderStore) {
  return {
    guard,
    logger: { warn() {} },
    store: { getAllowFailOpen: () => false },
    getReminderStore: () => reminderStore,
  };
}

function makeCompletedStart(id) {
  return async () => ({
    id,
    result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
    localAgent: { session: { events: [] } },
    dispose: async () => {},
  });
}

// --- guard 默认值与 configure --------------------------------------------------

test('dispatch-guard 默认值：maxParentTokens 500000 / maxConcurrent 8', () => {
  const guard = createDispatchGuard();
  const snapshot = guard.snapshot('p');
  assert.equal(snapshot.maxParentTokens, 500000);
  assert.equal(snapshot.maxConcurrent, 8);
});

test('guard configure：两值原子更新，acquire/recordTokens 立即用新值', () => {
  const guard = createDispatchGuard();
  const result = guard.configure({ maxConcurrent: 1, maxParentTokens: 150000 });
  assert.deepEqual(result, { updated: true, maxConcurrent: 1, maxParentTokens: 150000 });
  const snapshot = guard.snapshot('p');
  assert.equal(snapshot.maxConcurrent, 1);
  assert.equal(snapshot.maxParentTokens, 150000);
  assert.equal(guard.acquire('p').ok, true);
  assert.equal(guard.acquire('p').ok, false, '新并发上限 1 生效');
  assert.equal(guard.recordTokens('p', 150000), true, '新 token 上限 150000 生效');
});

test('guard configure：任一非法值忽略整次更新并 warn，不做部分更新', () => {
  const warns = [];
  const guard = createDispatchGuard({ warn: (m) => warns.push(m) });
  const first = guard.configure({ maxConcurrent: 99, maxParentTokens: 600000 });
  assert.equal(first.updated, false);
  assert.equal(first.maxConcurrent, 8);
  assert.equal(first.maxParentTokens, 500000);
  const second = guard.configure({ maxConcurrent: 4, maxParentTokens: 99 });
  assert.equal(second.updated, false, 'token 越界时并发值合法也不生效');
  assert.ok(warns.some((m) => m.includes('预算配置非法已忽略')));
  const snapshot = guard.snapshot('p');
  assert.equal(snapshot.maxConcurrent, 8);
  assert.equal(snapshot.maxParentTokens, 500000);
});

// --- state.json dispatchBudget 持久化（fail-soft）------------------------------

test('state.json dispatchBudget 坏值回退默认（fail-soft + warn）', () => {
  const iso = makeIsolatedDshHome();
  try {
    writeFileSync(join(iso.dir, 'subagent-profiles.state.json'), JSON.stringify({ dispatchBudget: { maxParentTokens: 999, maxConcurrent: 99 } }), 'utf8');
    const warns = [];
    const store = createProfileStore({ dshHome: iso.dir, logger: { warn: (m) => warns.push(m) } });
    assert.deepEqual(store.loadDispatchBudget(), { maxParentTokens: 500000, maxConcurrent: 8 });
    assert.ok(warns.some((m) => m.includes('dispatchBudget')), '坏值必须 warn');
  } finally { iso.restore(); iso.teardown(); }
});

test('state.json dispatchBudget 持久化：persist → load 同值，坏值不落盘', () => {
  const iso = makeIsolatedDshHome();
  try {
    const silent = { warn() {} };
    const store = createProfileStore({ dshHome: iso.dir, logger: silent });
    assert.equal(store.persistDispatchBudget({ maxParentTokens: 600000, maxConcurrent: 4 }).persisted, true);
    assert.deepEqual(createProfileStore({ dshHome: iso.dir, logger: silent }).loadDispatchBudget(), { maxParentTokens: 600000, maxConcurrent: 4 });
    const warns = [];
    const store2 = createProfileStore({ dshHome: iso.dir, logger: { warn: (m) => warns.push(m) } });
    assert.equal(store2.persistDispatchBudget({ maxParentTokens: 1, maxConcurrent: 2 }).persisted, true);
    assert.ok(warns.some((m) => m.includes('dispatchBudget')), '写入坏值必须 warn');
    assert.deepEqual(createProfileStore({ dshHome: iso.dir, logger: silent }).loadDispatchBudget(), { maxParentTokens: 500000, maxConcurrent: 2 }, '越界字段归一默认、合法字段保留');
  } finally { iso.restore(); iso.teardown(); }
});

// --- 预算闸失败 mint 提醒 --------------------------------------------------------

test('applyBudgetGate：token 上限拒绝时 mint P1 提醒（含 current/limit 数值）', () => {
  const minted = [];
  const reminderStore = { record: (entry) => minted.push(entry) };
  const guard = createDispatchGuard({ maxParentTokens: 100000 });
  guard.recordTokens('s1', 100000);
  const deps = makeGateDeps(guard, reminderStore);
  assert.throws(
    () => applyBudgetGate(deps, PARENT, { prompt: 'x' }, { tokenTier: 'cheap' }, { gates: [] }),
    /累计派发 token 已达上限 100000/
  );
  assert.equal(minted.length, 1);
  const entry = minted[0];
  assert.equal(entry.severity, 'P1');
  assert.equal(entry.kind, 'dispatch-budget-limit');
  assert.equal(entry.title, '派发被预算上限中止');
  assert.match(entry.detail, /本会话累计派发 token 已达上限 100000（当前 100000）/);
  assert.ok(entry.detail.includes('在设置中调高预算上限'), '建议句必须存在');
  assert.equal(entry.sessionId, 's1');
  assert.equal(entry.promptExcerpt, 'x');
});

test('applyBudgetGate：通过路径不 mint 提醒', () => {
  const minted = [];
  const reminderStore = { record: (entry) => minted.push(entry) };
  const guard = createDispatchGuard({ maxParentTokens: 100000 });
  const deps = makeGateDeps(guard, reminderStore);
  const handle = applyBudgetGate(deps, PARENT, { prompt: 'x' }, { tokenTier: 'cheap' }, { gates: [] });
  handle.finish('k', undefined);
  assert.equal(minted.length, 0, '通过路径零 mint');
});

test('applyBudgetGate：mint 失败不阻断 throw（fail-soft）', () => {
  const reminderStore = { record: () => { throw new Error('store down'); } };
  const guard = createDispatchGuard({ maxParentTokens: 100000 });
  guard.recordTokens('s1', 100000);
  const deps = makeGateDeps(guard, reminderStore);
  assert.throws(
    () => applyBudgetGate(deps, PARENT, { prompt: 'x' }, { tokenTier: 'cheap' }, { gates: [] }),
    /累计派发 token 已达上限 100000/
  );
});

// --- 未采纳提醒归因文案 ---------------------------------------------------------

test('mintUnadoptedReminder：无 cause 保持原文；budget-limit 归因文案含数值', () => {
  const minted = [];
  const audits = [];
  const store = { record: (entry) => minted.push(entry) };
  const evoLedger = { recordGovernanceAudit: (entry) => audits.push(entry) };
  const base = { parentSessionId: 'p', id: 'c1', ledgerKey: 'k', mode: 'one-shot', promptExcerpt: 'x' };
  mintUnadoptedReminder(store, evoLedger, base);
  assert.equal(minted[0].title, '派发结果未被采纳');
  assert.equal(minted[0].detail, '父 Agent 未采用该结果。若你认为结果有价值，可前往查看。');
  mintUnadoptedReminder(store, evoLedger, { ...base, cause: 'budget-limit', tokens: 300000, limit: 500000 });
  assert.equal(minted[1].title, '派发结果未被采纳（因预算中止）');
  assert.ok(minted[1].detail.includes('因 token 预算上限中止'));
  assert.ok(minted[1].detail.includes('300000'));
  assert.ok(minted[1].detail.includes('500000'));
  assert.equal(audits.length, 2, '每条判定各留一条同源审计');
  assert.equal(audits[0].kind, 'adoption-false');
});

// --- 设置保存即时生效（同一进程，无需重启）--------------------------------------

test('POST /set-budget：越界 400 中文提示；合法值保存即时生效 + GET 回读', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { webServer, routes } = makeRouteHarness();
    const { ctx, records } = createFakeCtx({ services: { webServer, agentPresets: { composedPreset: () => 'orchestrator-v2' } } });
    await mod.apply(ctx);
    const handler = routes[0].handler;
    const get = await callRoute(handler, 'GET', '/options/budget');
    assert.equal(get.code, 200);
    assert.deepEqual(get.json.dispatchBudget, { maxParentTokens: 500000, maxConcurrent: 8 });
    const bad = await callRoute(handler, 'POST', '/set-budget', { maxParentTokens: 999, maxConcurrent: 4 });
    assert.equal(bad.code, 400, '越界保存必须 fail-loud');
    assert.ok(bad.json.error.includes('100000'));
    const set = await callRoute(handler, 'POST', '/set-budget', { maxParentTokens: 600000, maxConcurrent: 4 });
    assert.equal(set.code, 200);
    assert.equal(set.json.persisted, true);
    assert.deepEqual(set.json.dispatchBudget, { maxParentTokens: 600000, maxConcurrent: 4 });
    // 同一进程无需重启：dispatch:budget section 立即读到新上限（guard.snapshot 生效值）。
    const budget = records.sectionCalls.find((s) => s.name === 'dispatch:budget');
    const text = budget.text({ agent: { ctx: {}, session: { header: { id: 's1' } } } });
    assert.equal(text, '派发预算：充足（剩余 600000 token / 上限 600000）');
    const get2 = await callRoute(handler, 'GET', '/options/budget');
    assert.deepEqual(get2.json.dispatchBudget, { maxParentTokens: 600000, maxConcurrent: 4 });
  } finally { iso.restore(); iso.teardown(); }
});

// --- 端到端：预算中止 → 提醒中心条目 ---------------------------------------------

test('execute 预算中止：提醒中心出现 dispatch-budget-limit 条目', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const tokenMeter = { measure: () => ({ totalTokens: 600000 }) };
    const { webServer, routes } = makeRouteHarness();
    const { ctx, records } = createFakeCtx({ subagentsStart: makeCompletedStart('child-bd'), services: { webServer, tokenMeter } });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    assert.ok(tool, 'apply() 必须注册 dispatch 工具');
    const parent = { ctx: { get: () => undefined }, options: {}, session: { header: { id: 'parent-bd' } } };
    const first = await tool.execute({ prompt: 'task', tokenTier: 'cheap' }, { agent: parent, signal: undefined });
    assert.equal(first.stopReason, 'completed');
    await assert.rejects(
      () => tool.execute({ prompt: 'task 2', tokenTier: 'cheap' }, { agent: parent, signal: undefined }),
      /累计派发 token 已达上限 500000/
    );
    const handler = routes[0].handler;
    const resp = await callRoute(handler, 'GET', '/reminders');
    assert.equal(resp.code, 200);
    const found = resp.json.reminders.find((r) => r.kind === 'dispatch-budget-limit');
    assert.ok(found, '提醒中心必须有派发被预算上限中止条目');
    assert.equal(found.severity, 'P1');
    assert.equal(found.title, '派发被预算上限中止');
    assert.match(found.detail, /本会话累计派发 token 已达上限 500000（当前 600000）/);
  } finally { iso.restore(); iso.teardown(); }
});
