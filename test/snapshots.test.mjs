// test/snapshots.test.mjs — 配置快照（B7 任务书验收清单）：开关默认关；开启→派发→
// snapshots/ 出现完整 config（含 persona 原文、toolFilter 全量）；台账行仍只有指纹
// （快照不写 dispatch.jsonl）；「保存为方案」有快照→完整方案（persona 在方案里 +
// snapshot-used 审计）、无快照→可还原段 + 副注；关闭后无新快照；一键清理→目录清空
// + 审计；总量护栏（≤200 停止新写、不自动删旧）；损坏文件 fail-soft。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSnapshotStore, SNAPSHOT_CAP } from '../lib/core/snapshots.mjs';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';
import { makeRouteHarness, callRoute } from './harness/routes.mjs';

const mod = await import('../index.mjs');

function makeLlm() {
  return {
    listProviders: async () => [{ id: 'p1' }],
    listModels: async () => [{ id: 'm1' }, { id: 'm2' }],
    resolveModelInfo: async () => ({}),
    resolveCallConfig: async () => ({}),
  };
}

function makeParent() {
  return {
    ctx: { get: (name) => (name === 'llm' ? makeLlm() : undefined), tools: { schemas: () => [{ name: 'read' }, { name: 'write' }] } },
    options: { provider: 'p1', model: 'm1' },
  };
}

// --- store 单元：开关/完整字段/幂等/护栏/清理/损坏 fail-soft ------------------------

test('快照 store：开关关恒跳过；开启写完整 config（persona 原文 + toolFilter 全量）+ 审计元数据', () => {
  const iso = makeIsolatedDshHome();
  try {
    const audits = [];
    let enabled = false;
    const store = createSnapshotStore({ dshHome: iso.dir, getEnabled: () => enabled, recordAudit: (e) => audits.push(e) });
    const config = { preset: 'standard', provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 1000, maxDepth: 2, persona: 'You are a code reviewer.', toolFilter: { deny: ['bash'] }, profileKey: 'ignored' };
    assert.equal(store.capture({ profileKey: 'preset:standard', config, mode: 'foreground' }), null, '默认关不写');
    assert.equal(store.count(), 0);
    enabled = true;
    const result = store.capture({ profileKey: 'preset:standard', config, mode: 'foreground' });
    assert.ok(result !== null, '开启后必须写快照');
    const snapshotsDir = join(iso.dir, 'subagent-evolution', 'snapshots');
    const files = readdirSync(snapshotsDir);
    const file = files.find((f) => f.endsWith('.json') && f !== 'snapshots.index.json');
    assert.ok(file !== undefined, '快照文件必须落盘');
    const payload = JSON.parse(readFileSync(join(snapshotsDir, file), 'utf8'));
    assert.equal(payload.config.persona, 'You are a code reviewer.', 'persona 原文完整保留');
    assert.deepEqual(payload.config.toolFilter, { deny: ['bash'] }, 'toolFilter 全量保留');
    assert.equal(payload.profileKey, 'preset:standard');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].kind, 'snapshot-written');
    assert.ok(typeof audits[0].size === 'number' && audits[0].size > 0, '审计只记元数据（file/size，无原文）');
    assert.ok(!JSON.stringify(audits[0]).includes('code reviewer'), '审计不得含 persona 原文');
    // 幂等：同 profileKey 同毫秒不重复（不同 ts 允许再写）。
    assert.equal(store.list().length, 1);
    assert.equal(store.count(), 1);
  } finally { iso.restore(); iso.teardown(); }
});

