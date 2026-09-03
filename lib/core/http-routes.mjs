// lib/core/http-routes.mjs — Client UI 设置 HTTP loopback 路由。/options 目录由共享
// catalog 缓存（catalog-cache.mjs）提供；注入全是显式参数——store、getEnabled/setEnabled、
// syncTool、catalog、logger；写路由各抽为模块级处理函数，工厂返回 scope.effect 设置函数。

import { sanitizeProfile } from './pure.mjs';
import { BUILTIN_SEEDS, assertProfileDescription } from './profiles-store.mjs';
import { detectVersions } from './shims.mjs';
import { readSummaries } from './evolution-advice.mjs';
import { profileStatsFromSummaries } from './profile-directory.mjs';
import { costSummaryFromSummaries } from './cost-evidence.mjs';
import { json, readBody, persistOk } from './http-helpers.mjs';
import { handleEvolutionAssets, handleEvolutionApply, handleEvolutionRollback, handleEvolutionRegenerate, handleAdviceSaveProfile, handleSettingsCandidate } from './evolution-routes.mjs';
import { handleBudgetRoute } from './budget-routes.mjs';
import { createDataMaintenance, routeDataMaintenance } from './data-maintenance.mjs';

// 只有 loopback 接口可以驱动设置 HTTP 路由。
const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// CSRF 三件套：loopback 只挡「非本机」；这三件挡「跨域表单/脚本冒充本机提交」。
// IPv6 字面量带方括号形态，两种形态都列入避免误拒。
const LOOPBACK_ORIGIN_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const CSRF_HEADER = 'X-DSH-Plugin';
const CSRF_HEADER_KEY = CSRF_HEADER.toLowerCase();
const CSRF_HEADER_VALUE = 'dsh-subagent-profile';

function listClean(store, stats) {
  const map = stats instanceof Map ? stats : new Map();
  return [...store.profiles.values()].map((profile) => {
    const clean = {};
    for (const [key, value] of Object.entries(profile)) if (value !== undefined && key !== 'persisted') clean[key] = value;
    // 对外暴露 UI 面向的 "modified" 信号（内置方案被改过）。
    if (profile.builtin === true && profile.persisted === true) clean.modified = true;
    // 方案卡成本预览数据（有数据才带；N 必显作置信度信号）。
    const stat = map.get(profile.id);
    if (stat !== undefined) {
      if (stat.avgCost !== null && stat.avgCost !== undefined) clean.avgCost = stat.avgCost;
      if (stat.successRate !== null && stat.successRate !== undefined) clean.successRate = stat.successRate;
      if (stat.n !== undefined) clean.n = stat.n;
    }
    return clean;
  });
}

async function handleList(deps, res) {
  let stats = new Map();
  let costSummary = { global: null, byModel: [] };
  let advice = [];
  let adviceGlobal = null;
  let evolutionCandidates = [];
  let adviceDetails = {};
  try {
    if (typeof deps.refreshAdvice === 'function') deps.refreshAdvice();
    const summaries = typeof deps.summariesFile === 'string' ? readSummaries(deps.summariesFile, deps.logger) : null;
    stats = profileStatsFromSummaries(deps.store, summaries);
    costSummary = costSummaryFromSummaries(summaries);
    if (deps.adviceWhitelist !== undefined && typeof deps.dispatchFile === 'string' && typeof deps.adviceSource === 'function') {
      // 建议 + 候选生成统一走装配层 helper（computeAdvice 之后推导候选资产），
      // 避免 /list 与其它消费点重复生成；候选随建议链开关同生共死。
      const result = await deps.adviceSource();
      advice = result.advice ?? [];
      adviceGlobal = result.global ?? null;
      evolutionCandidates = Array.isArray(result.candidates) ? result.candidates : [];
      adviceDetails = result.adviceDetails !== null && typeof result.adviceDetails === 'object' ? result.adviceDetails : {};
    }
  } catch { /* 统计/建议是增量展示；失败不影响 /list 主响应 */ }
  // 冷启动状态（apply/防退化可用性 + 原因清单）：只读暴露，UI 展示归建议面板。
  const evolutionStatus = typeof deps.evolution?.evolutionStatus === 'function' ? deps.evolution.evolutionStatus() : null;
  return json(res, 200, { ok: true, profiles: listClean(deps.store, stats), costSummary, advice, adviceGlobal, evolutionCandidates, adviceDetails, evolutionStatus });
}

