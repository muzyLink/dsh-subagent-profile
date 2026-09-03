import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DISPATCH_PARAMETER_KEYS } from './dispatch-schema.mjs';
export { profileSnapshotOf } from './profile-directory.mjs';

// lib/core/decision-trace.mjs — dispatch 决策轨迹（decisionTrace）的纯组装与
// 失败台账。纯记录层：只「记录」不参与任何派发行为；轨迹经
// output.presentationMeta 投影进会话块 meta 供客户端台账展示，绝不进模型可见面
// （render 行 / 结果文本）。
//
// 边界（后来开发者须知）：
//   * 本模块无 @deepseek-ai 依赖（仅 node 内置 fs），可被 bare-CI 单测直接 import。
//   * 台账默认是会话级内存结构（不传 stateFile 时进程重启即失）；传入 stateFile
//     时每次 record/take 后全量同步原子落盘（JSON {version:1,sessions}），构造时
//     加载（损坏/版本或形状不符 fail-soft 从空台账起步），clear 只清内存不删文件。
//   * 体积护栏分两级：recordGate 内工具/预设名单类数组截断前 8 项并打
//     truncated:true 标记；assertTraceSize 保证单条 trace JSON ≤ MAX_TRACE_BYTES，
//     超出时逐级截断（detail/reason 长文本 → checks 数组 → settled.calls 数组 →
//     丢弃超长 detail → 全树字符串截断 → 丢 settled → 逐闸丢弃，恒收敛）。
//   * 截断阈值经实测校准：调用级明细 6 条五段 JSON 约 0.7KB + trace 骨架约 1.5KB；
//     2026-08 评审第二轮加入决策输入快照（≤6 条 × ≤200B ≈ 1KB）后预算上调至
//     4096，calls 超预算时截到前 4 条。
//   * 其余阈值（200 字符 / 6 条 checks / 8 项名单 / 快照 6 条）为建议值，待实测校准。

const MAX_LIST_ITEMS = 8;
const MAX_TRACE_BYTES = 4096;
const MAX_TEXT_CHARS = 200;
const MAX_CHECKS = 6;
const MAX_CALLS = 4;

// 名单类数组截断：长度超过 MAX_LIST_ITEMS 且元素全为字符串的数组（工具/预设名
// 单）替换为 { values: 前 8 项, truncated: true }。数值类数组（如 usage）元素非
// 字符串，不截断，避免误伤。
function truncateLists(value) {
  if (Array.isArray(value)) {
    const isNameList = value.length > MAX_LIST_ITEMS && value.every((item) => typeof item === 'string');
    return isNameList ? { values: value.slice(0, MAX_LIST_ITEMS), truncated: true } : value;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = truncateLists(value[key]);
    return out;
  }
  return value;
}

// 单条 trace 骨架。parentContext / requested 由调用方组装后传入（调用方能拿到
// 运行时的父会话快照与请求参数）。gates 初始为空，逐道闸经 recordGate 追加。
export function createDecisionTrace(parentContext, requested, startedAt = Date.now()) {
  return {
    version: 1,
    startedAt,
    parentContext: parentContext ?? {},
    requested: requested ?? {},
    gates: [],
    effective: undefined,
    execution: undefined,
    settled: undefined,
  };
}

// 记录一道闸。gate = { name, input, output, verdict, reason }；input/output 内的
// 名单类数组在此截断（见 truncateLists）。reason 缺省时不写入（保持体积）。
export function recordGate(trace, gate) {
  trace.gates.push({
    name: gate.name,
    input: truncateLists(gate.input ?? {}),
    output: truncateLists(gate.output ?? {}),
    verdict: gate.verdict,
    ...(gate.reason !== undefined ? { reason: gate.reason } : {}),
  });
  return trace;
}

// 定稿：写入 effective / execution / settled（三者均缺省时不写）。后台/continuable
// 无 settled，早期拒绝无 effective——缺省跳过，保证三分支轨迹结构一致且可空。
export function finalizeTrace(trace, parts = {}) {
  if (parts.effective !== undefined) trace.effective = parts.effective;
  if (parts.execution !== undefined) trace.execution = parts.execution;
  if (parts.settled !== undefined) trace.settled = parts.settled;
  return trace;
}

