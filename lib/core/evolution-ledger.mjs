// lib/core/evolution-ledger.mjs — 派发台账（dispatch.jsonl）采集。JSONL 追加不可变：
// 只 appendFileSync 追加一行，绝不改写既有行。import-free（仅 node 内置
// fs/crypto/path + lib/core/pure.mjs），可被 bare-CI 单测直接 import。采集异常只
// warn + 丢失计数，绝不阻断派发（fail-soft）。
// 轮转：追加成功后在写路径惰性检查阈值（记录数/字节数），命中即封存当前台账为
// dispatch-<seq>-<ts>.jsonl 并新建空台账续写；封存件超保留上限时淘汰最早者并
// 提示回放窗口缩短。轮转失败只 warn（本条已落盘），下次写入重试。
//
// 审计分级：每类写失败分别计数，计数与 health 落盘到同目录的 ledger.meta.json
// （{v:1, lostTelemetry, lostGovernance, health}）。派发台账写失败计 lostTelemetry
// （fail-soft 仅告警）；profile 变更/治理写失败走 markGovernanceFailure 计
// lostGovernance 且 health 置 degraded（高可见，设置页红字暴露）。meta 独立成域
// subagent-evolution/（以 dshHome 为根，不在 .agent-presets/ 下，不被 preset 同步
// 裁剪）。health 持久化：重启保持 degraded，直到一次 meta 写成功（成功派发触发恢复）
// 才回 ok。meta.json 原子写（tmp+rename），损坏 fail-soft 从零，写失败绝不抛。
//
// 隐私红线：绝不落子 Agent 原始输出 / prompt 原文 / persona 原文——每条记录只有长度
// （min-PII）与确定性结构指纹。persona 只存 present 布尔 + 文本结构指纹；toolFilter 只
// 存 present + allow/deny 数组结构指纹。parent_adopted / goal_achieved / human_edited
// 不入库（写入那个时刻它们尚不存在，事后回填会破坏 append-only 不可变性，只由聚合层
// 惰性 join）。

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { textFrom } from './pure.mjs';
import { createRotation } from './evolution-persistence.mjs';

const LEDGER_VERSION = 1;
const GOVERNANCE_AUDIT_VERSION = 1;
const SOURCE = 'system';
const ORIGIN = 'subagent';

// --- 结构指纹（确定性，输入相同恒产出相同指纹）----------------------------------
// 长度做导流 + sha1 前 8 区分内容：仅截断哈希可被碰撞枚举，叠加前缀长度后同时刻画
// 内容形状与体量，避免可枚举碰撞。不含原文。
function fingerprint(text) {
  const value = String(text ?? '');
  const hash = createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 8);
  return `L${value.length}_${hash}`;
}

// prompt 规范化结构指纹：长度 + 换行数 + sha1 前 8（内容形状标识，独缺原文）。
function structureFingerprint(prompt) {
  const value = String(prompt ?? '');
  let newlines = 0;
  for (let i = 0; i < value.length; i += 1) if (value[i] === '\n') newlines += 1;
  return `${fingerprint(value)}_NL${newlines}`;
}

// allow/deny 数组结构指纹：各数组的项数 + 内容 sha1（只对数组结构，不含父级配置）。
function toolFilterFingerprint(toolFilter) {
  const list = (arr) => (Array.isArray(arr) ? arr : []);
  const allow = list(toolFilter?.allow);
  const deny = list(toolFilter?.deny);
  const part = (label, arr) => `${label}:N${arr.length}_${fingerprint(JSON.stringify(arr))}`;
  return `${part('allow', allow)};${part('deny', deny)}`;
}