// 轻量摘要：enabled/advice 开关/模型目录/预设名册/审计分级。
async function handleSummary(deps, res) {
  const snapshot = await deps.catalog.getSnapshot();
  return json(res, 200, {
    ok: true,
    enabled: deps.getEnabled(), evolutionAdvice: deps.getEvolutionAdvice(),
    models: snapshot.models,
    presets: snapshot.presets,
    audit: deps.getAudit(),
    escapeEnabled: deps.getEscapeEnabled(), escapePresets: deps.escape.list(),
    candidateMode: deps.store.loadCandidateMode(),
    candidateTtlH: deps.store.loadCandidateTtlH(),
  });
}

// 每模型 reasoning-effort 等级（懒加载；model 命中快照的 efforts 表）。
async function handleEfforts(deps, url, res) {
  const model = url.searchParams.get('model');
  const snapshot = await deps.catalog.getSnapshot();
  const efforts = (typeof model === 'string' && model !== '' && snapshot.efforts[model] !== undefined) ? snapshot.efforts[model] : [];
  return json(res, 200, { ok: true, efforts });
}

// 完整工具目录（面板打开时取）。
async function handleTools(deps, res) {
  const snapshot = await deps.catalog.getSnapshot();
  return json(res, 200, { ok: true, tools: snapshot.tools });
}

// 版本探测：三包 version + 越界/未知的中文 warnings（纯探测，同步）。
function handleVersions(res) {
  const { versions, warnings, pluginVersion } = detectVersions();
  return json(res, 200, { ok: true, versions, warnings, pluginVersion });
}

async function handleRefresh(deps, res) {
  deps.catalog.invalidate();
  if (typeof deps.refreshAdvice === 'function') deps.refreshAdvice();
  return json(res, 200, { ok: true, refreshed: true });
}

// 提醒系统：提醒与审计同源（host reminder store），全动作留痕。
async function handleRemindersList(deps, res) {
  const store = deps.reminderStore;
  return json(res, 200, { ok: true, reminders: store !== undefined ? store.list() : [], unread: store !== undefined ? store.unreadCount() : 0 });
}

async function handleRemindersAck(deps, req, res) {
  const body = await readBody(req);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
  const acked = deps.reminderStore !== undefined ? deps.reminderStore.ack(ids) : [];
  return json(res, 200, { ok: true, acked });
}

async function handleReminderAction(deps, req, res) {
  const body = await readBody(req);
  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  const done = deps.reminderStore !== undefined ? deps.reminderStore.actOn(id, action) : false;
  if (!done) return json(res, 400, { ok: false, error: 'subagent-profiles: 提醒 id 或动作无效' });
  return json(res, 200, { ok: true, id, action });
}

async function handleLedgerFailures(deps, url, res) {
  const session = url.searchParams.get('session') ?? '';
  return json(res, 200, { ok: true, failures: deps.ledger.get(session) });
}

async function handleLedgerJobs(deps, url, res) {
  const session = url.searchParams.get('session') ?? '';
  const jobs = deps.backgroundLedger !== undefined ? deps.backgroundLedger.get(session) : [];
  return json(res, 200, { ok: true, jobs });
}

async function handleDraftsList(deps, res) {
  return json(res, 200, { ok: true, drafts: deps.draftsStore.list() });
}

async function handleDraftAdd(deps, req, res) {
  const body = await readBody(req);
  const config = body && typeof body.config === 'object' && body.config !== null ? body.config : {};
  if (typeof config.id !== 'string' || config.id === '') return json(res, 400, { ok: false, error: 'draft config.id 必须为非空字符串' });
  const draft = {
    id: 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    source: typeof body.source === 'string' && body.source !== '' ? body.source : 'human',
    config,
    name: typeof body.name === 'string' && body.name !== '' ? body.name : config.id,
    description: typeof body.description === 'string' ? body.description : '',
    createdAt: Date.now(),
  };
  const persist = deps.draftsStore.add(draft);
  return persistOk(res, { draft }, persist);
}