test('快照 store：latestByProfileKey 取最近一条；损坏文件 fail-soft 跳过', () => {
  const iso = makeIsolatedDshHome();
  try {
    const store = createSnapshotStore({ dshHome: iso.dir, getEnabled: () => true });
    store.capture({ profileKey: 'provider:p1|model:m1', config: { provider: 'p1', model: 'm1', persona: 'first' }, mode: 'foreground' });
    const second = store.capture({ profileKey: 'provider:p1|model:m1', config: { provider: 'p1', model: 'm2', persona: 'second' }, mode: 'background' });
    const latest = store.latestByProfileKey('provider:p1|model:m1');
    assert.equal(latest.config.model, 'm2', '必须取 ts 最近一条');
    assert.equal(latest.id, second.id);
    // 损坏该文件 → fail-soft 跳过，回退到前一条。
    writeFileSync(join(iso.dir, 'subagent-evolution', 'snapshots', `${second.id}.json`), '{broken', 'utf8');
    const fallback = store.latestByProfileKey('provider:p1|model:m1');
    assert.equal(fallback.config.model, 'm1', '损坏文件跳过（fail-soft）');
    assert.equal(store.view(second.id), null, '损坏文件 view 返回 null');
    assert.equal(store.latestByProfileKey('provider:none'), null, '无匹配返回 null');
  } finally { iso.restore(); iso.teardown(); }
});

test('快照 store：总量护栏（≤200 停止新写、不自动删旧）+ 一键清理', () => {
  const iso = makeIsolatedDshHome();
  try {
    const warns = [];
    const store = createSnapshotStore({ dshHome: iso.dir, getEnabled: () => true, logger: { warn: (m) => warns.push(m) } });
    for (let i = 0; i < SNAPSHOT_CAP; i += 1) {
      store.capture({ profileKey: `k${i}`, config: { model: `m${i}` }, mode: 'foreground' });
    }
    assert.equal(store.count(), SNAPSHOT_CAP);
    const extra = store.capture({ profileKey: 'overflow', config: { model: 'mx' }, mode: 'foreground' });
    assert.equal(extra, null, '到护栏上限停止新写');
    assert.equal(store.count(), SNAPSHOT_CAP, '不自动删旧');
    assert.ok(warns.some((w) => w.includes('护栏上限')), '超限必须提示清理');
    const cleared = store.clear();
    assert.equal(cleared, SNAPSHOT_CAP);
    assert.equal(store.count(), 0);
    assert.ok(!existsSync(store.indexFile), '清理后索引文件移除');
    assert.deepEqual(readdirSync(store.dir), [], '清理后快照目录为空');
  } finally { iso.restore(); iso.teardown(); }
});

// --- 集成：派发→快照、保存为方案取快照、路由 -----------------------------------------------------------------

