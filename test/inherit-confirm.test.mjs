// test/inherit-confirm.test.mjs — 继承变更确认（confirm 参数 + inherit-confirm 闸）：
//   * schema：confirm 顶层布尔参数、描述人话化、不进 strategy 对象键集；
//   * 纯函数判定：同父值/父路由未声明/无父 session/显式 model/strategy 对象不触发，
//     方案带出异值与 auto 解析异值触发；
//   * 未确认 fail-loud 三层中文错误逐句断言；fail 前先记 confirm fail 闸；
//     闸序（tier-lock → confirm → cost，cost/预算闸前失败）；
//   * confirm:true 放行 + trace 记录（input 三键）+ requested.confirm 快照；
//   * 三分支（前台/后台/continuable）同语义；派发决策记录 confirm 字段写入。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DISPATCH_PARAMETERS } from '../lib/core/dispatch-schema.mjs';
import { applyInheritConfirmGate, inheritConfirmVerdictOf } from '../lib/core/dispatch-gates.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';

const mod = await import('../index.mjs');

// 提供能力面可核验的 llm：m1/m2 均在目录中（成本闸放行）。
function makeLlm() {
  return {
    listProviders: async () => [{ id: 'p1' }],
    listModels: async () => [{ id: 'm1' }, { id: 'm2' }],
    resolveModelInfo: async () => ({}),
    resolveCallConfig: async () => ({}),
  };
}

// 父 Agent fake：缺省父路由 p1/m1（与官方模型选择测试同款形状，带 session）。
function makeParent({ provider = 'p1', model = 'm1', sessionId = 'parent-confirm' } = {}) {
  const llm = makeLlm();
  return {
    ctx: {
      get: (name) => (name === 'llm' ? llm : undefined),
      tools: { schemas: () => [{ name: 'read' }, { name: 'write' }] },
    },
    options: { provider, model },
    session: { header: { id: sessionId } },
  };
}

function dispatchTool(records) {
  const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
  assert.ok(tool, 'apply() 必须注册 dispatch 工具');
  return tool;
}

function registerProfile(records, id, extra = {}) {
  const service = records.provides.find((p) => p.name === 'subagent-profiles')?.service;
  assert.ok(service, 'profiles service 必须提供');
  service.register({ id, name: id, description: '继承变更确认测试方案', ...extra });
}

function makeForegroundStart() {
  return async () => ({
    id: 'child-confirm',
    result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] },
    localAgent: { session: { events: [] } },
    dispose: async () => {},
  });
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

// ---- ① schema：confirm 参数声明 -------------------------------------------------

test('schema：confirm 为顶层布尔参数，描述人话化，不进 strategy 对象键集', () => {
  const confirm = DISPATCH_PARAMETERS.confirm;
  assert.equal(confirm.type, 'boolean', 'confirm 必须为布尔参数');
  assert.match(confirm.description, /确认使用继承\/auto 解析产生的模型变更/, '描述必须人话化说明确认对象');
  assert.match(confirm.description, /不传且发生继承变更时调用将失败/, '描述必须写明缺省行为');
  const strategyObj = DISPATCH_PARAMETERS.strategy.oneOf.find((branch) => branch.type === 'object');
  assert.equal('confirm' in strategyObj.properties, false, 'confirm 是调用方动作，不得进 strategy 键集');
});

// ---- ② 纯函数判定 ----------------------------------------------------------------

