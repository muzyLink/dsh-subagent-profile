// lib/core/dispatch-gates.mjs — dispatch 预检段各道闸的应用 + 决策轨迹记录，
// 从 dispatch-tool.mjs 拆出以守文件行门。闸逻辑与 fail-loud 文案逐字不变；
// 这里只「应用闸并就地记录 decisionTrace 的 pass/fail」，不改变任何派发行为。
//
// 依赖边界（无 @deepseek-ai 依赖）：只 import lib/core 模块——cost-guard
// （assertCostGuard）、decision-trace（recordGate / hardLimitChecks /
// effectiveModelSourceOf）、pure（MAX_TOKENS / MAX_DEPTH）、model-policy
// （官方模型选择投影读取与路由断言）、escape（放行审计快照口径）。

import { assertCostGuard } from './cost-guard.mjs';
import { recordGate, hardLimitChecks, effectiveModelSourceOf } from './decision-trace.mjs';
import { MAX_TOKENS, MAX_DEPTH, computeContinuableAllow } from './pure.mjs';
import { assertOfficialModelRoute, readModelSelectionPolicy } from './model-policy.mjs';
import { escapeGatesSnapshot } from './escape.mjs';
import { mintReminder, promptExcerptOf } from './adoption-reminder.mjs';
import { tierLockVerdictOf, deriveTierConfig, TIER_DEFAULTS } from './tier-map.mjs';

// 预检：显式具体 preset 必须在运行时推导的白名单内；与父 composed 预设相同的
// preset 改写为 'inherit'（不换装）。纯函数化：whitelist / parentComposed 由调用方
// 预检段 resolve 一次后注入（避免重复 list()），throw 语义与文案逐字不变。
function assertPresetWhitelist(merged, whitelist, parentComposed) {
  if (typeof merged.preset !== 'string' || merged.preset === 'inherit') return;
  if (!whitelist.has(merged.preset)) {
    throw new Error(`dispatch: 预设 "${merged.preset}" 不在 system-trust 白名单（可在设置页改用受信任预设）`);
  }
  if (merged.preset === parentComposed) merged.preset = 'inherit';
}

// 白名单闸：预检段只 resolve 一次名单，结果同时喂本闸与 trace。'inherit' 改写
// 也如实记入 resolvedPreset；fail 时先记 fail 闸再 rethrow（文案不变）。
export function applyWhitelistGate(trace, merged, whitelist, parentComposed) {
  const input = { requestedPreset: typeof merged.preset === 'string' ? merged.preset : undefined, systemTrustCandidates: [...whitelist] };
  try {
    assertPresetWhitelist(merged, whitelist, parentComposed);
    recordGate(trace, { name: 'whitelist', input, output: { allowed: true, resolvedPreset: merged.preset ?? 'inherit' }, verdict: 'pass' });
  } catch (error) {
    recordGate(trace, { name: 'whitelist', input, output: { allowed: false, resolvedPreset: input.requestedPreset }, verdict: 'fail', reason: error.message });
    throw error;
  }
}

// 治理审计（official-model-reject）：dispatch 渠道带决策轨迹快照（escapeGatesSnapshot），
// provider 渠道带渠道口径快照（whitelist/cost 已过、intersection deferred、approval never）。
function recordOfficialModelReject(deps, effective) {
  deps.evoLedger.recordGovernanceAudit({
    kind: 'official-model-reject',
    provider: effective.provider ?? null,
    model: effective.model ?? null,
    session_id: deps.sessionId ?? null,
    gates_snapshot: deps.gatesSnapshot ?? { whitelist: 'pass', cost: 'pass', intersection: 'deferred', approval: 'never' },
  });
}

// 官方模型选择闸：policy 未配置（投影缺失）→ 静默跳过——轨迹不新增闸条目，
// 行为与 0.4.0 完全一致；配置后对生效路由（解析链完成后的最终 provider/model，
// 含继承带出的模型）精确成对校验，越界 fail-loud 三层中文错误 + 治理审计。
// fail 时先记 fail 闸再 rethrow。
export function applyOfficialModelGate(deps, { policy, effective }) {
  if (policy === undefined || policy.configured !== true) return;
  const input = {
    policy: { enabled: policy.enabled, allowedModels: [...policy.allowedModels] },
    effective: { provider: effective.provider, model: effective.model },
  };
  try {
    assertOfficialModelRoute(policy, effective.provider, effective.model);
    recordGate(deps.trace, { name: 'official-model', input, output: { allowed: true }, verdict: 'pass' });
  } catch (error) {
    recordGate(deps.trace, { name: 'official-model', input, output: { allowed: false }, verdict: 'fail', reason: error.message });
    recordOfficialModelReject({ ...deps, gatesSnapshot: escapeGatesSnapshot(deps.trace) }, effective);
    throw error;
  }
}