// 父会话上下文快照（判定依据的输入部分）。parentPreset 拿不到记 undefined。
export function parentContextOf({ parentPreset, parentProvider, parentModel, parentToolCount, allowFailOpen }) {
  return { parentPreset, parentProvider, parentModel, parentToolCount, allowFailOpen };
}

// 请求参数快照。requested.prompt 原文绝不进 trace（体积 + 隐私），只记
// persona / toolFilter 的存在性布尔与 prompt 摘要（前 200 字符 + 截断标记）。
// opts.profiles：模型可见的 profile 目录快照（调用方按 dispatch:profiles section
// 同源同序传入，见 profileSnapshotOf）——「模型为什么选这个方案」的决策输入记录面。
export function requestedOf(args, opts = {}) {
  const rawPrompt = typeof args.prompt === 'string' ? args.prompt : '';
  const truncated = rawPrompt.length > 200;
  const profiles = Array.isArray(opts.profiles) ? opts.profiles : [];
  // 未知 per-call 字段不再静默吞——与 DISPATCH_PARAMETER_KEYS（单一事实来源）
  // 对照后记入 requested 快照，台账「请求值」区可见（fail-visible，不改派发行为）。
  const unknownKeys = args !== null && typeof args === 'object' && !Array.isArray(args)
    ? Object.keys(args).filter((key) => args[key] !== undefined && !DISPATCH_PARAMETER_KEYS.includes(key))
    : [];
  // 字段双名：requested 对外显示补官方名 reasoning_effort（与官方 subagent 工具
  // 字段对齐）；内部记录键 reasoningEffort 保持（台账/客户端读取方不动，后续 UI
  // 批次迁移读取方后可移除旧键）。内部键记录归一后值（camel 优先），官方键记录
  // 调用方实际使用的名（snake 优先）——同送两义时两值并留、交由 fail-loud 拒绝。
  const internalEffort = args.reasoningEffort !== undefined ? args.reasoningEffort : args.reasoning_effort;
  const officialEffort = args.reasoning_effort !== undefined ? args.reasoning_effort : args.reasoningEffort;
  return {
    profile: args.profile,
    preset: args.preset,
    provider: args.provider,
    model: args.model,
    reasoningEffort: internalEffort,
    ...(officialEffort !== undefined ? { reasoning_effort: officialEffort } : {}),
    tokenTier: args.tokenTier,
    ...(args.strategy !== undefined ? { strategy: args.strategy } : {}),
    persona_present: typeof args.persona === 'string' && args.persona.length > 0,
    toolFilter_present: args.toolFilter !== undefined,
    maxTokens: args.maxTokens,
    maxDepth: args.maxDepth,
    envelope: args.envelope === true,
    ...(args.confirm !== undefined ? { confirm: args.confirm === true } : {}),
    advice_present: opts.advicePresent === true,
    prompt_excerpt: rawPrompt.slice(0, 200),
    ...(truncated ? { prompt_truncated: true } : {}),
    ...(profiles.length > 0 ? { profiles_snapshot: profiles } : {}),
    ...(unknownKeys.length > 0 ? { unknown_keys: unknownKeys } : {}),
  };
}

// 生效来源判定（call > strategy/auto > profile > parent > default）：call=per-call 显式指定（顶层优先）；strategy=对象内指定模型字段；auto=显式解析链。
export function effectiveModelSourceOf(args, merged, parent) {
  if (args?.provider !== undefined || args?.model !== undefined) return 'call';
  if (args?.strategy === 'auto') return 'auto';
  const strategy = args?.strategy;
  if (strategy !== null && strategy !== undefined && typeof strategy === 'object'
    && (strategy.provider !== undefined || strategy.model !== undefined)) return 'strategy';
  if (merged?.provider !== undefined || merged?.model !== undefined) return 'profile';
  if (parent?.options?.provider !== undefined || parent?.options?.model !== undefined) return 'parent';
  return 'default';
}

// 生效值（与 buildMeta 同源字段 + ignored 列表；continuable 为 ['preset','reasoningEffort']，前/后台为空）。derived 记档位派生注入标记。
export function effectiveMeta(meta, ignored = [], derived = {}) {
  return {
    profile: meta.profile,
    preset: meta.preset,
    provider: meta.provider,
    model: meta.model,
    reasoningEffort: meta.reasoningEffort,
    tokenTier: meta.tokenTier,
    ...(derived?.reasoningEffort === true ? { reasoningEffortDerived: true } : {}),
    ...(derived?.maxTokens === true ? { maxTokensDerived: true } : {}),
    ignored,
  };
}

