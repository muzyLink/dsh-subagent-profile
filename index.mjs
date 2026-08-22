// index.mjs — dsh-subagent-profile host half (formal plugin bundle).
// Converted from prototype/subagent-profile/host.plugin.js (the dynamic-plugin
// `code.host` body) with import slimming: the inline foldConsumedWork /
// accountsForClaim / lastAssistantContent / uuid / AbortController-shim are
// replaced by package imports or platform primitives where semantics match
// exactly, and the harness-only APIs (registerTool/defineTool/handle) are
// mapped to their bundle equivalents or guarded. See the import mapping table
// in README.md.

import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendDelegatedPolicyOverrides,
  assertSubagentMaxDepth,
  captureDelegatedPolicyOverrides,
  createUserMessage,
  defineTool,
  readResult,
  resolveChildAgentOptions,
  resolveChildDepth,
} from './lib/shims.mjs';
import { textFrom, stopReasonError, withPartialText, sanitizeProfile, GUIDANCE_PREFIX, assertHardLimits, computeContinuableAllow, pruneBlocks, assertResultSchemaConsistency } from './lib/pure.mjs';

export const name = 'dsh-subagent-profile';
export const inject = ['subagents', 'tools', 'agents'];

// Resolve the DSH home directory (env override wins, platform fallback) — the
// same policy as the dsh-persona-ref bundle: user profiles persist to
// ~/.dsh/subagent-profiles.json, stable across harness working directories.
function dshHome() {
  const raw = process.env.DSH_HOME;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const trimmed = raw.trim();
    if (trimmed === '~') return homedir();
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(homedir(), trimmed.slice(2));
    return trimmed;
  }
  return join(homedir(), '.dsh');
}

// --- bundled agent-preset self-install --------------------------------------
// On host startup the plugin syncs the bundled `presets/` tree into the DSH
// agent-presets discovery root (~/.dsh/.agent-presets) so the "orchestrator"
// mode appears in the new-session picker without manual copying — the same
// self-install pattern as the shipped dsh-liangshen bundle. The sync is
// per-directory and idempotent (byte-identical trees are skipped; target files
// the bundle no longer ships are pruned); directories the plugin does not own
// are never touched. node:fs cpSync is avoided deliberately: on Node 22 for
// Windows, fs.cpSync({ recursive: true }) can crash the process when a source
// path contains non-ASCII (CJK home dir, nodejs/node#54476), so the copy is
// per-entry, preserving source mtimes.

// Absolute path of the bundled preset tree inside this package.
function bundledPresetsRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), 'presets');
}

const MTIME_TOLERANCE_MS = 1000;

function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(root);
  return out;
}

// File identity is bytes; size/mtime are only a fast negative check.
function sameFile(a, b) {
  const sa = statSync(a);
  const sb = statSync(b);
  if (sa.size !== sb.size) return false;
  if (Math.abs(sa.mtimeMs - sb.mtimeMs) > MTIME_TOLERANCE_MS) return false;
  return readFileSync(a).equals(readFileSync(b));
}

function copyTreeSync(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    const source = join(sourceDir, entry);
    const target = join(targetDir, entry);
    const st = statSync(source);
    if (st.isDirectory()) copyTreeSync(source, target);
    else {
      copyFileSync(source, target);
      utimesSync(target, st.atime, st.mtime);
    }
  }
}

// Remove target files not in `keep`, then only the directories emptied by it.
function pruneExtras(root, keep) {
  const parents = new Set();
  for (const file of filesUnder(root)) {
    if (!keep.has(relative(root, file))) {
      parents.add(dirname(file));
      rmSync(file, { force: true });
    }
  }
  for (const start of parents) {
    let dir = start;
    while (dir !== undefined && relative(root, dir) !== '') {
      if (existsSync(dir) && readdirSync(dir).length === 0) {
        rmSync(dir, { recursive: true, force: true });
        dir = dirname(dir);
      } else dir = undefined;
    }
  }
}

// Copy `sourceDir` into `targetDir` idempotently; returns 'synced' or 'current'.
function syncOnePreset(sourceDir, targetDir) {
  const sourceFiles = filesUnder(sourceDir);
  const sourceSet = new Set(sourceFiles.map((f) => relative(sourceDir, f)));
  if (existsSync(targetDir) && !statSync(targetDir).isDirectory()) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  if (!existsSync(targetDir)) {
    copyTreeSync(sourceDir, targetDir);
    pruneExtras(targetDir, sourceSet);
    return 'synced';
  }
  let dirty = false;
  for (const file of sourceFiles) {
    const dest = join(targetDir, relative(sourceDir, file));
    if (!existsSync(dest) || !sameFile(file, dest)) { dirty = true; break; }
  }
  if (!dirty) {
    for (const file of filesUnder(targetDir)) {
      if (!sourceSet.has(relative(targetDir, file))) { dirty = true; break; }
    }
  }
  if (!dirty) return 'current';
  pruneExtras(targetDir, sourceSet);
  copyTreeSync(sourceDir, targetDir);
  pruneExtras(targetDir, sourceSet);
  return 'synced';
}