// dispatch 渠道官方模型预检：一次完成「生效来源判定（写入 requested 快照供台账
// 与派发台账共用）→ 投影读取 → 生效路由判定 → 闸记录/审计」，调用方只需一行接线。
// 投影缺失时闸静默跳过；source 值 call/profile/parent/default 恒写入 requested。
export function runOfficialModelPreflight(deps, parent, merged, args) {
  deps.trace.requested.source = effectiveModelSourceOf(args, merged, parent);
  const policy = readModelSelectionPolicy(parent?.ctx, parent?.session);
  const effective = {
    provider: merged.provider ?? parent?.options?.provider,
    model: merged.model ?? parent?.options?.model,
  };
  applyOfficialModelGate(deps, { policy, effective });
}

// 档位互锁闸（resolve 后、cost guard 前）：请求显式携带档位时，显式
// reasoningEffort 超过档位允许上限、显式 maxTokens 超过档位默认预算即与档位承诺
// 冲突 → fail-loud。显式值与档位承诺一致或更省时放行。不带档位的调用整体跳过
// （不记闸条目），旧调用轨迹逐字节不变。fail 前先记 fail 闸再 rethrow。
export function applyTierLockGate(trace, merged, parent, deps) {
  const verdict = tierLockVerdictOf(merged);
  if (verdict.check !== true) return;
  const input = {
    tokenTier: verdict.tier,
    reasoningEffort: typeof merged.reasoningEffort === 'string' ? merged.reasoningEffort : undefined,
    maxTokens: typeof merged.maxTokens === 'number' ? merged.maxTokens : undefined,
  };
  if (verdict.allowed) {
    recordGate(trace, { name: 'tier-lock', input, output: { allowed: true }, verdict: 'pass' });
    return;
  }
  const first = verdict.conflicts[0];
  const message = first.field === 'reasoningEffort'
    ? `dispatch: 档位 ${verdict.tier} 与显式推理档 ${first.requested} 冲突——档位是成本/深度承诺，显式值与之矛盾；请改档位或改显式推理档（档位 ${verdict.tier} 允许至 ${first.ceiling}）`
    : `dispatch: 档位 ${verdict.tier} 的 token 预算承诺为 ${first.ceiling}，显式 maxTokens=${first.requested} 超出承诺——档位是成本/深度承诺，显式值与之矛盾；请改档位或改显式 maxTokens`;
  recordGate(trace, {
    name: 'tier-lock',
    input,
    output: { allowed: false, conflicts: verdict.conflicts },
    verdict: 'fail',
    reason: message,
  });
  deps.logger?.warn(`[dsh-subagent-profile] ${message}`);
  throw new Error(message);
}

// 继承变更判定（纯函数）：合并后生效路由与父会话当前路由（parent.options.provider /
// model）逐字段比对——父会话缺失（无 session）或父路由未声明时无法判定变更 → 不
// 触发；变更来源非显式（auto 解析 / 方案带出 / 默认；顶层或 strategy 对象显式指定
// model/provider 恒不触发）时成立。返回 needConfirm 与变更后的生效路由。
export function inheritConfirmVerdictOf(args, merged, parent) {
  const hasSession = parent !== null && typeof parent === 'object'
    && parent.session !== undefined && parent.session !== null;
  if (!hasSession) return { needConfirm: false };
  const parentProvider = parent.options !== null && typeof parent.options === 'object' ? parent.options.provider : undefined;
  const parentModel = parent.options !== null && typeof parent.options === 'object' ? parent.options.model : undefined;
  const known = (value) => typeof value === 'string' && value !== '';
  const effectiveProvider = merged !== null && typeof merged === 'object' ? (merged.provider ?? parentProvider) : parentProvider;
  const effectiveModel = merged !== null && typeof merged === 'object' ? (merged.model ?? parentModel) : parentModel;
  const providerChanged = known(parentProvider) && known(effectiveProvider) && effectiveProvider !== parentProvider;
  const modelChanged = known(parentModel) && known(effectiveModel) && effectiveModel !== parentModel;
  if (!providerChanged && !modelChanged) return { needConfirm: false };
  const source = effectiveModelSourceOf(args, merged, parent);
  if (source !== 'auto' && source !== 'profile' && source !== 'default') return { needConfirm: false };
  return { needConfirm: true, effectiveProvider, effectiveModel, parentProvider, parentModel, source };
}