// 成本闸 ① 硬上限（maxTokens / maxDepth）的预判条目。cap 由调用方注入（自
// pure.mjs 的 MAX_TOKENS / MAX_DEPTH 读取）；这里只判、不 throw——真正的硬上限
// throw 仍在 assertCostGuard 内的 assertHardLimits 完成。
export function hardLimitChecks(args, maxTokensCap, maxDepthCap) {
  const verdict = (value, cap) => (typeof value === 'number' && value > cap ? 'fail' : 'pass');
  return [
    { field: 'maxTokens', checkedAgainst: 'hardCap', input: args.maxTokens, cap: maxTokensCap, verdict: verdict(args.maxTokens, maxTokensCap) },
    { field: 'maxDepth', checkedAgainst: 'hardCap', input: args.maxDepth, cap: maxDepthCap, verdict: verdict(args.maxDepth, maxDepthCap) },
  ];
}

// 审批闸（声明性不变量，非运行时判定）：宿主未暴露可读的会话审批策略值，按
// 子 Agent 权限范围在启动时固定（委派不豁免审批）记 'never'。
export function recordApprovalGate(trace) {
  recordGate(trace, {
    name: 'approval',
    input: { policy: 'never' }, output: { applied: 'never' },
    verdict: 'pass',
    reason: '派发不豁免审批：子 Agent 权限范围在启动时固定（DELEGATION_CONTEXT 语义）',
  });
}

// 失败路径定稿 + 记账：拿不到 sessionId 时跳过（createFailureLedger.record 内部
// 也拒绝空 id）。调用方随后 rethrow 原错误对象（文案逐字不变）。
export function recordFailure(ledger, parent, trace) {
  ledger.record(parent?.session?.header?.id, assertTraceSize(trace));
}

// --- 体积护栏：单条 trace JSON ≤ MAX_TRACE_BYTES --------------------------------

// 深度清理 undefined：对象删除 undefined 值属性，数组 undefined 元素置 null
// （JSON 语义）。宿主对工具结果做 lossless JSON 校验——undefined 属性会在
// JSON.stringify 时被静默丢弃、数组 undefined 元素变 null，均破坏无损往返。
// trace 的可选字段（settled 占位、execution 可选 id、未请求的参数）常态携带
// undefined，故在体积护栏入口统一清理，保证 trace 恒为 lossless JSON。
function stripUndefined(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === undefined) value[i] = null;
      else if (value[i] !== null && typeof value[i] === 'object') stripUndefined(value[i]);
    }
    return value;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) delete value[key];
      else if (value[key] !== null && typeof value[key] === 'object') stripUndefined(value[key]);
    }
  }
  return value;
}

// 逐级截断 detail/reason 长文本到 MAX_TEXT_CHARS（仅命中键名为 detail/reason 的
// 字符串字段）。
function truncateLongTexts(node, max) {
  if (Array.isArray(node)) {
    for (const item of node) truncateLongTexts(item, max);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === 'string' && (key === 'detail' || key === 'reason') && value.length > max) {
        node[key] = value.slice(0, max);
      } else {
        truncateLongTexts(value, max);
      }
    }
  }
}

// 截断 cost 闸的 checks 数组到前 MAX_CHECKS 条。
function truncateChecks(gates, max) {
  for (const gate of gates) {
    const checks = gate.output?.checks;
    if (Array.isArray(checks) && checks.length > max) gate.output.checks = checks.slice(0, max);
  }
}

// 丢弃 detail 字段（最后一级兜底）：detail 是冗长自由文本，field/checkedAgainst/
// verdict 才是结构化摘要——仍超限时整体移除 detail，保留结构化键。
function dropDetails(node) {
  if (Array.isArray(node)) {
    for (const item of node) dropDetails(item);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (key === 'detail') delete node[key];
      else dropDetails(node[key]);
    }
  }
}

// 截任意超长字符串到 max（H3 硬保证）：provider/model/preset/profile 等长标识符此前
// 无 maxLength 约束（truncateLongTexts 只命中 detail/reason 键），恶意/异常输入可让
// trace 仍超护栏预算。这里递归截全树字符串，保证单一字符串体积有界。
function truncateAllStrings(node, max) {
  if (Array.isArray(node)) {
    for (const item of node) truncateAllStrings(item, max);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === 'string' && value.length > max) node[key] = value.slice(0, max);
      else truncateAllStrings(value, max);
    }
  }
}

