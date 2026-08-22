// test/persist.test.mjs — V2 安全 P0-a 持久化：loadProfiles 兼容 v1/v2、
// persistProfiles 原子写（tmp→rename）+ `persisted` 信号（D5/B1：写失败恒 HTTP
// 200 + `{persisted:false}`，不 throw）。这些用例走 apply() 的 HTTP 写路由，复用
// test/harness/ctx.mjs 的 createFakeCtx（用一个 capture webServer 拿 handler）
// 与 makeIsolatedDshHome（隔离 ~/.dsh）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeCtx, makeIsolatedDshHome } from './harness/ctx.mjs';
import { PERSONA_MAX_CHARS } from '../lib/pure.mjs';

const mod = await import('../index.mjs');

// --- HTTP harness ----------------------------------------------------------
// A capture webServer so apply()'s inject scope actually registers the settings
// route and hands us the handler, which the tests drive with mock req/res.
function makeRouteHarness() {
  const routes = [];
  const webServer = {
    register(config) {
      routes.push(config);
      return () => {};
    },
  };
  return { webServer, routes };
}

function makeReq(method, urlPath, body) {
  const listeners = { data: [], end: [], error: [] };
  const req = {
    method,
    url: `http://localhost/subagent-profiles${urlPath}`,
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    destroy() {},
  };
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  return {
    req,
    feed() {
      if (bodyText.length > 0) for (const fn of listeners.data) fn(Buffer.from(bodyText));
      for (const fn of listeners.end) fn();
    },
  };
}

function makeRes() {
  const state = { code: null, data: '' };
  return {
    state,
    writeHead(code) { state.code = code; },
    end(text) { state.data = text; },
  };
}

async function callRoute(handler, method, urlPath, body) {
  const { req, feed } = makeReq(method, urlPath, body);
  const res = makeRes();
  const p = handler(req, res);
  feed();
  await p;
  return { code: res.state.code, json: res.state.data ? JSON.parse(res.state.data) : null };
}

// apply() with a capture webServer; returns the route handler + the provided
// subagent-profiles service (to observe the in-memory registry post-load).
async function setupApp() {
  const { webServer, routes } = makeRouteHarness();
  const { ctx, records } = createFakeCtx({ services: { webServer } });
  await mod.apply(ctx);
  const service = records.provides.find((p) => p.name === 'subagent-profiles')?.service;
  return { routes, service };
}

// --- tests ------------------------------------------------------------------

test('persistProfiles: /add 触发原子写，产出 v2 文件且不留 .tmp', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { routes } = await setupApp();
    const handler = routes[0].handler;
    const resp = await callRoute(handler, 'POST', '/add', { id: 'custom', name: '我的方案\n第二行' });
    assert.equal(resp.code, 200);
    assert.equal(resp.json.ok, true);
    assert.equal(resp.json.id, 'custom');
    assert.equal(resp.json.persisted, true, '成功的磁盘写必须上报 persisted:true');
    const file = join(iso.dir, 'subagent-profiles.json');
    assert.ok(existsSync(file), '持久化文件必须存在');
    assert.ok(!existsSync(`${file}.tmp`), '原子写成功后 .tmp 必须被 rename 走（不残留）');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(parsed.version, 2, '写入恒为 v2 形态');
    assert.ok(Array.isArray(parsed.profiles));
    assert.equal(typeof parsed.allowFailOpen, 'boolean');
    const written = parsed.profiles.find((p) => p.id === 'custom');
    assert.ok(written, '新 profile 必须被写入');
    assert.equal(written.name, '我的方案 第二行', '写入的应为 sanitize 压平后的 name');
  } finally { iso.restore(); iso.teardown(); }
});

