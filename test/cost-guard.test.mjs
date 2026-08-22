// test/cost-guard.test.mjs — V2 安全 P0-b（SPEC §7.3）：
//   * assertHardLimits —— 硬上限（maxTokens/maxDepth）纯函数单测。硬上限已从
//     assertCostGuard 的 llm 依赖分支移出为 always-on，故不随 llm 缺失失效；
//   * llm 缺失 / provider 目录为空 + allowFailOpen 分支 —— 经 fake ctx 的
//     dispatch.execute 路径触发 assertCostGuard（该函数 module-scoped 未 export，
//     只能从 execute/start 侧触发）。allowFailOpen=false → fail-loud throw；true →
//     warn + 跳过（随后进入 fake 的 foreground 子 Agent 调用并在「not available」
//     处拒绝，证明未 fail-loud）。空 provider 目录用 listProviders 返回 [] 表示，
//     并断言 listModels 不可达（目录空在 model 校验之前短路）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertHardLimits, MAX_TOKENS, MAX_DEPTH } from '../lib/pure.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';

const mod = await import('../index.mjs');

// ---- assertHardLimits：硬上限 always-on（不依赖 llm）--------------------

test('assertHardLimits: maxTokens 超上限 throw（中文、可操作）', () => {
  assert.throws(() => assertHardLimits(MAX_TOKENS + 1, 1), /maxTokens.*超过委派上限/);
});

test('assertHardLimits: maxDepth 超上限 throw', () => {
  assert.throws(() => assertHardLimits(1, MAX_DEPTH + 1), /maxDepth.*超过委派上限/);
});

test('assertHardLimits: 上限以内 / 非数字 / == 上限 / 未设值 不 throw', () => {
  assert.doesNotThrow(() => assertHardLimits(MAX_TOKENS, MAX_DEPTH));
  assert.doesNotThrow(() => assertHardLimits(undefined, undefined));
  assert.doesNotThrow(() => assertHardLimits('big', '3')); // 非数字不触发（写路径已拒）
  assert.doesNotThrow(() => assertHardLimits());
});

// ---- llm 缺失 + allowFailOpen 分支（经 dispatch.execute 路径）------------

// 最小 fake 父 Agent：assertCostGuard 只读 parent.ctx.get('llm') 与
// parent.options.*；foreground 路径不访问 parent.ctx.tools。
function makeParent() {
  return { ctx: { get: () => undefined }, options: {} };
}

// 取 apply() 注册的 dispatch 工具（tools.register 记录的首个 name==='dispatch'）。
function dispatchTool(records) {
  const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
  assert.ok(tool, 'apply() 必须注册 dispatch 工具');
  return tool;
}

test('cost guard: llm 缺失 + allowFailOpen=false → fail-loud 抛「模型能力不可验证」', async () => {
  const iso = makeIsolatedDshHome(); // 无文件 ⇒ 全新部署默认 allowFailOpen=false
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    await assert.rejects(
      () => tool.execute({ prompt: 'do a task', model: 'some-model' }, { agent: makeParent(), signal: undefined }),
      (err) => {
        assert.match(err.message, /dispatch: 模型能力不可验证：fail-loud 拒绝/);
        return true;
      }
    );
  } finally { iso.restore(); iso.teardown(); }
});

test('cost guard: llm 缺失 + allowFailOpen=true → fail-open（warn，不抛 cost guard 错误）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    // 写入 v1（bare array，空）⇒ loadProfiles 置 allowFailOpen=true。
    writeFileSync(join(iso.dir, 'subagent-profiles.json'), '[]', 'utf8');
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    // allowFailOpen=true ⇒ assertCostGuard warn + return；随后 execute 进入
    // foreground 分支并在 fake ctx.subagents.start（「not available」）处拒绝，
    // 从而证明 cost guard 未 fail-loud。
    await assert.rejects(
      () => tool.execute({ prompt: 'do a task', model: 'some-model' }, { agent: makeParent(), signal: undefined }),
      (err) => {
        assert.doesNotMatch(err.message, /模型能力不可验证/);
        assert.match(err.message, /not available/);
        return true;
      }
    );
  } finally { iso.restore(); iso.teardown(); }
});

test('cost guard: 硬上限在 llm 缺失时仍 throw（always-on 前置）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    // llm 缺失 + maxTokens 超限：assertHardLimits 在 llm 分支（needsLlm 门）之前
    // 抛 —— 证明硬上限不随 llm 缺失失效。加上 model 使「若不抛则走到 llm 分支」。
    await assert.rejects(
      () => tool.execute({ prompt: 'do a task', model: 'some-model', maxTokens: MAX_TOKENS + 1 }, { agent: makeParent(), signal: undefined }),
      (err) => {
        assert.match(err.message, /maxTokens.*超过委派上限/);
        return true;
      }
    );
  } finally { iso.restore(); iso.teardown(); }
});

// ---- provider 目录为空（llm 存在但无提供者）→ 走同一 allowFailOpen 门 --------

// fake llm：listProviders 返回空数组（「目录为空」），listModels 不可达 —— 若被
// 调用则抛 sentinel 并计数，用于断言空目录在 model 校验（step ⑤）之前短路。
function makeParentWithEmptyLlmDirectory() {
  const listModelsCalls = { count: 0 };
  const llm = {
    listProviders: async () => [],
    listModels: async () => {
      listModelsCalls.count += 1;
      throw new Error('listModels must not be reached (empty provider directory short-circuits)');
    },
  };
  const parent = { ctx: { get: (name) => (name === 'llm' ? llm : undefined) }, options: {} };
  return { parent, listModelsCalls };
}

test('cost guard: 空 provider 目录 + allowFailOpen=false → fail-loud 抛「模型能力不可验证」', async () => {
  const iso = makeIsolatedDshHome(); // 无文件 ⇒ 全新部署默认 allowFailOpen=false
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const { parent, listModelsCalls } = makeParentWithEmptyLlmDirectory();
    await assert.rejects(
      () => tool.execute({ prompt: 'do a task', model: 'some-model' }, { agent: parent, signal: undefined }),
      (err) => {
        assert.match(err.message, /dispatch: 模型能力不可验证：fail-loud 拒绝/);
        return true;
      }
    );
    assert.equal(listModelsCalls.count, 0, '空 provider 目录必须在 model 校验之前短路，listModels 不可达');
  } finally { iso.restore(); iso.teardown(); }
});

test('cost guard: 空 provider 目录 + allowFailOpen=true → fail-open（warn，不抛 cost guard 错误）', async () => {
  const iso = makeIsolatedDshHome();
  try {
    writeFileSync(join(iso.dir, 'subagent-profiles.json'), '[]', 'utf8'); // v1 ⇒ allowFailOpen=true
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = dispatchTool(records);
    const { parent, listModelsCalls } = makeParentWithEmptyLlmDirectory();
    await assert.rejects(
      () => tool.execute({ prompt: 'do a task', model: 'some-model' }, { agent: parent, signal: undefined }),
      (err) => {
        assert.doesNotMatch(err.message, /模型能力不可验证/);
        assert.match(err.message, /not available/); // 证明 cost guard warn+skip，才走到 foreground
        return true;
      }
    );
    assert.equal(listModelsCalls.count, 0, '空 provider 目录必须在 model 校验之前短路，listModels 不可达');
  } finally { iso.restore(); iso.teardown(); }
});