// 三层中文错误文案（事实/语义/行动，范式对齐官方模型选择闸）：事实层说明方案或
// auto 解析带来的生效路由与父会话当前路由；语义层提示预算与性能风险；行动层给
// 三条出路。
function inheritConfirmMessage(args, verdict) {
  const shown = (value) => (typeof value === 'string' && value !== '' ? value : '(parent)');
  const subject = verdict.source === 'auto'
    ? 'auto 解析'
    : `方案 ${args !== null && typeof args === 'object' && typeof args.profile === 'string' && args.profile !== '' ? args.profile : '(inline)'}`;
  return [
    `dispatch: ${subject} 将把该子代理配置为 provider/model ${shown(verdict.effectiveProvider)}/${shown(verdict.effectiveModel)}（父会话当前为 ${shown(verdict.parentProvider)}/${shown(verdict.parentModel)}；变更来自方案配置而非显式指定）`,
    '未确认的模型变更可能产生预算与性能意外',
    '确认请传 confirm: true；或显式传 provider/model 覆盖；或改用与父会话相同的模型',
  ].join('\n');
}

// 继承变更确认闸（tier-lock 后、cost 前）：不触发不记闸（旧调用轨迹不变）；
// confirm:true 放行并记 pass；未确认记 fail 闸再 throw 三层中文错误。
export function applyInheritConfirmGate(trace, args, merged, parent) {
  const verdict = inheritConfirmVerdictOf(args, merged, parent);
  if (verdict.needConfirm !== true) return;
  const confirmed = args !== null && typeof args === 'object' && args.confirm === true;
  const input = {
    needConfirm: true,
    requestedChange: { provider: verdict.effectiveProvider, model: verdict.effectiveModel },
    confirmed,
  };
  if (confirmed) {
    recordGate(trace, { name: 'confirm', input, output: { allowed: true }, verdict: 'pass' });
    return;
  }
  const message = inheritConfirmMessage(args, verdict);
  recordGate(trace, { name: 'confirm', input, output: { allowed: false }, verdict: 'fail', reason: message });
  throw new Error(message);
}

// 档位派生默认（cost guard 之后、请求组装之前）：请求显式携带档位且无显式
// reasoningEffort / maxTokens 时，按档位表派生缺省值注入 merged；effort 经目录
// efforts 收敛到模型支持的档位（目录不可用或模型未知时回退表值）。只返回实际
// 注入的字段——调用方据此决定注入值与派生标记，不改变 explicit 值。不带档位的
// 调用返回空对象（不派生，旧调用行为不变）。
export async function resolveTierDerivation(deps, parent, merged) {
  const tier = merged !== null && typeof merged === 'object' && typeof merged.tokenTier === 'string' && TIER_DEFAULTS[merged.tokenTier] !== undefined
    ? merged.tokenTier
    : undefined;
  if (tier === undefined) return {};
  let modelEfforts;
  try {
    const llm = parent?.ctx?.get?.('llm');
    if (llm !== undefined && deps?.catalog !== undefined && typeof deps.catalog.getSnapshot === 'function') {
      const snapshot = await deps.catalog.getSnapshot(llm);
      const dir = snapshot !== null && typeof snapshot === 'object' && snapshot.llm !== null && typeof snapshot.llm === 'object' ? snapshot.llm : {};
      const model = merged.model ?? parent?.options?.model;
      if (typeof model === 'string' && dir.efforts !== undefined && dir.efforts !== null && typeof dir.efforts === 'object') modelEfforts = dir.efforts[model];
    }
  } catch { /* 目录读取失败 → 不判支持性，按表值派生 */ }
  const derived = deriveTierConfig(tier, modelEfforts);
  return {
    ...(merged.reasoningEffort === undefined ? { reasoningEffort: derived.reasoningEffort } : {}),
    ...(merged.maxTokens === undefined ? { maxTokens: derived.maxTokens } : {}),
  };
}