test('inheritConfirmVerdictOf：同父值/显式指定/父路由未知不触发，方案与 auto 异值触发', () => {
  const parent = makeParent();
  const same = inheritConfirmVerdictOf({ prompt: 't' }, {}, parent);
  assert.equal(same.needConfirm, false, '未带路由字段 = 继承父路由，同父值不触发');
  const sameModel = inheritConfirmVerdictOf({ prompt: 't', profile: 'same' }, { model: 'm1' }, parent);
  assert.equal(sameModel.needConfirm, false, '方案带出与父相同的 model 不触发');
  const explicit = inheritConfirmVerdictOf({ prompt: 't', model: 'm2' }, { model: 'm2' }, parent);
  assert.equal(explicit.needConfirm, false, '顶层显式 model 不触发');
  const strategyExplicit = inheritConfirmVerdictOf({ prompt: 't', strategy: { model: 'm2' } }, { model: 'm2' }, parent);
  assert.equal(strategyExplicit.needConfirm, false, 'strategy 对象显式 model 不触发');
  const profileDiff = inheritConfirmVerdictOf({ prompt: 't', profile: 'm2p' }, { model: 'm2' }, parent);
  assert.equal(profileDiff.needConfirm, true, '方案带出不同 model → 触发');
  assert.equal(profileDiff.effectiveProvider, 'p1', 'provider 继承父会话');
  assert.equal(profileDiff.effectiveModel, 'm2', '生效 model 为方案带出值');
  assert.equal(profileDiff.source, 'profile', '来源标记 profile');
  const autoDiff = inheritConfirmVerdictOf({ prompt: 't', strategy: 'auto' }, { model: 'm2' }, parent);
  assert.equal(autoDiff.needConfirm, true, 'auto 解析出异值 → 触发');
  assert.equal(autoDiff.source, 'auto', '来源标记 auto');
  const noSession = inheritConfirmVerdictOf({ prompt: 't', profile: 'm2p' }, { model: 'm2' }, { options: { provider: 'p1', model: 'm1' } });
  assert.equal(noSession.needConfirm, false, '父会话缺失（无 session）无法判定变更 → 不触发');
  const unknownParentRoute = inheritConfirmVerdictOf({ prompt: 't', profile: 'm2p' }, { model: 'm2' }, { ...makeParent(), options: {} });
  assert.equal(unknownParentRoute.needConfirm, false, '父路由未声明无法判定变更 → 不触发');
});

// ---- ③ 触发未确认：三层中文错误 ---------------------------------------------------

