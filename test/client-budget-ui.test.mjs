// test/client-budget-ui.test.mjs — 会话派发预算设置卡（成本与统计页签）源码结构断言。
// client.js 为浏览器 bundle（无 DOM 测试基建），与 settings-shell 同一方式做源码
// 断言：输入框/保存按钮/越界提示/说明文案/错误提示文案/提醒事件中文匹配。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8');

function functionBody(name) {
  const start = source.indexOf('function ' + name);
  assert.ok(start >= 0, '必须存在函数 ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('函数括号不平衡：' + name);
}

test('预算设置卡：说明文案 + 两输入框占位 + 保存按钮 + 越界提示齐备', () => {
  assert.ok(source.includes('预算达到上限时，该会话将停止派发新的子代理；已完成的派发不受影响。本预算按会话计，换新会话不累计；仅统计子代理消耗，不包含主会话自身用量。'), '人话说明必须逐字存在');
  assert.ok(source.includes("placeholder: '500000'"), 'token 上限输入框占位 500000');
  assert.ok(source.includes("placeholder: '8'"), '并发上限输入框占位 8');
  assert.ok(source.includes('会话派发 token 上限需为 100000~2000000 的整数'), 'token 越界中文提示必须存在');
  assert.ok(source.includes('并发派发数上限需为 1~32 的整数'), '并发越界中文提示必须存在');
  assert.ok(source.includes('预算设置已生效'), '保存后「已生效」提示必须存在');
  const card = functionBody('buildBudgetSettings');
  assert.match(card, /sap-candidateSettingsPanel/);
  assert.match(card, /onClick: actions\.saveBudget/, '保存按钮必须挂在卡内');
  const panel = functionBody('buildSectionReturn');
  assert.match(panel, /buildBudgetSettings\(el, s, actions\)/, '预算卡必须挂在成本与统计页签');
});

test('预算错误提示文案更新：指向「成本与统计」调高预算上限', () => {
  assert.ok(source.includes('并发派发数或本会话累计 token 已达上限，请等待在途任务完成、开启新会话 或 在「成本与统计」调高预算上限'));
  assert.ok(!source.includes('请等待在途任务完成或开启新会话'), '旧文案必须零残留');
});

test('提醒事件中文匹配：派发被预算上限中止', () => {
  assert.ok(source.includes("'dispatch-budget-limit': '派发预算中止'"), '审计事件必须映射中文');
});

test('保存动作：越界 fail-loud 不发请求，合法值 POST /set-budget', () => {
  const body = functionBody('attachBudgetActions');
  assert.match(body, /Number\.isInteger\(maxParentTokens\)/);
  assert.match(body, /100000/);
  assert.match(body, /2000000/);
  assert.match(body, /Number\.isInteger\(maxConcurrent\)/);
  assert.match(body, /api\('\/set-budget', \{ maxParentTokens, maxConcurrent \}\)/);
  assert.ok(body.indexOf('ZH.budgetTokensInvalid') < body.indexOf('api('), '越界错误在发请求之前');
});
