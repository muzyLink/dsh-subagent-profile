// test/budget-states.test.mjs — 预算余量三态 + 低位封顶：
//   50%/15% 边界文案（纯函数）；<15% 越档 fail-loud（applyBudgetGate，含
//   「当前可用最高档=cheap」）；dispatch:budget section 经 apply 接线为三态文案。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGET_AMPLE_RATIO,
  BUDGET_TIGHT_RATIO,
  budgetRemaining,
  budgetSectionText,
  requestedTierBeyondCheap,
  applyBudgetGate,
} from '../lib/core/dispatch-gates.mjs';
import { createDispatchGuard } from '../lib/core/dispatch-guard.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';

const mod = await import('../index.mjs');

// ---- 三态文案：50% / 15% 边界 ----------------------------------------------------------

test('budgetSectionText：≥50% 充足 / ≥15% 紧张 / 其余告警（边界值钉死）', () => {
  assert.match(budgetSectionText({ tokens: 0, maxParentTokens: 200000 }), /^派发预算：充足（剩余 200000 token \/ 上限 200000）$/);
  assert.match(budgetSectionText({ tokens: 100000, maxParentTokens: 200000 }), /^派发预算：充足（剩余 100000 token \/ 上限 200000）$/, '恰好 50% → 充足');
  assert.match(budgetSectionText({ tokens: 100001, maxParentTokens: 200000 }), /^派发预算：紧张（剩余 99999 token \/ 上限 200000），优先 cheap 方案$/);
  assert.match(budgetSectionText({ tokens: 170000, maxParentTokens: 200000 }), /^派发预算：紧张（剩余 30000 token \/ 上限 200000），优先 cheap 方案$/, '恰好 15% → 紧张');
  assert.match(budgetSectionText({ tokens: 170001, maxParentTokens: 200000 }), /^派发预算：告警（剩余 29999 token \/ 上限 200000），仅允许 cheap 方案；当前可用最高档=cheap$/);
  assert.match(budgetSectionText({ tokens: 199999, maxParentTokens: 200000 }), /^派发预算：告警（剩余 1 token \/ 上限 200000）/);
  assert.match(budgetSectionText({ tokens: 250000, maxParentTokens: 200000 }), /^派发预算：告警（剩余 0 token \/ 上限 200000）/, '超额按 0 兜底');
});

test('budgetRemaining：比例口径与阈值常量一致（0.5 / 0.15）', () => {
  assert.equal(BUDGET_AMPLE_RATIO, 0.5);
  assert.equal(BUDGET_TIGHT_RATIO, 0.15);
  assert.deepEqual(budgetRemaining({ tokens: 100000, maxParentTokens: 200000 }), { remaining: 100000, ratio: 0.5 });
  assert.deepEqual(budgetRemaining({ tokens: 170000, maxParentTokens: 200000 }), { remaining: 30000, ratio: 0.15 });
  assert.deepEqual(budgetRemaining({ tokens: 0, maxParentTokens: 0 }), { remaining: 0, ratio: 0 });
});

// ---- 请求档位推定：tokenTier 或 model/effort -------------------------------------------

test('requestedTierBeyondCheap：tokenTier / reasoningEffort / model 推定', () => {
  assert.equal(requestedTierBeyondCheap({ tokenTier: 'cheap' }), false, '显式 cheap 不超档');
  assert.equal(requestedTierBeyondCheap({ tokenTier: 'cheap', reasoningEffort: 'off' }), false, 'cheap + off 不超档');
  assert.equal(requestedTierBeyondCheap({ tokenTier: 'cheap', model: 'deepseek-v4-flash' }), false, 'cheap + flash 系模型不超档');
  assert.equal(requestedTierBeyondCheap({}), true, '缺省 balanced 超档');
  assert.equal(requestedTierBeyondCheap({ tokenTier: 'balanced' }), true);
  assert.equal(requestedTierBeyondCheap({ tokenTier: 'premium' }), true);
  assert.equal(requestedTierBeyondCheap({ tokenTier: 'cheap', reasoningEffort: 'high' }), true, 'cheap + 高 effort 推定超档');
  assert.equal(requestedTierBeyondCheap({ tokenTier: 'cheap', model: 'deepseek-v4' }), true, 'cheap + 非 flash 模型推定超档');
});

