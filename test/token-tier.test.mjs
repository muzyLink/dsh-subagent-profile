// test/token-tier.test.mjs — tokenTier 成本分层 + childTotalTokens 成本证据链。
// 覆盖：
//   * sanitizeProfile 的 tokenTier 白名单 / 缺省 balanced / 非法剔除 + warn。
//   * TIER_ORDER / tierSortKey 纯函数与 dispatch:profiles 目录行序
//     （cheap→balanced→premium，缺省按 balanced）。
//   * childTotalTokens：mock tokenMeter 时前台（execute）/后台（settleStart）
//     completed 结算写入 meta 且仅 completed 测量；tokenMeter 缺失省略字段
//     （fail-soft，估算口径非计费）。
//   * R1 三分支 output schema 同步携带 childTotalTokens + tokenTier。
//   * 档位映射表 / 能力收敛 / 互锁四象限 / 派生注入标记 / continuable 派生分支。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeProfile,
  TIER_ORDER,
  tierSortKey,
  assertResultSchemaConsistency,
} from '../lib/core/pure.mjs';
import { settleStart } from '../lib/core/delegation.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';
import { TIER_DEFAULTS, deriveTierConfig, tierLockVerdictOf } from '../lib/core/tier-map.mjs';
import { applyTierLockGate } from '../lib/core/dispatch-gates.mjs';

const mod = await import('../index.mjs');

// ---- sanitizeProfile：tokenTier 白名单 / 缺省 / 非法剔除 ----------------------

test('sanitizeProfile: tokenTier 白名单（cheap/balanced/premium 透传）', () => {
  for (const tier of ['cheap', 'balanced', 'premium']) {
    const { clean, warnings } = sanitizeProfile({ id: 'x', tokenTier: tier });
    assert.equal(clean.tokenTier, tier);
    assert.equal(warnings.length, 0);
  }
});

test('sanitizeProfile: tokenTier 缺省 → balanced', () => {
  const { clean, warnings } = sanitizeProfile({ id: 'x' });
  assert.equal(clean.tokenTier, 'balanced');
  assert.equal(warnings.length, 0);
});

test('sanitizeProfile: tokenTier 非法值 → 剔除 + warn（不回填缺省）', () => {
  const { clean, warnings } = sanitizeProfile({ id: 'x', tokenTier: 'expensive' });
  assert.equal(clean.tokenTier, undefined, '非法值必须剔除，而非回填 balanced');
  assert.ok(warnings.some((w) => w.field === 'tokenTier' && /cheap\/balanced\/premium/.test(w.reason)));
});

// ---- TIER_ORDER / tierSortKey --------------------------------------------------

test('TIER_ORDER / tierSortKey: cheap→balanced→premium 权重，未知 tier 按 balanced', () => {
  assert.deepEqual(TIER_ORDER, { cheap: 0, balanced: 1, premium: 2 });
  assert.equal(tierSortKey('cheap'), 0);
  assert.equal(tierSortKey('balanced'), 1);
  assert.equal(tierSortKey('premium'), 2);
  assert.equal(tierSortKey('unknown'), 1);
  assert.equal(tierSortKey(undefined), 1);
});

// ---- dispatch:profiles 目录行序 -------------------------------------------------

test('dispatch:profiles 目录行按 tier cheap→balanced→premium 排序', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ services: { agentPresets: { composedPreset: () => 'orchestrator-v2' } } });
    await mod.apply(ctx);
    // 注册一个 premium profile 覆盖三分档排序（register 不经 sanitize，原样入 store）。
    const service = records.provides.find((p) => p.name === 'subagent-profiles')?.service;
    service.register({ id: 'premium-x', name: 'Premium', description: '高成本', tokenTier: 'premium' });
    const profiles = records.sectionCalls.find((s) => s.name === 'dispatch:profiles');
    const text = profiles.text({ agent: {} });
    const idxCheap = text.indexOf('researcher:');
    const idxBalanced = text.indexOf('swap-standard:');
    const idxPremium = text.indexOf('premium-x:');
    assert.ok(idxCheap >= 0 && idxBalanced >= 0 && idxPremium >= 0, '三分档 profile 都应在目录中');
    assert.ok(idxCheap < idxBalanced, 'cheap 应在 balanced 之前');
    assert.ok(idxBalanced < idxPremium, 'balanced 应在 premium 之前');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- childTotalTokens：前台结算测量 ---------------------------------------------