async function handleDraftApply(deps, req, res) {
  const body = await readBody(req);
  const id = body && typeof body.id === 'string' ? body.id : '';
  if (id === '') return json(res, 400, { ok: false, error: 'draft id 不能为空' });
  const draft = deps.draftsStore.get(id);
  if (draft === undefined) return json(res, 404, { ok: false, error: 'draft 不存在（可能已被应用或删除）' });
  const next = { ...draft };
  if (typeof body.name === 'string' && body.name !== '') next.name = body.name;
  if (typeof body.description === 'string') next.description = body.description;
  const applied = await deps.applyDraft(next);
  deps.draftsStore.remove(id);
  return persistOk(res, applied, { persisted: applied.persisted !== false });
}

async function handleDraftRemove(deps, req, res) {
  const body = await readBody(req);
  const id = body && typeof body.id === 'string' ? body.id : '';
  if (id === '') return json(res, 400, { ok: false, error: 'draft id 不能为空' });
  const result = deps.draftsStore.remove(id);
  return persistOk(res, { id }, result);
}

async function handleSetEnabled(deps, req, res) {
  const body = await readBody(req);
  const next = !!(body && body.enabled === true);
  deps.setEnabled(next);
  const persist = deps.store.persistEnabled(next);
  deps.syncTool();
  return persistOk(res, { enabled: deps.getEnabled() }, persist);
}

// 派发优化建议注入开关（默认关，只提示不改派发行为）。
async function handleSetEvolutionAdvice(deps, req, res) {
  const body = await readBody(req);
  const next = !!(body && body.advice === true);
  deps.setEvolutionAdvice(next);
  const persist = deps.store.persistEvolutionAdvice(next);
  return persistOk(res, { evolutionAdvice: deps.getEvolutionAdvice() }, persist);
}

// 逃生舱开关（默认关）：只放行「放行集内且三道闸全过」的非 system 预设。
async function handleSetEscape(deps, req, res) {
  const body = await readBody(req);
  const next = !!(body && body.enabled === true);
  deps.setEscapeEnabled(next);
  const persist = deps.store.persistEscapeEnabled(next);
  return persistOk(res, { escapeEnabled: deps.getEscapeEnabled() }, persist);
}

// 放行集写路径校验：preset id 非字符串/缺失归一空串（调用方 400 拒绝）。
function escapePresetId(body) {
  const raw = body && typeof body === 'object' && typeof body.preset === 'string' ? body.preset : '';
  return raw.trim();
}

async function handleEscapeAdd(deps, req, res) {
  const body = await readBody(req);
  const preset = escapePresetId(body);
  if (preset === '') return json(res, 400, { ok: false, error: 'subagent-profiles: escape preset 必须为非空字符串' });
  const snapshot = await deps.catalog.getSnapshot();
  if (snapshot.presets.some((p) => p && p.id === preset)) {
    return json(res, 400, { ok: false, error: `subagent-profiles: preset "${preset}" 已是 system-trust，无需加入逃生舱` });
  }
  const persist = deps.escape.add(preset);
  return persistOk(res, { preset, presets: deps.escape.list() }, persist);
}

async function handleEscapeRemove(deps, req, res) {
  const body = await readBody(req);
  const preset = escapePresetId(body);
  if (preset === '') return json(res, 400, { ok: false, error: 'subagent-profiles: escape preset 必须为非空字符串' });
  const persist = deps.escape.remove(preset);
  return persistOk(res, { preset, presets: deps.escape.list() }, persist);
}

