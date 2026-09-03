// test/percall-spec.test.mjs — per-call 规范化清单（零行为变更断言）。
// 覆盖：
//   * ① per-call 覆盖优先于 profile：profile 设 model='m1'、per-call 设 model='m2'
//     → 前台 execute 结果与决策轨迹的 effective.model 均为 'm2'。
//   * ② 未知字段拒绝：DISPATCH_PARAMETERS 键集恰为白名单 16 键（10 配置 + 2 模式 +
//     profile/tokenTier/envelope/prompt + 双名键 reasoning_effort），toolFilter
//     schema 闭合（additionalProperties:false，无未知键接受路径）。
//   * ③ continuable 下 per-call reasoningEffort 忽略但回显请求值：结果
//     meta.reasoningEffort 回显请求档，ignored 含 reasoningEffort。
//   * ④ 字段双名（官方名 reasoning_effort ↔ 旧名 reasoningEffort）：同值等效、
//     同送两义 fail-loud、旧名弃用标注、requested 对外显示官方名。
//   * ⑤ 文案分工与错误闭环（dispatch 描述 / model 参数描述 grep 断言）。
//   * ⑥ strategy：7 键闭合对象与 auto 字符串、展开等价、顶层优先、auto 解析链
//     三态、策略内双名归一、与既有闸联动、来源标记 strategy/auto。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPATCH_PARAMETERS, DISPATCH_PARAMETER_KEYS, normalizeReasoningEffort, expandStrategy } from '../lib/core/dispatch-schema.mjs';
import { requestedOf, effectiveModelSourceOf } from '../lib/core/decision-trace.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';

const mod = await import('../index.mjs');

// 白名单键集 = 10 配置（preset/model/provider/reasoningEffort/persona/toolFilter/
// maxTokens/maxDepth + tokenTier 预算档 + strategy 策略对象）+ 2 模式
// （run_in_background/continuable）+ profile（容器选择）/ envelope（模式）/
// prompt（任务文本）+ 双名键 reasoning_effort（官方名，与 reasoningEffort 等效；
// 归一化见 normalizeReasoningEffort）。键集断言以未列出的任一键都必须被拒绝的
// 闭合口径为准。
const WHITELIST_KEYS = [
  'profile', 'preset', 'model', 'provider', 'reasoningEffort', 'reasoning_effort', 'tokenTier',
  'persona', 'toolFilter', 'maxTokens', 'maxDepth', 'strategy',
  'run_in_background', 'continuable', 'envelope', 'prompt',
];

// 提供能力面可核验的 llm：m1/m2 均在目录中，resolveCallConfig 接受任意档位。
function makeLlm() {
  return {
    listProviders: async () => [{ id: 'p1' }],
    listModels: async () => [{ id: 'm1' }, { id: 'm2' }],
    resolveModelInfo: async () => ({}),
    resolveCallConfig: async () => ({}),
  };
}

function makeForegroundParent() {
  const llm = makeLlm();
  return {
    ctx: {
      get: (name) => (name === 'llm' ? llm : undefined),
      tools: { schemas: () => [{ name: 'read' }, { name: 'write' }] },
    },
    options: {},
  };
}

// ---- ① per-call 覆盖优先于 profile ----------------------------------------------

test('per-call 优先：profile model=m1，per-call model=m2 → effective.model 为 m2', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const subagentsStart = async () => {
      // per-call 优先级断言只看 execute 返回的 meta/轨迹，不依赖子请求。
      return { result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }, dispose: async () => {} };
    };
    const { ctx, records } = createFakeCtx({ subagentsStart });
    await mod.apply(ctx);
    const service = records.provides.find((p) => p.name === 'subagent-profiles')?.service;
    service.register({ id: 'ptest', name: 'PT', description: '带 model 的测试 profile', model: 'm1' });
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute(
      { prompt: 'task', profile: 'ptest', model: 'm2' },
      { agent: makeForegroundParent(), signal: undefined }
    );
    assert.equal(out.model, 'm2', '前台结果 meta.model 必须为 per-call 覆盖值');
    assert.equal(out.decisionTrace.effective.model, 'm2', '决策轨迹 effective.model 必须为 per-call 覆盖值');
    assert.equal(out.decisionTrace.requested.model, 'm2', '请求参数快照 model 必须为 per-call 值');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ② 未知字段拒绝：白名单键集闭合 + toolFilter 闭合 ---------------------------