// ---- 预检联动：<15% 越档 fail-loud -----------------------------------------------------

function makeGateDeps(guard, tokens) {
  guard.recordTokens('s1', tokens);
  return {
    guard,
    logger: { warn() {} },
    getEnabled: () => true,
    store: { getAllowFailOpen: () => false },
  };
}
const PARENT = { session: { header: { id: 's1' } } };

test('applyBudgetGate：余量 <15% + 档位超出 cheap → fail-loud（不占并发槽）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const guard = createDispatchGuard({ maxParentTokens: 200000 });
    const deps = makeGateDeps(guard, 190000); // 剩余 5%
    const trace = { gates: [] };
    const messages = [];
    deps.logger.warn = (message) => messages.push(String(message));
    assert.throws(
      () => applyBudgetGate(deps, PARENT, { prompt: 'x' }, { tokenTier: 'balanced' }, trace),
      /预算不足：当前可用最高档=cheap，请改用 cheap 方案或为会话增加预算/
    );
    assert.ok(messages.some((m) => m.includes('当前可用最高档=cheap')), 'warn 留痕必须含当前可用最高档=cheap');
    assert.equal(trace.gates.length, 1, '失败闸必须记入轨迹');
    assert.equal(trace.gates[0].name, 'budget');
    assert.equal(trace.gates[0].verdict, 'fail');
    assert.equal(guard.snapshot('s1').concurrency, 0, 'fail-loud 不得占并发槽');
  } finally { iso.restore(); iso.teardown(); }
});

test('applyBudgetGate：余量 <15% 但 cheap 档（或 effort off / flash 模型）→ 放行', () => {
  const guard = createDispatchGuard({ maxParentTokens: 200000 });
  const deps = makeGateDeps(guard, 190000);
  for (const merged of [{ tokenTier: 'cheap' }, { tokenTier: 'cheap', reasoningEffort: 'off' }, { tokenTier: 'cheap', model: 'deepseek-v4-flash' }]) {
    const handle = applyBudgetGate(deps, PARENT, { prompt: 'x' }, merged, { gates: [] });
    assert.ok(handle.finish, 'cheap 请求必须获得结算句柄');
    handle.finish('k', undefined);
  }
});

test('applyBudgetGate：余量恰好 15% → 不触发封顶（仍走 acquire 路径）', () => {
  const guard = createDispatchGuard({ maxParentTokens: 200000 });
  const deps = makeGateDeps(guard, 170000); // 剩余 30000 = 15%
  const handle = applyBudgetGate(deps, PARENT, { prompt: 'x' }, { tokenTier: 'premium' }, { gates: [] });
  assert.ok(handle.finish, '恰好 15% 不得 fail-loud');
  handle.finish('k', undefined);
});

test('applyBudgetGate：continuable 不占预算（低余量也不受封顶）', () => {
  const guard = createDispatchGuard({ maxParentTokens: 200000 });
  const deps = makeGateDeps(guard, 190000);
  const handle = applyBudgetGate(deps, PARENT, { prompt: 'x', continuable: true }, { tokenTier: 'premium' }, { gates: [] });
  assert.equal(handle.parentSessionId, undefined, 'continuable 不占预算');
});

// ---- section 接线：dispatch:budget 三态文案 -------------------------------------------------

test('dispatch:budget section：orchestrator-v2 + sessionId → 三态文案（充足）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ services: { agentPresets: { composedPreset: () => 'orchestrator-v2' } } });
    await mod.apply(ctx);
    const budget = records.sectionCalls.find((s) => s.name === 'dispatch:budget');
    const text = budget.text({ agent: { ctx: {}, session: { header: { id: 's1' } } } });
    assert.equal(text, '派发预算：充足（剩余 500000 token / 上限 500000）');
    assert.equal(budget.text({ agent: { ctx: {} } }), '', '无父 sessionId 不注入');
  } finally { iso.restore(); iso.teardown(); }
});
