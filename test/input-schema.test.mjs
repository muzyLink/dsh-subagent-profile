// test/input-schema.test.mjs — V2 安全 P0-a 统一输入 schema 的纯函数单测
// （SPEC §7.2 / §12.1）。这些用例直接测 lib/pure.mjs 的 sanitizeProfile，不触碰
// index.mjs / fs —— 与 loadProfiles、/add 写路径共用同一个纯函数。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeProfile,
  PERSONA_MAX_CHARS,
  GUIDANCE_PREFIX,
  MAX_TOKENS,
  MAX_DEPTH,
} from '../lib/pure.mjs';

test('sanitizeProfile: 非对象根返回空 clean + 一条根警告', () => {
  for (const bad of [null, undefined, 'x', 5, []]) {
    const { clean, warnings } = sanitizeProfile(bad);
    assert.equal(Object.getPrototypeOf(clean), null, 'clean 必须是空原型对象（防污染兜底）');
    assert.equal(Object.keys(clean).length, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].field, '(root)');
  }
});

test('sanitizeProfile: 自带 __proto__ 键被丢弃，不产生原型污染（P1-1）', () => {
  // JSON.parse 可产生 OWN __proto__ 属性；过去 default 透传会改写 clean 的原型，
  // 使 clean.toolFilter 沿原型链解析到攻击者值。白名单 + 空原型后必须被丢弃。
  const { clean, warnings } = sanitizeProfile(JSON.parse('{"id":"x","__proto__":{"toolFilter":{"allow":["boom"]}}}'));
  assert.equal(Object.getPrototypeOf(clean), null, 'clean 原型必须未被改写');
  assert.equal(clean.__proto__, undefined, 'clean 不得带 __proto__ 键');
  assert.equal(clean.toolFilter, undefined, '越权 toolFilter 不得经原型链泄漏');
  assert.equal(clean.id, 'x');
  assert.ok(warnings.some((w) => w.field === '__proto__' && /未知字段已忽略/.test(w.reason)));
});

test('sanitizeProfile: constructor / prototype 键同样被丢弃（P1-1）', () => {
  const { clean, warnings } = sanitizeProfile(JSON.parse('{"id":"x","constructor":{"prototype":{"polluted":true}},"prototype":{"x":1}}'));
  assert.equal(Object.getPrototypeOf(clean), null);
  assert.equal(clean.constructor, undefined, 'constructor 不得被复制');
  assert.equal(clean.prototype, undefined, 'prototype 不得被复制');
  assert.ok(warnings.some((w) => w.field === 'constructor'));
  assert.ok(warnings.some((w) => w.field === 'prototype'));
});

test('persona：长度在含引导前缀上限内时原样保留，无警告', () => {
  const persona = 'p'.repeat(PERSONA_MAX_CHARS - GUIDANCE_PREFIX.length); // 恰好达到上限
  const { clean, warnings } = sanitizeProfile({ id: 'x', persona });
  assert.equal(clean.persona, persona);
  assert.equal(warnings.length, 0);
});

test('persona 超长 strict=false（迁移读入）：保留原值 + 警告，不截断', () => {
  const persona = 'p'.repeat(PERSONA_MAX_CHARS + 100);
  const { clean, warnings } = sanitizeProfile({ id: 'x', persona }, { strict: false });
  assert.equal(clean.persona, persona, '迁移读入必须保留原值（不截断）');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].field, 'persona');
  assert.match(warnings[0].reason, /超长/);
});

test('persona 超长 strict=true（写路径）：从 clean 移除 + 警告（拒绝写入）', () => {
  const persona = 'p'.repeat(PERSONA_MAX_CHARS + 100);
  const { clean, warnings } = sanitizeProfile({ id: 'x', persona }, { strict: true });
  assert.equal(clean.persona, undefined, '写路径 strict=true 必须拒绝超长 persona');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].field, 'persona');
  assert.match(warnings[0].reason, /拒绝写入/);
});

test('description/name：回车（\n / \r\n / \r）被压平为空格，无警告', () => {
  const { clean, warnings } = sanitizeProfile({
    id: 'x',
    name: '编码\n方案',
    description: '第一行\r\n第二行\r第三行',
  });
  assert.equal(clean.name, '编码 方案');
  assert.equal(clean.description, '第一行 第二行 第三行');
  assert.equal(warnings.length, 0);
});