test('触发未确认：方案带出不同模型 → fail-loud 三层中文错误逐句断言', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({});
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    const tool = dispatchTool(records);
    await assert.rejects(
      () => tool.execute({ prompt: 'task', profile: 'm2-profile' }, { agent: makeParent(), signal: undefined }),
      (err) => {
        assert.match(err.message, /方案 m2-profile 将把该子代理配置为 provider\/model p1\/m2（父会话当前为 p1\/m1；变更来自方案配置而非显式指定）/, '第一层：事实与生效/父路由');
        assert.match(err.message, /未确认的模型变更可能产生预算与性能意外/, '第二层：语义风险');
        assert.match(err.message, /确认请传 confirm: true；或显式传 provider\/model 覆盖；或改用与父会话相同的模型/, '第三层：行动路径');
        return true;
      }
    );
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ④ 闸记录：fail 前先记 confirm fail 闸 -----------------------------------------

test('applyInheritConfirmGate：未确认 fail 前先记 confirm fail 闸（input 三键 + reason 三层）', () => {
  const trace = { gates: [] };
  const parent = makeParent();
  assert.throws(
    () => applyInheritConfirmGate(trace, { profile: 'm2p' }, { model: 'm2' }, parent),
    /未确认的模型变更可能产生预算与性能意外/
  );
  assert.equal(trace.gates.length, 1, 'fail 闸恰好记录一条');
  const gate = trace.gates[0];
  assert.equal(gate.name, 'confirm');
  assert.equal(gate.verdict, 'fail');
  assert.deepEqual(gate.input, {
    needConfirm: true,
    requestedChange: { provider: 'p1', model: 'm2' },
    confirmed: false,
  }, 'input 记录 needConfirm/requestedChange/confirmed 三键');
  assert.equal(gate.output.allowed, false);
  assert.match(gate.reason, /确认请传 confirm: true/, 'reason 携带三层错误全文');
});

test('applyInheritConfirmGate：confirm:true 放行并记 pass，不触发不记闸', () => {
  const parent = makeParent();
  const passTrace = { gates: [] };
  applyInheritConfirmGate(passTrace, { profile: 'm2p', confirm: true }, { model: 'm2' }, parent);
  assert.equal(passTrace.gates.length, 1);
  assert.equal(passTrace.gates[0].name, 'confirm');
  assert.equal(passTrace.gates[0].verdict, 'pass');
  assert.deepEqual(passTrace.gates[0].input, {
    needConfirm: true,
    requestedChange: { provider: 'p1', model: 'm2' },
    confirmed: true,
  }, '确认放行的 input 标记 confirmed:true');
  const skipTrace = { gates: [] };
  applyInheritConfirmGate(skipTrace, { prompt: 't' }, {}, parent);
  assert.equal(skipTrace.gates.length, 0, '同父值不触发 → 不记闸条目（旧调用轨迹不变）');
});

// ---- ⑤ 闸序：fail 发生在 cost/预算之前 ---------------------------------------------

test('闸序：未确认 fail 时轨迹为 whitelist → tier-lock → confirm（cost/预算闸未到）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({});
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    const tool = dispatchTool(records);
    await assert.rejects(
      () => tool.execute(
        { prompt: 'task', profile: 'm2-profile', tokenTier: 'cheap' },
        { agent: makeParent({ sessionId: 'parent-order' }), signal: undefined }
      ),
      /未确认的模型变更/
    );
    const ledgerFile = join(iso.dir, 'subagent-profiles.failed-traces.json');
    const failed = JSON.parse(readFileSync(ledgerFile, 'utf8'));
    const [trace] = failed.sessions['parent-order'];
    assert.deepEqual(
      trace.gates.map((g) => g.name),
      ['whitelist', 'tier-lock', 'confirm'],
      '闸序为 tier-lock → confirm，cost/intersection/approval/budget 均未到达'
    );
    assert.equal(trace.gates[2].verdict, 'fail', 'confirm 闸为 fail 条目');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ⑥ confirm:true 放行：trace 记录 + 闸序 -----------------------------------------

test('confirm:true：放行 + confirm pass 闸记录 + requested.confirm 快照 + 全闸序', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ subagentsStart: makeForegroundStart() });
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    const tool = dispatchTool(records);
    const out = await tool.execute(
      { prompt: 'task', profile: 'm2-profile', tokenTier: 'cheap', confirm: true },
      { agent: makeParent({ sessionId: 'parent-pass' }), signal: undefined }
    );
    assert.equal(out.stopReason, 'completed');
    assert.deepEqual(
      out.decisionTrace.gates.map((g) => g.name),
      ['whitelist', 'tier-lock', 'confirm', 'cost', 'intersection', 'approval', 'budget'],
      'confirm 闸在 tier-lock 后、cost 前'
    );
    const gate = out.decisionTrace.gates.find((g) => g.name === 'confirm');
    assert.equal(gate.verdict, 'pass');
    assert.equal(gate.output.allowed, true);
    assert.deepEqual(gate.input, {
      needConfirm: true,
      requestedChange: { provider: 'p1', model: 'm2' },
      confirmed: true,
    }, 'trace 记录 confirm 闸 input 三键');
    assert.equal(out.decisionTrace.requested.confirm, true, 'requested 快照记录 confirm');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ⑦ 显式与同父值不触发（execute 级）----------------------------------------------

test('execute：显式 model 与同父值方案不触发 confirm 闸', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ subagentsStart: makeForegroundStart() });
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    registerProfile(records, 'same-profile', { model: 'm1' });
    const tool = dispatchTool(records);
    const explicit = await tool.execute(
      { prompt: 'task', profile: 'm2-profile', model: 'm2' },
      { agent: makeParent(), signal: undefined }
    );
    assert.equal(explicit.stopReason, 'completed');
    assert.ok(!explicit.decisionTrace.gates.some((g) => g.name === 'confirm'), '显式 model 不记 confirm 闸');
    const same = await tool.execute(
      { prompt: 'task', profile: 'same-profile' },
      { agent: makeParent(), signal: undefined }
    );
    assert.equal(same.stopReason, 'completed');
    assert.ok(!same.decisionTrace.gates.some((g) => g.name === 'confirm'), '同父值不记 confirm 闸');
    assert.equal(same.decisionTrace.requested.source, 'profile', '来源仍如实记录 profile');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ⑧ auto 解析异值触发 -----------------------------------------------------------