test('集成：开启→派发写快照；保存为方案命中快照（persona 在方案里 + snapshot-used）；关闭后无新快照；一键清理', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { webServer, routes } = makeRouteHarness();
    const subagentsStart = async () => ({ result: { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }, dispose: async () => {} });
    const { ctx, records } = createFakeCtx({ services: { webServer }, subagentsStart });
    await mod.apply(ctx);
    const handler = routes[0].handler;
    const tool = records.registerToolCalls.find((t) => t.name === 'dispatch');
    const snapshotsDir = join(iso.dir, 'subagent-evolution', 'snapshots');
    const args = { prompt: 'task', provider: 'p1', model: 'm1', persona: 'custom persona text', toolFilter: { deny: ['bash'] } };
    // 默认关：派发不写快照。
    await tool.execute(args, { agent: makeParent(), signal: undefined });
    assert.equal(existsSync(snapshotsDir), false, '默认关不写快照');
    // 开启 → 派发 → 快照落盘。
    let resp = await callRoute(handler, 'POST', '/snapshots/set-enabled', { snapshotEnabled: true });
    assert.equal(resp.code, 200);
    assert.equal(resp.json.snapshotEnabled, true);
    await tool.execute(args, { agent: makeParent(), signal: undefined });
    resp = await callRoute(handler, 'GET', '/snapshots');
    assert.equal(resp.code, 200, '路由 200（本批前该路径 404）');
    assert.equal(resp.json.count, 1);
    assert.equal(resp.json.cap, SNAPSHOT_CAP);
    const entry = resp.json.entries[0];
    assert.ok(typeof entry.id === 'string' && Number.isFinite(entry.ts) && typeof entry.size === 'number');
    assert.ok(!JSON.stringify(resp.json.entries).includes('custom persona'), '列表只给元数据，无 persona 原文');
    // 台账行仍只有指纹：dispatch.jsonl 不含 persona 原文。
    const ledgerText = readFileSync(join(iso.dir, 'subagent-evolution', 'dispatch.jsonl'), 'utf8');
    assert.ok(!ledgerText.includes('custom persona text'), '台账绝不含 persona 原文');
    // 单条查看（只读，UI 默认折叠）：含 persona 原文与 toolFilter 全量。
    resp = await callRoute(handler, 'GET', `/snapshot?id=${entry.id}`);
    assert.equal(resp.code, 200);
    assert.equal(resp.json.snapshot.config.persona, 'custom persona text');
    assert.deepEqual(resp.json.snapshot.config.toolFilter, { deny: ['bash'] });
    // 保存为方案：同 profileKey 命中快照 → 完整方案（persona/toolFilter 在方案里）。
    const saveResp = await callRoute(handler, 'POST', '/advice/save-profile', { profileKey: 'provider:p1|model:m1|persona:1|toolFilter:1' });
    assert.equal(saveResp.code, 200);
    assert.equal(saveResp.json.fromSnapshot, true, '命中快照必须回传 fromSnapshot');
    resp = await callRoute(handler, 'GET', '/list');
    const saved = resp.json.profiles.find((p) => p.id === saveResp.json.id);
    assert.equal(saved.persona, 'custom persona text', 'persona 字段在方案里');
    assert.deepEqual(saved.toolFilter, { deny: ['bash'] }, 'toolFilter 完整进方案');
    // 未命中回退可还原段（无 persona 字段）。
    const fallbackResp = await callRoute(handler, 'POST', '/advice/save-profile', { profileKey: 'model:m2' });
    assert.equal(fallbackResp.code, 200);
    assert.equal(fallbackResp.json.fromSnapshot, false, '无快照必须走回退分支');
    resp = await callRoute(handler, 'GET', '/list');
    const fallbackSaved = resp.json.profiles.find((p) => p.id === fallbackResp.json.id);
    assert.equal(fallbackSaved.persona, undefined, '回退分支不含 persona');
    // 审计：snapshot-written / snapshot-used 落治理审计。
    const auditText = readFileSync(join(iso.dir, 'subagent-evolution', 'governance-audit.jsonl'), 'utf8');
    assert.ok(auditText.includes('"kind":"snapshot-written"'), '写入审计');
    assert.ok(auditText.includes('"kind":"snapshot-used"'), '命中审计');
    // 关闭 → 派发无新快照（已有保留）。
    resp = await callRoute(handler, 'POST', '/snapshots/set-enabled', { snapshotEnabled: false });
    assert.equal(resp.json.snapshotEnabled, false);
    await tool.execute({ prompt: 'task3', provider: 'p1', model: 'm1' }, { agent: makeParent(), signal: undefined });
    resp = await callRoute(handler, 'GET', '/snapshots');
    assert.equal(resp.json.count, 1, '关闭后不再写新快照（已存保留）');
    // 一键清理（数据维护 ②）：目录清空 + data-cleared 审计。
    resp = await callRoute(handler, 'POST', '/maintenance/clean', { zone: 'snapshots' });
    assert.equal(resp.code, 200);
    assert.equal(resp.json.count, 1);
    assert.deepEqual(readdirSync(snapshotsDir), [], '清理后快照目录为空');
    const auditAfter = readFileSync(join(iso.dir, 'subagent-evolution', 'governance-audit.jsonl'), 'utf8');
    assert.ok(auditAfter.includes('"kind":"data-cleared"'), '清理审计');
    assert.ok(auditAfter.includes('"target":"snapshots"'), '清理目标为快照区');
  } finally { iso.restore(); iso.teardown(); }
});