// provider 渠道执行（宿主直连 start 的路径无 decisionTrace）：只写治理审计 +
// 抛同一三层中文文案；判定输入为 resolveChildAgentOptions 解析后的最终
// agentOptions provider/model（含父继承）。
export function applyOfficialModelProviderGate(deps, policy, effective) {
  if (policy === undefined || policy.configured !== true) return;
  try {
    assertOfficialModelRoute(policy, effective.provider, effective.model);
  } catch (error) {
    recordOfficialModelReject(deps, effective);
    throw error;
  }
}

// 成本闸：硬上限（maxTokens/maxDepth）在调 assertCostGuard 前自行预判（不重复
// throw，真 throw 仍在 assertHardLimits）；llm 能力面各检查项经 assertCostGuard
// 的 onCheck 回调逐项回填。预判读 merged（profile 合并后的实际判定值）而非原始
// args——保证轨迹 check 与真闸判定口径一致（profile 携带超限值时两者必须同 fail）。
// fail 时先记 fail 闸再 rethrow（文案不变）。
export async function applyCostGuardGate(trace, merged, parent, deps) {
  const allowFailOpen = deps.store.getAllowFailOpen();
  const input = { provider: merged.provider, model: merged.model, reasoningEffort: merged.reasoningEffort, maxTokens: merged.maxTokens, maxDepth: merged.maxDepth, allowFailOpen };
  // 决策输入快照补充：请求 model 的 reasoning-effort 支持档位（catalog 快照，
  // 有缓存；拿不到 fail-soft 省略）——台账可见「该模型当时可选哪些档位」。
  if (typeof merged.model === 'string' && merged.model !== '') {
    try {
      const snapshot = await deps.catalog.getSnapshot(parent.ctx.get('llm'));
      const efforts = snapshot?.efforts?.[merged.model];
      if (Array.isArray(efforts) && efforts.length > 0) {
        input.modelEfforts = efforts.map((effort) => (effort && typeof effort.id === 'string' ? effort.id : String(effort))).slice(0, 6);
      }
    } catch { /* fail-soft：快照不可用不影响闸判定 */ }
  }
  const checks = hardLimitChecks(merged, MAX_TOKENS, MAX_DEPTH);
  try {
    await assertCostGuard(parent, merged, allowFailOpen, deps.logger, deps.catalog, (entry) => checks.push(entry));
    recordGate(trace, { name: 'cost', input, output: { checks }, verdict: 'pass' });
  } catch (error) {
    recordGate(trace, { name: 'cost', input, output: { checks }, verdict: 'fail', reason: error.message });
    throw error;
  }
}

// 禁用门（continuable 专属显式检查）：provider start 的 !enabled 只拦 start、
// 不拦 startContinuable；syncTool 注销工具对 continuable 是间接门，故在此显式
// fail-loud。检查位于全部闸之前——与「禁用时不得静默派生子树」的既有语义一致，
// 且保证交集闸不会在禁用态先于本门抛其它文案。
export function assertContinuableEnabled(deps, args) {
  if (args.continuable === true && !deps.getEnabled()) {
    throw new Error('dispatch: 插件已禁用（设置 → 子 Agent 方案 重新启用）');
  }
}

// 交集闸（三分支统一在 approval 之前记录，闸序一致）：前/后台真交集由宿主在
// 子会话启动时计算（execute 返回之后），记 deferred；continuable 在此预加工
// 闭集 allow（空集 fail-loud），同一结果同时用于轨迹记录与 request 组装。
// 返回 continuable 的 effectiveAllow（非 continuable 返回 undefined）。
export function applyIntersectionGate(trace, mode, intersectionInput, merged, parentToolNames) {
  if (mode !== 'continuable') {
    recordGate(trace, { name: 'intersection', input: intersectionInput, output: { mode: 'deferred' }, verdict: 'pass', reason: '子工具交集由宿主在子会话启动时计算（restrictChildTools），结果体现在结算 stopReason/error' });
    return undefined;
  }
  try {
    const effectiveAllow = computeContinuableAllow(parentToolNames, merged.toolFilter);
    // 工具集子节数据（continuable 可计算闭集与移除清单）。名单类数组超 8 项由
    // recordGate 的 truncateLists 自动截断为 { values, truncated }（台账展示时认标记）。
    const removedRaw = parentToolNames
      .filter((name) => !effectiveAllow.includes(name))
      .map((name) => ({ name, reason: name === 'run_code' ? '安全策略：子代理不执行代码' : '不在白名单' }));
    const removedTools = removedRaw.length > 8 ? { values: removedRaw.slice(0, 8), truncated: true } : removedRaw;
    recordGate(trace, { name: 'intersection', input: intersectionInput, output: { effectiveAllowCount: effectiveAllow.length, effectiveAllowNames: effectiveAllow, removedTools }, verdict: 'pass' });
    return effectiveAllow;
  } catch (error) {
    recordGate(trace, { name: 'intersection', input: intersectionInput, output: {}, verdict: 'fail', reason: error.message });
    throw error;
  }
}

