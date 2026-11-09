// eslint.config.js — 行门：单文件 ≤400 行、单函数 ≤50 行（数据表豁免 + 完整性
// 护栏；client.js 文件级按 ADR 豁免）。拒绝 baseline disable：无整文件
// /* eslint-disable */ 豁免。注释行不计入行门：注释写的是行为与契约，不构成
// 函数内控制流，口径按代码行计。

import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    ignores: ['presets/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        fetch: 'readonly', // Node 18+ 内置全局（host 侧 scripts 合法使用）
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
  // 行门：全仓库 ≤400 行/文件（client.js 按 ADR 豁免文件级；presets/** 为搬运
  // 冻结的上游预设内容、内容零修改，行门豁免——一致性由 preflight byte 对账守护）
  {
    files: ['**/*.mjs', '**/*.js'],
    ignores: ['lib/client.js', 'presets/**'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
    },
  },
  // client.js：文件级 max-lines 按 ADR 永久豁免（module-host 单 bundle 契约，
  // 无相对 require/多文件路由，物理多文件拆分需引入构建，违背无构建基线）。
  // 函数级行门（≤50）全量生效：纯数据/纯函数上提模块作用域，React 依赖件经
  // 参数注入的 maker（makeChip / makeDispatchToolview / makeProfilesSection）
  // 装配。拆分决策的完整论证见 docs/ADR-client-js-split.md（本机内部文档，不入 git）。
  {
    files: ['lib/client.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        __ModuleLoader__: 'readonly',
      },
    },
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
    },
  },
  // catalog.mjs 数据表豁免（纯键值映射数据表豁免 + 完整性护栏，护栏在测试）
  {
    files: ['lib/core/catalog.mjs'],
    rules: {
      'max-lines-per-function': 'off', // 数据表本身无函数；防误报保险
    },
  },
  // test/ 不套行门（测试文件本身不该被 50 行函数限制扼杀）
  {
    files: ['test/**/*.mjs'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
  // presets/** 全局豁免：搬运冻结的上游预设内容（如编排者模式 V2 的
  // custom-bash.mjs / tool-bootstrap.mjs），内容零修改，行门/推荐规则均不适用；
  // 其一致性由 preflight 的 byte 对账守护。
  {
    ignores: ['presets/**'],
  },
];