function makeForegroundParent() {
  return { ctx: { get: () => undefined }, options: {} };
}

test('foreground completed + tokenMeter → meta.childTotalTokens 来自 measure', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const measureCalls = [];
    const meter = {
      measure(session) {
        measureCalls.push(session);
        return { totalTokens: 1534 };
      },
    };
    const childSession = { id: 'child-session' };
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
      localAgent: { session: childSession },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ services: { tokenMeter: meter }, subagentsStart });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute({ prompt: 'task' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(out.childTotalTokens, 1534);
    assert.equal(measureCalls.length, 1, 'completed 必须测量一次');
    assert.equal(measureCalls[0], childSession, 'measure 必须收到子 session');
    assert.equal(out.tokenTier, 'balanced', '缺省 tokenTier=balanced');
  } finally { iso.restore(); iso.teardown(); }
});

test('foreground 非 completed → 不测量（无 childTotalTokens）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const measureCalls = [];
    const meter = { measure() { measureCalls.push(1); return { totalTokens: 99 }; } };
    const subagentsStart = async () => ({
      result: { stopReason: 'max-tokens', output: [{ type: 'text', text: 'partial' }] },
      localAgent: { session: { id: 'child-session' } },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ services: { tokenMeter: meter }, subagentsStart });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    await assert.rejects(
      () => tool.execute({ prompt: 'task' }, { agent: makeForegroundParent(), signal: undefined }),
      /token limit/
    );
    assert.equal(measureCalls.length, 0, '非 completed 不得测量');
  } finally { iso.restore(); iso.teardown(); }
});

test('foreground completed + tokenMeter 缺失 → 省略 childTotalTokens（fail-soft）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
      localAgent: { session: { id: 'child-session' } },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ subagentsStart }); // services 无 tokenMeter
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute({ prompt: 'task' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(out.childTotalTokens, undefined, 'tokenMeter 缺失必须省略字段');
    assert.equal(out.tokenTier, 'balanced');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- childTotalTokens：后台结算（settleStart）测量 -------------------------------

test('settleStart completed + measure → 结果含 childTotalTokens（后台路径）', async () => {
  const measureCalls = [];
  const measure = (session) => { measureCalls.push(session); return 777; };
  const childSession = { id: 'bg-session' };
  const start = async () => ({
    result: { stopReason: 'completed', output: [{ type: 'text', text: 'done' }] },
    localAgent: { session: childSession },
    dispose: async () => {},
  });
  const out = await settleStart(start(), { aborted: false }, { profile: 'x' }, (blocks) => blocks, measure);
  assert.equal(out.status, 'completed');
  assert.equal(out.childTotalTokens, 777);
  assert.equal(measureCalls.length, 1);
  assert.equal(measureCalls[0], childSession);
});

test('settleStart 非 completed → 不测量（后台路径）', async () => {
  const measureCalls = [];
  const measure = () => { measureCalls.push(1); return 99; };
  const start = async () => ({
    result: { stopReason: 'aborted', output: [{ type: 'text', text: 'partial' }] },
    localAgent: { session: { id: 'bg-session' } },
    dispose: async () => {},
  });
  const out = await settleStart(start(), { aborted: false }, { profile: 'x' }, (blocks) => blocks, measure);
  assert.equal(out.status, 'killed');
  assert.equal(out.childTotalTokens, undefined);
  assert.equal(measureCalls.length, 0);
});

// ---- 参数 schema + R1 三分支 schema + render 行 ---------------------------------

test('dispatch 参数 schema：tokenTier 为 enum（cheap/balanced/premium）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const p = tool.parameters.properties.tokenTier;
    assert.equal(p.type, 'string');
    assert.deepEqual(p.enum, ['cheap', 'balanced', 'premium']);
  } finally { iso.restore(); iso.teardown(); }
});

