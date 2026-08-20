# dsh-subagent-profile

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">子 Agent 派发方案化插件 —— 用对的人（预设 / 模型 / 推理强度）干对的事</b><br /><br />
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  <img alt="Version: 0.1.0" src="https://img.shields.io/badge/version-0.1.0-blue.svg" />
  <img alt="DSH" src="https://img.shields.io/badge/DSH-0.1.0--rc.6%20~%20rc.8-blue.svg" />
</div>

<div align="center">English · <a href="README.zh.md">中文</a></div>

For [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH).

> *Thinking, Fast and Slow*: System 1 is fast and cheap, System 2 is slow and careful. The built-in `subagent` gives every subtask the same brain as its parent — no way to tell them apart. `dsh-subagent-profile` lets you pick per subtask: research with a fast brain, deep work with a careful one, saved as named **profiles**.

## Why the built-in `subagent` isn't enough

| | Built-in `subagent` | `dsh-subagent-profile` |
|---|---|---|
| Per-subtask model / preset | ❌ same brain for every subtask | ✅ pick per subtask |
| Reusable named setups | ❌ | ✅ profiles |
| Tool-scope narrowing | ❌ | ✅ whitelist ∩ parent, `run_code` always removed |
| Cost guardrails | ❌ | ✅ model / effort / tokens / depth capped |
| GUI management | ❌ | ✅ settings page |

## What it solves

- **Per-subtask control over the child's brain.** `dispatch` sets, per subtask: which preset (composition), which model, which reasoning effort, which tools, and the token cap. A research subtask and a coding subtask can run with completely different setups — something the plain `subagent` tool can't do (it only inherits the parent).
- **Named, reusable profiles.** A profile is one bundle of preset + model + reasoning effort + tool scope + persona. Save "research" as `researcher` (reasoning off, search-only tools) and dispatch with `dispatch(profile="researcher")`; two built-ins ship (`swap-standard` = full standard coding toolkit, `researcher`), and you can add/edit/remove your own in the settings page.
- **Fully observable.** Every result reports the effective profile / preset / model / reasoning effort; logs are tagged `[dsh-subagent-profile]`.

## Quick start

```bash
dsh plugin --profile web add dsh-subagent-profile        # published package
dsh plugin --profile web add ./dsh-subagent-profile      # from a local checkout
```

Restart `dsh web`. This is a standard **bundle plugin**: it provides the `dispatch` tool, the profile provider, the `subagent-profiles` service, the `/subagent-profiles/*` loopback management routes, the settings page (「子 Agent 方案」), and the `dispatch` tool-call card in the web GUI. On startup it also **self-installs an agent preset** — **`orchestrator`** (「编排者模式」) — pick it in the new-session preset picker. The sync is idempotent and re-runs on every startup, so upgrading the plugin updates the preset.

## Usage

### 1. Configure sub-agent profiles

Profiles are managed in the settings page — each one bundles preset + model + reasoning effort + tool scope (and optionally a persona), and can be enabled, disabled, edited, or reset individually.

![Built-in profile list — editable, deletable, individually toggleable](docs/screenshots/settings-page1.png)

![Configure profiles — the full settings page with the new-profile form](docs/screenshots/settings-page2.png)

### 2. Dispatch per subtask — the `dispatch` tool

```js
dispatch(
  profile: "researcher",        // preset + model + reasoning effort + tool scope
  prompt: "Survey the DSH plugin ecosystem and compare direct competitors",
  run_in_background: true
)
```

![dispatch tool-call card — every result shows what actually ran](docs/screenshots/dispatch-card.png)

## Profiles

Profiles live in `~/.dsh/subagent-profiles.json` and take effect immediately (edits are made from the settings page).

| Profile | Purpose |
|---|---|
| `swap-standard` | switch the child to the full standard coding toolkit |
| `researcher` | deep reasoning off, search-only tools |

## Safety model

Delegation never lets a subagent gain more power than you already have — this is the default, with no configuration:

- **Tools only shrink.** A child's tool set is the intersection of the profile's tools and the parent's tools, and `run_code` is always removed.
- **Approval is always "never".** A child cannot widen its own permissions; operations that need approval are rejected automatically.
- **Cost is capped.** Model, reasoning effort, tokens, and recursion depth are all bounded; out-of-range values fail loudly instead of silently downgrading.

## Data

- `~/.dsh/subagent-profiles.json` — the profile registry (edited from the settings page).
- `~/.dsh/subagent-profiles.state.json` — the plugin's enable/disable switch (default enabled).
- `~/.dsh/.agent-presets/orchestrator/` — the self-installed `orchestrator` agent preset (synced from the bundled `presets/orchestrator/` on every startup).

`DSH_HOME` is respected and defaults to `~/.dsh`.

## Known limitations

- **Background** one-shot dispatch requires `@deepseek-ai/dsh-jobs` and `@deepseek-ai/dsh-tool-jobs` to be loaded; otherwise it fails with "background jobs unavailable".
- **Continuable** mode goes through the DSH standard composition path, so the `preset` swap and `reasoningEffort` are ignored (the child inherits the parent preset at the default reasoning effort).

## Credits

The bundled `orchestrator` agent preset was inspired by [dsh-liangshen](https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-liangshen) (梁神模式) from [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui), licensed under Apache-2.0. Thanks to its author for the great work.

## License

[MIT](LICENSE) — Copyright (c) 2026 muzyLink