test('description/name 非字符串：被移除字段 + 警告', () => {
  const { clean, warnings } = sanitizeProfile({ id: 'x', description: 42 });
  assert.equal(clean.description, undefined);
  assert.ok(warnings.some((w) => w.field === 'description' && /必须为字符串/.test(w.reason)));
});

test('description/name 为 null/"" 是清除信号，原样透传且不警告（供 /add merge 清除字段）', () => {
  const a = sanitizeProfile({ id: 'x', description: null, name: '' });
  assert.equal(a.clean.description, null);
  assert.equal(a.clean.name, '');
  assert.equal(a.warnings.length, 0);
});

test('maxTokens / maxDepth 超限：字段被移除 + 警告；上限以内保留', () => {
  const { clean, warnings } = sanitizeProfile({
    id: 'x',
    maxTokens: MAX_TOKENS + 1,
    maxDepth: MAX_DEPTH + 1,
  });
  assert.equal(clean.maxTokens, undefined);
  assert.equal(clean.maxDepth, undefined);
  assert.ok(warnings.some((w) => w.field === 'maxTokens' && /超过上限/.test(w.reason)));
  assert.ok(warnings.some((w) => w.field === 'maxDepth' && /超过上限/.test(w.reason)));

  const ok = sanitizeProfile({ id: 'x', maxTokens: MAX_TOKENS, maxDepth: MAX_DEPTH });
  assert.equal(ok.clean.maxTokens, MAX_TOKENS);
  assert.equal(ok.clean.maxDepth, MAX_DEPTH);
  assert.equal(ok.warnings.length, 0);
});

test('maxTokens / maxDepth 非数字：被移除 + 警告', () => {
  const { clean, warnings } = sanitizeProfile({ id: 'x', maxTokens: 'big', maxDepth: '3' });
  assert.equal(clean.maxTokens, undefined);
  assert.equal(clean.maxDepth, undefined);
  assert.equal(warnings.length, 2);
});

test('toolFilter：allow/deny 去重、丢弃空字符串，非法条目导致该子字段被移除', () => {
  const { clean } = sanitizeProfile({
    id: 'x',
    toolFilter: { allow: ['read', 'read', 'write', ''], deny: ['run_code', 'run_code'] },
  });
  assert.deepEqual(clean.toolFilter, { allow: ['read', 'write'], deny: ['run_code'] });
  assert.equal(clean.toolFilter.allow.length, 2);
  assert.equal(clean.toolFilter.deny.length, 1);

  // 非法子字段按字段粒度丢弃：allow 含非字符串被移除，deny 仍被保留。
  const bad = sanitizeProfile({ id: 'x', toolFilter: { allow: ['read', 5], deny: ['run_code'] } });
  assert.deepEqual(bad.clean.toolFilter, { deny: ['run_code'] });
  assert.ok(bad.warnings.some((w) => w.field === 'toolFilter.allow' && /必须为字符串数组/.test(w.reason)));
});

test('toolFilter：全部为空时（空数组/非法）不产生 clean.toolFilter', () => {
  const { clean, warnings } = sanitizeProfile({ id: 'x', toolFilter: { allow: [], deny: [] } });
  assert.equal(clean.toolFilter, undefined);
  assert.equal(warnings.length, 0, '空数组是正常归一（清除），不算警告');
});

test('toolFilter 非对象：被移除 + 警告', () => {
  const { clean, warnings } = sanitizeProfile({ id: 'x', toolFilter: ['read'] });
  assert.equal(clean.toolFilter, undefined);
  assert.ok(warnings.some((w) => w.field === 'toolFilter'));
});

test('其余字段（id / preset / enabled 等）原样透传', () => {
  const input = { id: 'custom', preset: 'standard', provider: 'x', enabled: true, builtin: true };
  const { clean, warnings } = sanitizeProfile(input);
  assert.equal(clean.id, 'custom');
  assert.equal(clean.preset, 'standard');
  assert.equal(clean.provider, 'x');
  assert.equal(clean.enabled, true);
  assert.equal(clean.builtin, true);
  assert.equal(warnings.length, 0);
});