test('R1 schema：三分支同步携带 childTotalTokens + tokenTier', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    assert.doesNotThrow(() => assertResultSchemaConsistency(tool.output.schema));
    for (const branch of tool.output.schema.oneOf) {
      assert.equal(branch.properties.childTotalTokens.type, 'number', '每分支必须有 childTotalTokens(number)');
      assert.equal(branch.properties.tokenTier.type, 'string', '每分支必须有 tokenTier(string)');
      assert.deepEqual(branch.properties.tokenTier.enum, ['cheap', 'balanced', 'premium']);
    }
  } finally { iso.restore(); iso.teardown(); }
});

test('render 行：包含 tokenTier 与 childTotalTokens（供 client 解析回显）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const value = {
      kind: 'foreground',
      output: 'x',
      profile: 'p',
      preset: 'inherit',
      provider: 'pr',
      model: 'm',
      reasoningEffort: 'off',
      tokenTier: 'cheap',
      childTotalTokens: 42,
      ignored: [],
    };
    const [block] = tool.output.render({}, value);
    assert.match(block.text, /tokenTier=cheap/);
    assert.match(block.text, /childTotalTokens=42/);
  } finally { iso.restore(); iso.teardown(); }
});

// ---- 档位映射表 / 能力收敛 / 互锁 ------------------------------------------------

test('tier-map：TIER_DEFAULTS 三档默认表（effort + maxTokens）', () => {
  assert.deepEqual(TIER_DEFAULTS.cheap, { reasoningEffort: 'off', maxTokens: 8000 });
  assert.deepEqual(TIER_DEFAULTS.balanced, { reasoningEffort: 'high', maxTokens: 16000 });
  assert.deepEqual(TIER_DEFAULTS.premium, { reasoningEffort: 'max', maxTokens: 32000 });
});

test('deriveTierConfig：efforts 能力收敛（官方档位序 off<low<high<max）', () => {
  assert.deepEqual(deriveTierConfig('cheap', ['off', 'max']), { reasoningEffort: 'off', maxTokens: 8000 }, 'cheap 默认 off 受支持 → off');
  assert.deepEqual(deriveTierConfig('balanced', ['off', 'max']), { reasoningEffort: 'max', maxTokens: 16000 }, '目标 high 不支持 → 取不低于目标档的最近档 max');
  assert.deepEqual(deriveTierConfig('premium', ['off', 'max']), { reasoningEffort: 'max', maxTokens: 32000 });
  assert.deepEqual(deriveTierConfig('cheap', ['low', 'high']), { reasoningEffort: 'low', maxTokens: 8000 }, '目标 off 不支持 → 不低于的最近档 low');
  assert.deepEqual(deriveTierConfig('premium', ['low', 'high']), { reasoningEffort: 'high', maxTokens: 32000 }, '全部低于目标 max → 取最高可用档 high');
  assert.deepEqual(deriveTierConfig('cheap', [{ id: 'off' }, { id: 'max' }]), { reasoningEffort: 'off', maxTokens: 8000 }, 'catalog 快照对象形状同样收敛');
  assert.deepEqual(deriveTierConfig('cheap'), { reasoningEffort: 'off', maxTokens: 8000 }, '无 efforts 数据回退表值不判支持性');
  assert.deepEqual(deriveTierConfig('unknown'), { reasoningEffort: 'high', maxTokens: 16000 }, '未知档位按 balanced 表值');
});