// --- 预算余量三态与低位封顶 ---------------------------------------------------
// 阈值常量（后续校准只改这里）：可用比例 ≥50% 充足 / ≥15% 紧张 / 其余告警。
export const BUDGET_AMPLE_RATIO = 0.5;
export const BUDGET_TIGHT_RATIO = 0.15;

// 剩余 token 与可用比例（剩余按 0 兜底；上限非正数时比例按 0 = 告警）。
export function budgetRemaining(snapshot) {
  const max = snapshot !== null && typeof snapshot === 'object' && typeof snapshot.maxParentTokens === 'number' ? snapshot.maxParentTokens : 0;
  const tokens = snapshot !== null && typeof snapshot === 'object' && typeof snapshot.tokens === 'number' ? snapshot.tokens : 0;
  const remaining = Math.max(0, max - tokens);
  return { remaining, ratio: max > 0 ? remaining / max : 0 };
}

// dispatch:budget section 三态文案（与 index.mjs 共用）。
export function budgetSectionText(snapshot) {
  const { remaining, ratio } = budgetRemaining(snapshot);
  const max = snapshot !== null && typeof snapshot === 'object' && typeof snapshot.maxParentTokens === 'number' ? snapshot.maxParentTokens : 0;
  if (ratio >= BUDGET_AMPLE_RATIO) return `派发预算：充足（剩余 ${remaining} token / 上限 ${max}）`;
  if (ratio >= BUDGET_TIGHT_RATIO) return `派发预算：紧张（剩余 ${remaining} token / 上限 ${max}），优先 cheap 方案`;
  return `派发预算：告警（剩余 ${remaining} token / 上限 ${max}），仅允许 cheap 方案；当前可用最高档=cheap`;
}

// 真实计费五段求和（预算记账口径）：input + cacheRead + cacheWrite + output 四项
// 相加（与官方「本轮用量」同一 API usage 事件流；reasoningTokens 不计入）；
// childUsage 缺失或无有效数字段返回 undefined（调用方回退估算口径兜底）。
export function usageTotalOf(childUsage) {
  if (childUsage === null || typeof childUsage !== 'object' || Array.isArray(childUsage)) return undefined;
  let total = 0;
  let any = false;
  for (const key of ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) {
    const value = childUsage[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      total += value;
      any = true;
    }
  }
  return any ? total : undefined;
}

// 请求档位是否超出 cheap（tokenTier 或 model/effort 推定）：tokenTier 缺省
// balanced；tokenTier=cheap 但 reasoningEffort 显式高于 off、或显式模型名非 flash
// 系 → 推定超出。不做 tokenTier→effort 映射（禁止事项），flash 名称启发式只拦
// 显式重负载。
export function requestedTierBeyondCheap(merged) {
  const tier = merged !== null && typeof merged === 'object' && typeof merged.tokenTier === 'string' && merged.tokenTier !== '' ? merged.tokenTier : 'balanced';
  if (tier !== 'cheap') return true;
  const effort = merged !== null && typeof merged === 'object' ? merged.reasoningEffort : undefined;
  if (typeof effort === 'string' && effort !== '' && effort !== 'off') return true;
  const model = merged !== null && typeof merged === 'object' ? merged.model : undefined;
  return typeof model === 'string' && model !== '' && !model.toLowerCase().includes('flash');
}

// 低位封顶预检：余量 <15% 且请求档位超出 cheap → 记 budget fail 闸 + fail-loud。
function assertBudgetTierCap(deps, trace, parentSessionId, budget, merged) {
  if (typeof parentSessionId !== 'string' || parentSessionId === '' || budgetRemaining(budget).ratio >= BUDGET_TIGHT_RATIO || !requestedTierBeyondCheap(merged)) return;
  const message = '预算不足：当前可用最高档=cheap，请改用 cheap 方案或为会话增加预算';
  recordGate(trace, {
    name: 'budget',
    input: { parentSessionId, current: budget, requestedTier: merged?.tokenTier ?? 'balanced（缺省）' },
    output: { allowed: false },
    verdict: 'fail',
    reason: message,
  });
  deps.logger.warn(`[dsh-subagent-profile] ${message}`);
  throw new Error(message);
}