async function handleAdd(deps, req, res) {
  const body = await readBody(req);
  const profile = body && typeof body === 'object' ? body : {};
  if (typeof profile.id !== 'string' || profile.id.length === 0) {
    return json(res, 400, { ok: false, error: 'subagent-profiles: profile id 必须为非空字符串' });
  }
  // 写路径 strict=true：超限/非法字段 400 拒绝（与 loadProfiles 宽松读取区分）。
  const { clean, warnings } = sanitizeProfile(profile, { strict: true });
  if (warnings.length > 0) {
    const detail = warnings.map((w) => `${w.field}：${w.reason}`).join('；');
    return json(res, 400, { ok: false, error: `写入被拒绝：${detail}` });
  }
  // description 落库契约（仅当请求显式携带 description 键：新建/编辑严格，未传
  // 保留存量值不校验——存量宽容）。
  if (Object.hasOwn(profile, 'description')) {
    try { assertProfileDescription(profile.description); }
    catch (error) { return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  const hadToolFilter = profile.toolFilter !== undefined;
  // tokenTier 单独用 raw-body 守卫（sanitize 恒回填 balanced，进 merge 会破坏
  // 「未传→保留 existing」语义）；strict 下非法值已在上面 400 拒绝。
  const hadTokenTier = profile.tokenTier !== undefined;
  const existing = deps.store.profiles.get(clean.id);
  const seed = BUILTIN_SEEDS.find((s) => s.id === clean.id);
  const isBuiltin = (existing !== undefined && existing.builtin === true) || seed !== undefined;
  // 合并而非替换：表单未带字段（内置 persona/preset 等）编辑后仍保留。
  const merged = { ...(existing ?? seed ?? {}) };
  merged.id = clean.id;
  for (const key of ['name', 'description', 'preset', 'provider', 'model', 'reasoningEffort', 'persona', 'enabled']) {
    if (clean[key] === undefined) continue;       // 未传：保留 existing 原值
    if (clean[key] === '' || clean[key] === null) { delete merged[key]; continue; }  // 空：清除字段
    merged[key] = clean[key];
  }
  // toolFilter：空数组 = 清除；未传保留 existing；传了但归一为空则清除。
  if (hadToolFilter) {
    const tf = clean.toolFilter;
    if (tf !== undefined && ((Array.isArray(tf.allow) && tf.allow.length > 0) || (Array.isArray(tf.deny) && tf.deny.length > 0))) {
      merged.toolFilter = { ...(Array.isArray(tf.allow) && tf.allow.length > 0 ? { allow: tf.allow } : {}), ...(Array.isArray(tf.deny) && tf.deny.length > 0 ? { deny: tf.deny } : {}) };
    } else {
      delete merged.toolFilter;
    }
  }
  if (hadTokenTier) merged.tokenTier = clean.tokenTier;
  if (merged.enabled !== undefined) merged.enabled = merged.enabled === false ? false : true;
  deps.store.saveProfile({ ...merged, ...(isBuiltin ? { builtin: true } : {}), persisted: true });
  deps.store.deletedBuiltins.delete(merged.id);
  return persistOk(res, { id: merged.id }, deps.store.persistProfiles());
}

async function handleRemove(deps, req, res) {
  const body = await readBody(req);
  const id = body && typeof body === 'object' && typeof body.id === 'string' ? body.id : '';
  const existing = deps.store.profiles.get(id);
  if (existing === undefined) {
    return json(res, 404, { ok: false, error: `subagent-profiles: profile "${id}" 不存在（可在设置页确认可用的 profile id）` });
  }
  deps.store.profiles.delete(id);
  if (existing.builtin === true) deps.store.deletedBuiltins.add(id);
  return persistOk(res, { id }, deps.store.persistProfiles());
}

async function handleReset(deps, req, res) {
  const body = await readBody(req);
  const id = body && typeof body === 'object' && typeof body.id === 'string' ? body.id : '';
  const seed = BUILTIN_SEEDS.find((s) => s.id === id);
  if (seed === undefined) {
    return json(res, 404, { ok: false, error: `subagent-profiles: profile "${id}" 不是内置方案（无可重置项）` });
  }
  deps.store.profiles.set(id, { ...seed });
  deps.store.deletedBuiltins.delete(id);
  return persistOk(res, { id }, deps.store.persistProfiles());
}

async function handleResetAll(deps, res) {
  for (const seed of BUILTIN_SEEDS) {
    deps.store.profiles.set(seed.id, { ...seed });
    deps.store.deletedBuiltins.delete(seed.id);
  }
  return persistOk(res, { count: BUILTIN_SEEDS.length }, deps.store.persistProfiles());
}

async function handleSetProfileEnabled(deps, req, res) {
  const body = await readBody(req);
  const id = body && typeof body === 'object' && typeof body.id === 'string' ? body.id : '';
  const existing = deps.store.profiles.get(id);
  if (existing === undefined) {
    return json(res, 404, { ok: false, error: `subagent-profiles: profile "${id}" 不存在（可在设置页确认可用的 profile id）` });
  }
  existing.enabled = body && body.enabled === false ? false : true;
  // 无条件持久化：运行时注册的 profile 启用/禁用也须重启后保留。
  existing.persisted = true;
  return persistOk(res, { id, enabled: existing.enabled }, deps.store.persistProfiles());
}

// CSRF 传输授权：Origin 白名单 + Content-Type + 自定义头；reason 进 403 与 warn
// 日志，GET 只读不设防。
function csrfViolation(req) {
  const headers = req.headers ?? {};
  const origin = typeof headers.origin === 'string' ? headers.origin : '';
  const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : '';
  // 1. Origin 白名单：只放行本机源；无 Origin 的本地脚本靠第 3 道兜底。
  if (origin !== '') {
    let host;
    try { host = new URL(origin).hostname; } catch { host = null; }
    if (host === null || !LOOPBACK_ORIGIN_HOSTS.has(host)) {
      return { reason: `Origin 不在本机白名单（收到：${origin}）`, origin, contentType };
    }
  }
  // 2. 强制 Content-Type: application/json（text/plain、表单编码等一律拒绝）。
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { reason: `写请求必须带 Content-Type: application/json（收到：${contentType || '缺失'}）`, origin, contentType };
  }
  // 3. 自定义头逼 preflight：跨域表单/脚本无法携带非简单头，缺头即拒。
  if (headers[CSRF_HEADER_KEY] !== CSRF_HEADER_VALUE) {
    return { reason: `写请求必须带 ${CSRF_HEADER}: ${CSRF_HEADER_VALUE} 请求头`, origin, contentType };
  }
  return null;
}

// 路由分发链（从 createHttpRoutes 抽出守行门）：纯 if 链分发，每条路由一行；
// 未知路由 404 兜底。CSRF 与 loopback 守卫在 createHttpRoutes 入口完成。
async function routeRequest(deps, req, res, url, sub) {
  if (req.method === 'GET' && (sub === '/' || sub === '/list')) return handleList(deps, res);
  if (req.method === 'GET' && sub === '/options/summary') return handleSummary(deps, res);
  if (req.method === 'GET' && sub === '/options/versions') return handleVersions(res);
  if (req.method === 'GET' && sub === '/options/efforts') return handleEfforts(deps, url, res);
  if (req.method === 'GET' && sub === '/options/tools') return handleTools(deps, res);
  if ((req.method === 'GET' && sub === '/options/budget') || (req.method === 'POST' && sub === '/set-budget')) return handleBudgetRoute(deps, req, res);
  if (req.method === 'GET' && sub === '/ledger/failures') return handleLedgerFailures(deps, url, res);
  if (req.method === 'GET' && sub === '/ledger/jobs') return handleLedgerJobs(deps, url, res);
  if (req.method === 'GET' && sub === '/reminders') return handleRemindersList(deps, res);
  if (req.method === 'POST' && sub === '/reminders/ack') return handleRemindersAck(deps, req, res);
  if (req.method === 'POST' && sub === '/reminders/action') return handleReminderAction(deps, req, res);
  if (req.method === 'GET' && sub === '/drafts') return handleDraftsList(deps, res);
  if (req.method === 'POST' && sub === '/draft') return handleDraftAdd(deps, req, res);
  if (req.method === 'POST' && sub === '/draft/apply') return handleDraftApply(deps, req, res);
  if (req.method === 'POST' && sub === '/draft/remove') return handleDraftRemove(deps, req, res);
  if (req.method === 'POST' && sub === '/draft/preview') { const body = await readBody(req); return json(res, 200, { ok: true, ...(await deps.previewDraft(body)) }); }
  if (req.method === 'GET' && sub === '/evolution/assets') return handleEvolutionAssets(deps, res);
  if (req.method === 'POST' && sub === '/evolution/apply') return handleEvolutionApply(deps, req, res);
  if (req.method === 'POST' && sub === '/evolution/rollback') return handleEvolutionRollback(deps, req, res);
  if (req.method === 'POST' && sub === '/evolution/regenerate') return handleEvolutionRegenerate(deps, req, res);
  if (req.method === 'POST' && sub === '/advice/save-profile') return handleAdviceSaveProfile(deps, req, res);
  if (req.method === 'POST' && sub === '/settings/candidate') return handleSettingsCandidate(deps, req, res);
  if (req.method === 'POST' && sub === '/options/refresh') return handleRefresh(deps, res);
  if ((req.method === 'GET' && (sub === '/snapshots' || sub === '/snapshot' || sub === '/reminders/archived')) || (req.method === 'POST' && (sub === '/snapshots/set-enabled' || sub === '/maintenance/clean'))) return routeDataMaintenance(deps, req, res, url, sub);
  if (req.method === 'POST' && sub === '/set-enabled') return handleSetEnabled(deps, req, res);
  if (req.method === 'POST' && sub === '/set-evolution-advice') return handleSetEvolutionAdvice(deps, req, res);
  if (req.method === 'POST' && sub === '/set-escape') return handleSetEscape(deps, req, res);
  if (req.method === 'POST' && sub === '/escape-add') return handleEscapeAdd(deps, req, res);
  if (req.method === 'POST' && sub === '/escape-remove') return handleEscapeRemove(deps, req, res);
  if (req.method === 'POST' && sub === '/add') return handleAdd(deps, req, res);
  if (req.method === 'POST' && sub === '/remove') return handleRemove(deps, req, res);
  if (req.method === 'POST' && sub === '/reset') return handleReset(deps, req, res);
  if (req.method === 'POST' && sub === '/reset-all') return handleResetAll(deps, res);
  if (req.method === 'POST' && sub === '/set-profile-enabled') return handleSetProfileEnabled(deps, req, res);
  json(res, 404, { ok: false, error: `未知路由 ${sub}` });
}

export function createHttpRoutes({ webServer, store, getEnabled, setEnabled, syncTool, catalog, ledger, backgroundLedger, draftsStore, applyDraft, getAudit, getEvolutionAdvice, setEvolutionAdvice, getEscapeEnabled, setEscapeEnabled, escape, refreshAdvice, summariesFile, dispatchFile, adviceWhitelist, previewDraft, reminderStore, adviceSource, evolution, logger, snapshots, recordAudit, guard }) {
  const deps = { store, getEnabled, setEnabled, syncTool, catalog, ledger, backgroundLedger, draftsStore, applyDraft, getAudit, getEvolutionAdvice, setEvolutionAdvice, getEscapeEnabled, setEscapeEnabled, escape, refreshAdvice, summariesFile, dispatchFile, adviceWhitelist, previewDraft, reminderStore, adviceSource, evolution, logger, snapshots, recordAudit, guard };
  // 数据维护域装配（快照清理/候选清理/提醒归档/统计重置 + 快照管理路由依赖）。
  deps.maintenance = createDataMaintenance({ dispatchFile, summariesFile, snapshots, reminderStore, evolution, logger, store, recordAudit });
  const handler = async (req, res) => {
    const remote = req.socket?.remoteAddress;
    if (!LOOPBACKS.has(remote)) return json(res, 403, { ok: false, error: '仅限本机访问' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sub = (url.pathname.replace(/^\/subagent-profiles/, '') || '/').replace(/\/+$/, '') || '/';
    try {
      // 写路由统一做 CSRF 传输授权（loopback 之后、路由分发之前）；GET 只读不设防。
      if (req.method === 'POST') {
        const violation = csrfViolation(req);
        if (violation !== null) {
          deps.logger.warn(
            `[dsh-subagent-profile] CSRF 防护拒绝：${violation.reason}` +
            `（origin=${violation.origin || '无'}，contentType=${violation.contentType || '无'}）`
          );
          return json(res, 403, { ok: false, error: `CSRF 防护拒绝：${violation.reason}` });
        }
      }
      // 显式 await：async 路由的拒绝必须落入下方 catch（未 await 时 reject 会绕过
      // catch 直接传播给 webServer，fail-loud 变成未捕获拒绝）。
      return await routeRequest(deps, req, res, url, sub);
    } catch (error) {
      // 通用 500 不回显内部错误信息（防泄漏），详情只进宿主日志。
      deps.logger.error('[dsh-subagent-profile] settings route error:', error instanceof Error ? (error.stack ?? error.message) : String(error));
      json(res, 500, { ok: false, error: '内部错误，详情见宿主日志' });
    }
  };
  return () => {
    const disposeRoutes = webServer.register({ kind: 'prefix', path: '/subagent-profiles', handler });
    return () => disposeRoutes();
  };
}