test('tier-lock 四象限：一致放行 / 更省放行 / 冲突 fail / 显式 maxTokens 超档位默认 fail', () => {
  const pass = (merged) => { const v = tierLockVerdictOf(merged); assert.equal(v.check, true); assert.equal(v.allowed, true); };
  const fail = (merged, field) => {
    const v = tierLockVerdictOf(merged);
    assert.equal(v.check, true);
    assert.equal(v.allowed, false);
    assert.ok(v.conflicts.some((c) => c.field === field), `冲突字段必须为 ${field}`);
  };
  pass({ tokenTier: 'cheap', reasoningEffort: 'off' }); // 一致放行
  pass({ tokenTier: 'cheap', reasoningEffort: 'low' }); // 档位容量内放行
  pass({ tokenTier: 'balanced', reasoningEffort: 'high' });
  pass({ tokenTier: 'balanced', reasoningEffort: 'low' }); // 更省放行
  pass({ tokenTier: 'premium', reasoningEffort: 'max' });
  pass({ tokenTier: 'premium', reasoningEffort: 'low' }); // 显式降档放行
  pass({ tokenTier: 'premium', reasoningEffort: 'off' });
  fail({ tokenTier: 'cheap', reasoningEffort: 'high' }, 'reasoningEffort');
  fail({ tokenTier: 'cheap', reasoningEffort: 'max' }, 'reasoningEffort');
  fail({ tokenTier: 'balanced', reasoningEffort: 'max' }, 'reasoningEffort');
  fail({ tokenTier: 'cheap', reasoningEffort: 'medium' }, 'reasoningEffort'); // 未知档按最高档保守判
  pass({ tokenTier: 'cheap', maxTokens: 8000 }); // maxTokens 一致放行
  pass({ tokenTier: 'cheap', maxTokens: 4000 }); // maxTokens 更省放行
  pass({ tokenTier: 'premium', maxTokens: 32000 });
  fail({ tokenTier: 'cheap', maxTokens: 8001 }, 'maxTokens');
  fail({ tokenTier: 'premium', maxTokens: 40000 }, 'maxTokens');
  assert.deepEqual(tierLockVerdictOf({}), { check: false }, '无档位不互锁');
  assert.deepEqual(tierLockVerdictOf({ tokenTier: 'unknown' }), { check: false }, '非法档位不互锁');
});

test('applyTierLockGate：fail 前记 fail 闸并抛三层中文错误；pass 记 pass 闸；无档位不记', () => {
  const deps = { logger: { warn: () => {} } };
  const failTrace = { gates: [] };
  assert.throws(
    () => applyTierLockGate(failTrace, { tokenTier: 'cheap', reasoningEffort: 'high' }, {}, deps),
    (err) => {
      assert.match(err.message, /档位 cheap 与显式推理档 high 冲突/, '第一层：冲突事实');
      assert.match(err.message, /档位是成本\/深度承诺，显式值与之矛盾/, '第二层：语义');
      assert.match(err.message, /请改档位或改显式推理档/, '第三层：行动');
      return true;
    }
  );
  assert.equal(failTrace.gates.length, 1, 'fail 前先记闸条目');
  assert.equal(failTrace.gates[0].name, 'tier-lock');
  assert.equal(failTrace.gates[0].verdict, 'fail');
  assert.equal(failTrace.gates[0].output.allowed, false);
  assert.equal(failTrace.gates[0].input.tokenTier, 'cheap');
  const tokenFailTrace = { gates: [] };
  assert.throws(
    () => applyTierLockGate(tokenFailTrace, { tokenTier: 'cheap', maxTokens: 9000 }, {}, deps),
    /档位 cheap 的 token 预算承诺为 8000，显式 maxTokens=9000 超出承诺/,
    'maxTokens 冲突必须给档位预算承诺文案'
  );
  assert.equal(tokenFailTrace.gates[0].verdict, 'fail');
  const passTrace = { gates: [] };
  applyTierLockGate(passTrace, { tokenTier: 'premium', reasoningEffort: 'low' }, {}, deps);
  assert.equal(passTrace.gates[0].name, 'tier-lock');
  assert.equal(passTrace.gates[0].verdict, 'pass');
  const noTierTrace = { gates: [] };
  applyTierLockGate(noTierTrace, { reasoningEffort: 'max' }, {}, deps);
  assert.equal(noTierTrace.gates.length, 0, '无档位整体跳过，不记闸条目');
});

// ---- 派生注入（execute 层） ------------------------------------------------------

// 提供能力面可核验的 llm：目录含 p1/m1、m2，resolveCallConfig 接受任意档位。
function makeTierLlm() {
  return {
    listProviders: async () => [{ id: 'p1' }],
    listModels: async () => [{ id: 'm1' }, { id: 'm2' }],
    resolveModelInfo: async () => ({}),
    resolveCallConfig: async () => ({}),
  };
}