// 预算中止提醒 mint（token 上限拒绝时调用）：P1 条目言明上限与当前累计，
// store 未就绪或写失败一律吞掉，绝不阻断闸失败 throw 路径。
function mintBudgetLimitReminder(deps, parentSessionId, budget, acquired, args) {
  if (acquired.reason !== 'tokens') return;
  try {
    const store = typeof deps.getReminderStore === 'function' ? deps.getReminderStore() : undefined;
    mintReminder(store, {
      severity: 'P1',
      kind: 'dispatch-budget-limit',
      title: '派发被预算上限中止',
      detail: '本会话累计派发 token 已达上限 ' + acquired.limit + '（当前 ' + budget.tokens + '）。建议：开启新会话 或 在设置中调高预算上限（保存即时生效）。',
      sessionId: parentSessionId,
      promptExcerpt: promptExcerptOf(args !== null && typeof args === 'object' ? args.prompt : ''),
    });
  } catch { /* mint 失败不影响闸失败路径 */ }
}

// 总预算闸（并发上限 + 每父累计 token）：前/后台在派发入口占并发额度（continuable
// 不占——持久会话启动、非在途 one-shot）。低位封顶在 acquire 之前（fail-loud 不占
// 并发槽）。拒绝时记一道 budget fail 闸 + warn + 抛可行动中文错误（只拦新增派发，
// 数值内零影响）；无父 sessionId 时 acquire 内部跳过守卫。返回
// { parentSessionId, finish }：finish(key, usageTotal) 是结算共用钩子
// （untrack + recordTokens + release），前/后台 settle 时恰好调用一次；usageTotal
// 为子代理真实计费用量总和（无 childUsage 时调用方回退估算值兜底）。
export function applyBudgetGate(deps, parent, args, merged, trace) {
  if (args.continuable === true) return { parentSessionId: undefined, finish: () => {}, release: () => {} };
  const parentSessionId = parent.session?.header?.id;
  const budget = deps.guard.snapshot(parentSessionId);
  assertBudgetTierCap(deps, trace, parentSessionId, budget, merged);
  const acquired = deps.guard.acquire(parentSessionId);
  if (!acquired.ok) {
    const message = acquired.reason === 'concurrency'
      ? `dispatch: 并发派发数已达上限 ${acquired.limit}，请等待在途任务完成`
      : `dispatch: 本会话累计派发 token 已达上限 ${acquired.limit}，请等待在途任务完成或开启新会话`;
    mintBudgetLimitReminder(deps, parentSessionId, budget, acquired, args);
    recordGate(trace, {
      name: 'budget',
      input: { parentSessionId, current: budget, reason: acquired.reason, limit: acquired.limit },
      output: { allowed: false },
      verdict: 'fail',
      reason: message,
    });
    deps.logger.warn(`[dsh-subagent-profile] ${message}`);
    throw new Error(message);
  }
  // 通过也记闸（与 whitelist/cost/intersection 同口径：pass/fail 均记，台账时间线可
  // 见预算检查项；无父 sessionId 时 acquire 跳过守卫，同样记 pass 并注明 skipped）。
  recordGate(trace, {
    name: 'budget',
    input: { parentSessionId, current: budget },
    output: { allowed: true, skipped: acquired.skipped === true },
    verdict: 'pass',
  });
  return {
    parentSessionId,
    finish: (key, usageTotal) => {
      deps.guard.untrack(key);
      if (usageTotal !== undefined) deps.guard.recordTokens(parentSessionId, usageTotal);
      acquired.release();
    },
    // 错误路径兜底：分支 throw 时 runDispatch 的 catch 幂等释放并发槽（不记账、不
    // untrack——untrack 由正常结算路径负责；acquire 的 release 本身幂等）。
    release: () => acquired.release(),
  };
}

// 读取父工具名（失败软回退为空数组）。真实宿主 ctx.tools.schemas 恒存在；测试
// fake 父 Agent 可能缺 tools，故此处守卫，避免预检段破坏前/后台路径。
export function readParentToolNames(parent) {
  const tools = parent.ctx?.tools;
  if (tools === undefined || typeof tools.schemas !== 'function') return [];
  const schemas = tools.schemas(parent);
  return Array.isArray(schemas) ? schemas.map((schema) => schema.name) : [];
}
