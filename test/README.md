# test/ — characterization & pure-function tests

This is the V2 T0-1 test infrastructure. It adds zero **new** dependency: only the
built-in `node:test` runner is used, and no npm packages are added. Note that this is
**not** bare-CI runnable: the characterization test re-imports `../index.mjs`,
which depends on the `@deepseek-ai/*` peer packages (present here as a local
junction). After the V2.0-mid 12-module split, the pure modules and their unit
tests will run green on a bare CI with no @deepseek-ai. This is also **not** a
harness simulation.

## What it locks

- `characterization.test.mjs` — a **snapshot** of the observable `apply(ctx)`
  wiring of `../index.mjs`: provider registration, tool registration, the
  `subagent-profiles` service, the `systemPrompt` sections, and the guarantee
  that `agents.create` is never touched at apply time. It re-imports
  `index.mjs` and calls `apply(fakeCtx)` directly.
- `pure.test.mjs` — true unit tests for the import-free helpers in
  `lib/pure.mjs` (`textFrom` / `toStopReason` / `stopReasonError` /
  `withPartialText`).
- `continuable-guard.test.mjs` — V2 安全 P0-b（§7.1）：`computeContinuableAllow`
  闭集计算（run_code 恒剔 / deny 生效 / allow 交集 / 空集 fail-loud / 去重等
  11 用例），加一条经 dispatch.execute 的**禁用路径**（enabled=false 时 continuable
  分支 fail-loud）。
- `cost-guard.test.mjs` — V2 安全 P0-b（§7.3）：`assertHardLimits` 硬上限 always-on
  （不随 llm 缺失失效），加 llm 缺失 / 空 provider 目录下按 `allowFailOpen` 的
  fail-loud / fail-open 分支（经 dispatch.execute 触发），并断言空目录在 model
  校验前短路（listModels 不可达）。
- `gating.test.mjs` — V2 Token P0（§8.1）：`dispatch:profiles` / `orchestrator:mode`
  两段 section 的 text() 门控分支——有 dispatch 工具→非空；无 dispatch→空；
  `composedPreset==='orchestrator'` 回退→非空；enabled=false→空。
- `recycle.test.mjs` — V2 Token P0（§8.2/§8.4/R1）：`pruneBlocks` 默认剪枝纯函数
  （有 pruner→剪、缺失/抛错/非数组→不剪）；`assertResultSchemaConsistency` 锁定
  R1 三分支共享元数据键集一致（漏 `ignored` 即 throw）；`envelope` 参数 schema 暴露
  且 execute 不消费；前台路径注入 toolResultPruner 后 pruneContent 在 textFrom 前
  被调用。

## §8.1 prompt-gate criterion (the one the code actually uses)

Both `dispatch:profiles` and `orchestrator:mode` sections are gated so they are
injected **only** into orchestrator sessions (SPEC §8.1). The judge is taken
from the host source, not a guess:

- `dsh-system-prompt`'s `assemble()` calls each section's `text` as
  `section.text(context)`, and the agent loop supplies that context via
  `assembleContextFor(agent, signal)` = `{ agent, scope: agent, signal }`
  (`@deepseek-ai/dsh-agent`). So `text()` **does** receive the current agent.
- **Primary judge (preset feature)**: `ctx.get('agentPresets').composedPreset(agentCtx) ===
  'orchestrator'`, where `agentCtx` prefers `context.agent.ctx` (the agent's ctx,
  the arg `composedPreset(agentCtx)` actually expects — `@deepseek-ai/dsh-agent-presets`),
  falling back to the plugin `ctx` when no agent is available. This is the reliable
  "is this an orchestrator session" signal. The first gate stays `!enabled → ''`.
- **Veto (defensive)**: dispatch is registered by this host row and, via
  `dsh-tools.schemas(scope)`'s global inheritance start, is **always visible to
  every agent** — so `schemas(agent)` containing `dispatch` is **恒真** and cannot
  be the primary judge. It is instead a **veto**: if `schemas(agent)` explicitly
  does NOT contain `dispatch`, the section is empty (defends against any host
  behavior that hides `dispatch`; it never fires in the normal path).
- **Fallback**: when `agentPresets` / `composedPreset` is unavailable we cannot
  determine the preset feature, so the section is empty (conservative, no leak).

## §8.2 recycle pruning (host `toolResultPruner.pruneContent`)

`pruneBlocks(blocks, pruner)` reuses the host pruner before `textFrom` at both
foreground and background (`settleStart`) call sites. Note: the host pruner's
`pruneContent(blocks)` reads its **own** configured budgets
(`thresholdChars`/`headChars`/`tailChars`) and returns `null` when within budget;
the `PRUNE_HEAD_CHARS` / `PRUNE_TAIL_CHARS` / `PRUNE_MIN_KEEP` constants in
`lib/pure.mjs` document the intended **child-level** budget (待实测) and are
reserved for a future refined-prune/envelope path. When the pruner is absent or
the content is non-array, pruning is skipped (剪枝是增强、非硬依赖).