test('参数 schema：键集恰为白名单 16 键（含双名键 reasoning_effort，无未知字段接受路径）', () => {
  const keys = Object.keys(DISPATCH_PARAMETERS);
  assert.deepEqual([...keys].sort(), [...WHITELIST_KEYS].sort(), '键集必须与白名单齐全');
  assert.equal(keys.length, WHITELIST_KEYS.length, '不得多出白名单外的字段');
  assert.equal(keys.length, 16, '键集必须恰为 16 键（15 + 双名键 reasoning_effort）');
  assert.ok(DISPATCH_PARAMETER_KEYS.includes('reasoning_effort'), '官方名必须进 DISPATCH_PARAMETER_KEYS（单一事实来源）');
  for (const key of keys) {
    assert.ok(WHITELIST_KEYS.includes(key), `字段 ${key} 必须在白名单内`);
  }
});

test('参数 schema：toolFilter 闭合（additionalProperties:false，无未知键接受路径）', () => {
  const filter = DISPATCH_PARAMETERS.toolFilter;
  assert.equal(filter.type, 'object');
  assert.equal(filter.additionalProperties, false, 'toolFilter 必须闭合，任何未知子键都被 schema 拒绝');
  assert.ok(filter.properties.allow, 'allow 子字段必须声明');
  assert.ok(filter.properties.deny, 'deny 子字段必须声明');
});

// ---- ③ continuable 下 per-call reasoningEffort 忽略但回显 ------------------------

test('continuable：per-call reasoningEffort 被忽略但结果回显请求值，ignored 含 reasoningEffort', async () => {
  const iso = makeIsolatedDshHome();
  try {
    let captured;
    const startContinuable = async (opts) => { captured = opts; return { childId: 'child-effort' }; };
    const { ctx, records } = createFakeCtx({ startContinuable });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute(
      { prompt: 'task', continuable: true, reasoningEffort: 'high' },
      { agent: makeForegroundParent(), signal: undefined } // agentOptions 不含 effort
    );
    assert.equal(out.kind, 'continuable');
    assert.equal(out.reasoningEffort, 'high', '结果 meta.reasoningEffort 必须回显请求值');
    assert.deepEqual(out.ignored, ['preset', 'reasoningEffort'], 'ignored 必须列出被丢弃的 reasoningEffort');
    assert.equal(out.decisionTrace.effective.reasoningEffort, 'high', '轨迹 effective.reasoningEffort 回显请求值');
    assert.ok(out.decisionTrace.effective.ignored.includes('reasoningEffort'), '轨迹 effective.ignored 必须含 reasoningEffort');
    assert.equal(captured.request.agentOptions, undefined, 'continuable request 不得携带 agentOptions（effort 被忽略）');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ④ 字段双名：官方名 reasoning_effort ↔ 旧名 reasoningEffort ----------------

test('双名归一：只传 reasoning_effort → 归一为 reasoningEffort；只传旧名原样返回', () => {
  const normalized = normalizeReasoningEffort({ prompt: 't', reasoning_effort: 'high' });
  assert.equal(normalized.reasoningEffort, 'high', '官方名必须归一为内部旧名');
  assert.equal(normalized.reasoning_effort, undefined, '归一后不再携带官方名');
  const same = normalizeReasoningEffort({ prompt: 't', reasoningEffort: 'high' });
  assert.equal(same.reasoningEffort, 'high', '只传旧名原样返回');
  assert.equal(same.reasoning_effort, undefined);
  const neither = normalizeReasoningEffort({ prompt: 't' });
  assert.equal(neither.reasoningEffort, undefined);
});

test('双名同送 fail-loud：reasoning_effort 与 reasoningEffort 同送即歧义，execute 路径拒绝', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    await assert.rejects(
      () => tool.execute(
        { prompt: 'task', reasoning_effort: 'high', reasoningEffort: 'low' },
        { agent: makeForegroundParent(), signal: undefined }
      ),
      /reasoning_effort 与 reasoningEffort 不得同送/,
      '同送两义必须 fail-loud，不得静默二选一'
    );
  } finally { iso.restore(); iso.teardown(); }
});

test('双名等效：reasoning_effort 与 reasoningEffort 同值同行为（生效值/轨迹/子请求一致）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    let captured;
    const subagentsStart = async (_provider, request) => {
      captured = request;
      return { result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }, dispose: async () => {} };
    };
    const { ctx, records } = createFakeCtx({ subagentsStart });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const snake = await tool.execute({ prompt: 'task', reasoning_effort: 'off' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(snake.reasoningEffort, 'off', '官方名值必须成为生效 reasoningEffort');
    assert.equal(captured.profile.reasoningEffort, 'off', '归一后子请求带 reasoningEffort');
    assert.equal(snake.decisionTrace.effective.reasoningEffort, 'off', '轨迹 effective 归一');
    assert.equal(snake.decisionTrace.requested.reasoningEffort, 'off', '内部记录键保持');
    assert.equal(snake.decisionTrace.requested.reasoning_effort, 'off', 'requested 对外显示官方名');
    assert.equal(snake.decisionTrace.requested.unknown_keys, undefined, '官方名不得误报未知键');
    const camel = await tool.execute({ prompt: 'task', reasoningEffort: 'off' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(camel.reasoningEffort, 'off');
    assert.equal(camel.decisionTrace.requested.reasoning_effort, 'off', '旧名请求同样对外显示官方名');
    assert.deepEqual(snake.decisionTrace.effective, camel.decisionTrace.effective, '双名同值 → 生效轨迹一致');
  } finally { iso.restore(); iso.teardown(); }
});

test('旧名弃用标注：reasoningEffort description 标弃用别名，reasoning_effort 声明官方名', () => {
  const legacy = DISPATCH_PARAMETERS.reasoningEffort;
  const official = DISPATCH_PARAMETERS.reasoning_effort;
  assert.equal(legacy.type, 'string');
  assert.match(legacy.description, /弃用别名，请用 reasoning_effort/, '旧名必须标弃用并指向官方名');
  assert.equal(official.type, 'string');
  assert.match(official.description, /与官方 subagent 工具字段同名/, '官方名必须声明与官方工具字段同名');
  assert.match(official.description, /同送（两义即歧义）时 fail-loud 拒绝/, '同送拒绝语义必须写入官方名描述');
});

// ---- ⑤ 文案分工与错误闭环（grep 断言）---------------------------------------

test('文案：dispatch 描述含分工句 / stopReason 动作映射 / continuable 失败回报', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    assert.match(tool.description, /细粒度路由\/授权发现请用官方 subagent 工具 \+ list_subagent_models/, '分工句必须指向官方 subagent + list_subagent_models');
    assert.match(tool.description, /dispatch 只管方案（profile）及方案内覆盖/, '分工句必须写明 dispatch 只管方案');
    assert.match(tool.description, /max-tokens→用 profiles_query 降档或 profile 加 maxTokens/, 'stopReason=max-tokens 动作映射');
    assert.match(tool.description, /error→换 profile\/preset/, 'stopReason=error 动作映射');
    assert.match(tool.description, /refusal→重述任务/, 'stopReason=refusal 动作映射');
    assert.match(tool.description, /连续失败→告知用户/, '连续失败动作映射');
    assert.match(tool.description, /失败经结算通知回报；超时可 send_message 追问/, 'continuable 失败回报说明');
  } finally { iso.restore(); iso.teardown(); }
});

