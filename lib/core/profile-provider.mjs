// lib/core/profile-provider.mjs — `profile` 子 Agent provider
// （setup/start/prepareContinuable），从 index.mjs 的
// `ctx.subagents.registerProvider({...})` 块逐字拆出。仅引用 lib + shims；
// 无 @deepseek-ai 依赖（shims 是唯一入口）。
//
// 注入：所有 apply 闭包 / ctx 依赖都是显式参数——
//   subagents   本 provider 注册进的注册表（工厂内调用 subagents.registerProvider），
//   store       profile store（getAllowFailOpen 供 cost guard），
//   getEnabled  读取 apply 闭包 `enabled` 标志（关时 start fail-loud），
//   logger      ctx.logger（决策级子会话日志）。
// 工厂返回 registerProvider 的返回值（调用方保持原有
// `if (typeof disposeProvider === 'function') ctx.effect(...)` 形状）。
//
// start 按预检段（runStartPreflight）/ 结算+取消接线段（wireChildLifecycle）
// 拆为模块级私有函数；start 内嵌 setup 按 ①-⑦ 步拆 setupChild +
// restrictChildTools。行为逐字不变。

import { randomUUID } from 'node:crypto';
import {
  appendDelegatedPolicyOverrides,
  assertSubagentMaxDepth,
  captureDelegatedPolicyOverrides,
  createUserMessage,
  readResult,
  resolveChildAgentOptions,
  resolveChildDepth,
} from './shims.mjs';
import { GUIDANCE_PREFIX } from './pure.mjs';
import { computeEffectiveAllow } from './intersection.mjs';
import { resolveWhitelist } from './whitelist.mjs';
import { assertCostGuard } from './cost-guard.mjs';
import { DELEGATION_CONTEXT, buildDispatchMeta } from './delegation.mjs';
import { readSessionEvents } from './session-read.mjs';
import { applyOfficialModelProviderGate } from './dispatch-gates.mjs';

// --- start 预检段（从 start 拆出）-------------------------------------------------

// start 前置校验：enabled / profile 存在 / 策略捕获 / whitelist /
// cost guard / 深度断言与 childDepth / childId / swapPreset / meta /
// agentOptions，一次性返回 start 后续段所需的全部状态。
async function runStartPreflight(request, deps) {
  if (!deps.getEnabled()) {
    throw new Error('dispatch: 插件已禁用（可在设置 → 子 Agent 方案 中重新启用）');
  }
  const profile = request.profile;
  if (profile === undefined) {
    throw new Error('dispatch: request.profile 缺失（dispatch 工具在启动子 Agent 前必须解析出 profile，请检查调用参数）');
  }
  const parent = request.parent;
  // 同步捕获委派策略，在首个 await 之前——之后的父会话切换属于父的未来，
  // 不属于本 child（shipped captureDelegatedPolicyOverrides）。
  const delegated = captureDelegatedPolicyOverrides(parent);
  // 权威 preset whitelist 检查（对照运行时名册）。逃生舱只叠加：开关开时
  // getEscapeSet 返回放行集，否则空数组（零叠加）。
  const whitelist = new Set(await resolveWhitelist(parent.ctx.get('agentPresets'), deps.getEscapeSet()));
  if (typeof profile.preset === 'string' && profile.preset !== 'inherit' && !whitelist.has(profile.preset)) {
    throw new Error(`dispatch: 预设 "${profile.preset}" 不在 system-trust 白名单（可在设置页改用受信任预设）`);
  }
  // 放行审计（provider 渠道）：成员经逃生舱放行时同样写高可见治理审计（「每个放行
  // 都留痕」的绝对语义覆盖非 dispatch 渠道）。成本闸在本函数下方、交集在子会话
  // setup 时执行——审计快照按 provider 渠道口径标注。
  if (typeof deps.recordEscapeAllowProvider === 'function' && deps.getEscapeSet().includes(profile.preset)) {
    deps.recordEscapeAllowProvider(parent, profile.preset);
  }
  // 权威 cost guard（运行时推导；硬上限始终生效，llm 能力核验由 allowFailOpen 门控；
  // llm 目录读取走共享 catalog 快照）。
  await assertCostGuard(parent, profile, deps.store.getAllowFailOpen(), deps.logger, deps.catalog);
  // 官方模型选择投影读取（服务/投影缺失或未固化 → configured:false 跳过）；生效
  // 路由判定在 agentOptions 解析完成后——provider 渠道与 dispatch 预检同一白名单。
  const policy = deps.readModelSelectionPolicy?.(parent.ctx, parent.session);
  // 委派深度：官方助手——先断言上限值，再解析子深度（父底 + 1）并执行上限。
  assertSubagentMaxDepth(profile.maxDepth);
  const childDepth = resolveChildDepth(parent, profile.maxDepth);
  const childId = randomUUID();
  const parentAgentPresets = parent.ctx.get('agentPresets');
  const parentComposed = parentAgentPresets !== undefined ? parentAgentPresets.composedPreset(parent.ctx) : undefined;
  const swapPreset = typeof profile.preset === 'string' && profile.preset !== 'inherit' && profile.preset !== parentComposed;
  const meta = buildProviderMeta(parent, profile, swapPreset, childDepth);
  const agentOptions = buildProviderAgentOptions(parent, profile, childDepth);
  applyOfficialModelProviderGate({ evoLedger: deps.evoLedger, sessionId: parent.session?.header?.id }, policy, agentOptions);
  return { parent, profile, delegated, childId, swapPreset, meta, agentOptions };
}

