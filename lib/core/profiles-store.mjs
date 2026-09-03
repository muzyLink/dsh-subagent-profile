// lib/core/profiles-store.mjs — profile 注册表 store 与启用/禁用开关
// （从 index.mjs 逐字移出并重构为工厂；import-free——
// 仅 node 内置 + lib/core/pure.mjs / dispatch-guard.mjs，无 @deepseek-ai 依赖）。
//
// `dshHome()` 与 `BUILTIN_SEEDS` 是模块级导出，工厂与 lib/core/http-routes.mjs
// （设置 HTTP 处理器查 seeds）共享。per-apply store 由
// `createProfileStore({ dshHome, logger })` 构造，取代 apply 闭包单例：
// 每次 apply() 调用都有自己的 profiles Map / deletedBuiltins Set /
// allowFailOpen 标志，与原始闭包状态完全一致。
//
// 工厂内嵌的 loadProfiles/persistProfiles/resolveProfile 按行门抽为模块级函数，
// per-apply 状态收集进 `state` 对象注入；开关态（enabled / evolutionAdvice）
// 经 loadState/persistState 读写共享 state.json。

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sanitizeProfile } from './pure.mjs';
import { DISPATCH_BUDGET_LIMITS } from './dispatch-guard.mjs';

// 解析 DSH 主目录（env 覆盖优先，平台回退）——与 dsh-persona-ref bundle 相同
// 策略：用户 profile 持久化到 ~/.dsh/subagent-profiles.json，跨 harness 工作目录
// 稳定。
export function dshHome() {
  const raw = process.env.DSH_HOME;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const trimmed = raw.trim();
    if (trimmed === '~') return homedir();
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(homedir(), trimmed.slice(2));
    return trimmed;
  }
  return join(homedir(), '.dsh');
}

// 1. Profile 注册表（per-instance 状态；bundle 行是进程级，故本 Map 是单例
//    store，与动态插件完全一致）。内置种子带 `builtin: true`，reset/remove 可
//    识别它们，改过的内置方案与纯用户 profile 可区分。
//    description 是语义化的：一行定位 + 何时用，帮助模型选择；description
//    须含适用场景词（落库契约，见 assertProfileDescription）。reasoningEffort
//    档位经 llm-deepseek adapter 核验（off/high/max；见 resolveModel 对
//    connection.defaults.thinking 的门控——本部署未设 thinking，
//    故对 deepseek-v4-flash 全档位宣传）。
export const BUILTIN_SEEDS = [
  { id: 'swap-standard', name: '标准编码', description: '写代码与重构场景：切换到 standard 预设的完整编码工具集，适合多文件改动、修复与测试；当父会话不是 standard、但子任务需要完整编码能力时选用。', preset: 'standard', tokenTier: 'balanced', builtin: true },
  { id: 'researcher', name: '调研检索', description: '调研与汇总场景：关闭深度推理省 token，继承父工具；适合查资料、检索、背景调研与只读分析，不适合改代码。', reasoningEffort: 'off', persona: 'You are a research subagent: search, read, and summarize only. Do not modify code or files.', tokenTier: 'cheap', builtin: true }
];

// description 落库契约词表：description 必须包含至少一个适用场景词（常量，可微调）。
export const DESCRIPTION_SCENARIO_WORDS = ['查', '调研', '检索', '汇总', '代码', '重构', '修复', '审查', '只读', '审计', '生成', '测试', '翻译', '编写', '改', '脚本', '分析'];

// description 落库校验（纯函数，zero-dep）：非空（trim）+ 长度 ≥10 字符 + 含适用
// 场景词，任一不满足 fail-loud（文案定稿）。返回 trim 后的文本供调用方落库。
export function assertProfileDescription(description) {
  const text = typeof description === 'string' ? description.trim() : '';
  const valid = text.length >= 10 && DESCRIPTION_SCENARIO_WORDS.some((word) => text.includes(word));
  if (!valid) {
    throw new Error('description 需写明适用场景（如：查资料/周报汇总、多文件重构、只读审计），当前描述不含可用场景词');
  }
  return text;
}

