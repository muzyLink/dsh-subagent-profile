// test/recycle.test.mjs — V2 Token P0（SPEC §8.2 / §8.4 / R1）：
//   * pruneBlocks —— 结果回收默认剪枝纯函数：有 toolResultPruner.pruneContent 时
//     在 textFrom 之前预剪（返回裁剪结果）；pruner 缺失 / 内置打回 null / 抛错 /
//     非数组内容时回退为不剪（剪枝是增强、非硬依赖）。
//   * envelope 参数 —— 工具 schema 暴露 boolean 以作字段契约（预留），execute
//     不消费它（当前不生效）。
//   * assertResultSchemaConsistency —— 锁定 R1 closed oneOf：三分支共享元数据
//     (profile/preset/provider/model/reasoningEffort/ignored) 键集一致；构造
//     不一致（某分支漏 ignored 等）即 throw。
//
// 前台路径经 dispatch.execute 触发：mock ctx.subagents.start 返回 completed
// 结果，注入 toolResultPruner 后断言 pruneContent 在 textFrom 前被调用。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneBlocks, assertResultSchemaConsistency } from '../lib/pure.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';

const mod = await import('../index.mjs');

// ---- pruneBlocks：纯函数（覆盖 settleStart 与前台两处调用的公共语义）--------

test('pruneBlocks: pruner 存在 → 返回 pruneContent 结果（裁剪生效）', () => {
  const blocks = [{ type: 'text', text: 'long'.repeat(3000) }];
  const pruner = { pruneContent: (b) => [{ type: 'text', text: 'PRUNED' }] };
  assert.deepEqual(pruneBlocks(blocks, pruner), [{ type: 'text', text: 'PRUNED' }]);
});

test('pruneBlocks: pruner.pruneContent 返回 null（在预算内）→ 保持原 blocks', () => {
  const blocks = [{ type: 'text', text: 'small' }];
  const pruner = { pruneContent: () => null };
  assert.deepEqual(pruneBlocks(blocks, pruner), blocks);
});

test('pruneBlocks: pruner 缺失 → 保持原 blocks（回退不剪）', () => {
  const blocks = [{ type: 'text', text: 'x' }];
  assert.deepEqual(pruneBlocks(blocks, undefined), blocks);
  assert.deepEqual(pruneBlocks(blocks, {}), blocks); // 有对象但无 pruneContent
});

test('pruneBlocks: pruner 抛错 → 回退为原 blocks（绝不吞掉子结果）', () => {
  const blocks = [{ type: 'text', text: 'a' }];
  const pruner = { pruneContent: () => { throw new Error('boom'); } };
  assert.deepEqual(pruneBlocks(blocks, pruner), blocks);
});

test('pruneBlocks: 非数组内容 → 返回 []（与 textFrom 对空输出语义一致）', () => {
  assert.deepEqual(pruneBlocks(undefined, { pruneContent: () => [] }), []);
  assert.deepEqual(pruneBlocks('nope', { pruneContent: () => [] }), []);
});

// ---- assertResultSchemaConsistency：R1 三分支共享元数据键集一致 --------------

function consistentSchema() {
  return {
    oneOf: [
      { properties: { kind: {}, jobId: {}, profile: {}, preset: {}, provider: {}, model: {}, reasoningEffort: {}, ignored: {} } },
      { properties: { kind: {}, subagentId: {}, profile: {}, preset: {}, provider: {}, model: {}, reasoningEffort: {}, ignored: {} } },
      { properties: { output: {}, profile: {}, preset: {}, provider: {}, model: {}, reasoningEffort: {}, ignored: {} } }
    ]
  };
}

test('assertResultSchemaConsistency: 三分支共享元数据键集一致 → 通过', () => {
  assert.equal(assertResultSchemaConsistency(consistentSchema()), true);
});

test('assertResultSchemaConsistency: 某分支漏 ignored → throw（R1 中文错误）', () => {
  const schema = consistentSchema();
  schema.oneOf[2].properties = Object.fromEntries(
    Object.entries(schema.oneOf[2].properties).filter(([k]) => k !== 'ignored')
  );
  // 错误信息：「…分支 3 的元数据字段集与分支 1 不一致（R1：…）」—— R1 在分支
  // 文本之后，故正则匹配「分支 3 … 不一致」段。
  assert.throws(() => assertResultSchemaConsistency(schema), /分支 3.*不一致.*R1/);
});

test('assertResultSchemaConsistency: 某分支多出成员字段 → throw', () => {
  const schema = consistentSchema();
  schema.oneOf[1].properties.extraMeta = {};
  assert.throws(() => assertResultSchemaConsistency(schema), /分支 2.*不一致.*R1/);
});

test('assertResultSchemaConsistency: 非对象 / 空 oneOf → throw；单分支不抛（无可对齐对象）', () => {
  assert.throws(() => assertResultSchemaConsistency(null), /必须为对象/);
  assert.throws(() => assertResultSchemaConsistency({ oneOf: [] }), /非空 oneOf/);
  // 单个分支无可漂移对象 → 视为一致（不 throw）。
  assert.doesNotThrow(() => assertResultSchemaConsistency({ oneOf: [{ properties: { a: {} } }] }));
});

