// lib/core/dispatch-guard.mjs — 派发总预算守卫（进程级并发上限 + 每父累计 token
// 记账）+ 在途登记表（级联取消）。import-free（仅 node 内置），工厂式参数注入、
// 无模块级单例：每次 apply 各持一份独立状态。
//
// 三职责：
//   1. 并发上限：同一父会话的在途 one-shot 派发数封顶（acquire/release，release 幂等，
//      计数归零删键）；
//   2. 每父累计 token：子结算时的 childTotalTokens 独立进程级记账（不复用 profiles
//      Map，避免与 registry 状态耦合），累计达到上限后该父会话后续派发被拒；
//   3. 在途登记：track/untrack/cancelAll（前台 run.dispose、后台 jobs.kill、
//      continuable 宿主 interrupt），禁用/卸载时级联取消在途派发。
//
// 边界（后来开发者须知）：
//   * 并发上限 8 与 token 上限 500_000 为默认值；configure 可在运行时改写（设置页保存即时生效）。
//   * 守卫只拦「新增派发」（acquire 拒绝），不拦现有任何合法路径（数值内零影响）。
//   * 父会话结束的记账释放不依赖宿主生命周期事件（插件侧无法可靠观测父会话结束）：
//     释放依赖禁用/卸载清账（reset）+ 上限轮换兜底，见 index.mjs 的 syncTool 禁用
//     分支与 dispose 钩子。
//   * continuable 子会话只可「中断当前 turn」（宿主 interrupt 为 fire-and-return
//     中断、非终止，子会话仍驻留），详见 dispatch-tool.mjs 的 in-flight 登记注释。
//   * continuable 的 in-flight 登记无 untrack 点（持久子会话无结算时刻）：登记只服务
//     禁用/卸载时的 interrupt 级联，条目随 reset 或进程生命周期释放——这是有意的
//     fire-and-return 口径，勿按 one-shot 的结算-释放模式补 untrack。

function emptyKey(key) {
  return key === undefined || key === null || key === '';
}

// acquire 主体：并发 +1；token 累计已达上限或并发已满时拒绝（不 +1）。无父
// sessionId 时跳过守卫（返回 ok + no-op release，数值内零影响）。
function acquireSlot(concurrency, tokenTotals, maxConcurrent, maxParentTokens, parentSessionId) {
  if (emptyKey(parentSessionId)) {
    return { ok: true, release: () => {}, skipped: true };
  }
  const current = concurrency.get(parentSessionId) ?? 0;
  if (current >= maxConcurrent) {
    return { ok: false, reason: 'concurrency', limit: maxConcurrent };
  }
  const tokens = tokenTotals.get(parentSessionId) ?? 0;
  if (tokens >= maxParentTokens) {
    return { ok: false, reason: 'tokens', limit: maxParentTokens };
  }
  concurrency.set(parentSessionId, current + 1);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const next = (concurrency.get(parentSessionId) ?? 1) - 1;
      if (next <= 0) concurrency.delete(parentSessionId);
      else concurrency.set(parentSessionId, next);
    },
  };
}

// recordTokens 主体：结算时把子 childTotalTokens 记入父会话累计，返回累计是否已达
// 上限（>= 上限）。空 id / 已 dispose 的父 / 非有限非负数跳过并返回 false（fail-soft，
// 绝不阻断结算）。disposed 守卫是 H2 修复：父会话结束（resetParent）后后台任务才
// 结算时，若仍 set 会把 tokenTotals 键重新插回，导致 Map 随会话数无界增长。
function addTokens(tokenTotals, disposed, maxParentTokens, parentSessionId, childTotalTokens) {
  if (emptyKey(parentSessionId) || disposed.has(parentSessionId)) return false;
  if (typeof childTotalTokens !== 'number' || !Number.isFinite(childTotalTokens) || childTotalTokens < 0) return false;
  const next = (tokenTotals.get(parentSessionId) ?? 0) + childTotalTokens;
  tokenTotals.set(parentSessionId, next);
  return next >= maxParentTokens;
}

// track/untrack 主体：登记一个在途派发（key=前台 run.id / 后台 jobId / continuable
// childId）。cancel 可能为 undefined（continuable 宿主无 interrupt 时注明边界）。
function registerInflight(inflight, key, cancel) {
  if (emptyKey(key)) return;
  inflight.set(key, typeof cancel === 'function' ? cancel : undefined);
}

function dropInflight(inflight, key) {
  if (emptyKey(key)) return;
  inflight.delete(key);
}

// cancelAll 主体：级联取消全部在途派发（禁用/卸载）。每项 cancel 恰好调用一次并清空
// 登记表；cancel 缺失或抛错时 warn（fail-soft，绝不因单项失败阻断整体取消）。
function cancelInflight(inflight, warn, reason) {
  const entries = [...inflight.entries()];
  inflight.clear();
  for (const [key, cancel] of entries) {
    if (typeof cancel !== 'function') continue;
    try {
      cancel(reason);
    } catch (error) {
      warn(`dispatch: 取消在途派发 ${key} 失败（${error instanceof Error ? error.message : String(error)}）`);
    }
  }
}

// 预算参数区间与默认值：configure 与配置读写共用同一口径，改默认只动这里。
export const DISPATCH_BUDGET_LIMITS = {
  maxParentTokens: { min: 100000, max: 2000000, default: 500000 },
  maxConcurrent: { min: 1, max: 32, default: 8 },
};