// cfg（requested/effective 双栏共用）。pending 为 merged（continuable 时部分值会被
// 丢弃）；opts 覆盖生效栏（continuable 生效 preset 恒 'inherit'、reasoningEffort 被
// 宿主忽略应空置）。双栏拆分正是为捕捉「请求了但被宿主丢弃」的失真。空字段统一
// 归一为 null（不写 undefined，保持 JSONL 行形状稳定）。
function cfgOf(merged, opts = {}) {
  const persona = typeof merged?.persona === 'string' ? merged.persona : '';
  const hasPersona = persona.length > 0;
  const toolFilterSet = merged?.toolFilter !== undefined && merged?.toolFilter !== null;
  const str = (value) => (typeof value === 'string' && value.length > 0 ? value : null);
  return {
    preset: opts.preset ?? (typeof merged?.preset === 'string' && merged.preset !== '' ? merged.preset : 'inherit'),
    provider: str(merged?.provider),
    model: str(merged?.model),
    reasoningEffort: opts.reasoningEffort !== undefined ? opts.reasoningEffort : str(merged?.reasoningEffort),
    maxTokens: typeof merged?.maxTokens === 'number' ? merged.maxTokens : null,
    maxDepth: typeof merged?.maxDepth === 'number' ? merged.maxDepth : null,
    persona_present: hasPersona,
    persona_fp: hasPersona ? fingerprint(persona) : null,
    toolFilter_present: toolFilterSet,
    toolFilter_fp: toolFilterSet ? toolFilterFingerprint(merged.toolFilter) : null,
  };
}

// 记录静态元数据（写入即知的共享字段，不含 ts/v——由 record 落盘时补）。三分支各自
// 在此基础上补 child_id 与 outcome 后调用 record。pluginVersion 由工厂闭包注入。
function buildBase({ parent, args, merged, mode, pluginVersion, effectiveModelSource }) {
  const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
  const effectivePreset = mode === 'continuable' ? 'inherit' : (merged?.preset ?? 'inherit');
  // continuable 下宿主忽略 reasoningEffort（决策轨迹侧将其列入 ignored），生效栏
  // 空置以保持「生效值」语义与聚合层读值不失真。
  const effectiveReasoningEffort = mode === 'continuable' ? null : (merged?.reasoningEffort ?? null);
  return {
    // session_id 空值归一 null：它是未来聚合层惰性 join 的键，静默缺失会破坏
    // join 且难察觉，显式 null 至少保持 JSONL 行形状稳定。
    session_id: parent?.session?.header?.id ?? null,
    parent_model: parent?.options?.model ?? null,
    parent_provider: parent?.options?.provider ?? null,
    // 生效来源（call/profile/parent/default）：每次派发记录「生效路由是谁决定的」；
    // 调用方未传时归一 null，保持 JSONL 行形状稳定。
    effectiveModelSource: typeof effectiveModelSource === 'string' && effectiveModelSource !== '' ? effectiveModelSource : null,
    mode,
    // 调用方是否显式确认（true/false 恒写；旧记录缺省不读，向前兼容）。
    confirm: args?.confirm === true,
    origin: ORIGIN,
    requested: cfgOf(merged),
    effective: cfgOf(merged, { preset: effectivePreset, reasoningEffort: effectiveReasoningEffort }),
    task: {
      len: prompt.length,
      structure: structureFingerprint(prompt),
    },
    source: SOURCE,
    provenance: `dispatch:v${pluginVersion}`,
    plugin_version: pluginVersion,
  };
}

// --- outcome 组装（前台/后台结算时携带；continuable 无结算 → 不产 outcome）--------

// tool_count 为「携带 usage 的 assistant/message 事件数」（collectChildCalls 的
// totalCalls），是工具调用次数的可测代理而非字面计数值——宿主会话面无更直接的
// 工具调用计数字段；拿不到记 null。
function foregroundOutcome({ result, elapsedMs, prunedOutputLen, toolCount, childTotalTokens, childUsage }) {
  const stopReason = result?.stopReason ?? 'completed';
  const completed = stopReason === 'completed';
  return {
    status: completed ? 'completed' : (stopReason === 'aborted' ? 'killed' : 'failed'),
    stop_reason: stopReason,
    elapsed_ms: elapsedMs,
    output_len: prunedOutputLen,
    tool_count: completed ? toolCount : null,
    ...(typeof childTotalTokens === 'number' && Number.isFinite(childTotalTokens) ? { tokens: childTotalTokens } : {}),
    ...(childUsage !== null && typeof childUsage === 'object' ? { usage: childUsage } : {}),
  };
}

