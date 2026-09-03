// index.mjs — dsh-subagent-profile 宿主侧插件 bundle（只做装配）。宿主导入面收敛在
// lib/core/shims.mjs，装配块按模块拆分驻留 lib/core/；`enabled` 经 getter 实时读取。
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { syncBundledPresets } from './lib/core/presets-sync.mjs';
import { dshHome, createProfileStore } from './lib/core/profiles-store.mjs';
import { removeOwnedData, cleanRemovedBackups } from './lib/core/cleanup.mjs';
import { createHttpRoutes } from './lib/core/http-routes.mjs';
import { createProfileProvider } from './lib/core/profile-provider.mjs';
import { createDispatchTool } from './lib/core/dispatch-tool.mjs';
import { createDispatchGuard } from './lib/core/dispatch-guard.mjs';
import { createCatalogCache } from './lib/core/catalog-cache.mjs';
import { createFailureLedger } from './lib/core/decision-trace.mjs';
import { createEvolutionLedger } from './lib/core/evolution-ledger.mjs';
import { createAdoptionTracker } from './lib/core/adoption-tracker.mjs';
import { createReminderStore } from './lib/core/reminder-store.mjs';
import { createSnapshotStore } from './lib/core/snapshots.mjs';
import { mintReminder, mintUnadoptedReminder } from './lib/core/adoption-reminder.mjs';
import { createBackgroundLedger } from './lib/core/background-ledger.mjs';
import { createDraftsStore } from './lib/core/drafts-store.mjs';
import { assessDraftProfile } from './lib/core/draft-gates.mjs';
import { createEscapeStore, recordEscapeAllowProvider } from './lib/core/escape.mjs';
import { resolveWhitelist, FALLBACK_WHITELIST } from './lib/core/whitelist.mjs';
import { readModelSelectionPolicy, appendOfficialVisibilityLine } from './lib/core/model-policy.mjs';
import { profileSectionText } from './lib/core/profile-directory.mjs';
import { createProfilesQueryTool } from './lib/core/profiles-query.mjs';
import { budgetSectionText } from './lib/core/dispatch-gates.mjs';
import { refreshSummaries } from './lib/core/evolution-advice.mjs';
import { createEvolutionAssembly } from './lib/core/evolution-engine.mjs';

export const name = 'dsh-subagent-profile';
export const inject = ['subagents', 'tools', 'agents'];

// 自装 bundled 的 "orchestrator-v2" 预设到 agent-presets 根（与官方自安装相同）。
// 幂等：字节一致跳过、bundle 变更重写；fail-soft：写入被拒时工具与设置页照常工作。
function syncBundledPresetsToHome(ctx) {
  try {
    const presetRoot = join(dshHome(), '.agent-presets');
    const sync = syncBundledPresets(presetRoot);
    for (const { id, error } of sync.failed) ctx.logger.warn(`[dsh-subagent-profile] preset ${id} sync failed: ${error}`);
    if (sync.synced.length > 0) ctx.logger.info(`[dsh-subagent-profile] presets synced into ${presetRoot}: ${sync.synced.join(', ')}`);
    if (sync.archived.length > 0) ctx.logger.info(`[dsh-subagent-profile] legacy preset archived into ${presetRoot}: ${sync.archived.join(', ')}`);
    if (sync.userModified.length > 0) ctx.logger.warn(`[dsh-subagent-profile] presets left untouched (user-modified): ${sync.userModified.join(', ')}`);
  } catch (error) {
    ctx.logger.warn('[dsh-subagent-profile] preset sync failed:', error instanceof Error ? error.message : String(error));
  }
}

// 卸载清理与启动清理辅助驻留 lib/core/cleanup.mjs（装配文件行门）。