test('R1 lock: dispatch 工具的 output.schema 通过 assertResultSchemaConsistency', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    assert.ok(tool, 'apply() 必须注册 dispatch 工具');
    assert.doesNotThrow(() => assertResultSchemaConsistency(tool.output.schema));
    // 三分支都含 ignored 且 additionalProperties 均关闭（closed oneOf）。
    for (const branch of tool.output.schema.oneOf) {
      assert.ok(branch.properties.ignored, '每个分支都必须有 ignored 字段');
      assert.equal(branch.additionalProperties, false, 'closed oneOf 分支必须 additionalProperties:false');
      assert.equal(typeof branch.properties.ignored, 'object');
      assert.equal(branch.properties.ignored.type, 'array');
      assert.equal(branch.properties.ignored.items.type, 'string');
    }
  } finally { iso.restore(); iso.teardown(); }
});

// ---- envelope 参数：schema 暴露 + execute 不消费 ------------------------------

test('envelope 参数：schema 中为 boolean（预留），execute 不消费', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { ctx, records } = createFakeCtx();
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    assert.ok(tool.parameters.properties.envelope, 'dispatch 参数 schema 必须暴露 envelope');
    assert.equal(tool.parameters.properties.envelope.type, 'boolean');
    // execute 不消费：带 envelope:true 调用前台路径，输出仍为纯 textFrom 结果
    // （无任何信封结构）且不抛错 —— 证明该参数当前被忽略。
    const parent = { ctx: { get: () => undefined }, options: {} };
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'plain-task-output' }] },
      // 真实 dispose 返回 Promise（execute 的 finally 会 await run.dispose()）。
      dispose: async () => {},
    });
    const { ctx: c2, records: r2 } = createFakeCtx({ subagentsStart });
    await mod.apply(c2);
    const tool2 = r2.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool2.execute({ prompt: 'task', envelope: true }, { agent: parent, signal: undefined });
    assert.equal(out.output, 'plain-task-output', 'envelope 当前不生效 → 输出为纯文本');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- 前台路径：textFrom 前调用 toolResultPruner.pruneContent -----------------

function makeForegroundParent() {
  return { ctx: { get: () => undefined }, options: {} };
}

test('前台回收：有 toolResultPruner → pruneContent 在 textFrom 前被调用，输出为裁剪结果', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const pruneCalls = [];
    const pruner = {
      pruneContent(blocks) {
        pruneCalls.push(blocks);
        return [{ type: 'text', text: 'PRUNED-CONTENT' }];
      }
    };
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'FULL-LONG-CONTENT' }] },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ services: { toolResultPruner: pruner }, subagentsStart });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute({ prompt: 'task' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(pruneCalls.length, 1, 'pruneContent 必须在 textFrom 之前被调用一次');
    assert.deepEqual(pruneCalls[0], [{ type: 'text', text: 'FULL-LONG-CONTENT' }], '传入的必须是原始结果 blocks');
    assert.equal(out.output, 'PRUNED-CONTENT', 'textFrom 必须消费裁剪后的 blocks');
  } finally { iso.restore(); iso.teardown(); }
});

test('前台回收：无 toolResultPruner → 不剪，输出为完整文本', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const subagentsStart = async () => ({
      result: { stopReason: 'completed', output: [{ type: 'text', text: 'FULL-UNPRUNED' }] },
      dispose: async () => {},
    });
    const { ctx, records } = createFakeCtx({ subagentsStart }); // services 无 toolResultPruner
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute({ prompt: 'task' }, { agent: makeForegroundParent(), signal: undefined });
    assert.equal(out.output, 'FULL-UNPRUNED', '无 pruner → 完整输出，不剪');
  } finally { iso.restore(); iso.teardown(); }
});

// ---- §8.4 continuable 可见性：返回 reasoningEffort + ignored -----------------

function makeContinuableParent() {
  // 提供 llm（让 assertCostGuard 对 reasoningEffort 的校验通过）与 tools.schemas
  // （供 computeContinuableAllow 取父工具集，非空）。
  const llm = {
    listProviders: async () => [{ id: 'p1' }],
    listModels: async () => [{ id: 'm1' }],
    resolveCallConfig: async () => ({}),
  };
  return {
    ctx: {
      get: (name) => (name === 'llm' ? llm : undefined),
      tools: { schemas: () => [{ name: 'read' }, { name: 'write' }] },
    },
    options: {},
  };
}

test('§8.4 continuable 返回：preset=inherit + reasoningEffort(请求值) + ignored 列出被丢弃项', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const startContinuable = async () => ({ childId: 'child-1' });
    const { ctx, records } = createFakeCtx({ startContinuable });
    await mod.apply(ctx);
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const out = await tool.execute(
      { prompt: 'task', continuable: true, preset: 'standard', reasoningEffort: 'high' },
      { agent: makeContinuableParent(), signal: undefined }
    );
    assert.equal(out.kind, 'continuable');
    assert.equal(out.subagentId, 'child-1');
    assert.equal(out.preset, 'inherit', 'continuable 路径真实生效值必须是 inherit（preset 被忽略）');
    assert.equal(out.reasoningEffort, 'high', 'reasoningEffort 回显请求值（被忽略但可见）');
    assert.deepEqual(out.ignored, ['preset', 'reasoningEffort'], 'ignored 必须完整列出被忽略项');
  } finally { iso.restore(); iso.teardown(); }
});