test('execute 档位派生：无显式 effort/maxTokens 时按档位注入子请求配置并记 derived 标记', async () => {
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
    const out = await tool.execute(
      { prompt: 'task', tokenTier: 'cheap' },
      { agent: makeForegroundParent(), signal: undefined }
    );
    assert.equal(captured.profile.reasoningEffort, 'off', '派生 effort 注入发往子请求的配置');
    assert.equal(captured.profile.maxTokens, 8000, '派生 maxTokens 注入发往子请求的配置');
    assert.equal(out.reasoningEffort, 'off', '生效元数据回显派生 effort');
    assert.equal(out.decisionTrace.effective.reasoningEffortDerived, true, 'effort 派生标记');
    assert.equal(out.decisionTrace.effective.maxTokensDerived, true, 'maxTokens 派生标记');
    assert.ok(out.decisionTrace.gates.some((g) => g.name === 'tier-lock' && g.verdict === 'pass'), '互锁闸 pass 条目在轨迹中');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 显式值优先：显式 effort/maxTokens 与档位一致时不被派生覆盖', async () => {
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
    const out = await tool.execute(
      { prompt: 'task', tokenTier: 'cheap', reasoningEffort: 'low', maxTokens: 8000 },
      { agent: { ctx: { get: (name) => (name === 'llm' ? makeTierLlm() : undefined) }, options: {} }, signal: undefined }
    );
    assert.equal(captured.profile.reasoningEffort, 'low', '显式 effort 恒优先');
    assert.equal(captured.profile.maxTokens, 8000, '显式 maxTokens 恒优先');
    assert.equal(out.decisionTrace.effective.reasoningEffortDerived, undefined, '显式 effort 不记派生标记');
    assert.equal(out.decisionTrace.effective.maxTokensDerived, undefined, '显式 maxTokens 不记派生标记');
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 显式值越档：互锁闸在成本闸前 fail-loud（闸序）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    await assert.rejects(
      () => tool.execute(
        { prompt: 'task', tokenTier: 'cheap', reasoningEffort: 'high' },
        { agent: makeForegroundParent(), signal: undefined }
      ),
      /档位 cheap 与显式推理档 high 冲突/,
      '显式值越档必须 fail-loud'
    );
  } finally { iso.restore(); iso.teardown(); }
});

test('execute 无档位不派生：不带 tokenTier 的调用子请求配置与轨迹零变化', async () => {
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
    const out = await tool.execute({ prompt: 'task' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(captured.profile.reasoningEffort, undefined, '无档位不派生 effort');
    assert.equal(captured.profile.maxTokens, undefined, '无档位不派生 maxTokens');
    assert.equal(out.reasoningEffort, '(default)', 'meta 保持旧版默认占位');
    assert.equal(out.decisionTrace.effective.reasoningEffortDerived, undefined, '无派生标记');
    assert.ok(!out.decisionTrace.gates.some((g) => g.name === 'tier-lock'), '无档位不记互锁闸');
  } finally { iso.restore(); iso.teardown(); }
});

test('continuable 档位派生：派生 effort 忽略但 maxTokens 生效（agentOptions 断言）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    let captured;
    const startContinuable = async (opts) => { captured = opts; return { childId: 'child-tier' }; };
    const { ctx, records } = createFakeCtx({ startContinuable });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute(
      { prompt: 'task', continuable: true, tokenTier: 'cheap' },
      { agent: { ctx: { get: () => undefined, tools: { schemas: () => [{ name: 'read' }, { name: 'write' }] } }, options: {} }, signal: undefined }
    );
    assert.equal(captured.request.agentOptions.maxTokens, 8000, '派生 maxTokens 进入 agentOptions');
    assert.equal(captured.request.agentOptions.reasoningEffort, undefined, '派生 effort 不进 agentOptions（continuable 忽略）');
    assert.equal(out.reasoningEffort, 'off', '结果回显派生档位');
    assert.deepEqual(out.ignored, ['preset', 'reasoningEffort'], 'ignored 列出被丢弃项');
    assert.equal(out.decisionTrace.effective.reasoningEffortDerived, true, '轨迹记录派生标记');
    assert.equal(out.decisionTrace.effective.maxTokensDerived, true);
  } finally { iso.restore(); iso.teardown(); }
});