// 未采纳提醒 mint：判定时刻该父会话预算已耗尽（累计 >= 上限）则按预算中止
// 归因（cause=budget-limit 带数值），否则走常规未采纳文案；快照读取失败恒按常规。
function mintUnadoptedWithCause(guard, reminderStore, evoLedger, rec) {
  const snapshot = guard.snapshot(rec.parentSessionId);
  const budgetLimited = Number.isFinite(snapshot.maxParentTokens) && snapshot.maxParentTokens > 0
    && Number.isFinite(snapshot.tokens) && snapshot.tokens >= snapshot.maxParentTokens;
  return mintUnadoptedReminder(reminderStore, evoLedger, budgetLimited
    ? { ...rec, cause: 'budget-limit', tokens: snapshot.tokens, limit: snapshot.maxParentTokens }
    : rec);
}

// parent_adopted 装配：tracker 工厂 + 根 ctx 订阅 session/event（按 session.id 过滤），
// 卸载退订并清理定时器。onDecision 经 getRefreshAdvice 延迟读取（先判定后聚合时为空
// 操作）；onDecided 把「明确未采纳」转成提醒中心条目（同源审计 + 注意级提醒）。
function setupAdoptionTracker(ctx, home, getRefreshAdvice, onUnadopted) {
  const adoptionTracker = createAdoptionTracker({
    stateFile: join(home, 'subagent-evolution', 'adopted-state.json'),
    warn: (message) => ctx.logger.warn(`[dsh-subagent-profile] ${message}`),
    onDecision: () => { try { getRefreshAdvice()(); } catch { /* 聚合重算失败不影响判定（fail-soft） */ } },
    onDecided: onUnadopted,
  });
  const onSessionEvent = (session, event) => adoptionTracker.handleEvent(session, event); ctx.on('session/event', onSessionEvent);
  ctx.effect(() => () => { ctx.off('session/event', onSessionEvent); adoptionTracker.dispose(); });
  return adoptionTracker;
}

// 卸载接线：注销工具 + 清空台账 + 级联取消 + 删数据文件与预设目录。agent/disposed
// 挂钩按父释放并发/token 记账，并把该父会话未决采纳判定判「明确未采纳」。
function registerTeardown(ctx, dispatch, profilesQuery, ledger, guard, home, backgroundLedger, adoptionTracker) {
  ctx.effect(() => dispatch.dispose);
  ctx.effect(() => profilesQuery.dispose);
  ctx.effect(() => ledger.clear);
  ctx.effect(() => backgroundLedger.clear);
  ctx.effect(() => () => {
    guard.cancelAll();
    guard.reset();
    removeOwnedData(home);
  });
  const onAgentDisposed = ({ agent }) => {
    const parentSessionId = agent?.session?.header?.id;
    if (parentSessionId !== undefined && parentSessionId !== null && parentSessionId !== '') { adoptionTracker.parentDisposed(parentSessionId); guard.resetParent(parentSessionId); }
  };
  ctx.on('agent/disposed', onAgentDisposed);
  ctx.effect(() => () => ctx.off('agent/disposed', onAgentDisposed));
}

// subagent-profiles service：包在 store 的 per-apply profiles Map 之上，对外只暴露
// 枚举/扩展注册表的窄接口，不触碰内部结构。
function provideProfileService(ctx, store) {
  ctx.provide('subagent-profiles', {
    register(profile) {
      if (!profile || typeof profile.id !== 'string' || profile.id.length === 0) {
        throw new Error('subagent-profiles: profile id 必须为非空字符串');
      }
      if (store.profiles.has(profile.id)) {
        throw new Error(`subagent-profiles: profile "${profile.id}" 已注册（id 需唯一）`);
      }
      const registered = { ...profile };
      store.profiles.set(profile.id, registered);
      return () => {
        if (store.profiles.get(profile.id) === registered) store.profiles.delete(profile.id);
      };
    },
    get(id) {
      return store.profiles.get(id);
    },
    list() {
      return [...store.profiles.values()];
    },
    resolve(id) {
      return store.resolveProfile(id);
    }
  });
}

