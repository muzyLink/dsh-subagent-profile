# dsh-subagent-profile

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">子 Agent 派发方案化插件 —— 用对的人（预设 / 模型 / 推理强度）干对的事</b><br /><br />
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  <img alt="Version: 0.1.0" src="https://img.shields.io/badge/version-0.1.0-blue.svg" />
  <img alt="DSH: 0.1.0-rc.8" src="https://img.shields.io/badge/DSH-0.1.0--rc.8-blue.svg" />
  <img alt="Node: ^22.19.0 || >=24" src="https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24-green.svg" />
</div>

<div align="center"><a href="README.md">English</a> · 中文</div>

为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）打造。

> 《思考，快与慢》：系统 1 快而省，系统 2 慢而稳。内置的 `subagent` 给所有子任务同一个「大脑」，分不出快慢；`dsh-subagent-profile` 让你按任务指定——调研用快思考，攻坚用慢思考，常用搭配存成命名**方案**。

## 为什么内置 `subagent` 不够用

| | 内置 `subagent` | `dsh-subagent-profile` |
|---|---|---|
| 按子任务指定模型/预设 | ❌ 每个子任务同一个大脑 | ✅ 每个子任务单独指定 |
| 常用组合复用 | ❌ | ✅ 命名方案（profiles） |
| 收窄工具范围 | ❌ | ✅ 白名单 ∩ 父工具，`run_code` 一律移除 |
| 成本护栏 | ❌ | ✅ 模型/推理强度/token/深度上限 |
| GUI 管理 | ❌ | ✅ 设置页 |

## 解决什么问题

- **按子任务指定子 Agent 的「大脑」。** `dispatch` 给每个子任务单独指定：用哪个预设（composition）、哪个模型、哪种推理强度、只开哪些工具、给多少 token 上限。查资料和写代码两个子任务可以用完全不同的配置——这是内置 `subagent` 做不到的（它只能让子任务继承父 Agent 的同一套配置）。
- **把常用搭配存成命名方案，按名调用。** 「方案」= 预设 + 模型 + 推理强度 + 工具范围 + 人设的一揽子配置。把「调研」存成 `researcher`（关深度推理、只留检索工具），以后 `dispatch(profile="researcher")` 即可；内置 `swap-standard`（切到 standard 全套编码工具）和 `researcher` 两个现成方案，也能在设置页自己增删改。
- **每次派发都看得见实际用了什么。** 结果里标注实际生效的方案/预设/模型/推理强度，日志带 `[dsh-subagent-profile]` 标记，方便排查。

## 快速开始

```bash
dsh plugin --profile web add dsh-subagent-profile        # 发布包
dsh plugin --profile web add ./dsh-subagent-profile      # 本地检出
```

装完**重启 `dsh web`**。这是一个标准 **bundle 插件**，装好后自动提供：`dispatch` 派发工具、profile provider、`subagent-profiles` 服务、`/subagent-profiles/*` 本机管理接口，以及 Web 界面里的「子 Agent 方案」设置页与 `dispatch` 工具调用卡片。插件启动时还会**自动装好一个 agent 预设**——**`orchestrator`「编排者模式」**，在「新建会话」的预设选择器里选它即可。同步幂等、每次启动都执行，升级插件即更新预设。

## 用法

### 1. 配置子 Agent 方案

在设置页管理命名方案——每个方案打包预设 + 模型 + 推理强度 + 工具范围（可选人设），可单独启用、禁用、编辑或批量重置。

![内置方案列表：可编辑、删除、单独启用/禁用](docs/screenshots/settings-page1.png)

![配置方案：设置页全貌（含新建方案表单）](docs/screenshots/settings-page2.png)

### 2. 按任务派发 —— `dispatch` 工具

```js
dispatch(
  profile: "researcher",        // 预设 + 模型 + 推理强度 + 工具范围
  prompt: "调研 DSH 插件生态，列出直接竞品并对比",
  run_in_background: true
)
```

![dispatch 工具调用卡片：每次派发都显示实际生效的配置](docs/screenshots/dispatch-card.png)

## 方案（Profiles）

方案保存在 `~/.dsh/subagent-profiles.json`，改完立即生效（在设置页编辑）。

| 方案 | 用途 |
|---|---|
| `swap-standard` | 子 Agent 切换为 standard 全套编码工具 |
| `researcher` | 关深度推理、只留检索工具 |

## 安全模型

委派绝不会让子 Agent 拿到比你更多的权限，默认生效、无需配置：

- **工具只减不增。** 子 Agent 最终能用的工具，是「方案允许的工具」和「主 Agent 已有工具」的交集，且 `run_code`（运行代码）一律移除。
- **审批恒为「永不」。** 子 Agent 无法扩大自己的权限，需要审批的操作会被自动拒绝。
- **成本设上限。** 模型、推理强度、token、递归深度都有限制，越界直接报错、不会悄悄降级。

## 数据

- `~/.dsh/subagent-profiles.json` —— 方案注册表（由设置页编辑）。
- `~/.dsh/subagent-profiles.state.json` —— 插件的启用/禁用开关（默认启用）。
- `~/.dsh/.agent-presets/orchestrator/` —— 自动安装的 `orchestrator` 编排者预设（每次启动由打包的 `presets/orchestrator/` 同步）。

尊重 `DSH_HOME`，默认 `~/.dsh`。

## 已知限制

- **后台**一次性派发需要加载 `@deepseek-ai/dsh-jobs` 与 `@deepseek-ai/dsh-tool-jobs`，否则报「background jobs unavailable」。
- **可续跑**模式走 DSH 标准组合路径，因此 `preset` 换用与 `reasoningEffort` 会被忽略（继承父预设、使用默认推理强度）。

## 致谢

内置的 `orchestrator` 编排者预设的构成方式参考了 [dsh-liangshen（梁神模式）](https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-liangshen)（出自 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)，Apache-2.0 许可）。感谢作者的出色工作。

## License

[MIT](LICENSE) — Copyright (c) 2026 muzyLink