function backgroundOutcome(settled) {
  const s = settled !== null && typeof settled === 'object' ? settled : {};
  const totalCalls = s.calls !== null && typeof s.calls === 'object' && typeof s.calls.totalCalls === 'number'
    ? s.calls.totalCalls
    : null;
  return {
    status: s.status ?? 'failed',
    stop_reason: s.stopReason ?? 'error',
    elapsed_ms: s.elapsedMs,
    output_len: typeof s.output === 'string' ? s.output.length : 0,
    tool_count: totalCalls,
    ...(typeof s.childTotalTokens === 'number' && Number.isFinite(s.childTotalTokens) ? { tokens: s.childTotalTokens } : {}),
    ...(s.childUsage !== null && typeof s.childUsage === 'object' ? { usage: s.childUsage } : {}),
  };
}

// --- 三分支 finish 助手：每条派发只加一行调用（守 dispatch-tool 行门）------------

export function finishForegroundLedger(ledger, base, childId, result, prunedBlocks, elapsedMs, childCalls, childTotalTokens, childUsage) {
  const calls = childCalls ?? {};
  ledger.record({
    ...base,
    child_id: childId,
    mode: 'foreground',
    outcome: foregroundOutcome({
      result,
      elapsedMs,
      prunedOutputLen: textFrom(prunedBlocks).length,
      toolCount: typeof calls.totalCalls === 'number' ? calls.totalCalls : null,
      childTotalTokens,
      childUsage,
    }),
  });
}

export function finishBackgroundLedger(ledger, base, childId, settled) {
  ledger.record({ ...base, child_id: childId, mode: 'background', outcome: backgroundOutcome(settled) });
}

export function finishContinuableLedger(ledger, base, childId) {
  ledger.record({ ...base, child_id: childId, mode: 'continuable' });
}

// --- 审计 meta（ledger.meta.json）----------------------------------------------

// meta 默认态（缺失/损坏/形状不符均回退此值 → fail-soft 从零）。last_write_ts 为
// 最近一次成功落盘时间（旧文件无该字段时经合并回退 0）。lost_count 计版本迁移
// 类丢失；rotation_seq 为轮转序号（0 = 尚未轮转）。
const META_DEFAULTS = {
  v: 1,
  lostTelemetry: 0,
  lostGovernance: 0,
  health: 'ok',
  last_write_ts: 0,
  lost_count: 0,
  rotation_seq: 0,
};

// 可选字段（last_write_ts/lost_count/rotation_seq）缺省或非数字时回退默认，
// 保证旧版本写出的 meta 文件可读。
function optionalNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// 读取并校验 meta.json；缺失/损坏/形状不符回退默认并 warn（fail-soft 从零）。
// 只接受 v:1 与必填字段的数字/字符串形态，防止被手改的坏元数据冒充。
function loadAuditMeta(metaFile, warn) {
  if (!existsSync(metaFile)) return { ...META_DEFAULTS };
  try {
    const parsed = JSON.parse(readFileSync(metaFile, 'utf8'));
    if (
      parsed !== null && typeof parsed === 'object' && parsed.v === 1
      && typeof parsed.lostTelemetry === 'number' && Number.isFinite(parsed.lostTelemetry)
      && typeof parsed.lostGovernance === 'number' && Number.isFinite(parsed.lostGovernance)
      && (parsed.health === 'ok' || parsed.health === 'degraded')
    ) {
      return {
        ...META_DEFAULTS,
        ...parsed,
        last_write_ts: optionalNumber(parsed.last_write_ts, 0),
        lost_count: optionalNumber(parsed.lost_count, 0),
        rotation_seq: optionalNumber(parsed.rotation_seq, 0),
      };
    }
    warn(`ledger meta: 审计元数据形状不符，已从零重建（${metaFile}）`);
    return { ...META_DEFAULTS };
  } catch {
    warn(`ledger meta: 审计元数据损坏，已从零重建（${metaFile}）`);
    return { ...META_DEFAULTS };
  }
}

// --- 工厂 -----------------------------------------------------------------------