// 截 settled.calls 的调用级成本明细到前 MAX_CALLS 条并补截断标记：calls 是纯
// 数字对象无 detail/reason 可截，前两级护栏不命中它，只能整条丢弃。settled.calls
// 是包装结构 {calls, truncated, totalCalls}（collectChildCalls 返回值）——此处截
// 内层数组并把 truncated 置 true，与第一级截断（maxCalls=6）同口径，client 读取
// raw.truncated 即可渲染截断提示。
function truncateSettledCalls(trace, max) {
  const wrapped = trace.settled?.calls;
  if (wrapped === null || typeof wrapped !== 'object' || !Array.isArray(wrapped.calls)) return;
  if (wrapped.calls.length <= max) return;
  wrapped.calls = wrapped.calls.slice(0, max);
  wrapped.truncated = true;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

// 单条 trace 体积护栏：先深度清理 undefined（lossless JSON 前提），再保证 JSON
// 序列化后 ≤ MAX_TRACE_BYTES，超出时逐级收敛——
//   ① 截 gates 的 detail/reason 长文本到 MAX_TEXT_CHARS；
//   ② 截 cost 闸 checks 数组到前 MAX_CHECKS 条；
//   ③ 截 settled.calls 调用级明细到前 MAX_CALLS 条；
//   ④ 仍超则整体移除 detail 字段（保留 field/checkedAgainst/verdict 结构化摘要）；
//   ⑤ 硬保证兜底（H3）：截全树任意超长字符串到 MAX_TEXT_CHARS，再丢弃 settled、
//     逐道丢弃最旧闸，恒收敛到 ≤ MAX_TRACE_BYTES，绝不 return 超限 trace。
// 各级均不改派发行为，只丢展示冗余；护栏不 throw（fail-soft），trace 始终可写。
export function assertTraceSize(trace) {
  stripUndefined(trace);
  if (byteLength(trace) <= MAX_TRACE_BYTES) return trace;
  truncateLongTexts(trace.gates, MAX_TEXT_CHARS);
  if (byteLength(trace) <= MAX_TRACE_BYTES) return trace;
  truncateChecks(trace.gates, MAX_CHECKS);
  if (byteLength(trace) <= MAX_TRACE_BYTES) return trace;
  truncateSettledCalls(trace, MAX_CALLS);
  if (byteLength(trace) <= MAX_TRACE_BYTES) return trace;
  dropDetails(trace.gates);
  if (byteLength(trace) <= MAX_TRACE_BYTES) return trace;
  // H3 硬保证：长 provider/model/preset 等标识符无 maxLength，截全树字符串后若仍
  // 超，按体积优先级丢弃可选大段（settled → 最旧闸），直至必然 ≤ MAX_TRACE_BYTES。
  truncateAllStrings(trace, MAX_TEXT_CHARS);
  if (byteLength(trace) <= MAX_TRACE_BYTES) return trace;
  if (trace.settled !== undefined) {
    delete trace.settled;
    stripUndefined(trace);
    if (byteLength(trace) <= MAX_TRACE_BYTES) return trace;
  }
  while (byteLength(trace) > MAX_TRACE_BYTES && Array.isArray(trace.gates) && trace.gates.length > 0) {
    trace.gates.shift();
  }
  return trace;
}

// --- 失败台账 -------------------------------------------------------------------

// 形状判定：落盘 JSON 必须 {version:1, sessions:{<sessionId>:[trace...]}}，任一
// 不符返回 false（fail-soft 用，不 throw）。
function isFailureLedgerShape(parsed) {
  return parsed !== null && typeof parsed === 'object'
    && parsed.version === 1
    && parsed.sessions !== null && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
    && Object.values(parsed.sessions).every((list) => Array.isArray(list));
}

// 构造时加载：文件缺失 / 解析失败 / 版本或形状不符一律 warn + 空台账起步，绝不
// throw（fail-soft）。仅在传入 stateFile 时调用。
function loadFailureLedgerFile(stateFile, sessions, warn) {
  if (stateFile === undefined) return;
  let parsed;
  try {
    if (!existsSync(stateFile)) return;
    parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch (error) {
    warn(`dispatch ledger: 失败台账落盘文件加载失败，从空台账起步（${error instanceof Error ? error.message : String(error)}）`);
    return;
  }
  if (!isFailureLedgerShape(parsed)) {
    warn('dispatch ledger: 失败台账落盘文件版本或形状不符，从空台账起步');
    return;
  }
  // 元素级守卫：条目非对象（含数组/null/原始值）一律丢弃——不把畸形数据注入内存
  // 台账（/ledger/failures 会原样输出给客户端，脏数据只配在加载边界被拦下）。
  for (const [sessionId, list] of Object.entries(parsed.sessions)) {
    const clean = list.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
    if (clean.length > 0) sessions.set(sessionId, clean);
  }
}

// 全量同步落盘：写 <stateFile>.tmp 后 rename 覆盖（崩溃不产生截断文件）；写失败
// warn 不阻断（fail-soft），内存台账照常驱动本进程——与「写失败仅 warn」纪律一致。
// 仅在传入 stateFile 时调用。
function persistFailureLedgerFile(stateFile, sessions, warn) {
  if (stateFile === undefined) return;
  const payload = { version: 1, sessions: Object.fromEntries(sessions) };
  const tmp = `${stateFile}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, stateFile);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    warn(`dispatch ledger: 失败台账落盘写入失败（${error instanceof Error ? error.message : String(error)}）`);
  }
}

// --- 台账条目操作（模块级纯操作：sessions/limits/warn 参数注入，守函数行门）----

function countFailureEntries(sessions) {
  let total = 0;
  for (const list of sessions.values()) total += list.length;
  return total;
}

function dropOldestOverallEntry(sessions, maxTotal, warn) {
  const firstKey = sessions.keys().next();
  if (firstKey.done) return;
  const list = sessions.get(firstKey.value);
  list.shift();
  if (list.length === 0) sessions.delete(firstKey.value);
  warn(`dispatch ledger: 失败台账总量超过上限 ${maxTotal}，已丢弃最旧一条`);
}

function recordFailureEntry(sessions, sessionId, trace, maxPerSession, maxTotal, warn, stateFile) {
  if (sessionId === undefined || sessionId === null || sessionId === '') return;
  let list = sessions.get(sessionId);
  if (list === undefined) {
    list = [];
    sessions.set(sessionId, list);
  }
  list.push(trace);
  if (list.length > maxPerSession) {
    list.shift();
    warn(`dispatch ledger: 会话 ${sessionId} 失败记录超过每会话上限 ${maxPerSession}，已丢弃最旧一条`);
  }
  while (countFailureEntries(sessions) > maxTotal) {
    dropOldestOverallEntry(sessions, maxTotal, warn);
  }
  persistFailureLedgerFile(stateFile, sessions, warn);
}

function getFailureEntries(sessions, sessionId) {
  const list = sessions.get(sessionId);
  return list === undefined ? [] : [...list];
}

function takeFailureEntries(sessions, sessionId, warn, stateFile) {
  const list = sessions.get(sessionId);
  if (list === undefined) return [];
  sessions.delete(sessionId);
  persistFailureLedgerFile(stateFile, sessions, warn);
  return [...list];
}

// 会话级失败台账（Map<sessionId, Array<trace>>）。参数注入、弃单例；每会话
// 上限 maxPerSession、总量上限 maxTotal，超限丢弃最旧并 warn（fail-soft，绝不
// 阻断派发失败路径）。warn 由调用方注入（宿主 logger 或测试捕获器）。
// 可选 stateFile：传入时构造加载 + record/take 后落盘；不传 = 纯内存。
export function createFailureLedger({ maxPerSession = 50, maxTotal = 500, warn = () => {}, stateFile } = {}) {
  const sessions = new Map();
  loadFailureLedgerFile(stateFile, sessions, warn);
  return {
    record: (sessionId, trace) => recordFailureEntry(sessions, sessionId, trace, maxPerSession, maxTotal, warn, stateFile),
    get: (sessionId) => getFailureEntries(sessions, sessionId),
    take: (sessionId) => takeFailureEntries(sessions, sessionId, warn, stateFile),
    clear: () => sessions.clear(),
    count: () => countFailureEntries(sessions),
  };
}