// --- 模块级 store 函数（从工厂拆出；per-apply 状态经 `state` 注入）---------------

function resolveProfile(profiles, id) {
  const found = profiles.get(id);
  if (found === undefined) throw new Error(`dispatch: 未知 profile "${id}"（可在设置页的 profile 列表确认可用的 id）`);
  if (found.enabled === false) throw new Error(`dispatch: profile "${id}" 已禁用（可在设置页重新启用该 profile）`);
  return found;
}

// 两种文件形状：v1 = 裸数组；v2 = { version:2, profiles:[...],
// allowFailOpen:<bool> }。返回 { entries, version }；无法识别的形状返回
// { entries: undefined }。
function classifyProfileFile(parsed) {
  if (Array.isArray(parsed)) return { entries: parsed, version: 1 };
  if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.profiles)) {
    return { entries: parsed.profiles, version: parsed.version ?? 2 };
  }
  return { entries: undefined, version: undefined };
}

// 逐条净化（strict=false）：超限字段被丢弃（字段移除）+ 告警；超长 persona
// 保留 + 告警（绝不静默截断）。坏条目跳过（fail-soft）。返回
// 'loaded' | 'skipped' | 'deleted'，loadProfiles 据此维护计数。
function applyProfileEntry(raw, profiles, deletedBuiltins, logger) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id.length === 0) {
    logger.warn('[dsh-subagent-profile] skipping malformed profile entry:', raw === null ? String(raw) : typeof raw);
    return 'skipped';
  }
  const { clean, warnings } = sanitizeProfile(raw, { strict: false });
  for (const warning of warnings) {
    logger.warn(`[dsh-subagent-profile] profile "${raw.id}" ${warning.field} 被跳过或提示：${warning.reason}`);
  }
  if (clean.deleted === true) {
    if (clean.builtin === true) {
      profiles.delete(clean.id);
      deletedBuiltins.add(clean.id);
    }
    return 'deleted';
  }
  const existing = profiles.get(clean.id);
  if (existing !== undefined && existing.builtin === true) {
    profiles.set(clean.id, { ...clean, builtin: true, persisted: true });
  } else {
    profiles.set(clean.id, { ...clean, persisted: true });
  }
  return 'loaded';
}