// 系统提示门控（门控拆分）：dispatch:profiles 按「能力」判据（schemas 含 dispatch 即注入）；
// orchestrator:mode / dispatch:budget 保持「模式」判据（composedPreset==='orchestrator-v2'）。禁止成对放宽共享 gate。
// evolution:advice 自本轮起模型侧恒空（下架），不挂任何注入门控——见注册处注释。
function profileSectionGate(ctx, getEnabled, context) {
  if (!getEnabled()) return false;
  // schemas(agent) 明确不含 dispatch → 必空（否决）；缺失 → 注入机会 + debug。
  if (context !== undefined && context.agent !== undefined) {
    const schemas = ctx.tools.schemas(context.agent);
    if (Array.isArray(schemas)) return schemas.some((s) => s && s.name === 'dispatch');
  }
  if (ctx.logger !== undefined && typeof ctx.logger.debug === 'function') {
    ctx.logger.debug('[dsh-subagent-profile] dispatch:profiles 门控：schemas 不可用，按注入机会处理');
  }
  return true;
}
// 编排者专属 gate：与 0.4.0 原判据一致（enabled + 否决 + composedPreset，预设名随 V2 收编更新为 orchestrator-v2）。
function orchestrationGate(ctx, getEnabled, context) {
  if (!getEnabled()) return false;
  if (context !== undefined && context.agent !== undefined) {
    const schemas = ctx.tools.schemas(context.agent);
    if (Array.isArray(schemas) && !schemas.some((s) => s && s.name === 'dispatch')) return false;
  }
  // 主判据：preset 特征 —— composedPreset(agentCtx) === 'orchestrator-v2'（精确匹配新名；旧名 orchestrator 已由 V2 收编取代，不构成注入判据）。
  const agentPresets = ctx.get('agentPresets');
  if (agentPresets !== undefined && typeof agentPresets.composedPreset === 'function') {
    const agentCtx = context !== undefined && context.agent !== undefined && context.agent.ctx !== undefined
      ? context.agent.ctx
      : ctx;
    try { return agentPresets.composedPreset(agentCtx) === 'orchestrator-v2'; }
    catch { return false; }
  }
  // 无 agentPresets → 无法判别 → 保守不注入。
  return false;
}

// orchestrator:mode section 文本（编排者模式 V2 定稿文案；与 profiles 同门控。
// 追加官方错误对照句：官方全英文报错补中文行动引导，与 dispatch 的 stopReason
// 映射共同构成错误闭环）。
const ORCHESTRATOR_MODE_TEXT = '本机已安装「编排者模式 V2」agent 预设（字段 orchestrator-v2）：新建会话可选。把自己定位为主协调者——拆解任务后用 dispatch（方案）或官方 subagent/workflow 委派子 Agent，再整合结果；第一期采用 Minimal 双工具锚定轨迹，稳定后升满编排能力。需要 1-2 步自查的小事直接自己干，别派；方案在「子 Agent 方案」设置页管理。官方子代理工具若报 “not allowed for this Session”，意为该模型不在本会话白名单——改用 list_subagent_models 查允许路由，或转用 dispatch（profile）。官方工具没出现=模型选择未启用。';

// 建议注入候选池：受信任预设白名单（解析失败回退内置名单）。不叠加逃生舱放行集。
async function resolveAdviceWhitelist(ctx) {
  try {
    return new Set(await resolveWhitelist(ctx.get('agentPresets')));
  } catch {
    return new Set(FALLBACK_WHITELIST);
  }
}