// agentPreset 仅在存在 preset 名册时记录（否则整体省略）。该 meta 是自定义的
// ——非 shipped childSessionMeta——因为 swap 记录的是 profile.preset 而非父的
// composedPreset。纯组装在 lib/core/delegation.mjs：buildDispatchMeta。
function buildProviderMeta(parent, profile, swapPreset, childDepth) {
  const parentAgentPresets = parent.ctx.get('agentPresets');
  const parentComposed = parentAgentPresets !== undefined ? parentAgentPresets.composedPreset(parent.ctx) : undefined;
  return buildDispatchMeta({
    cwd: parent.session.header.cwd,
    hasPresets: parentAgentPresets !== undefined,
    swapPreset,
    preset: profile.preset,
    parentComposed,
    parentSession: parent.session.header.id,
    childDepth
  });
}

// agentOptions：官方 resolveChildAgentOptions——父路由继承，除非 profile 覆盖
// provider/model/maxTokens，并盖上子自身的委派深度。
function buildProviderAgentOptions(parent, profile, childDepth) {
  return resolveChildAgentOptions(parent, {
    ...(profile.provider !== undefined ? { provider: profile.provider } : {}),
    ...(profile.model !== undefined ? { model: profile.model } : {}),
    ...(profile.maxTokens !== undefined ? { maxTokens: profile.maxTokens } : {})
  }, childDepth);
}

// start 主体：预检 → 建 child（setup 装配）→ 结算/取消接线，行为逐字不变。
async function startProvider(request, deps) {
  const { parent, profile, delegated, childId, swapPreset, meta, agentOptions } = await runStartPreflight(request, deps);
  if (request.signal !== undefined && request.signal.aborted) {
    throw new Error('dispatch: 子 Agent 请求在发布前已被取消（可重试一次派发）');
  }
  const handle = await parent.ctx.agents.create({
    sessionId: childId,
    meta,
    agentOptions,
    signal: request.signal,
    setup: (childCtx, childAgent) => setupChild(childCtx, { parent, profile, swapPreset, delegated, request, childAgent }),
  });
  return wireChildLifecycle(handle, request, childId, swapPreset, profile, deps.logger);
}

// --- start 内嵌 setup(childCtx)：按 ①-⑦ 步装配子 Agent 会话（从 start 拆出）-------