// 1b. 用户 profile 持久化。设置服务服务不了本插件（其写路径硬性要求
//    register(ns, schema) + schemastery schema），故用户 profile 经 node:fs
//    持久化到 ~/.dsh/subagent-profiles.json——bundle 有 node 全局，不像需要可选
//    `fs` 服务的动态插件沙箱。启动时加载一次；add/remove HTTP 路由重写文件。
//    持久化是增强而非硬依赖：任何失败只告警，内置种子照常工作。
function loadProfiles(state, logger) {
  if (!existsSync(state.profilesFile)) return;
  try {
    const parsed = JSON.parse(readFileSync(state.profilesFile, 'utf8'));
    const { entries, version } = classifyProfileFile(parsed);
    if (entries === undefined) {
      logger.warn('[dsh-subagent-profile] persisted profile file has an unrecognized shape; ignoring');
      return;
    }
    if (version !== 2) {
      // v1（或无版本数组）：内存迁移，保持 fail-open 兼容。
      state.allowFailOpen = true;
      logger.warn('[dsh-subagent-profile] v1 数据：fail-open 兼容模式');
    } else {
      // v2 缺 allowFailOpen 字段时按 fail-open 兼容（显式 false 才关闭）；
      // 全新部署默认已定：fail-loud（初始 allowFailOpen=false）。
      state.allowFailOpen = parsed.allowFailOpen !== false;
    }
    let loaded = 0;
    let skipped = 0;
    for (const raw of entries) {
      const status = applyProfileEntry(raw, state.profiles, state.deletedBuiltins, logger);
      if (status === 'loaded') loaded++;
      else if (status === 'skipped') skipped++;
    }
    // 静默成功：报告载入了多少持久化 profile（没有时跳过——缺失/空文件是
    // 正常首启）。
    if (loaded > 0) logger.info(`[dsh-subagent-profile] loaded ${loaded} persisted profile(s)`);
    if (skipped > 0) logger.warn(`[dsh-subagent-profile] skipped ${skipped} malformed profile entry(ies)`);
  } catch (error) {
    logger.warn('[dsh-subagent-profile] persisted profile load failed:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * 持久化每个 `persisted: true` 的 profile 加内置删除墓碑。
 * 原子写：同目录写 `<profilesFile>.tmp`，再 `renameSync` 覆盖目标
 * （崩溃只留下旧文件完好，绝不留下截断文件）。失败可见：失败不抛、不
 * 回滚内存 `profiles` Map——返回 `{ persisted: false }`，调用方可以提示
 * 「已保存但未持久化」，内存态继续驱动本进程。恒写 v2 信封形状。
 */
function persistProfiles(state, logger) {
  const entries = [];
  for (const profile of state.profiles.values()) {
    if (profile.persisted !== true) continue;
    const clean = {};
    for (const [key, value] of Object.entries(profile)) {
      if (value === undefined || key === 'persisted') continue;
      clean[key] = value;
    }
    entries.push(clean);
  }
  for (const id of state.deletedBuiltins) {
    entries.push({ id, builtin: true, deleted: true });
  }
  const payload = { version: 2, profiles: entries, allowFailOpen: state.allowFailOpen };
  const tmp = `${state.profilesFile}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, state.profilesFile);
    return { persisted: true };
  } catch (error) {
    // 尽力清理残留的 tmp 文件（rename 未执行）。
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    logger.warn('[dsh-subagent-profile] persisted profile write failed:', error instanceof Error ? error.message : String(error));
    return { persisted: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 插件开关态（state.json）：enabled（默认开，禁用即关派发工具）+ evolutionAdvice
// （派发优化建议注入，默认关，需显式开）+ escapeEnabled（逃生舱放行，默认关——信任
// 底板，仅设置页显式 opt-in 可放开）+ applyEnabled（进化候选生成与应用写路径，默认
// 关——应用能力只由人显式开启）+ candidateMode/candidateTtlH（候选方案更新策略与
// 有效期，用户可配置）+ snapshotEnabled（派发配置快照，默认关——本机私有域，仅
// 设置页显式 opt-in 开启）。开关共用同一 state.json，读写整份对象以互不覆盖；
// 缺失文件回退默认值（全新部署），损坏文件 fail-closed（全关，绝不静默回退
// enabled:true —— 安全禁用会被撤销），内存态仍驱动本进程。
const STATE_DEFAULTS = { enabled: true, evolutionAdvice: false, escapeEnabled: false, applyEnabled: false, candidateMode: 'auto', candidateTtlH: 24, snapshotEnabled: false };
const STATE_FAIL_CLOSED = { enabled: false, evolutionAdvice: false, escapeEnabled: false, applyEnabled: false, candidateMode: 'auto', candidateTtlH: 24, snapshotEnabled: false };

// dispatchBudget 默认值（派生自 dispatch-guard 的区间常量，单一出处）。
const DISPATCH_BUDGET_DEFAULTS = {
  maxParentTokens: DISPATCH_BUDGET_LIMITS.maxParentTokens.default,
  maxConcurrent: DISPATCH_BUDGET_LIMITS.maxConcurrent.default,
};

// 区间内整数判定（与 dispatch-guard.configure 同一口径，防坏值落盘）。
function budgetFieldValid(value, limits) {
  return typeof value === 'number' && Number.isInteger(value) && value >= limits.min && value <= limits.max;
}

// dispatchBudget 归一（fail-soft）：逐字段整数 + 区间校验，非法字段回退默认并
// warn；缺键静默用默认、坏形状整体回退默认。读取与写入共用，绝不抛错阻断启动。
function normalizeDispatchBudget(raw, warn) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const tokens = budgetFieldValid(src.maxParentTokens, DISPATCH_BUDGET_LIMITS.maxParentTokens) ? src.maxParentTokens : DISPATCH_BUDGET_DEFAULTS.maxParentTokens;
  const concurrent = budgetFieldValid(src.maxConcurrent, DISPATCH_BUDGET_LIMITS.maxConcurrent) ? src.maxConcurrent : DISPATCH_BUDGET_DEFAULTS.maxConcurrent;
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw) || tokens !== src.maxParentTokens || concurrent !== src.maxConcurrent)) {
    if (typeof warn === 'function') warn('[dsh-subagent-profile] dispatchBudget 配置非法，已回退默认（maxParentTokens 需 100000~2000000 整数、maxConcurrent 需 1~32 整数）');
  }
  return { maxParentTokens: tokens, maxConcurrent: concurrent };
}

// state.json 写路径共享 warn（logger 缺失时静默——纯 store 单测可省略 logger）。
function stateWarn(state, message) {
  if (state.logger !== undefined && typeof state.logger.warn === 'function') state.logger.warn(message);
}

// 候选有效期小时数归一：0（不自动过期）或 1~8760（一年内）的整数原样保留，
// 其余值回退默认 24 小时（读取与写入共用同一口径，防坏值落盘）。
function validCandidateTtlH(value) {
  return typeof value === 'number' && Number.isInteger(value) && (value === 0 || (value >= 1 && value <= 8760)) ? value : 24;
}

function loadState(state) {
  if (!existsSync(state.stateFile)) return { ...STATE_DEFAULTS };
  try {
    const parsed = JSON.parse(readFileSync(state.stateFile, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('state 文件不是对象');
    return {
      enabled: parsed.enabled !== false,
      evolutionAdvice: parsed.evolutionAdvice === true,
      escapeEnabled: parsed.escapeEnabled === true,
      applyEnabled: parsed.applyEnabled === true,
      candidateMode: parsed.candidateMode === 'manual' ? 'manual' : 'auto',
      candidateTtlH: validCandidateTtlH(parsed.candidateTtlH),
      snapshotEnabled: parsed.snapshotEnabled === true,
      dispatchBudget: normalizeDispatchBudget(parsed.dispatchBudget, (message) => stateWarn(state, message)),
    };
  } catch (error) {
    // fail-closed（S2）：损坏的 state.json 若回退 enabled:true，会把「安全禁用」静默撤销。
    // 三开关一律关（派发/建议/逃生舱全停），显式 warn；下次持久化写入即自愈。
    if (state.logger !== undefined && typeof state.logger.warn === 'function') {
      state.logger.warn('[dsh-subagent-profile] state.json 损坏，按 fail-closed 处理（三开关全关）：', error instanceof Error ? error.message : String(error));
    }
    return { ...STATE_FAIL_CLOSED, dispatchBudget: { ...DISPATCH_BUDGET_DEFAULTS } };
  }
}

// 原子写 state.json（tmp+rename，与 persistProfiles 同口径，修复「全库唯一非原子写」）。
// 返回 { persisted: true } 或 { persisted: false, error }，供开关路由回传 persisted 信号；
// 写失败仍触发治理审计钩子（不抛），内存态照常驱动本进程。
function persistState(state, patch, onGovernanceFailure) {
  const next = { ...loadState(state), ...patch };
  const tmp = `${state.stateFile}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    renameSync(tmp, state.stateFile);
    return { persisted: true };
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    // best effort——内存态仍驱动本进程；
    // 开关态（含 persistEnabled）写失败也是治理审计丢失，通知审计钩子（不抛）。
    if (typeof onGovernanceFailure === 'function') onGovernanceFailure();
    return { persisted: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 落库保存路径：description 值发生变化（新建或编辑改写）必须过契约校验；
// 与原值相同（存量未动）或未携带 description 时跳过——存量宽容不迁移。
// 校验失败 fail-loud，不落 Map。
function saveProfile(state, profile) {
  if (profile !== null && typeof profile === 'object' && profile.description !== undefined) {
    const existing = state.profiles.get(profile.id);
    if (existing === undefined || existing.description !== profile.description) {
      assertProfileDescription(profile.description);
    }
  }
  state.profiles.set(profile.id, profile);
  return profile;
}

// dispatchBudget 持久化：归一后原子写 state.json；写失败 warn + 治理审计钩子
// （persistState 已触发）并返回 persisted 信号，不抛、内存态照常生效。
function persistDispatchBudgetState(state, onGovernanceFailure, value) {
  const result = persistState(state, { dispatchBudget: normalizeDispatchBudget(value, (message) => stateWarn(state, message)) }, onGovernanceFailure);
  if (result.persisted === false) stateWarn(state, '[dsh-subagent-profile] dispatchBudget 配置写入失败：' + (typeof result.error === 'string' ? result.error : ''));
  return result;
}

// 构造一个 store 实例。`dshHome` 是已解析的主目录字符串（来自导出的
// dshHome()）；`logger` 是 apply 时的 ctx.logger。`onGovernanceFailure`（可选）
// 是任何 profile/state 持久化写失败时触发的审计钩子——一次治理审计丢失事件。
// per-apply 状态（profiles / deletedBuiltins / paths / allowFailOpen）收进
// `state` 供移出的模块级函数使用。profile 注册表表面与拆分前工厂一致；两个
// 开关访问器（enabled / evolutionAdvice）读写共享 state.json。
export function createProfileStore({ dshHome, logger, onGovernanceFailure = () => {} }) {
  const profiles = new Map(BUILTIN_SEEDS.map((p) => [p.id, { ...p }]));
  const deletedBuiltins = new Set();
  const state = {
    profiles,
    deletedBuiltins,
    profilesFile: join(dshHome, 'subagent-profiles.json'),
    stateFile: join(dshHome, 'subagent-profiles.state.json'),
    allowFailOpen: false,
    logger,
  };
  return {
    profiles,
    deletedBuiltins,
    resolveProfile: (id) => resolveProfile(profiles, id),
    saveProfile: (profile) => saveProfile(state, profile),
    loadProfiles: () => loadProfiles(state, logger),
    persistProfiles: () => {
      const result = persistProfiles(state, logger);
      // 治理审计：profile 变更持久化失败计一次治理丢失（写入不抛，仅为高可见标记）。
      if (result.persisted === false) onGovernanceFailure();
      return result;
    },
    loadEnabled: () => loadState(state).enabled,
    persistEnabled: (enabled) => persistState(state, { enabled }, onGovernanceFailure),
    loadEvolutionAdvice: () => loadState(state).evolutionAdvice,
    persistEvolutionAdvice: (value) => persistState(state, { evolutionAdvice: value === true }, onGovernanceFailure),
    loadEscapeEnabled: () => loadState(state).escapeEnabled,
    persistEscapeEnabled: (value) => persistState(state, { escapeEnabled: value === true }, onGovernanceFailure),
    loadApplyEnabled: () => loadState(state).applyEnabled,
    persistApplyEnabled: (value) => persistState(state, { applyEnabled: value === true }, onGovernanceFailure),
    // 候选更新策略与有效期（state.json 同源读写，坏值归一默认）。
    loadCandidateMode: () => loadState(state).candidateMode,
    persistCandidateMode: (value) => persistState(state, { candidateMode: value === 'manual' ? 'manual' : 'auto' }, onGovernanceFailure),
    loadCandidateTtlH: () => loadState(state).candidateTtlH,
    persistCandidateTtlH: (value) => persistState(state, { candidateTtlH: validCandidateTtlH(value) }, onGovernanceFailure),
    loadSnapshotEnabled: () => loadState(state).snapshotEnabled,
    persistSnapshotEnabled: (value) => persistState(state, { snapshotEnabled: value === true }, onGovernanceFailure),
    // 派发预算（state.json 同源读写）：读取 fail-soft 归一默认；写入归一 + 原子写。
    loadDispatchBudget: () => loadState(state).dispatchBudget,
    persistDispatchBudget: (value) => persistDispatchBudgetState(state, onGovernanceFailure, value),
    // getAllowFailOpen：cost guard 必须在派发时读取迁移标志；
    // loadProfiles/persistProfiles 持有该写入。
    getAllowFailOpen: () => state.allowFailOpen,
  };
}