// 回滚建议提醒 mint：仅 regress 判定时触发一次（提醒写失败吞掉）；标题人话化，
// 内容引导到自进化与建议页签查看建议（只读跳转）。
async function setupEvolution(ctx, home, store, catalog, evoLedger, getEvolutionAdvice, getReminderStore) {
  const adviceWhitelist = await resolveAdviceWhitelist(ctx);
  const adviceEnv = { summariesFile: join(home, 'subagent-evolution', 'summaries.json'), dispatchFile: join(home, 'subagent-evolution', 'dispatch.jsonl'), whitelist: adviceWhitelist, logger: ctx.logger, onLoss: () => evoLedger.markMigrationLoss() };
  const mintRollbackReminder = (asset) => mintReminder(getReminderStore(), {
    severity: 'P2', kind: 'suggestion-rollback',
    title: '自进化撤销建议：' + ((asset && asset.applied_config && typeof asset.applied_config.name === 'string' && asset.applied_config.name !== '') ? asset.applied_config.name : ((asset && typeof asset.name === 'string' && asset.name !== '') ? asset.name : '未知方案')),
    detail: '该方案调整后观察期表现下降，建议撤销。可在「自进化与建议」页签查看并处理。', sessionId: null,
  });
  const { adviceSource, evolution } = createEvolutionAssembly({ ctx, home, store, catalog, evoLedger, adviceWhitelist, getEvolutionAdvice, getReminderStore: mintRollbackReminder, pluginVersion: readPluginVersion() });
  return { adviceEnv, adviceSource, evolution };
}

// 系统提示各 section：profiles 段挂 profileSectionGate（能力判据），orchestrator:mode
// 与 dispatch:budget 挂 orchestrationGate（模式判据，编排者专属）；evolution:advice
// 自本轮起模型侧恒空（下架，见注册处注释）。`enabled` 经 getter 实时读取。
function registerSystemPromptSections(ctx, store, getEnabled, getEvolutionAdvice, adviceEnv, guard) {
  const pluginSystemPrompt = ctx.get('systemPrompt');
  if (pluginSystemPrompt === undefined) return;
  const profileGate = (context) => profileSectionGate(ctx, getEnabled, context);
  const orchestratorGate = (context) => orchestrationGate(ctx, getEnabled, context);
  pluginSystemPrompt.section({
    name: 'dispatch:profiles',
    order: 116.5,
    text: (context) => appendOfficialVisibilityLine(profileSectionText(store, profileGate, context), ctx, context, ctx.logger),
  });
  // 宣告自装的 orchestrator-v2 预设（门控与 0.4.0 相同：仅编排者 agent 可见）。
  pluginSystemPrompt.section({
    name: 'orchestrator:mode',
    order: 117,
    text: (context) => (orchestratorGate(context) ? ORCHESTRATOR_MODE_TEXT : ''),
  });
  // 派发优化建议段（模型侧下架）：建议文本曾注入模型可见面却自称「仅供人类
  // 参考」——噪声 + 诱导降档，故恒不注入（text 恒 ''，不再过任何门控/开关）。
  // 注册结构保留（section 名与 order 不变，客户端依赖其存在性）；人类面板
  // （建议卡/提醒中心/审计行）经 http-routes 读取同一数据源，不受影响。勿在此恢复注入。
  pluginSystemPrompt.section({
    name: 'evolution:advice',
    order: 116.8,
    text: () => '',
  });
  // 派发预算余量段（三态文案，见 dispatch-gates.mjs）：门控 = orchestrator-v2 预设；
  // 无父 sessionId 不注入（无法关联具体会话）。
  pluginSystemPrompt.section({
    name: 'dispatch:budget',
    order: 116.7,
    text: (context) => {
      if (!orchestratorGate(context)) return '';
      const parentSessionId = context?.agent?.session?.header?.id;
      if (typeof parentSessionId !== 'string' || parentSessionId === '') return '';
      return budgetSectionText(guard.snapshot(parentSessionId));
    },
  });
}