test('文案：schema model 描述补官方模型选择白名单句（与 B2 现状一致）', () => {
  assert.match(
    DISPATCH_PARAMETERS.model.description,
    /派发已遵循官方模型选择白名单（本会话启用时；未启用则继承父模型）/,
    'model 参数描述必须与 B2 官方白名单联动一致'
  );
  assert.match(
    DISPATCH_PARAMETERS.continuable.description,
    /失败经结算通知回报；超时可 send_message 追问/,
    'continuable 参数描述必须补失败回报说明'
  );
});

// ---- ⑥ 未知字段 fail-visible（F5）----------------------------------------------

test('F5：requestedOf 把未知 per-call 字段记入 unknown_keys（键集以 DISPATCH_PARAMETERS 为准）', () => {
  const requested = requestedOf({ prompt: 'p', model: 'm1', bogus: 1, toolFilter: { allow: ['read'] } });
  assert.deepEqual(requested.unknown_keys, ['bogus'], '未知字段必须记录到决策轨迹');
  assert.equal(requested.model, 'm1', '已知字段不受影响');
  const clean = requestedOf({ prompt: 'p' });
  assert.equal(clean.unknown_keys, undefined, '无未知字段时不写该键');
  // 已知键集合与 DISPATCH_PARAMETERS 同源（单一事实来源），防止两处键集漂移。
  const withModes = requestedOf({ prompt: 'p', run_in_background: true, continuable: false });
  assert.equal(withModes.unknown_keys, undefined, '模式字段不得误报为未知');
});