// 区间内整数判定：非整数/非有限/越界一律 false（configure 非法值忽略的依据）。
function budgetValueValid(value, limits) {
  return typeof value === 'number' && Number.isInteger(value) && value >= limits.min && value <= limits.max;
}

// 按父释放（见 index.mjs 的 agent/disposed 挂钩）：父会话逻辑结束（Agent 注册
// fiber 卸载）时删该父的并发计数与 token 累计键。在途登记表键为子标识
// （run.id/jobId/childId）不含父 id，不在此清——在途子随自身结算或禁用/卸载级联
// 取消自然收敛。
export function createDispatchGuard({ maxConcurrent = DISPATCH_BUDGET_LIMITS.maxConcurrent.default, maxParentTokens = DISPATCH_BUDGET_LIMITS.maxParentTokens.default, warn = () => {} } = {}) {
  const concurrency = new Map();
  const tokenTotals = new Map();
  const inflight = new Map();
  // H2：已 dispose 的父会话 id 集合。resetParent（agent/disposed 挂钩）登记，防止
  // 后台任务在父结束后结算时经 recordTokens 把 tokenTotals 键重插回来（无界增长）。
  // 该集合按会话数线性增长（每会话一条小字符串），远小于原泄漏的每次结算一插。
  const disposed = new Set();
  // 预算参数走可变引用：configure 改写后 acquire/recordTokens/snapshot 立即读新值。
  const budget = { maxConcurrent, maxParentTokens };
  return {
    acquire: (parentSessionId) => acquireSlot(concurrency, tokenTotals, budget.maxConcurrent, budget.maxParentTokens, parentSessionId),
    recordTokens: (parentSessionId, childTotalTokens) => addTokens(tokenTotals, disposed, budget.maxParentTokens, parentSessionId, childTotalTokens),
    track: (key, cancel) => registerInflight(inflight, key, cancel),
    untrack: (key) => dropInflight(inflight, key),
    cancelAll: (reason = 'dispatch: 插件已禁用或卸载，取消在途派发') => cancelInflight(inflight, warn, reason),
    resetParent: (parentSessionId) => {
      if (emptyKey(parentSessionId)) return;
      disposed.add(parentSessionId);
      concurrency.delete(parentSessionId);
      tokenTotals.delete(parentSessionId);
    },
    // 运行时改预算参数：两值都合法才原子更新（任一非法忽略整次更新并 warn，
    // 不做部分更新）；返回更新后的生效值。
    configure: ({ maxConcurrent, maxParentTokens } = {}) => {
      const concurrencyOk = budgetValueValid(maxConcurrent, DISPATCH_BUDGET_LIMITS.maxConcurrent);
      const tokensOk = budgetValueValid(maxParentTokens, DISPATCH_BUDGET_LIMITS.maxParentTokens);
      if (!concurrencyOk || !tokensOk) {
        warn('dispatch: 预算配置非法已忽略（maxConcurrent 需 1~32 整数、maxParentTokens 需 100000~2000000 整数）');
        return { updated: false, maxConcurrent: budget.maxConcurrent, maxParentTokens: budget.maxParentTokens };
      }
      budget.maxConcurrent = maxConcurrent;
      budget.maxParentTokens = maxParentTokens;
      return { updated: true, maxConcurrent: budget.maxConcurrent, maxParentTokens: budget.maxParentTokens };
    },
    snapshot: (parentSessionId) => ({
      concurrency: typeof parentSessionId === 'string' && parentSessionId !== '' ? (concurrency.get(parentSessionId) ?? 0) : 0,
      tokens: typeof parentSessionId === 'string' && parentSessionId !== '' ? (tokenTotals.get(parentSessionId) ?? 0) : 0,
      maxConcurrent: budget.maxConcurrent,
      maxParentTokens: budget.maxParentTokens,
    }),
    reset: () => {
      concurrency.clear();
      tokenTotals.clear();
      inflight.clear();
      disposed.clear();
    },
  };
}

// 在途登记 helper：前台 one-shot key=run.id，cancel=run.dispose（禁用/卸载级联取消）。
export function trackForegroundInflight(guard, run) {
  guard.track(run.id, () => run.dispose().catch(() => {}));
}

// 在途登记 helper：后台 job key=jobId，cancel=jobs.kill（owner=parent 作 caller 授权；
// 未知 job 抛错、已结算 job 返回 already-finished——两者均由 guard.cancelAll 的
// fail-soft 兜底，级联取消不因单项失败中断）。
export function trackBackgroundInflight(guard, jobs, jobId, parent) {
  guard.track(jobId, (reason) => {
    if (typeof jobs.kill === 'function') jobs.kill(jobId, parent, reason);
  });
}

// 在途登记 helper：continuable 子会话 key=childId，cancel=宿主 interrupt（fire-and-
// return 中断当前 turn，非终止——子会话仍驻留，后续 send_message 可唤醒；插件侧无法
// 终止持久子会话）。无 interrupt 能力时不登记取消（cancelAll 跳过）。
export function trackContinuableInflight(guard, subagents, childId, parentSessionId) {
  if (typeof subagents.interrupt === 'function') {
    guard.track(childId, () => subagents.interrupt(childId, { kind: 'user', parentSessionId }));
  }
}