// Client 设置 UI 的 HTTP loopback 路由（webServer.register ↔ client fetch，纯 JSON）。
// 路由本体在 lib/core/http-routes.mjs（上文已 import）；这里只注入 per-apply 依赖。
// webServer 可选——无头部署保留 dispatch 工具、只丢设置页。webServer 的激活
// （listen）是异步的，可能晚于本插件 inject 依赖解析完成，故在等它的 inject
// 子 scope 内注册（apply 时 ctx.get 会读到 undefined）。
function registerSettingsRoutes(ctx, store, getEnabled, setEnabled, syncTool, catalog, ledger, backgroundLedger, draftsStore, applyDraft, getAudit, getEvolutionAdvice, setEvolutionAdvice, getEscapeEnabled, setEscapeEnabled, escape, refreshAdvice, summariesFile, dispatchFile, adviceWhitelist, previewDraft, reminderStore, adviceSource, evolution, snapshots, recordAudit, guard) {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(createHttpRoutes({
      webServer: scope.webServer,
      store,
      getEnabled,
      setEnabled,
      syncTool,
      catalog,
      ledger,
      backgroundLedger,
      draftsStore,
      applyDraft,
      getAudit,
      getEvolutionAdvice,
      setEvolutionAdvice,
      getEscapeEnabled,
      setEscapeEnabled,
      escape,
      refreshAdvice,
      summariesFile,
      dispatchFile,
      adviceWhitelist,
      previewDraft,
      reminderStore,
      adviceSource,
      evolution,
      snapshots,
      recordAudit,
      logger: ctx.logger,
      guard,
    }), 'dsh-subagent-profile: settings routes');
  });
}

// 进程级共享 catalog 快照工厂：一处快照同时喂 /options 三路由与 dispatch 的
// cost guard（cost guard 经 parent.ctx.get('llm') 传父实例，同一 host llm 下
// 命中同一条目）。
function createSharedCatalog(ctx) {
  return createCatalogCache({
    getLlm: () => ctx.get('llm'),
    getAgentPresets: () => ctx.get('agentPresets'),
    getTools: () => ctx.tools,
    logger: ctx.logger,
  });
}

