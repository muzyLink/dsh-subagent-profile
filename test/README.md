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

## Snapshot, not full simulation

The fake context in `test/harness/ctx.mjs` models **only** the surfaces the
`apply()` top-level contract touches: `inject` / `get` / `provide` / `effect` /
`logger` / `subagents.registerProvider` / `tools.register` / `tools.schemas` /
a `webServer`-backed scope / `systemPrompt.section|context`. It deliberately
does **not** model `provider.start`, `dispatch.execute`, the HTTP handler, or
`agents.create` (SPEC §6.2 / §6.3b "不单测" — the top-level contract is already
snapshotted here; per-branch mirrors would only manufacture false coverage).

## Known churn surfaces (expected maintenance, not defects)

Two snapshot assertions are intentionally coupled to the plugin's current design
choices and **will** need re-baselining when those choices change:

- the `systemPrompt` section set and their `order` values (`dispatch:profiles`
  at `116.5`, `orchestrator:mode` at `117`), and
- the `profile` provider's `capabilities` field set (and its sibling
  `inheritsParentContext`).

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