test('F5：execute 层未知字段进入 decisionTrace.requested.unknown_keys（不静默吞）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ subagentsStart });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute(
      { prompt: 'task', model: 'm1', bogus: true, anotherUnknown: 'x' },
      { agent: makeForegroundParent(), signal: undefined }
    );
    assert.deepEqual(out.decisionTrace.requested.unknown_keys, ['bogus', 'anotherUnknown'], '未知字段必须记录到决策轨迹');
    assert.equal(out.decisionTrace.requested.model, 'm1', '已知字段不受影响');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ⑥ strategy：schema 闭合 / 展开等价 / auto 解析链 -----------------------------

test('strategy schema：auto 字符串或 7 键闭合对象，未知键被 additionalProperties:false 拒绝', () => {
  const strategy = DISPATCH_PARAMETERS.strategy;
  assert.equal(strategy.oneOf.length, 2, 'strategy 必须为 auto 字符串或对象二选一');
  const autoBranch = strategy.oneOf.find((b) => b.type === 'string');
  assert.deepEqual(autoBranch.enum, ['auto']);
  const objBranch = strategy.oneOf.find((b) => b.type === 'object');
  assert.equal(objBranch.additionalProperties, false, 'strategy 对象必须闭合，任何未知子键都被 schema 拒绝');
  assert.deepEqual(
    [...Object.keys(objBranch.properties)].sort(),
    ['maxDepth', 'maxTokens', 'model', 'preset', 'provider', 'reasoning_effort', 'reasoningEffort', 'tokenTier'].sort(),
    'strategy 对象键集恰为 7 策略字段（reasoning_effort 双名）'
  );
  assert.match(strategy.description, /方案 → 父级 → provider 默认/, 'strategy 描述必须写解析链');
  assert.match(strategy.description, /顶层显式字段优先/, 'strategy 描述必须写顶层优先');
});

test('strategy 对象：未知键 fail-loud；非 auto/对象形态 fail-loud', () => {
  assert.throws(
    () => expandStrategy({ prompt: 't', strategy: { bogus: 1 } }, {}),
    /strategy 含未知字段 "bogus"（仅接受 preset\/provider\/model\/reasoning_effort\/reasoningEffort\/tokenTier\/maxTokens\/maxDepth）/,
    '未知键必须 fail-loud'
  );
  assert.throws(() => expandStrategy({ prompt: 't', strategy: 42 }, {}), /只接受字符串 "auto" 或 7 策略字段对象/);
});

test('strategy 展开等价：strategy:{model} 与顶层 model 同结果同轨迹，来源标记 strategy', async () => {
  const iso = makeIsolatedDshHome();
  try {
    let captured;
    const subagentsStart = async (_provider, request) => {
      captured = request;
      return { result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }, dispose: async () => {} };
    };
    const { ctx, records } = createFakeCtx({ subagentsStart });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const grouped = await tool.execute({ prompt: 'task', strategy: { model: 'm1' } }, { agent: makeForegroundParent(), signal: undefined });
    const flat = await tool.execute({ prompt: 'task', model: 'm1' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(grouped.model, 'm1', '分组形态与顶层直传等价');
    assert.equal(grouped.decisionTrace.effective.model, flat.decisionTrace.effective.model, '生效轨迹一致');
    assert.equal(grouped.decisionTrace.requested.model, undefined, 'requested 快照保留原始请求（model 在 strategy 内）');
    assert.deepEqual(grouped.decisionTrace.requested.strategy, { model: 'm1' }, 'requested 保留 strategy 原始值');
    assert.equal(grouped.decisionTrace.requested.source, 'strategy', '来源标记 strategy');
    assert.equal(flat.decisionTrace.requested.source, 'call', '顶层直传仍标记 call');
    assert.equal(captured.profile.model, 'm1', '子请求配置携带展开后的 model');
  } finally { iso.restore(); iso.teardown(); }
});

test('strategy 顶层优先：同送时顶层胜出不报错，来源标记 call', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ subagentsStart });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute(
      { prompt: 'task', strategy: { model: 'm1', maxTokens: 8000 }, model: 'm2' },
      { agent: makeForegroundParent(), signal: undefined }
    );
    assert.equal(out.model, 'm2', '顶层显式字段优先于 strategy');
    assert.equal(out.decisionTrace.requested.source, 'call', '顶层显式指定模型 → call');
    assert.deepEqual(out.decisionTrace.requested.strategy, { model: 'm1', maxTokens: 8000 }, 'strategy 原值保留在 requested');
  } finally { iso.restore(); iso.teardown(); }
});