test('loadProfiles: 兼容 v1 数组 — persona 超长保留+提示、超限字段丢弃、坏条目跳过；写回后 allowFailOpen=true', async () => {
  const iso = makeIsolatedDshHome();
  try {
    // v1 = bare array（旧 schema）。legacy persona 超长；maxTokens 超上限；含坏条目。
    const legacyPersona = 'x'.repeat(PERSONA_MAX_CHARS + 50);
    writeFileSync(join(iso.dir, 'subagent-profiles.json'), JSON.stringify([
      { id: 'legacy', name: '旧数据', persona: legacyPersona, maxTokens: 999999 },
      { id: '', name: 'no id' },
      { name: 'id missing' },
      { id: 'ok', name: '好' },
    ]), 'utf8');
    const { routes, service } = await setupApp();
    const legacy = service.list().find((p) => p.id === 'legacy');
    assert.ok(legacy, 'v1 数据必须被读入内存');
    assert.equal(legacy.persona, legacyPersona, 'persona 超长必须保留原值，不截断');
    assert.equal(legacy.maxTokens, undefined, '超上限 maxTokens 必须被移除');
    assert.ok(!service.list().some((p) => p.id === ''), '空 id 条目必须被跳过');
    assert.ok(service.list().some((p) => p.id === 'ok'), '合法条目必须载入');
    // 触发一次写回（/add），验证写回后就是 v2 且 allowFailOpen=true。
    const handler = routes[0].handler;
    await callRoute(handler, 'POST', '/add', { id: 'trigger', name: 't' });
    const parsed = JSON.parse(readFileSync(join(iso.dir, 'subagent-profiles.json'), 'utf8'));
    assert.equal(parsed.version, 2, '写回后即为 v2 形态');
    assert.equal(parsed.allowFailOpen, true, 'v1 迁移写回必须以 fail-open 兼容标志');
    const writtenLegacy = parsed.profiles.find((p) => p.id === 'legacy');
    assert.equal(writtenLegacy.persona, legacyPersona, '写回不得截断超长 persona');
    assert.equal(writtenLegacy.maxTokens, undefined, '写回不得带回超上限 maxTokens');
  } finally { iso.restore(); iso.teardown(); }
});

test('loadProfiles: 读入 v2 对象按存储 allowFailOpen 取值并保持', async () => {
  const iso = makeIsolatedDshHome();
  try {
    writeFileSync(join(iso.dir, 'subagent-profiles.json'), JSON.stringify({
      version: 2,
      profiles: [{ id: 'user', name: '用户' }],
      allowFailOpen: false,
    }), 'utf8');
    const { routes, service } = await setupApp();
    assert.ok(service.list().find((p) => p.id === 'user'), 'v2 对象必须被读入');
    const handler = routes[0].handler;
    await callRoute(handler, 'POST', '/add', { id: 'trigger', name: 't' });
    const parsed = JSON.parse(readFileSync(join(iso.dir, 'subagent-profiles.json'), 'utf8'));
    assert.equal(parsed.allowFailOpen, false, 'v2 存储的 allowFailOpen:false 必须被保持');
  } finally { iso.restore(); iso.teardown(); }
});

test('persistProfiles: 写失败返回 persisted:false（HTTP 恒 200 + persistWarning），不 throw', async () => {
  // 让 DSH_HOME 指向一个父路径为普通文件的位置，使 writeFileSync(.tmp) 抛 ENOTDIR
  // —— 跨平台，无需权限位。
  const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-subagent-profile-fail-'));
  const blockerFile = join(tmpRoot, 'blocker');
  writeFileSync(blockerFile, 'x', 'utf8');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = join(blockerFile, 'dsh');
  try {
    const { routes } = await setupApp();
    const handler = routes[0].handler;
    const resp = await callRoute(handler, 'POST', '/add', { id: 'x', name: 'n' });
    assert.equal(resp.code, 200, '写失败必须恒 HTTP 200（B1）');
    assert.equal(resp.json.ok, true);
    assert.equal(resp.json.id, 'x');
    assert.equal(resp.json.persisted, false, '写失败必须上报 persisted:false');
    assert.equal(resp.json.persistWarning, '已保存但未持久化');
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

test('写入上限：/add 对超限/非法字段返回 400 中文错误', async () => {
  const iso = makeIsolatedDshHome();
  try {
    const { routes } = await setupApp();
    const handler = routes[0].handler;
    const overCap = await callRoute(handler, 'POST', '/add', { id: 'p', maxTokens: 999999 });
    assert.equal(overCap.code, 400);
    assert.equal(overCap.json.ok, false);
    assert.match(overCap.json.error, /写入被拒绝/);
    assert.match(overCap.json.error, /maxTokens/);
    const badToolFilter = await callRoute(handler, 'POST', '/add', { id: 'q', toolFilter: { allow: ['read', 5] } });
    assert.equal(badToolFilter.code, 400);
    assert.match(badToolFilter.json.error, /toolFilter/);
    const overDepth = await callRoute(handler, 'POST', '/add', { id: 'r', maxDepth: 99 });
    assert.equal(overDepth.code, 400);
    assert.match(overDepth.json.error, /maxDepth/);
  } finally { iso.restore(); iso.teardown(); }
});