async function setupChild(childCtx, { parent, profile, swapPreset, delegated, request, childAgent }) {
  // DSH 0.2.x passes the child agent as setup's second argument
  // (dsh-agent-loop: `setup?.(prepared.agent.ctx, prepared.agent)`); only 0.1.x
  // exposed `.agent` on the ctx, and reading it through the Context proxy on 0.2.x
  // throws `cannot get property "agent" without inject`.
  const child = childAgent !== undefined ? childAgent : childCtx.agent;
  // ① 预设组合：显式 swap 挂载目标预设；否则从父组合。无名册 + 显式 swap
  // fail-loud。
  const childPresets = childCtx.get('agentPresets');
  if (swapPreset) {
    if (childPresets === undefined) {
      throw new Error('dispatch: 无法在无预设名册的部署中切换预设（该部署不支持自定义预设挂载，可省略 preset 以继承父预设）');
    }
    await childPresets.mount(childCtx, profile.preset);
  } else if (childPresets !== undefined) {
    childPresets.composeFrom(childCtx, parent.ctx);
  }
  // ② Tool intersection（safety gate 1，实现见 restrictChildTools）。
  restrictChildTools(childCtx, parent, profile, child);
  // ③ 委派范围声明（systemPrompt 可用时）。
  const systemPrompt = childCtx.get('systemPrompt');
  if (systemPrompt !== undefined) {
    systemPrompt.context({ name: 'subagent:delegation', order: 120, text: DELEGATION_CONTEXT });
  }
  // ④ Persona 影子段（覆盖 order 0 的 deployment:persona）。双防线 prefix。
  if (profile.persona !== undefined && systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'deployment:persona',
      order: 0,
      text: profile.persona.length > 0 ? `${GUIDANCE_PREFIX}${profile.persona}` : profile.persona,
    });
  }
  // ⑤ 推理档位注入每个子请求。
  if (profile.reasoningEffort !== undefined) {
    childCtx.on('agent/request', async (_payload, next) => {
      const resolved = await next();
      return { ...resolved, reasoningEffort: profile.reasoningEffort };
    });
  }
  // ⑥ Descriptor append inside the child's first turn（descriptor 存在才 append；
  // 核心注入的是对象（snapshotJsonValue 快照），早期版本为字符串，故只判存在不判类型）。
  let appended = false;
  childCtx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next();
    if (!appended && decision.kind === 'enter') {
      appended = true;
      if (request.descriptor !== undefined && request.descriptor !== null) agent.session.append('subagent/descriptor', request.descriptor);
    }
    return decision;
  });
  // ⑦ 委派策略追加（官方助手）。
  appendDelegatedPolicyOverrides(child.session, delegated);
}

// ② 工具交集（安全门 1）：父集 ∩ 子集，减去 run_code、减去 deny，存在 allow
// 时再收窄（纯核心在 lib/core/intersection.mjs：computeEffectiveAllow）。
function restrictChildTools(childCtx, parent, profile, child) {
  const parentNames = new Set(parent.ctx.tools.schemas(parent).map((schema) => schema.name));
  const childNames = childCtx.tools.schemas(child).map((schema) => schema.name);
  const effective = computeEffectiveAllow(parentNames, childNames, profile.toolFilter);
  // shipped restrict 不对 allow:[] throw——在此 fail-loud，让空交集显式化
  // （throw ⇒ setupAndPublish 回滚创建）。
  if (effective.length === 0) {
    throw new Error('dispatch: 子工具交集为空（父工具集与子工具集无交集，或 toolFilter 过滤后为空，可放宽过滤器后重试）');
  }
  // restrict 对未知/scope-local/保留 allow 集抛错：包成干净错误再 rethrow，
  // 触发创建回滚。
  try {
    childCtx.tools.restrict({ allow: effective });
  } catch (error) {
    throw new Error(`dispatch: 子工具限制失败（未能按交集限制子工具集：${error instanceof Error ? error.message : String(error)}），可检查 toolFilter 是否含未知工具`, { cause: error });
  }
}

// --- 结算 + 取消接线段（从 start 拆出）--------------------------------------------

// 发布后取消接线（drivePublishedRun）：调用方 signal 取消 child，
// 已取消时 result 闭包跳过 followup。
function wireChildLifecycle(handle, request, childId, swapPreset, profile, logger) {
  const child = handle.agent;
  const boundary = readSessionEvents(child.session).length;
  const flags = { cancelled: false };
  const onAbort = () => {
    flags.cancelled = true;
    child.cancel({ kind: 'parent' });
  };
  const signal = request.signal;
  if (signal !== undefined) {
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
  const result = (async () => {
    try {
      if (!flags.cancelled) {
        child.followup(createUserMessage({ content: request.prompt, source: { kind: 'user' } }));
        await child.whenIdle();
      }
      const settled = readResult(child, boundary, flags.cancelled);
      // 决策级日志在结果结算时（readResult，返回前）。
      logger.info('[dsh-subagent-profile] child:', JSON.stringify({ childId, preset: profile.preset ?? 'inherit', swapPreset, stopReason: settled.stopReason }));
      return settled;
    } finally {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    }
  })();
  return {
    id: childId,
    localAgent: child,
    result,
    async dispose() {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
      flags.cancelled = true;
      const settled = await Promise.allSettled([handle.dispose(), result]);
      if (settled[0].status === 'rejected') throw settled[0].reason;
    }
  };
}

export function createProfileProvider({ subagents, store, getEnabled, logger, catalog, getEscapeSet, readModelSelectionPolicy, evoLedger }) {
  const deps = { store, getEnabled, logger, catalog, getEscapeSet, readModelSelectionPolicy, evoLedger };
  return subagents.registerProvider({
    name: 'profile',
    capabilities: { outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: (request) => startProvider(request, deps),
    prepareContinuable: async () => ({})
  });
}