test('strategy auto 三态：方案有值取方案 / 无值取父 / 双无只记录 default', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ subagentsStart });
    await mod.apply(ctx);
    const service = records.provides.find((p) => p.name === 'subagent-profiles')?.service;
    service.register({ id: 'auto-p', name: 'Auto', description: 'auto 解析链测试', model: 'm1', tokenTier: 'cheap' });
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const byProfile = await tool.execute(
      { prompt: 'task', strategy: 'auto', profile: 'auto-p' },
      { agent: makeForegroundParent(), signal: undefined }
    );
    assert.equal(byProfile.model, 'm1', '方案已配置 → 取方案值');
    assert.equal(byProfile.decisionTrace.requested.strategy_resolution.model, 'profile', '解析链记录 profile');
    assert.equal(byProfile.decisionTrace.requested.strategy_resolution.tokenTier, 'profile');
    assert.equal(byProfile.decisionTrace.requested.source, 'auto', '来源标记 auto');
    const byParent = await tool.execute(
      { prompt: 'task', strategy: 'auto' },
      { agent: { ...makeForegroundParent(), options: { provider: 'p1', model: 'm1' } }, signal: undefined }
    );
    assert.equal(byParent.model, 'm1', '方案未配置 → 继承父会话当前值');
    assert.equal(byParent.decisionTrace.requested.strategy_resolution.model, 'parent', '解析链记录 parent');
    const byDefault = await tool.execute(
      { prompt: 'task', strategy: 'auto' },
      { agent: makeForegroundParent(), signal: undefined }
    );
    assert.equal(byDefault.decisionTrace.requested.strategy_resolution.model, 'default', '双无 → 只记录 default 不产生覆盖');
    assert.equal(byDefault.decisionTrace.requested.strategy_resolution.maxTokens, 'default');
  } finally { iso.restore(); iso.teardown(); }
});

test('strategy 内双名：只送官方名归一为 camel；同送两义 fail-loud；顶层 snake 优先', () => {
  const normalized = expandStrategy({ prompt: 't', strategy: { reasoning_effort: 'off' } }, {});
  assert.equal(normalized.args.reasoningEffort, 'off', 'strategy 内官方名归一为 camel');
  assert.equal(normalized.args.reasoning_effort, undefined);
  assert.throws(
    () => expandStrategy({ prompt: 't', strategy: { reasoning_effort: 'high', reasoningEffort: 'low' } }, {}),
    /strategy 内 reasoning_effort 与 reasoningEffort 不得同送（两义即歧义，请二选一）/,
    'strategy 内双名同送必须 fail-loud'
  );
  const topWins = expandStrategy({ prompt: 't', reasoning_effort: 'high', strategy: { reasoningEffort: 'low' } }, {});
  assert.equal(topWins.args.reasoning_effort, 'high', '顶层官方名优先');
  assert.equal(topWins.args.reasoningEffort, undefined, 'strategy 内值不覆盖顶层双名');
});

test('strategy 与既有闸联动：strategy.model 出官方模型白名单仍 fail-loud', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const projections = { stateOf: (_session, key) => (key === 'subagentModelSelectionPolicy' ? [{ provider: 'p1', model: 'm1' }] : undefined) };
    const parent = { ctx: { get: (name) => (name === 'llm' ? makeLlm() : name === 'sessionProjections' ? projections : undefined), tools: { schemas: () => [{ name: 'read' }] } }, options: {}, session: { header: { id: 's-st' } } };
    await assert.rejects(
      () => tool.execute({ prompt: 'task', strategy: { provider: 'p2', model: 'm2' } }, { agent: parent, signal: undefined }),
      /模型 p2\/m2 不在本会话允许的子代理模型白名单内/,
      'strategy 展开后的 model 必须走既有官方模型闸'
    );
  } finally { iso.restore(); iso.teardown(); }
});

test('effectiveModelSourceOf：strategy/auto 来源标记与顶层优先', () => {
  assert.equal(effectiveModelSourceOf({ strategy: 'auto' }, {}, { options: {} }), 'auto');
  assert.equal(effectiveModelSourceOf({ strategy: { model: 'm1' } }, {}, { options: {} }), 'strategy');
  assert.equal(effectiveModelSourceOf({ strategy: { maxTokens: 8000 } }, {}, { options: {} }), 'default', '不含模型字段的 strategy 不决定路由');
  assert.equal(effectiveModelSourceOf({ strategy: { model: 'm1' }, model: 'm2' }, {}, { options: {} }), 'call', '顶层显式字段优先于 strategy');
  assert.equal(effectiveModelSourceOf({ strategy: 'auto', provider: 'p1' }, {}, { options: {} }), 'call', '顶层显式字段优先于 auto');
});