// 原子写 meta.json（tmp+rename）。metaState 为可写闭包状态 {dir, metaFile, lost,
// governanceLost, health}；写成功以 healthValue 为准（恢复 ok 即在此触发）。写失败
// fail-soft：清理 tmp + warn、返回 false。warnOnFailure 供派发遥测失败路径关闭——
// 该路径已就台账写失败 warn 一次，避免重复告警。
function persistAuditMeta(metaState, healthValue, warn, { warnOnFailure = true } = {}) {
  const payload = {
    v: 1,
    lostTelemetry: metaState.lost,
    lostGovernance: metaState.governanceLost,
    health: healthValue,
    last_write_ts: Date.now(),
    lost_count: metaState.migrationLost,
    rotation_seq: metaState.rotationSeq,
  };
  let reported = false;
  try {
    mkdirSync(metaState.dir, { recursive: true });
    const tmp = `${metaState.metaFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, metaState.metaFile);
    metaState.health = healthValue;
  } catch (error) {
    try { rmSync(`${metaState.metaFile}.tmp`, { force: true }); } catch { /* best effort */ }
    reported = true;
    if (warnOnFailure) {
      warn(`ledger meta: 审计元数据写入失败（${error instanceof Error ? error.message : String(error)}）`);
    }
  }
  return !reported;
}

// --- 治理审计（append-only）-------------------------------------------------------

// 治理失败统一接线：计 lostGovernance + health 置 degraded，meta 尽力落盘保证
// 重启仍 degraded；内存 health 无论落盘成败一律降级（写失败只 warn，不降回 ok）。
// ok → degraded 转变时经 onAlert 通知提醒系统（全局审计异常源）。
function markGovernanceFailureMeta(meta, persistMeta, onAlert) {
  const wasOk = meta.health === 'ok';
  meta.governanceLost += 1;
  meta.health = 'degraded';
  persistMeta('degraded');
  if (wasOk && typeof onAlert === 'function') onAlert(meta.governanceLost);
}

// 治理审计事件（放行审计等）追加一行到 governance-audit.jsonl（append-only 不可变）。
// 写失败绝不静默：warn + markGovernanceFailureMeta（计 lostGovernance + degraded）；
// 写成功若正处 degraded，即为一次成功文件写 → 恢复 ok（与派发台账同口径）。
function appendGovernanceAudit(meta, dir, auditFile, persistMeta, warn, onAlert, entry) {
  const line = JSON.stringify({ v: GOVERNANCE_AUDIT_VERSION, ts: Date.now(), ...entry });
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(auditFile, `${line}\n`, 'utf8');
    if (meta.health === 'degraded') persistMeta('ok');
  } catch (error) {
    warn(`dispatch ledger: 治理审计事件写入失败（${error instanceof Error ? error.message : String(error)}）`);
    markGovernanceFailureMeta(meta, persistMeta, onAlert);
  }
}

// 台账现有行数（按换行符计数，文件缺失/读失败回退 0）：轮转的记录数判据在
// 内存累计，避免每次追加都读整文件。
function countLines(file) {
  try {
    if (!existsSync(file)) return 0;
    const text = readFileSync(file, 'utf8');
    let count = 0;
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') count += 1;
    return count;
  } catch {
    return 0;
  }
}

// 台账字节数（文件缺失/读失败回退 0）。
function fileBytes(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

// 轮转执行器装配：追加成功后惰性检查；首次轮转前若 meta 文件缺失，先按现值落盘
// （rotation_seq 从 0 起步），seq 递增后再落盘。文件操作异常向上抛，由调用方
// fail-soft 处理。
function makeRotationCheck({ dir, file, metaFile, meta, persistMeta, warn, rotation }) {
  return createRotation({
    dir,
    dispatchFile: file,
    getRotationSeq: () => meta.rotationSeq,
    setRotationSeq: (seq) => { meta.rotationSeq = seq; },
    initMetaIfMissing: () => {
      if (!existsSync(metaFile)) persistMeta(meta.health, { warnOnFailure: false });
    },
    persistMeta: () => persistMeta(meta.health),
    warn,
    maxRecords: rotation.maxRecords,
    maxBytes: rotation.maxBytes,
    keep: rotation.keep,
    now: rotation.now,
  });
}

// 追加不可变：mkdir recursive + appendFileSync。写失败只 warn + 丢失计数 ++，
// 绝不抛错、绝不阻断派发。写失败计 lostTelemetry 并落盘 meta；写成功恢复 ok。
// 轮转检查独立于追加成败：轮转失败只 warn，本条已落盘、下次写入重试。
function makeRecord({ dir, file, meta, persistMeta, warn, checkRotation }) {
  return (entry) => {
    try {
      // 序列化也在 try 内（循环引用/BigInt 等理论异常会绕过 fail-soft 外泄；
      // 实际 entry 为自产标量，防御性收口）。
      const line = JSON.stringify({ v: LEDGER_VERSION, ts: Date.now(), ...entry });
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, `${line}\n`, 'utf8');
      meta.lineCount += 1;
      if (meta.health === 'degraded') persistMeta('ok');
    } catch (error) {
      meta.lost += 1;
      warn(`dispatch ledger: 派发台账写入失败，已丢失 ${meta.lost} 条（${error instanceof Error ? error.message : String(error)}）`);
      persistMeta(meta.health, { warnOnFailure: false });
      return;
    }
    try {
      const result = checkRotation(meta.lineCount, fileBytes(file));
      if (result.rotated) meta.lineCount = 0;
    } catch (error) {
      warn(`dispatch ledger: 台账轮转失败，将在下次写入重试（${error instanceof Error ? error.message : String(error)}）`);
    }
  };
}

export function createEvolutionLedger({ dshHome, pluginVersion, warn = () => {}, onAlert, rotation = {} } = {}) {
  if (typeof dshHome !== 'string' || dshHome.length === 0) {
    throw new Error('dispatch ledger: 派发台账需要 dshHome 目录');
  }
  const dir = join(dshHome, 'subagent-evolution');
  const file = join(dir, 'dispatch.jsonl');
  const auditFile = join(dir, 'governance-audit.jsonl');
  const metaFile = join(dir, 'ledger.meta.json');
  const persisted = loadAuditMeta(metaFile, warn);
  // 可写审计状态：lost（遥测）/governanceLost/migrationLost/rotationSeq/health，
  // 初始为持久化值；lineCount 为内存行数累计（构造时读文件初始化）。
  const meta = {
    dir,
    metaFile,
    lost: persisted.lostTelemetry,
    governanceLost: persisted.lostGovernance,
    migrationLost: persisted.lost_count,
    rotationSeq: persisted.rotation_seq,
    health: persisted.health,
    lineCount: countLines(file),
  };
  const persistMeta = (healthValue, opts) => persistAuditMeta(meta, healthValue, warn, opts);
  const checkRotation = makeRotationCheck({ dir, file, metaFile, meta, persistMeta, warn, rotation });

  return {
    baseEntry: (input) => buildBase({ ...input, pluginVersion }),
    record: makeRecord({ dir, file, meta, persistMeta, warn, checkRotation }),
    recordGovernanceAudit(entry) {
      appendGovernanceAudit(meta, dir, auditFile, persistMeta, warn, onAlert, entry);
    },
    // 治理审计失败（profile 变更写失败等）：计 lostGovernance + health 置 degraded，
    // 不抛、不阻断调用方；meta 尽力落盘保证重启仍 degraded。
    markGovernanceFailure() {
      markGovernanceFailureMeta(meta, persistMeta, onAlert);
    },
    // 版本迁移类丢失计数：资产加载方在跳过不可迁移资产时调用（fail-soft 留痕，
    // 不降级 health）。计数随 meta 落盘，重启保持。
    markMigrationLoss() {
      meta.migrationLost += 1;
      persistMeta(meta.health, { warnOnFailure: false });
    },
    // 进程内 health（'ok' | 'degraded'）。
    metaHealth: () => meta.health,
    // 设置页 summary 的 audit 字段来源：{lostTelemetry, lostGovernance, health}。
    auditState: () => ({ lostTelemetry: meta.lost, lostGovernance: meta.governanceLost, health: meta.health }),
    lostCount: () => meta.lost,
    // 迁移类丢失计数与当前轮转序号（诊断/测试读取）。
    migrationLostCount: () => meta.migrationLost,
    rotationSeq: () => meta.rotationSeq,
  };
}