## Snapshot, not full simulation

The fake context in `test/harness/ctx.mjs` models **only** the surfaces the
`apply()` top-level contract touches: `inject` / `get` / `provide` / `effect` /
`logger` / `subagents.registerProvider` / `tools.register` / `tools.schemas` /
a `webServer`-backed scope / `systemPrompt.section|context`. It deliberately
does **not** model `provider.start`, `dispatch.execute`, the HTTP handler, or
`agents.create` (SPEC §6.2 / §6.3b "不单测" — the top-level contract is already
snapshotted here; per-branch mirrors would only manufacture false coverage).

The fake's `tools.schemas(...)` defaults to `[{ name: 'dispatch' }]` so an
out-of-the-box `apply()` registers dispatch-capable sections; pass
`toolSchemas: []` to simulate a non-dispatch-capable agent, and `subagentsStart`
to inject a fake parent-agent driver for recycle/execute tests.

## Known churn surfaces (expected maintenance, not defects)

Two snapshot assertions are intentionally coupled to the plugin's current design
choices and **will** need re-baselining when those choices change:

- the `systemPrompt` section set and their `order` values (`dispatch:profiles`
  at `116.5`, `orchestrator:mode` at `117`) — and, after §8.1, that both `text`
  values are **functions** taking an assembly `context` (the gate reads
  `context.agent`), and
- the `profile` provider's `capabilities` field set (and its sibling
  `inheritsParentContext`).

### T5 snapshot re-baseline

The §8.1 gate changed `dispatch:profiles` / `orchestrator:mode` `text` from a
no-arg string/function to a `text(context)` function that returns `''` unless
the current agent's composed preset is `orchestrator` (preset-feature primary
judge) AND the tool schema still contains `dispatch` (which is the host-global
always-true default, so only a defensive veto). The old snapshot asserted a
`string`/no-arg render; under the new contract the gate requires an
`agentPresets.composedPreset` stub returning `'orchestrator'` plus the default
dispatch-capable `toolSchemas`, so the characterization test now creates the fake
with `services: { agentPresets: { composedPreset: () => 'orchestrator' } }` and
calls `text({ agent: {} })`. That is the only assertion changed; the section set /
order / capabilities assertions are untouched.

These are **known churn surfaces**: when the host upgrades or a designer
deliberately changes them, the characterization assertions must be updated
together with the change. That is a normal, expected maintenance action — it is
not a bug. Treat a diff that only touches these assertions (without touching the
plugin's behavior) as an intentional re-baseline, not a regression.

## Updating on a host upgrade

If the host (or the `@deepseek-ai/*` packages) changes the signature of any
service `apply()` consumes — e.g. `webServer.register` arg shape,
`tools.register` / `tools.schemas` shapes, `subagents.registerProvider` contract,
`systemPrompt.section` — this fake **must be re-verified against the new
signature**. The comments in `ctx.mjs` mark exactly which fake methods are the
contract seams. Re-run `npm test` after such an upgrade; a shape mismatch shows
up as the fake failing to drive `apply()`, not as a silent pass.

## DSH_HOME isolation

`index.mjs`'s `dshHome()` reads `process.env.DSH_HOME` at call time (inside
`apply()`). To keep the preset self-install (writes to `${DSH_HOME}/.agent-presets`)
and the profile load (reads `${DSH_HOME}/subagent-profiles.json`) away from the
real `~/.dsh`:

- `test/harness/ctx.mjs` exports `makeIsolatedDshHome()`, which creates a
  unique temp dir under `os.tmpdir()`, sets `process.env.DSH_HOME` to it, and
  returns a handle to restore / clean up.
- `characterization.test.mjs` calls it **before** `import('../index.mjs')` and
  restores + removes the temp dir on process exit.
- The snapshot test asserts `process.env.DSH_HOME` equals the temp dir during
  `apply()` and that the preset sync wrote into `${DSH_HOME}/.agent-presets` —
  i.e. the side effects were routed through the isolated home.

Run with:

```bash
npm test                          # from the repo root
# or directly (Node expands the glob itself, so any shell works):
node --test "test/**/*.test.mjs"
```

> **Node 24 note**: `node --test test/` (a bare directory argument) no longer
> scans for test files in this Node version — it treats the path as a single
> module and fails with `MODULE_NOT_FOUND`. The glob form above is what works
> and is what `npm test` runs. It matches only `*.test.mjs`.