// 读本插件 package.json version 供派发台账 provenance 使用。fail-soft：读取/解析
// 失败回退 'unknown'，绝不阻断插件启动。
function readPluginVersion() {
  try {
    const pkg = createRequire(import.meta.url)('./package.json');
    return typeof pkg?.version === 'string' && pkg.version !== '' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

// 逃生舱装配：放行集 store + 开关态（state.json 持久化）+ 访问器。开关态经对象字段
// 可变（/set-escape 改写），getEscapeSet 开关关时恒空数组（零叠加、零放行审计）。
// 放行时 mint P0（紧急）提醒（高可见治理事件，与放行审计同源留痕）。
function setupEscape(ctx, store, evoLedger, home, getReminderStore) {
  const escape = createEscapeStore({ dshHome: home, logger: ctx.logger, onGovernanceFailure: () => evoLedger.markGovernanceFailure() });
  const state = { escapeEnabled: store.loadEscapeEnabled() };
  return {
    escape,
    getEscapeSet: () => (state.escapeEnabled ? escape.list() : []),
    getEscapeEnabled: () => state.escapeEnabled,
    setEscapeEnabled: (next) => { state.escapeEnabled = next; },
    recordEscapeAllowProvider: (parent, preset) => {
      recordEscapeAllowProvider(evoLedger, parent, preset);
      mintReminder(getReminderStore(), { severity: 'P0', kind: 'escape-allow', title: '逃生舱放行非官方预设', detail: '预设 "' + preset + '" 经逃生舱放行，其余安全检查仍全量生效', sessionId: parent?.session?.header?.id });
    },
  };
}

// `dispatch` 工具装配（defineTool + execute + syncTool）。须在 HTTP inject 之前
// 构造，使 createHttpRoutes 能拿 dispatch.syncTool 供 /set-enabled 注册/注销。
function createDispatch(ctx, store, catalog, ledger, guard, evoLedger, backgroundLedger, adoptionTracker, getEscapeSet, getEnabled, getEvolutionAdvice, snapshots, getReminderStore) {
  return createDispatchTool({
    register: (tool) => ctx.tools.register(tool),
    store,
    getEnabled,
    getService: (name) => ctx.get(name),
    logger: ctx.logger,
    subagents: ctx.subagents,
    catalog,
    ledger,
    guard,
    evoLedger,
    backgroundLedger,
    adoptionTracker,
    getEscapeSet,
    getEvolutionAdvice,
    snapshots,
    getReminderStore,
  });
}

// profiles_query 工具装配（apply 前抽出）：syncTool 机制自动可见、不依赖静态段；
// 与 dispatch 共用 enabled 开关（/set-enabled 一并注册/注销）。
function createProfilesQuery(ctx, store, catalog, adviceEnv, getEnabled) {
  return createProfilesQueryTool({
    register: (tool) => ctx.tools.register(tool),
    store,
    catalog,
    summariesFile: adviceEnv.summariesFile,
    onLoss: adviceEnv.onLoss,
    logger: ctx.logger,
    getEnabled,
  });
}

// auto-profile 落库：三道安全检查评估（draft-gates）→ 任一 fail 即 throw → 落库 + 审计。
async function applyDraftProfile({ ctx, store, catalog, getEscapeSet, evoLedger, draft }) {
  const { ok, checks, clean } = await assessDraftProfile({ ctx, store, catalog, getEscapeSet, draft });
  if (!ok) {
    const failed = checks.find((c) => c.verdict === 'fail');
    throw new Error(failed !== undefined && typeof failed.reason === 'string' ? failed.reason : 'draft 未通过安全检查');
  }
  store.saveProfile({ ...clean, persisted: true });
  const persisted = store.persistProfiles();
  evoLedger.recordGovernanceAudit({ kind: 'draft-apply', profileId: clean.id, source: typeof draft.source === 'string' ? draft.source : 'human' });
  return { id: clean.id, persisted: persisted.persisted };
}

export async function apply(ctx) {
  const home = dshHome(); cleanRemovedBackups(home); // 上个生命周期留下的 .removed-* 备份残留。
  // reminderStore 变量提前声明：evoLedger.onAlert 与 escape mint 钩子延迟读取。
  let reminderStore;
  // 派发台账 + 审计分级须在 store 之前构造：store 的治理审计钩子指向其 markGovernanceFailure。
  const evoLedger = createEvolutionLedger({ dshHome: home, pluginVersion: readPluginVersion(), warn: (message) => ctx.logger.warn(`[dsh-subagent-profile] ${message}`), onAlert: (lost) => mintReminder(reminderStore, { severity: 'P0', kind: 'audit-degraded', title: '审计降级', detail: '治理审计丢失 ' + lost + ' 条，健康状态已降级——请检查磁盘', sessionId: null }) });
  const store = createProfileStore({ dshHome: home, logger: ctx.logger, onGovernanceFailure: () => evoLedger.markGovernanceFailure() });
  const escapeCtl = setupEscape(ctx, store, evoLedger, home, () => reminderStore);
  let enabled = store.loadEnabled();
  let evolutionAdvice = store.loadEvolutionAdvice();
  store.loadProfiles();
  syncBundledPresetsToHome(ctx);
  const catalog = createSharedCatalog(ctx);
  const ledger = createFailureLedger({ warn: (message) => ctx.logger.warn(`[dsh-subagent-profile] ${message}`), stateFile: join(home, 'subagent-profiles.failed-traces.json') });
  const guard = createDispatchGuard({ ...store.loadDispatchBudget(), warn: (message) => ctx.logger.warn(`[dsh-subagent-profile] ${message}`) });
  const backgroundLedger = createBackgroundLedger({ warn: (message) => ctx.logger.warn(`[dsh-subagent-profile] ${message}`) });
  const draftsStore = createDraftsStore({ dshHome: home, onGovernanceFailure: () => evoLedger.markGovernanceFailure() });
  reminderStore = createReminderStore({ dshHome: home, audit: (entry) => evoLedger.recordGovernanceAudit(entry), warn: (message) => ctx.logger.warn(`[dsh-subagent-profile] ${message}`) });
  // 配置快照域：开关关恒跳过（store.loadSnapshotEnabled 默认关）；写审计与治理失败同源。
  const snapshots = createSnapshotStore({ dshHome: home, logger: ctx.logger, getEnabled: () => store.loadSnapshotEnabled(), recordAudit: (entry) => evoLedger.recordGovernanceAudit(entry), onGovernanceFailure: () => evoLedger.markGovernanceFailure() });
  let refreshAdvice = () => {}; const adoptionTracker = setupAdoptionTracker(ctx, home, () => refreshAdvice, (rec) => mintUnadoptedWithCause(guard, reminderStore, evoLedger, rec));
  const dispatch = createDispatch(ctx, store, catalog, ledger, guard, evoLedger, backgroundLedger, adoptionTracker, escapeCtl.getEscapeSet, () => enabled, () => evolutionAdvice, snapshots, () => reminderStore);
  provideProfileService(ctx, store);
  const { adviceEnv, adviceSource, evolution } = await setupEvolution(ctx, home, store, catalog, evoLedger, () => evolutionAdvice, () => reminderStore);
  const profilesQuery = createProfilesQuery(ctx, store, catalog, adviceEnv, () => enabled);
  const syncTools = () => { dispatch.syncTool(); profilesQuery.syncTool(); };
  // 生产聚合触发点（T1 修复）：/options/refresh 与 /list 的惰性重算。
  refreshAdvice = () => refreshSummaries({ dispatchFile: adviceEnv.dispatchFile, summariesFile: adviceEnv.summariesFile, logger: ctx.logger, opts: { parentAdoptedConfirmedFalse: adoptionTracker.confirmedFalseCounts() } });
  registerSystemPromptSections(ctx, store, () => enabled, () => evolutionAdvice, adviceEnv, guard);
  const disposeProvider = createProfileProvider({ subagents: ctx.subagents, store, getEnabled: () => enabled, logger: ctx.logger, catalog, getEscapeSet: escapeCtl.getEscapeSet, recordEscapeAllowProvider: escapeCtl.recordEscapeAllowProvider, readModelSelectionPolicy, evoLedger });
  if (typeof disposeProvider === 'function') ctx.effect(() => disposeProvider);
  const applyDraft = (draft) => applyDraftProfile({ ctx, store, catalog, getEscapeSet: escapeCtl.getEscapeSet, evoLedger, draft });
  // /draft/preview：只读安全检查预览（不落库）。body 为 {config, name, description, source}。
  const previewDraft = (body) => assessDraftProfile({
    ctx,
    store,
    catalog,
    getEscapeSet: escapeCtl.getEscapeSet,
    draft: {
      config: body !== null && typeof body === 'object' && typeof body.config === 'object' && body.config !== null ? body.config : {},
      name: body !== null && typeof body === 'object' && typeof body.name === 'string' ? body.name : '',
      description: body !== null && typeof body === 'object' && typeof body.description === 'string' ? body.description : '',
      source: body !== null && typeof body === 'object' && typeof body.source === 'string' ? body.source : 'human',
    },
  });
  registerSettingsRoutes(ctx, store, () => enabled, (next) => { enabled = next; }, syncTools, catalog, ledger, backgroundLedger, draftsStore, applyDraft, () => evoLedger.auditState(), () => evolutionAdvice, (next) => { evolutionAdvice = next; }, escapeCtl.getEscapeEnabled, escapeCtl.setEscapeEnabled, escapeCtl.escape, refreshAdvice, join(home, 'subagent-evolution', 'summaries.json'), adviceEnv.dispatchFile, adviceEnv.whitelist, previewDraft, reminderStore, adviceSource, evolution, snapshots, (entry) => evoLedger.recordGovernanceAudit(entry), guard);
  registerTeardown(ctx, dispatch, profilesQuery, ledger, guard, home, backgroundLedger, adoptionTracker);
}