// Sync every preset directory under `presets/` into the target discovery root.
function syncBundledPresets(targetRoot) {
  const result = { synced: [], current: [], failed: [] };
  const sourceRoot = bundledPresetsRoot();
  mkdirSync(targetRoot, { recursive: true });
  if (existsSync(sourceRoot)) {
    for (const entry of readdirSync(sourceRoot)) {
      const source = join(sourceRoot, entry);
      if (!statSync(source).isDirectory()) continue;
      const id = basename(source);
      try {
        const outcome = syncOnePreset(source, join(targetRoot, id));
        (outcome === 'synced' ? result.synced : result.current).push(id);
      } catch (error) {
        result.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return result;
}

// Only the loopback interfaces may drive the settings HTTP routes.
const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// The plugin's enable/disable switch. Persisted beside the profile list so a
// user can turn the dispatch tool off without uninstalling the bundle. Default
// is enabled; a missing/unreadable file falls back to enabled.
function stateFile() {
  return join(dshHome(), 'subagent-profiles.state.json');
}
function loadEnabled() {
  try {
    if (existsSync(stateFile())) {
      const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'));
      return parsed && parsed.enabled !== false;
    }
  } catch {
    // fall through to enabled
  }
  return true;
}
function persistEnabled(enabled) {
  try {
    writeFileSync(stateFile(), JSON.stringify({ enabled }, null, 2), 'utf8');
  } catch {
    // best effort — the in-memory state still drives this process
  }
}

// --- module-level helpers (kept inline; the packages do not export them) ---

// F5: runtime-derived cost guard. Two parts (SPEC §7.3):
//   ① always-on hard caps (assertHardLimits, in lib/pure.mjs) — maxTokens /
//      maxDepth are hard delegation caps, independent of the `llm` service, so
//      they must NOT stop applying when `llm` is absent (the old `if (llm ===
//      undefined) return` skipped them).
//   ② llm capability — validates provider / model / reasoningEffort against the
//      live provider directory. When the `llm` service is absent OR its provider
//      directory is empty (an adapter without discovery), capability cannot be
//      verified: per `allowFailOpen` (SPEC §12.1 migration switch) either
//      fail-open compat (warn + skip; v1 数据迁移中) or fail-loud reject. A
//      profile that requests none of provider/model/reasoningEffort has nothing
//      to verify and always passes (valid in a headless deployment).
// Used by both the provider's authoritative check and the dispatch tool's
// pre-check. `allowFailOpen`/`logger` are injected because this function is
// module-scoped and cannot reach the apply closure's `allowFailOpen`/`ctx.logger`.
async function assertCostGuard(parent, profile, allowFailOpen, logger) {
  // ① 硬上限 always-on（不依赖 llm）。
  assertHardLimits(profile.maxTokens, profile.maxDepth);

  // ② 仅当 profile 请求了需核验能力面的字段时才进入 llm 校验（无头/headless 部署下
  //    persona-only / toolFilter-only 的 profile 合法，不应被 fail-loud 拒绝）。
  const needsLlm = ['provider', 'model', 'reasoningEffort'].some(
    (key) => typeof profile[key] === 'string' && profile[key].length > 0
  );
  if (!needsLlm) return;

  const llm = parent.ctx.get('llm');
  // ③ 目录为空检测：llm 存在但其 provider 目录为空（无发现能力）→ 无法核验。
  let emptyDirectory = false;
  if (llm !== undefined) {
    try {
      const providers = await llm.listProviders();
      emptyDirectory = (providers ?? []).length === 0;
    } catch {
      emptyDirectory = true;
    }
  }
  if (llm === undefined || emptyDirectory) {
    if (allowFailOpen === true) {
      logger.warn('llm 不可用：fail-open 兼容模式（v1 数据迁移中，建议保存一次配置以升级到 fail-loud）');
      return;
    }
    throw new Error('dispatch: 模型能力不可验证：fail-loud 拒绝（可在配置中显式开启兼容模式）');
  }

  // ④ provider 注册校验（目录非空时才能判定「不在目录」）。
  if (typeof profile.provider === 'string' && profile.provider.length > 0) {
    const providers = await llm.listProviders();
    if (!(providers ?? []).some((provider) => provider && provider.id === profile.provider)) {
      throw new Error(`dispatch: provider "${profile.provider}" is not a registered provider`);
    }
  }
  const effectiveProvider = profile.provider !== undefined ? profile.provider : parent.options.provider;
  const effectiveModel = profile.model !== undefined ? profile.model : parent.options.model;
  // ⑤ model 校验。resolveModelInfo does not reject unknown models (catalog
  //    membership is advisory), so validate against the advertised catalog
  //    instead. An EMPTY catalog (adapter without discovery) cannot be verified
  //    and is skipped — 目录级空集已在 ③ 走 allowFailOpen 分支，此处仅兜底
  //    per-provider 空目录。A non-empty catalog that does not advertise the model
  //    fails loud. An unverifiable lookup (listModels(undefined) when no provider
  //    is known) becomes a clean fail-loud error instead of leaking "undefined".
  if (typeof profile.model === 'string' && profile.model.length > 0) {
    let models;
    try {
      models = await llm.listModels(effectiveProvider);
    } catch (error) {
      throw new Error(`dispatch: cannot validate model "${profile.model}" without a provider: ${error instanceof Error ? error.message : String(error)}`);
    }
    const listed = models ?? [];
    const known = listed.length > 0 && listed.some((model) => model && (model.id === profile.model || model.name === profile.model));
    if (listed.length > 0 && !known) {
      throw new Error(`dispatch: model "${profile.model}" is not advertised by provider "${String(effectiveProvider)}"`);
    }
  }
  // ⑥ reasoningEffort 校验。
  if (typeof profile.reasoningEffort === 'string' && profile.reasoningEffort.length > 0) {
    try {
      await llm.resolveCallConfig({ provider: effectiveProvider, model: effectiveModel, reasoningEffort: profile.reasoningEffort });
    } catch (error) {
      throw new Error(`dispatch: reasoningEffort "${profile.reasoningEffort}" is not supported by provider "${String(effectiveProvider)}" model "${String(effectiveModel)}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Settle one background one-shot run into a job outcome with the same
// observability metadata the foreground path reports. Non-completed stop reasons
// become failed (aborted => killed, shipped vocabulary) with partial output
// attached; hard failures never reject the job.
// `prune` is the result-recycle pre-clipper (§8.2): the caller (dispatch
// execute) injects a closure that calls the host toolResultPruner.pruneContent
// before textFrom; defaulting to identity keeps the background path safe when no
// pruner is available.
async function settleStart(start, signal, meta, prune = (blocks) => blocks) {
  let run;
  try {
    run = await start;
    const result = await run.result;
    const failure = stopReasonError(result);
    if (failure !== undefined) {
      return { status: result.stopReason === 'aborted' ? 'killed' : 'failed', detail: withPartialText(failure, result.output), ...meta };
    }
    return { status: 'completed', output: textFrom(prune(result.output)), ...meta };
  } catch (error) {
    return signal.aborted ? { status: 'killed', ...meta } : { status: 'failed', detail: String(error), ...meta };
  } finally {
    // Release the child handle no matter how the result settled — run.result
    // rejecting must not leak the subagent (same discipline as the foreground
    // try/finally).
    if (run !== undefined) await run.dispose().catch(() => {});
  }
}

// Verbatim from the shipped SUBAGENT_DELEGATION_CONTEXT.
const DELEGATION_CONTEXT = 'You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the task needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.';

export async function apply(ctx) {
  // 0. Enable/disable switch: default on, toggled at runtime by the settings
  //    page and persisted across restarts. When off, the dispatch tool is
  //    unregistered so it disappears from the model's tool list.
  let enabled = loadEnabled();

  // 1. Profile registry (per-instance state; a bundle row is process-level, so
  //    this Map is the singleton store, exactly like the dynamic plugin's).
  //    Builtin seeds carry `builtin: true` so reset/remove can identify them and
  //    a modified builtin stays distinguishable from a pure user profile.
  //    Descriptions are semantic: one-line positioning + when to use, to help
  //    the model choose. reasoningEffort levels verified against the
  //    llm-deepseek adapter (off/high/max; see resolveModel gating on
  //    connection.defaults.thinking — this deployment leaves thinking unset,
  //    so the full set is advertised for deepseek-v4-flash).
  const BUILTIN_SEEDS = [
    { id: 'swap-standard', name: '标准编码', description: '切换到 standard 预设的完整编码工具集。当父会话不是 standard、但子任务需要完整编码能力时用。', preset: 'standard', builtin: true },
    { id: 'researcher', name: '调研检索', description: '关闭深度推理省 token，继承父工具。适合查资料、汇总、背景调研，不适合改代码。', reasoningEffort: 'off', persona: 'You are a research subagent: search, read, and summarize only. Do not modify code or files.', builtin: true }
  ];

  // Tool-name → 中文说明 map, shown beside the raw tool name in the toolFilter
  // picker. Tools absent here fall back to their raw name.
  const TOOL_ZH = {
    'bash': '终端命令',
    'pwsh': 'PowerShell 命令',
    'read': '读取文件',
    'write': '写入文件',
    'edit': '编辑文件',
    'grep': '搜索文件内容',
    'glob': '查找文件',
    'web_search': '网页搜索',
    'browser_navigate': '浏览器打开网址',
    'browser_snapshot': '浏览器页面快照',
    'browser_click': '浏览器点击',
    'browser_type': '浏览器输入',
    'browser_scroll': '浏览器滚动',
    'browser_back': '浏览器后退',
    'browser_forward': '浏览器前进',
    'browser_press': '浏览器按键',
    'browser_reload': '浏览器刷新',
    'browser_wait': '浏览器等待',
    'browser_get_text': '读取页面文本',
    'dispatch': '派发子 Agent',
    'subagent': '派生子 Agent',
    'subagent_fork': '派生子 Agent（继承上下文）',
    'send_message': '给子 Agent 发消息',
    'interrupt_agent': '中断子 Agent',
    'list_agents': '列出子 Agent',
    'todo_write': '任务清单',
    'create_goal': '创建目标',
    'get_goal': '查看目标',
    'update_goal': '更新目标',
    'workflow': '编排多 Agent 工作流',
    'ralph': 'Ralph 迭代',
    'ask_user_question': '询问用户',
    'skill': '加载技能',
    'describe_image': '描述图片',
    'read_image': '读取图片',
    'modlens_read_image': '读取图片（modlens）',
    'ssh_list': '列出 SSH 主机',
    'ssh_exec': 'SSH 执行命令',
    'ssh_upload': 'SSH 上传',
    'ssh_download': 'SSH 下载',
    'ssh_tunnel': 'SSH 隧道',
    'ssh_cluster': 'SSH 集群执行',
    'exit_plan_mode': '退出计划模式',
    'incident_resolved': '标记事故已解决',
    'dsh_rollback': '回滚 DSH',
    'dsh_snapshot': 'DSH 快照',
    'job_list': '列出后台任务',
    'job_output': '读取后台任务输出',
    'job_kill': '终止后台任务',
    'str_replace_editor': '文本编辑',
    'cordis_inspect_list': '列出 Cordis 服务',
    'cordis_inspect_query': '查询 Cordis 服务',
    'cordis_inspect_self': '查看自身 Cordis 服务',
    'cordis_define': '定义 Cordis 服务',
    'cordis_run': '运行 Cordis 服务',
    'cordis_stop': '停止 Cordis 服务',
    'cordis_undefine': '取消定义 Cordis 服务',
    'run_code': '运行代码',
  };

  // Tool-name → 功能分类 map，覆盖 DSH 官方核心工具（固定集合）。插件工具
  // 走前缀提取（见 categoryOf），自建预设用 preset 名。
  const TOOL_CATEGORY = {
    'read': '文件', 'write': '文件', 'edit': '文件', 'grep': '文件', 'glob': '文件', 'str_replace_editor': '文件',
    'bash': '终端', 'pwsh': '终端',
    'web_search': '网络',
    'todo_write': '任务', 'create_goal': '任务', 'get_goal': '任务', 'update_goal': '任务',
    'subagent': '子 Agent', 'subagent_fork': '子 Agent', 'send_message': '子 Agent', 'interrupt_agent': '子 Agent', 'list_agents': '子 Agent',
    'workflow': '工作流', 'ralph': '工作流',
    'ask_user_question': '交互', 'skill': '交互',
    'read_image': '图片', 'describe_image': '图片',
    'cordis_inspect_list': 'Cordis', 'cordis_inspect_query': 'Cordis', 'cordis_inspect_self': 'Cordis',
    'cordis_define': 'Cordis', 'cordis_run': 'Cordis', 'cordis_stop': 'Cordis', 'cordis_undefine': 'Cordis',
    'exit_plan_mode': '计划',
  };

  const profiles = new Map(BUILTIN_SEEDS.map((p) => [p.id, { ...p }]));

  // Builtin ids the user has deleted (soft delete via persisted tombstone). The
  // Map keeps working entries; this Set records tombstones so they survive
  // restarts and a later reset can clear them.
  const deletedBuiltins = new Set();

  // F6: the target-preset whitelist is derived from the runtime roster, not
  // hard-coded: system-trust presets when agentPresets exists, else the
  // shipped fallback names.
  const FALLBACK_WHITELIST = ['standard', 'code', 'minimal'];
  async function resolveWhitelist(agentCtx) {
    const agentPresets = agentCtx.get('agentPresets');
    if (agentPresets === undefined) return FALLBACK_WHITELIST;
    const presets = await agentPresets.list();
    return (presets ?? []).filter((preset) => preset && preset.trust === 'system').map((preset) => preset.id);
  }

  function resolveProfile(id) {
    const found = profiles.get(id);
    if (found === undefined) throw new Error(`dispatch: unknown profile "${id}"`);
    if (found.enabled === false) throw new Error(`dispatch: profile "${id}" is disabled`);
    return found;
  }

  // 1b. User profile persistence. The settings service cannot serve this
  // plugin (its write path hard-requires register(ns, schema) + a schemastery
  // schema), so user profiles are persisted to ~/.dsh/subagent-profiles.json
  // through node:fs — a bundle has node globals, unlike the dynamic-plugin
  // sandbox that needed the optional `fs` service. Loaded once at startup; the
  // add/remove HTTP routes rewrite the file. Persistence is an enhancement, not
  // a hard dependency: any failure only warns and the builtin seeds work.
  const profilesFile = join(dshHome(), 'subagent-profiles.json');
  // V2 migration switch (SPEC §7.3 / §12.1): whether the cost guard may fail-open
  // when the `llm` service is absent. Defaults to FALSE (fail-loud, SPEC §7.3
  // 评审遗留裁定: 全新部署 fail-loud); only a v1 data file being read sets it to
  // true (v1 迁移 fail-open 兼容). A v2 envelope carries its own stored value.
  // Task 4 (cost-guard narrow) reads this flag.
  let allowFailOpen = false;
  function loadProfiles() {
    if (!existsSync(profilesFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(profilesFile, 'utf8'));
      // Two file shapes (SPEC §12.1): v1 = a bare array; v2 = { version:2,
      // profiles:[...], allowFailOpen:<bool> }.
      let entries;
      let version;
      if (Array.isArray(parsed)) {
        entries = parsed;
        version = 1;
      } else if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.profiles)) {
        entries = parsed.profiles;
        version = parsed.version ?? 2;
        // v2 缺 allowFailOpen 字段时按 fail-open 兼容（显式 false 才关闭）；
        // 全新部署默认已定：fail-loud（初始 allowFailOpen=false，见上方声明），
        // 读入 v2 文件按其存储值读取并保持。
        allowFailOpen = parsed.allowFailOpen !== false;
      } else {
        ctx.logger.warn('[dsh-subagent-profile] persisted profile file has an unrecognized shape; ignoring');
        return;
      }
      // v1 (or an unversioned array): migrate in memory, keep fail-open compat.
      if (version !== 2) {
        allowFailOpen = true;
        ctx.logger.warn('[dsh-subagent-profile] v1 数据：fail-open 兼容模式');
      }
      let loaded = 0;
      let skipped = 0;
      for (const raw of entries) {
        if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id.length === 0) {
          skipped++;
          ctx.logger.warn('[dsh-subagent-profile] skipping malformed profile entry:', raw === null ? String(raw) : typeof raw);
          continue;
        }
        // Per-entry sanitize (strict=false): over-limit fields are dropped
        // (field removed) + warned; an over-length persona is KEPT + warned
        // (never silently truncated). A bad entry is skipped (fail-soft).
        const { clean, warnings } = sanitizeProfile(raw, { strict: false });
        for (const warning of warnings) {
          ctx.logger.warn(`[dsh-subagent-profile] profile "${raw.id}" ${warning.field} 被跳过或提示：${warning.reason}`);
        }
        if (clean.deleted === true) {
          if (clean.builtin === true) {
            profiles.delete(clean.id);
            deletedBuiltins.add(clean.id);
          }
          continue;
        }
        const existing = profiles.get(clean.id);
        if (existing !== undefined && existing.builtin === true) {
          profiles.set(clean.id, { ...clean, builtin: true, persisted: true });
        } else {
          profiles.set(clean.id, { ...clean, persisted: true });
        }
        loaded++;
      }
      // Silent success: report how many persisted profiles came in (skipped
      // when none — a missing/empty file is the normal first boot).
      if (loaded > 0) ctx.logger.info(`[dsh-subagent-profile] loaded ${loaded} persisted profile(s)`);
      if (skipped > 0) ctx.logger.warn(`[dsh-subagent-profile] skipped ${skipped} malformed profile entry(ies)`);
    } catch (error) {
      ctx.logger.warn('[dsh-subagent-profile] persisted profile load failed:', error instanceof Error ? error.message : String(error));
    }
  }
  loadProfiles();

  // 1c. Self-install the bundled "orchestrator" agent preset into the DSH
  // agent-presets root so the mode appears in the new-session picker without
  // manual copying (mirrors the shipped dsh-liangshen self-install). Idempotent:
  // byte-identical trees are skipped; a bundle change rewrites the preset — the
  // intended upgrade path. Fail-soft: the dispatch tool and settings page keep
  // working even if the write is denied.
  try {
    const presetRoot = join(dshHome(), '.agent-presets');
    const sync = syncBundledPresets(presetRoot);
    for (const { id, error } of sync.failed) ctx.logger.warn(`[dsh-subagent-profile] preset ${id} sync failed: ${error}`);
    if (sync.synced.length > 0) ctx.logger.info(`[dsh-subagent-profile] presets synced into ${presetRoot}: ${sync.synced.join(', ')}`);
  } catch (error) {
    ctx.logger.warn('[dsh-subagent-profile] preset sync failed:', error instanceof Error ? error.message : String(error));
  }

  /**
   * Persist every `persisted: true` profile plus builtin-delete tombstones.
   * Atomic write (SPEC §12.2): write `<profilesFile>.tmp` in the same directory,
   * then `renameSync` over the target (a crash leaves the old file intact, never
   * a truncated one). Fail-visible (D5/B1): a failure does NOT throw and does NOT
   * roll back the in-memory `profiles` Map — it returns `{ persisted: false }` so
   * the caller can signal "已保存但未持久化" while the in-memory state keeps
   * driving this process. Always writes the v2 envelope shape.
   */
  function persistProfiles() {
    const entries = [];
    for (const profile of profiles.values()) {
      if (profile.persisted !== true) continue;
      const clean = {};
      for (const [key, value] of Object.entries(profile)) {
        if (value === undefined || key === 'persisted') continue;
        clean[key] = value;
      }
      entries.push(clean);
    }
    for (const id of deletedBuiltins) {
      entries.push({ id, builtin: true, deleted: true });
    }
    const payload = { version: 2, profiles: entries, allowFailOpen };
    const tmp = `${profilesFile}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      renameSync(tmp, profilesFile);
      return { persisted: true };
    } catch (error) {
      // Best-effort cleanup of the partial tmp file (rename never ran).
      try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
      ctx.logger.warn('[dsh-subagent-profile] persisted profile write failed:', error instanceof Error ? error.message : String(error));
      return { persisted: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // 1c. HTTP loopback routes for the Client settings UI (webServer.register ↔
  // client fetch; JSON only). webServer is optional — a headless deployment
  // keeps the dispatch tool and drops only the settings page. webServer's
  // activation (listen) is async and may not be ready when this plugin's
  // inject deps resolve, so register inside an inject sub-scope that waits for
  // it (ctx.get would read undefined at apply time).
  ctx.inject(['webServer'], (scope) => {
    const json = (res, code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    const readBody = (req) => new Promise((resolve, reject) => {
      let data = '';
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1 << 20) { reject(new Error('请求体过大')); req.destroy(); return; }
        data += chunk;
      });
      req.on('end', () => {
        try { resolve(data === '' ? {} : JSON.parse(data)); } catch { reject(new Error('请求体不是合法 JSON')); }
      });
      req.on('error', reject);
    });
    // D5/B1 write-failure contract: the write routes return HTTP 200 with
    // `persisted` always present; when the disk write failed, persistWarning
    // explains "已保存但未持久化" (in-memory state drives this process, the
    // disk did not update). The client renders that as the amber warning.
    const persistOk = (res, payload, persist) => json(res, 200, {
      ok: true,
      ...payload,
      persisted: persist.persisted,
      ...(persist.persisted ? {} : { persistWarning: '已保存但未持久化' }),
    });
    const listClean = () => [...profiles.values()].map((profile) => {
      const clean = {};
      for (const [key, value] of Object.entries(profile)) if (value !== undefined && key !== 'persisted') clean[key] = value;
      // The internal `persisted` flag is stripped above; expose a UI-facing
      // "modified" signal so the reset panel can label a changed builtin.
      if (profile.builtin === true && profile.persisted === true) clean.modified = true;
      return clean;
    });
    const handler = async (req, res) => {
      const remote = req.socket?.remoteAddress;
      if (!LOOPBACKS.has(remote)) return json(res, 403, { ok: false, error: '仅限本机访问' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const sub = (url.pathname.replace(/^\/subagent-profiles/, '') || '/').replace(/\/+$/, '') || '/';
      try {
        if (req.method === 'GET' && (sub === '/' || sub === '/list')) {
          return json(res, 200, { ok: true, profiles: listClean() });
        }
        if (req.method === 'GET' && sub === '/options') {
          const models = [];
          const efforts = {};
          const presets = [];
          // Model directory + per-model reasoning-effort levels. The `llm`
          // service is optional (headless): a failure only empties the lists,
          // never breaks the settings page.
          const llm = ctx.get('llm');
          if (llm !== undefined) {
            try {
              const providers = await llm.listProviders();
              for (const provider of (providers ?? [])) {
                const providerId = provider && provider.id;
                if (typeof providerId !== 'string') continue;
                let modelList = [];
                try { modelList = await llm.listModels(providerId); } catch { /* skip this provider's catalog */ }
                for (const model of (modelList ?? [])) {
                  if (!model || typeof model.id !== 'string') continue;
                  models.push({
                    provider: providerId,
                    providerName: provider.name ?? providerId,
                    id: model.id,
                    name: model.name ?? model.id
                  });
                  try {
                    const info = await llm.resolveModelInfo(providerId, model.id);
                    const effortsList = info && info.reasoning && Array.isArray(info.reasoning.efforts) ? info.reasoning.efforts : [];
                    efforts[model.id] = effortsList.map((effort) => ({
                      id: effort.id,
                      name: effort.name ?? effort.id,
                      ...(effort.description !== undefined ? { description: effort.description } : {})
                    }));
                  } catch { /* exact-model lookup may reject; skip its efforts */ }
                }
              }
            } catch { /* llm directory unavailable; leave options empty */ }
          }
          // System-trust presets (agentPresets is optional; fail-soft).
          const agentPresets = ctx.get('agentPresets');
          if (agentPresets !== undefined) {
            try {
              const list = await agentPresets.list();
              for (const preset of (list ?? [])) {
                if (preset && preset.trust === 'system') {
                  presets.push({ id: preset.id, name: preset.name ?? preset.id });
                }
              }
            } catch { /* presets roster unavailable; leave empty */ }
          }
          // Full tool directory = global layer (deployment plugins) + every
          // preset's standing scope (the agent.cordis.yml tool rows). Each tool
          // is tagged with its source: 'global' or the preset id — the grouping
          // is fully dynamic, derived from the runtime's preset roster.
          let tools = [];
          try {
            const seen = new Set();
            const OFFICIAL_PRESETS = ['standard', 'code', 'minimal', 'cordis'];
            const layerOf = (source) => {
              if (source === 'global') return 'plugin';
              if (OFFICIAL_PRESETS.includes(source)) return 'core';
              return 'custom';
            };
            const groupOf = (name, source) => {
              const layer = layerOf(source);
              if (layer === 'core') return TOOL_CATEGORY[name] ?? '其他';
              if (layer === 'plugin') return name.includes('_') ? name.split('_')[0] : name;
              return source;
            };
            const push = (schemas, source) => {
              for (const s of (Array.isArray(schemas) ? schemas : [])) {
                if (!s || typeof s.name !== 'string' || s.name === 'run_code' || seen.has(s.name)) continue;
                seen.add(s.name);
                tools.push({ name: s.name, description: typeof s.description === 'string' ? s.description : '', zh: TOOL_ZH[s.name] ?? '', source, layer: layerOf(source), group: groupOf(s.name, source) });
              }
            };
            if (ctx.tools && typeof ctx.tools.schemas === 'function') {
              push(ctx.tools.schemas(), 'global');
              const agentPresets = ctx.get('agentPresets');
              if (agentPresets !== undefined && typeof agentPresets.list === 'function' && typeof agentPresets.standingKeyFor === 'function') {
                const presets = await agentPresets.list();
                for (const preset of (presets ?? [])) {
                  if (!preset || typeof preset.id !== 'string') continue;
                  try {
                    push(ctx.tools.schemas(await agentPresets.standingKeyFor(preset.id)), preset.id);
                  } catch { /* one preset's standing scope unavailable; skip */ }
                }
              }
            }
          } catch (error) {
            ctx.logger.warn('[dsh-subagent-profile] tools directory failed:', error instanceof Error ? error.message : String(error));
          }
          return json(res, 200, { ok: true, enabled, models, efforts, presets, tools });
        }
        if (req.method === 'POST' && sub === '/set-enabled') {
          const body = await readBody(req);
          const next = !!(body && body.enabled === true);
          enabled = next;
          persistEnabled(next);
          syncTool();
          return json(res, 200, { ok: true, enabled });
        }
        if (req.method === 'POST' && sub === '/add') {
          const body = await readBody(req);
          const profile = body && typeof body === 'object' ? body : {};
          if (typeof profile.id !== 'string' || profile.id.length === 0) {
            return json(res, 400, { ok: false, error: 'subagent-profiles: profile id must be a non-empty string' });
          }
          // 写路径上限（SPEC §7.2）：strict=true —— 超限/非法字段直接 400 拒绝，
          // 与 loadProfiles（strict=false 迁移宽松读取）的行为区分。列被拒字段与中文原因。
          const { clean, warnings } = sanitizeProfile(profile, { strict: true });
          if (warnings.length > 0) {
            const detail = warnings.map((w) => `${w.field}：${w.reason}`).join('；');
            return json(res, 400, { ok: false, error: `写入被拒绝：${detail}` });
          }
          const hadToolFilter = profile.toolFilter !== undefined;
          const existing = profiles.get(clean.id);
          const seed = BUILTIN_SEEDS.find((s) => s.id === clean.id);
          const isBuiltin = (existing !== undefined && existing.builtin === true) || seed !== undefined;
          // Merge (not replace): start from the existing profile — or its seed
          // when it was deleted — so fields not present in the form (e.g. a
          // builtin's persona/preset) survive an edit or a re-add. `clean` is the
          // sanitized request body, so a field absent from the request is absent
          // from clean and the existing value is preserved (merge semantics).
          const merged = { ...(existing ?? seed ?? {}) };
          merged.id = clean.id;
          for (const key of ['name', 'description', 'preset', 'provider', 'model', 'reasoningEffort', 'persona', 'enabled']) {
            if (clean[key] === undefined) continue;       // 未传：保留 existing 原值
            if (clean[key] === '' || clean[key] === null) { delete merged[key]; continue; }  // 空：清除字段
            merged[key] = clean[key];
          }
          // toolFilter 特殊处理：前端改成多选下拉后总是传数组，空数组 = 清除。
          // 请求未传 toolFilter 时保留 existing 原值（merge 语义）；传了但被
          // sanitize 归一为空（如 allow/deny 均空）则清除。
          if (hadToolFilter) {
            const tf = clean.toolFilter;
            if (tf !== undefined && ((Array.isArray(tf.allow) && tf.allow.length > 0) || (Array.isArray(tf.deny) && tf.deny.length > 0))) {
              merged.toolFilter = { ...(Array.isArray(tf.allow) && tf.allow.length > 0 ? { allow: tf.allow } : {}), ...(Array.isArray(tf.deny) && tf.deny.length > 0 ? { deny: tf.deny } : {}) };
            } else {
              delete merged.toolFilter;
            }
          }
          if (merged.enabled !== undefined) merged.enabled = merged.enabled === false ? false : true;
          profiles.set(merged.id, { ...merged, ...(isBuiltin ? { builtin: true } : {}), persisted: true });
          deletedBuiltins.delete(merged.id);
          return persistOk(res, { id: merged.id }, persistProfiles());
        }
        if (req.method === 'POST' && sub === '/remove') {
          const body = await readBody(req);
          const id = body && typeof body === 'object' && typeof body.id === 'string' ? body.id : '';
          const existing = profiles.get(id);
          if (existing === undefined) {
            return json(res, 404, { ok: false, error: `subagent-profiles: profile "${id}" does not exist` });
          }
          profiles.delete(id);
          if (existing.builtin === true) deletedBuiltins.add(id);
          return persistOk(res, { id }, persistProfiles());
        }
        if (req.method === 'POST' && sub === '/reset') {
          const body = await readBody(req);
          const id = body && typeof body === 'object' && typeof body.id === 'string' ? body.id : '';
          const seed = BUILTIN_SEEDS.find((s) => s.id === id);
          if (seed === undefined) {
            return json(res, 404, { ok: false, error: `subagent-profiles: profile "${id}" is not a builtin (nothing to reset)` });
          }
          profiles.set(id, { ...seed });
          deletedBuiltins.delete(id);
          return persistOk(res, { id }, persistProfiles());
        }
        if (req.method === 'POST' && sub === '/reset-all') {
          for (const seed of BUILTIN_SEEDS) {
            profiles.set(seed.id, { ...seed });
            deletedBuiltins.delete(seed.id);
          }
          return persistOk(res, { count: BUILTIN_SEEDS.length }, persistProfiles());
        }
        if (req.method === 'POST' && sub === '/set-profile-enabled') {
          const body = await readBody(req);
          const id = body && typeof body === 'object' && typeof body.id === 'string' ? body.id : '';
          const existing = profiles.get(id);
          if (existing === undefined) {
            return json(res, 404, { ok: false, error: `subagent-profiles: profile "${id}" does not exist` });
          }
          existing.enabled = body && body.enabled === false ? false : true;
          // Persist unconditionally (not just for builtins): a runtime-registered
          // profile's enable/disable must also survive a restart.
          existing.persisted = true;
          return persistOk(res, { id, enabled: existing.enabled }, persistProfiles());
        }
        json(res, 404, { ok: false, error: `未知路由 ${sub}` });
      } catch (error) {
        // 通用 500 不回显内部错误信息（防泄漏），详情只进宿主日志。
        ctx.logger.error('[dsh-subagent-profile] settings route error:', error instanceof Error ? (error.stack ?? error.message) : String(error));
        json(res, 500, { ok: false, error: '内部错误，详情见宿主日志' });
      }
    };
    scope.effect(() => {
      const disposeRoutes = scope.webServer.register({ kind: 'prefix', path: '/subagent-profiles', handler });
      return () => disposeRoutes();
    }, 'dsh-subagent-profile: settings routes');
  });

  // C: subagent-profiles service over the same closure Map — lets the outside
  // world enumerate and extend the registry without touching internals.
  ctx.provide('subagent-profiles', {
    register(profile) {
      if (!profile || typeof profile.id !== 'string' || profile.id.length === 0) {
        throw new Error('subagent-profiles: profile id must be a non-empty string');
      }
      if (profiles.has(profile.id)) {
        throw new Error(`subagent-profiles: profile "${profile.id}" is already registered`);
      }
      const registered = { ...profile };
      profiles.set(profile.id, registered);
      return () => {
        if (profiles.get(profile.id) === registered) profiles.delete(profile.id);
      };
    },
    get(id) {
      return profiles.get(id);
    },
    list() {
      return [...profiles.values()];
    },
    resolve(id) {
      return resolveProfile(id);
    }
  });

  // C: directory section rendering the available profiles (systemPrompt's
  // section `text` accepts a function, as the shipped tool-subagent proves).
  const pluginSystemPrompt = ctx.get('systemPrompt');
  if (pluginSystemPrompt !== undefined) {
    // §8.1 系统提示门控：两段 profile-mode section **只在当前席 Agent 是编排者
    // 预设（orchestrator）**时注入，从而消除从 standard/code/minimal 等不派发
    // 会话上的每请求固定泄漏。
    //
    // —— 门控判据（以源码为准确认，见 test/README.md）——
    // 主判据（preset 特征）：`composedPreset(agentCtx) === 'orchestrator'`。这是
    // 判别「是否编排者会话」的可靠信号：dispatch 工具由本 host 行注册、经
    // dsh-tools `schemas(scope)` 的 global 继承起点对**每个** agent 恒可见，因此
    // 「schemas(agent) 含 dispatch」在宿主架构下恒真，**不能**作为主判据（规格
    // 评审意见：schemas 判据降为否决）。
    // 否决（防御，防假阳性）：若 `schemas(agent)` **明确不含** dispatch → 必空。
    // 生产环境恒含 dispatch（host-global），此否决在正常路径不触发；它只防御任何
    // 让 dispatch 从 agent 视野消失的宿主行为。
    // 回退：拿不到 agentPresets（composedPreset 不可用）时无法判别当前 Agent 的
    // 组成，保守不注入（无泄漏风险）。
    //
    // section.text(context) 由宿主以 assembleContextFor(agent, signal) =
    // { agent, scope: agent, signal } 调用（@deepseek-ai/dsh-agent），因此 text()
    // 能拿到 context.agent；Agent 实例带 .ctx（dsh-agent-presets 的
    // composedPreset(agentCtx) 正以 agentCtx 作为期望入参），故主判据优先取
    // context.agent.ctx。
    const sectionGatePasses = (context) => {
      if (!enabled) return false;
      // 否决（防御性）：schemas(agent) 明确不含 dispatch → 必空。
      if (context !== undefined && context.agent !== undefined) {
        const schemas = ctx.tools.schemas(context.agent);
        if (Array.isArray(schemas) && !schemas.some((s) => s && s.name === 'dispatch')) {
          return false;
        }
      }
      // 主判据：preset 特征 —— composedPreset(agentCtx) === 'orchestrator'。
      const agentPresets = ctx.get('agentPresets');
      if (agentPresets !== undefined && typeof agentPresets.composedPreset === 'function') {
        const agentCtx = context !== undefined && context.agent !== undefined && context.agent.ctx !== undefined
          ? context.agent.ctx
          : ctx;
        try { return agentPresets.composedPreset(agentCtx) === 'orchestrator'; }
        catch { return false; }
      }
      // 无 agentPresets → 无法判别 → 保守不注入。
      return false;
    };
    pluginSystemPrompt.section({
      name: 'dispatch:profiles',
      order: 116.5,
      text: (context) => {
        if (!sectionGatePasses(context)) return '';
        const rows = [...profiles.values()]
          .filter((p) => p.enabled !== false)
          .map((p) => {
            // 引号引用：description 套引号；为空时显示占位符（不套引号）。压平
            // 在存储层完成（sanitizeProfile），此处仅负责显示层包裹。
            const desc = typeof p.description === 'string' && p.description.length > 0 ? `"${p.description}"` : '(无描述)';
            return `- ${p.id}: ${desc}${p.preset !== undefined ? ` (preset: ${p.preset})` : ''}`;
          });
        if (rows.length === 0) return '';
        // §8.3 一行行为规则（进门控 profiles section，非常开 persona）：用相对
        // 锚点降低「几分钟内可自查完的小任务」被派发的概率（SPEC §8.1 残留分歧
        // 已定：行为规则注入点取门控 profiles section）。
        const note = '- 别把 1-2 步即可自查/可搜完的小事委派出去 —— 几分钟内能自查完的直接做。';
        return `Available dispatch profiles (dispatch.profile):\n${rows.join('\n')}\n${note}`;
      }
    });
    // Announce the self-installed orchestrator preset so the current agent
    // knows the mode exists and can point the user to it. §8.1: gated the same
    // way — only a dispatch-capable agent sees it.
    pluginSystemPrompt.section({
      name: 'orchestrator:mode',
      order: 117,
      text: (context) => {
        if (!sectionGatePasses(context)) return '';
        return '本机已安装 dsh-subagent-profile 插件的「编排者模式」agent preset：新建会话的预设选择器中可选「编排者模式」。该模式把 Agent 定位为主协调者——拆解任务后按场景用 dispatch（内置 swap-standard=标准编码、researcher=调研检索，可在「子 Agent 方案」设置页自定义）与 subagent/subagent_fork/workflow 委派给子 Agent，再整合结果。preset 文件由插件维护于 ~/.dsh/.agent-presets，安装/升级时自动同步；用户提到「编排者模式 / orchestrator / 主协调模式」时即指本预设，请据此协作。';
      }
    });
  }

  // 3. `profile` subagent provider.
  const disposeProvider = ctx.subagents.registerProvider({
    name: 'profile',
    capabilities: { outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    async start(request) {
      if (!enabled) {
        throw new Error('dispatch: the subagent-profile plugin is disabled (re-enable it in 设置 → 子 Agent 方案)');
      }
      const profile = request.profile;
      if (profile === undefined) {
        throw new Error('dispatch: request.profile is missing (the dispatch tool must resolve a profile before starting)');
      }
      const parent = request.parent;
      // F9: capture the delegation policy synchronously, before the first
      // await — a later parent switch belongs to the parent's future, not to
      // this child (shipped captureDelegatedPolicyOverrides). Passed to setup
      // through the closure.
      const delegated = captureDelegatedPolicyOverrides(parent);
      // F6: authoritative preset whitelist check against the runtime roster.
      const whitelist = new Set(await resolveWhitelist(parent.ctx));
      if (typeof profile.preset === 'string' && profile.preset !== 'inherit' && !whitelist.has(profile.preset)) {
        throw new Error(`dispatch: preset "${profile.preset}" is not in the target-preset whitelist`);
      }
      // F5: authoritative cost guard (runtime-derived; hard caps always applied,
      // llm capability gated by allowFailOpen — SPEC §7.3).
      await assertCostGuard(parent, profile, allowFailOpen, ctx.logger);
      // Delegation depth: shipped helpers — assert the cap value, then resolve
      // the child depth (parent floor + 1) and enforce the cap.
      assertSubagentMaxDepth(profile.maxDepth);
      const childDepth = resolveChildDepth(parent, profile.maxDepth);
      const childId = randomUUID();
      const parentAgentPresets = parent.ctx.get('agentPresets');
      const parentComposed = parentAgentPresets !== undefined ? parentAgentPresets.composedPreset(parent.ctx) : undefined;
      const swapPreset = typeof profile.preset === 'string' && profile.preset !== 'inherit' && profile.preset !== parentComposed;
      // F8: agentPreset is recorded only when a preset roster exists
      // (non-rosterless), otherwise omitted entirely. This meta is CUSTOM —
      // not the shipped childSessionMeta — because a swap records
      // profile.preset instead of the parent's composedPreset.
      const meta = {
        ...(parent.session.header.cwd !== undefined ? { cwd: parent.session.header.cwd } : {}),
        ...(parentAgentPresets !== undefined
          ? swapPreset
            ? { agentPreset: profile.preset }
            : parentComposed !== undefined
              ? { agentPreset: parentComposed }
              : {}
          : {}),
        parentSession: parent.session.header.id,
        origin: 'subagent',
        delegationDepth: childDepth
      };
      // agentOptions: shipped resolveChildAgentOptions — parent route inherited
      // unless the profile overrides provider/model/maxTokens, stamped with the
      // child's own delegation depth.
      const agentOptions = resolveChildAgentOptions(parent, {
        ...(profile.provider !== undefined ? { provider: profile.provider } : {}),
        ...(profile.model !== undefined ? { model: profile.model } : {}),
        ...(profile.maxTokens !== undefined ? { maxTokens: profile.maxTokens } : {})
      }, childDepth);
      if (request.signal !== undefined && request.signal.aborted) {
        throw new Error('dispatch: subagent request was aborted before child publication');
      }
      const handle = await parent.ctx.agents.create({
        sessionId: childId,
        meta,
        agentOptions,
        signal: request.signal,
        setup: async (childCtx) => {
          // ① Preset composition: explicit swap mounts the target preset;
          //    otherwise compose from the parent. E: rosterless + explicit
          //    swap fails loud instead of silently degrading. This is CUSTOM —
          //    not the shipped applyChildComposition, which only composes from
          //    the parent.
          const childPresets = childCtx.get('agentPresets');
          if (swapPreset) {
            if (childPresets === undefined) {
              throw new Error('dispatch: cannot swap preset in a rosterless deployment');
            }
            await childPresets.mount(childCtx, profile.preset);
          } else if (childPresets !== undefined) {
            childPresets.composeFrom(childCtx, parent.ctx);
          }
          // ② Tool intersection (safety gate 1): parent set ∩ child set, minus
          //    run_code, minus deny, then narrowed by allow when present.
          const parentNames = new Set(parent.ctx.tools.schemas(parent).map((schema) => schema.name));
          const childNames = childCtx.tools.schemas(childCtx.agent).map((schema) => schema.name);
          let effective = childNames.filter((name) =>
            parentNames.has(name) &&
            name !== 'run_code' &&
            !(profile.toolFilter !== undefined && profile.toolFilter.deny !== undefined && profile.toolFilter.deny.includes(name))
          );
          if (profile.toolFilter !== undefined && Array.isArray(profile.toolFilter.allow)) {
            effective = effective.filter((name) => profile.toolFilter.allow.includes(name));
          }
          // F4: shipped restrict does NOT throw on allow:[] — fail loud here so
          // the empty-intersection case is explicit (throw => setupAndPublish
          // rolls the creation back).
          if (effective.length === 0) {
            throw new Error('dispatch: child tool intersection is empty (zero tools)');
          }
          // restrict throws on unknown/scope-local/reserved allow sets: wrap
          // in a clean error and rethrow to trigger creation rollback.
          try {
            childCtx.tools.restrict({ allow: effective });
          } catch (error) {
            throw new Error(`dispatch: child tool restriction failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          // ③ Delegation scope declaration (when systemPrompt is available).
          const systemPrompt = childCtx.get('systemPrompt');
          if (systemPrompt !== undefined) {
            systemPrompt.context({ name: 'subagent:delegation', order: 120, text: DELEGATION_CONTEXT });
          }
          // ④ Persona shadow (overrides deployment:persona at order 0). The
          // guidance marker is prefixed when the persona is non-empty (双防线):
          // the injected text is `${GUIDANCE_PREFIX}${persona}`, exactly the
          // length the sanitizeProfile cap validates (wrappedLength).
          if (profile.persona !== undefined && systemPrompt !== undefined) {
            systemPrompt.section({
              name: 'deployment:persona',
              order: 0,
              text: profile.persona.length > 0 ? `${GUIDANCE_PREFIX}${profile.persona}` : profile.persona,
            });
          }
          // ⑤ Reasoning-effort injection into every child request.
          if (profile.reasoningEffort !== undefined) {
            childCtx.on('agent/request', async (_payload, next) => {
              const resolved = await next();
              return { ...resolved, reasoningEffort: profile.reasoningEffort };
            });
          }
          // ⑥ Descriptor append inside the child's first turn.
          let appended = false;
          childCtx.on('agent/pre-step', async ({ agent }, next) => {
            const decision = await next();
            if (!appended && decision.kind === 'enter') {
              appended = true;
              agent.session.append('subagent/descriptor', request.descriptor);
            }
            return decision;
          });
          // ⑦ Delegation policy appends (shipped helper: sandbox/mode when the
          //    parent has an explicit override, approval/policy pinned 'never').
          appendDelegatedPolicyOverrides(childCtx.agent.session, delegated);
        }
      });
      // F3: post-publication cancellation wiring (drivePublishedRun): the
      // caller signal cancels the child and the result closure skips the
      // followup when already cancelled.
      const child = handle.agent;
      const boundary = child.session.events.length;
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
          // Decision-level log at result settlement (readResult, before return).
          ctx.logger.info('[dsh-subagent-profile] child:', JSON.stringify({ childId, preset: profile.preset ?? 'inherit', swapPreset, stopReason: settled.stopReason }));
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
    },
    async prepareContinuable() {
      return {};
    }
  });
  if (typeof disposeProvider === 'function') ctx.effect(() => disposeProvider);

  // 4. `dispatch` tool — bundle registration: the dynamic-plugin harness pair
  //    (harness.defineTool/harness.registerTool) does not exist in a bundle, so
  //    this uses the shipped ctx.tools.register + imported defineTool. The tool
  //    is registered dynamically so the settings switch can unregister it at
  //    runtime (disappearing from the model's tool list) without a restart.
  const dispatchTool = defineTool({
    name: 'dispatch',
    description: 'Dispatch a subtask to a derived subagent, optionally overriding its preset, model, provider, reasoning effort, persona, tool whitelist, token budget, or recursion depth. Foreground waits for the result; run_in_background: true starts a background job (single turn); continuable: true starts a durable subagent whose conversation stays available for later turns via the send_message tool. 前瞻：continuable 模式忽略 preset 换用与 reasoningEffort（结果以 ignored 提示）。',
    parameters: {
      profile: { type: 'string', description: 'Optional profile id from the profile registry (built-ins: swap-standard, researcher, plus any you define in the settings page); omit to inherit the parent preset and tools as-is.' },
      preset: { type: 'string', description: 'Explicit target preset override; must be a system-trust preset of this runtime.' },
      model: { type: 'string', description: 'Explicit model override for the child.' },
      provider: { type: 'string', description: 'Explicit provider override for the child.' },
      reasoningEffort: { type: 'string', description: 'Explicit reasoning-effort override injected into every child request.' },
      persona: { type: 'string', description: 'Persona text shadowing the child deployment:persona section.' },
      toolFilter: {
        type: 'object',
        // F1: DSL object parameters reject unknown keys by default, so the
        // toolFilter object must close its schema or defineTool throws at
        // apply time and the plugin fails to load.
        additionalProperties: false,
        description: 'Extra tool whitelist intersection for the child (intersected with the parent tool set).',
        properties: {
          allow: { type: 'array', items: { type: 'string' }, description: 'When present, only these tool names are kept.' },
          deny: { type: 'array', items: { type: 'string' }, description: 'These tool names are always removed.' }
        }
      },
      maxTokens: { type: 'number', description: 'Explicit max-tokens budget for the child.' },
      maxDepth: { type: 'number', description: 'Absolute delegation-depth cap for this child.' },
      run_in_background: { type: 'boolean', description: '异步 one-shot：走 jobs.start 包 start()，返回 jobId；仍单轮即弃，非 continuable' },
      continuable: { type: 'boolean', description: 'Start a durable continuable subagent instead of a one-shot: returns a subagentId immediately and keeps the child conversation available for later turns via the send_message tool. Defaults to false.' },
      // §8.2 信封模式 = opt-in（仅「中段即交付物」的任务用）。首切片**仅预留**：
      // 工具 schema 暴露此参数作字段契约，execute 当前不消费它（结构化信封回收
      // 在 V2.0-中期启用）。见 execute 内注释。
      envelope: { type: 'boolean', description: '预留：结构化信封回收（V2.0 中期启用，当前不生效）' },
      prompt: { type: 'string', required: true, description: 'The complete, self-contained task for the child (it does not see this conversation).' }
    },
    output: {
      schema: {
        // D: observability metadata on every result. OneOf covers the
        // background variant (kind/jobId) and the foreground variant (output),
        // both closed and both carrying the effective delegation values.
        // R1: `ignored` was added to ALL three branches (with the shared `preset`
        // / `provider` / `model` / `reasoningEffort` / `profile`), keeping the
        // closed oneOf consistent — assertResultSchemaConsistency(dispatchTool
        // .output.schema) in apply() fires if any 分支 忘补该字段.
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
              profile: { type: 'string' },
              preset: { type: 'string' },
              provider: { type: 'string' },
              model: { type: 'string' },
              reasoningEffort: { type: 'string' },
              ignored: { type: 'array', items: { type: 'string' } }
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
              profile: { type: 'string' },
              preset: { type: 'string' },
              provider: { type: 'string' },
              model: { type: 'string' },
              reasoningEffort: { type: 'string' },
              ignored: { type: 'array', items: { type: 'string' } }
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              output: { type: 'string', required: true },
              profile: { type: 'string' },
              preset: { type: 'string' },
              provider: { type: 'string' },
              model: { type: 'string' },
              reasoningEffort: { type: 'string' },
              ignored: { type: 'array', items: { type: 'string' } }
            }
          }
        ]
      },
      render: (_args, value) => {
        // §8.4: continuable 丢弃 preset 换用与 reasoningEffort —— 渲染行把
        // `ignored` 列表回显出来（`reasoningEffort=<值>(ignored)`，再加 ignored 项
        // 明细），让模型「看见」被丢弃项；background/foreground 无忽略项时该后缀为空。
        const ignored = value.ignored !== undefined && value.ignored.length > 0
          ? `(ignored: ${value.ignored.join(', ')})`
          : '';
        const text = value.kind === 'background'
          ? `[dispatch] background job ${value.jobId} · profile=${value.profile} · preset=${value.preset} · provider=${value.provider} · model=${value.model} · reasoningEffort=${value.reasoningEffort}${ignored}`
          : value.kind === 'continuable'
            ? `[dispatch] started subagent ${value.subagentId} · profile=${value.profile} · preset=${value.preset} · provider=${value.provider} · model=${value.model} · reasoningEffort=${value.reasoningEffort}${ignored}`
            : `[dispatch] profile=${value.profile} · preset=${value.preset} · provider=${value.provider} · model=${value.model} · reasoningEffort=${value.reasoningEffort}${ignored}\n\n${value.output}`;
        return [{ type: 'text', text }];
      }
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent) throw new Error('dispatch requires calling agent');
      // Resolve the base profile (side channel), then overlay explicit args.
      const base = args.profile !== undefined ? resolveProfile(args.profile) : {};
      const merged = { ...base };
      for (const key of ['preset', 'model', 'provider', 'reasoningEffort', 'persona', 'toolFilter', 'maxTokens', 'maxDepth']) {
        if (args[key] !== undefined) merged[key] = args[key];
      }
      // Pre-check: explicit concrete preset must be in the runtime-derived
      // whitelist (F6); a preset equal to the parent's composed preset is
      // rewritten to 'inherit' (no swap).
      if (typeof merged.preset === 'string' && merged.preset !== 'inherit') {
        const whitelist = new Set(await resolveWhitelist(parent.ctx));
        if (!whitelist.has(merged.preset)) {
          throw new Error(`dispatch: preset "${merged.preset}" is not in the target-preset whitelist`);
        }
        const parentPresets = parent.ctx.get('agentPresets');
        const parentComposed = parentPresets !== undefined ? parentPresets.composedPreset(parent.ctx) : undefined;
        if (merged.preset === parentComposed) merged.preset = 'inherit';
      }
      // F5: cost guard (runtime-derived; hard caps always applied, llm capability
      // gated by allowFailOpen — SPEC §7.3).
      await assertCostGuard(parent, merged, allowFailOpen, ctx.logger);
      // D: effective delegation values for observability.
      const meta = {
        profile: args.profile ?? '(inline)',
        preset: merged.preset ?? 'inherit',
        provider: merged.provider ?? parent.options.provider ?? '(parent)',
        model: merged.model ?? parent.options.model ?? '(parent)',
        reasoningEffort: merged.reasoningEffort ?? '(default)'
      };
      const request = {
        label: String(args.prompt ?? '').slice(0, 60),
        prompt: [{ type: 'text', text: args.prompt }],
        parent,
        signal: exec.signal,
        profile: merged,
        ...(merged.persona !== undefined ? { persona: merged.persona } : {}),
        ...(merged.toolFilter !== undefined ? { toolFilter: merged.toolFilter } : {}),
        ...(merged.maxDepth !== undefined ? { maxDepth: merged.maxDepth } : {})
      };
      // §8.2 结果回收默认剪枝：在 textFrom(result.output) 之前复用宿主
      // toolResultPruner.pruneContent 预剪。`pruneResultOutput` 每次现取
      // ctx.get('toolResultPruner') 以反映服务就绪状态；pruner 缺失时
      // pruneBlocks 回退为不剪（剪枝是增强、非硬依赖）。envelope 参数虽已在
      // 工具 schema 暴露（预留，V2.0-中期启用结构化信封回收），但 execute
      // **不消费**它——本首切片只实现「剪枝默认」，不做信封注入。
      const pruneResultOutput = (blocks) => pruneBlocks(blocks, ctx.get('toolResultPruner'));
      // Decision-level log: resolved effective delegation inputs, after the
      // cost guard and after request assembly, before dispatch.
      ctx.logger.info('[dsh-subagent-profile] dispatch:', JSON.stringify({
        profile: args.profile ?? '(inline)',
        preset: merged.preset ?? 'inherit',
        provider: merged.provider ?? parent.options.provider ?? '(parent)',
        model: merged.model ?? parent.options.model ?? '(parent)',
        reasoningEffort: merged.reasoningEffort ?? '(default)',
        maxDepth: merged.maxDepth ?? null,
        background: args.run_in_background === true,
        continuable: args.continuable === true
      }));
      // Continuable (durable) path — startContinuable publishes a persistent
      // child and returns its durable id; the official send_message tool drives
      // later turns. Treated first so a caller asking for both background and
      // continuable gets the continuable child.
      if (args.continuable === true) {
        // 安全 P0-b（SPEC §7.1 第 2 条）：provider `start` 的 !enabled 检查只拦
        // `start`，不拦 `startContinuable` —— 这里显式补上。当前 syncTool 会在
        // 禁用时注销 dispatch 工具（间接门），此处是防御性兜底：禁用后
        // dispatch(continuable:true) 必须 fail-loud，不得静默派生子树。
        if (!enabled) {
          throw new Error('dispatch: 插件已禁用（设置 → 子 Agent 方案 重新启用）');
        }
        if (args.run_in_background === true) {
          ctx.logger.warn('[dsh-subagent-profile] dispatch: both continuable and run_in_background are true; continuable takes precedence');
        }
        // 已知降级：continuable 标准路径不支持 preset swap 和 reasoningEffort（subagent 包的 SubagentStartRequest 无 preset 字段、AgentOptions 无 reasoningEffort 字段）
        if (merged.preset !== undefined && merged.preset !== 'inherit') {
          ctx.logger.warn(`[dsh-subagent-profile] continuable mode cannot swap preset; ignoring "${merged.preset}" (child inherits the parent preset)`);
        }
        if (merged.reasoningEffort !== undefined) {
          ctx.logger.warn(`[dsh-subagent-profile] continuable mode cannot set reasoningEffort; ignoring "${merged.reasoningEffort}"`);
        }
        // 安全 P0-b（SPEC §7.1 第 1 条）：预加工 toolFilter 为闭集 allow。continuable
        // 走宿主 applyChildComposition→tools.restrict，prepareContinuable 返回 {}，
        // 插件侧无法重算父∩子交集，故在此把 allow 预加工为闭集传到 request。
        //
        // 假设：continuable 继承父预设（preset swap 被忽略，见上方 warn）⇒
        // 子工具集 ≈ 父工具集，故 父集 − run_code − deny 可安全作为 restrict 的
        // allow。失效：任何导致子工具集与父工具集不一致的宿主行为变化（非仅
        // preset swap——例如未来允许 swap preset、组合不同工具集等），父集都可能
        // 含子集上不存在之工具 → tools.restrict 会抛「未知工具」→ 本缓解自动降级
        // 为 fail-loud（保守安全）——此时必须替换为真交集（父∩子）。
        const parentNames = new Set(parent.ctx.tools.schemas(parent).map((schema) => schema.name));
        const effectiveAllow = computeContinuableAllow(parentNames, merged.toolFilter);
        const hasAgentOptions = merged.provider !== undefined || merged.model !== undefined || merged.maxTokens !== undefined;
        const continuableRequest = {
          prompt: [{ type: 'text', text: args.prompt }],
          parent,
          ...(hasAgentOptions ? { agentOptions: {
            ...(merged.provider !== undefined ? { provider: merged.provider } : {}),
            ...(merged.model !== undefined ? { model: merged.model } : {}),
            ...(merged.maxTokens !== undefined ? { maxTokens: merged.maxTokens } : {})
          } } : {}),
          ...(merged.persona !== undefined ? { persona: merged.persona } : {}),
          // 恒传闭集 allow（覆盖原 merged.toolFilter 透传）；空集在
          // computeContinuableAllow 内 fail-loud。
          toolFilter: { allow: effectiveAllow },
          ...(merged.maxDepth !== undefined ? { maxDepth: merged.maxDepth } : {})
        };
        const { childId } = await ctx.subagents.startContinuable({
          provider: 'profile',
          label: String(args.prompt ?? '').slice(0, 60),
          request: continuableRequest,
          signal: exec.signal
        });
        // Continuable drops the profile's preset swap and reasoningEffort (the
        // child inherits the parent preset), so the observability meta must
        // report what actually took effect, not the requested-but-ignored values.
        // §8.4 可见性修复：`reasoningEffort` 回显**请求值**（经 meta.reasoningEffort，
        // 即 merged.reasoningEffort ?? '(default)'），`preset:'inherit'` 是真实生效值；
        // `ignored` 明确列出被丢弃项，让模型「看见」被忽略的字段。
        return {
          kind: 'continuable',
          subagentId: childId,
          profile: meta.profile,
          preset: 'inherit',
          provider: meta.provider,
          model: meta.model,
          reasoningEffort: meta.reasoningEffort,
          ignored: ['preset', 'reasoningEffort']
        };
      }
      // A: background one-shot (job) path — jobs.start wraps start() with a
      // native AbortController (a Node global in a bundle; the dynamic-plugin
      // sandbox needed the hand-rolled shim instead); still one turn, not
      // continuable.
      if (args.run_in_background === true) {
        const jobs = ctx.get('jobs');
        if (jobs === undefined) {
          throw new Error('dispatch: background jobs unavailable (load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs)');
        }
        const jobId = jobs.start({
          kind: 'subagent',
          label: String(args.prompt ?? '').slice(0, 60),
          owner: parent,
          run: () => {
            const controller = new AbortController();
            return {
              cancel: (reason) => controller.abort(reason ?? 'dispatch: background subagent task killed'),
              done: settleStart(ctx.subagents.start('profile', { ...request, signal: controller.signal }), controller.signal, meta, pruneResultOutput)
            };
          }
        });
        return { kind: 'background', jobId, ...meta };
      }
      // Foreground: collect, always release the handle (E: dispose even when
      // run.result rejects), then fail loud on a non-completed stop reason.
      const run = await ctx.subagents.start('profile', request);
      let result;
      try {
        result = await run.result;
      } finally {
        await run.dispose().catch(() => {});
      }
      // F2: a non-'completed' stop reason is a failure; attach the child's
      // partial output text (withPartialText style).
      const failure = stopReasonError(result);
      if (failure !== undefined) throw new Error(withPartialText(failure, result.output));
      return { output: textFrom(pruneResultOutput(result.output)), ...meta };
    }
  });
  // R1（共享规则）lock: the closed oneOf result schema must carry an identical
  // shared meta key set across all three branches. Fires only at apply time; a
  // future meta-field add that forgets one 分支 throws here (once), so the
  // model-side schema never silently rejects a分支.
  assertResultSchemaConsistency(dispatchTool.output.schema);
  // Register the tool only while enabled; unregister it the moment the switch
  // turns off so it disappears from the model's tool list without a restart.
  let disposeTool;
  function syncTool() {
    if (enabled && disposeTool === undefined) {
      disposeTool = ctx.tools.register(dispatchTool);
    } else if (!enabled && disposeTool !== undefined) {
      const dispose = disposeTool;
      disposeTool = undefined;
      dispose();
    }
  }
  syncTool();
  ctx.effect(() => () => {
    if (disposeTool !== undefined) {
      const dispose = disposeTool;
      disposeTool = undefined;
      dispose();
    }
  });
}