test('auto 解析异值：未确认 fail-loud（subject 为 auto 解析），confirm 放行', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({});
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    const tool = dispatchTool(records);
    await assert.rejects(
      () => tool.execute(
        { prompt: 'task', profile: 'm2-profile', strategy: 'auto' },
        { agent: makeParent(), signal: undefined }
      ),
      (err) => {
        assert.match(err.message, /auto 解析 将把该子代理配置为 provider\/model p1\/m2（父会话当前为 p1\/m1；变更来自方案配置而非显式指定）/, 'auto 解析出异值 → 触发');
        assert.match(err.message, /未确认的模型变更可能产生预算与性能意外/);
        assert.match(err.message, /确认请传 confirm: true；或显式传 provider\/model 覆盖；或改用与父会话相同的模型/);
        return true;
      }
    );
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ⑨ 三分支同语义 ----------------------------------------------------------------

test('continuable 分支：未确认 fail-loud，confirm:true 放行并记 pass', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const startContinuable = async () => ({ childId: 'child-cont' });
    const { ctx, records } = createFakeCtx({ startContinuable });
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    const tool = dispatchTool(records);
    await assert.rejects(
      () => tool.execute(
        { prompt: 'task', profile: 'm2-profile', continuable: true },
        { agent: makeParent({ sessionId: 'parent-cont' }), signal: undefined }
      ),
      /未确认的模型变更可能产生预算与性能意外/
    );
    const out = await tool.execute(
      { prompt: 'task', profile: 'm2-profile', continuable: true, confirm: true },
      { agent: makeParent({ sessionId: 'parent-cont' }), signal: undefined }
    );
    assert.equal(out.kind, 'continuable');
    const gate = out.decisionTrace.gates.find((g) => g.name === 'confirm');
    assert.equal(gate.verdict, 'pass', 'continuable 分支确认放行');
    assert.equal(gate.input.confirmed, true);
  } finally { iso.restore(); iso.teardown(); }
});

test('background 分支：未确认 fail-loud，confirm:true 放行并记 pass', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const jobs = { start: () => 'job-confirm' };
    const { ctx, records } = createFakeCtx({ services: { jobs } });
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    const tool = dispatchTool(records);
    await assert.rejects(
      () => tool.execute(
        { prompt: 'task', profile: 'm2-profile', run_in_background: true },
        { agent: makeParent({ sessionId: 'parent-bg' }), signal: undefined }
      ),
      /未确认的模型变更可能产生预算与性能意外/
    );
    const out = await tool.execute(
      { prompt: 'task', profile: 'm2-profile', run_in_background: true, confirm: true },
      { agent: makeParent({ sessionId: 'parent-bg' }), signal: undefined }
    );
    assert.equal(out.kind, 'background');
    const gate = out.decisionTrace.gates.find((g) => g.name === 'confirm');
    assert.equal(gate.verdict, 'pass', 'background 分支确认放行');
    assert.equal(gate.input.confirmed, true);
  } finally { iso.restore(); iso.teardown(); }
});

// ---- ⑩ 决策记录 confirm 字段写入 --------------------------------------------------------

test('决策记录：baseEntry 静态元数据写 confirm（确认 true / 未确认 false）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx({ subagentsStart: makeForegroundStart() });
    await mod.apply(ctx);
    registerProfile(records, 'm2-profile', { model: 'm2' });
    const tool = dispatchTool(records);
    const parent = makeParent({ sessionId: 'parent-ledger' });
    await tool.execute({ prompt: 'task', profile: 'm2-profile', confirm: true }, { agent: parent, signal: undefined });
    await tool.execute({ prompt: 'task' }, { agent: parent, signal: undefined });
    const rows = readJsonl(join(iso.dir, 'subagent-evolution', 'dispatch.jsonl'));
    assert.equal(rows.length, 2, '两次派发各写一条决策记录');
    assert.equal(rows[0].confirm, true, '确认放行的派发写 confirm:true');
    assert.equal(rows[1].confirm, false, '未确认（同父值）的派发写 confirm:false');
  } finally { iso.restore(); iso.teardown(); }
});
