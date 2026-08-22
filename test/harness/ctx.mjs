// test/harness/ctx.mjs — shared fake Cordis context for the V2 T0-1
// characterization snapshot. See test/README.md.
//
// Scope of this fake (SPEC §6.2): it mocks only the surfaces that the
// top-level `apply(ctx)` contract reaches in index.mjs — `inject` / `get` /
// `provide` / `effect` / `logger` / `subagents.registerProvider` /
// `tools.register` / `tools.schemas` / a `webServer`-provided scope /
// `systemPrompt.section|context`. It deliberately does NOT provide a working
// `agents.create` (SPEC says we must not mock it; instead the characterization
// test asserts apply() never touches it). provider.start / dispatch execute /
// the HTTP handler are NOT invoked by apply(), so this fake does not model
// them; those are explicitly out of scope for the snapshot and are asserted to
// be left untested (see test/README.md).
//
// Characterization, not simulation: this is a snapshot of the current observable
// apply-time wiring, not a full harness. If the host upgrades and a service
// signature changes (e.g. webServer.register or tools.register argument shape),
// this fake must be re-verified against the new signature.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- DSH_HOME isolation -------------------------------------------------------
// index.mjs's `dshHome()` is a function that reads `process.env.DSH_HOME` at
// call time (inside apply()). Setting it to a fresh temp directory BEFORE
// apply() keeps the preset self-install and the profile load from ever touching
// the real ~/.dsh. This is a precondition of the snapshot test — see README.
function makeIsolatedDshHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-subagent-profile-test-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  return {
    dir,
    previous,
    restore() {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    },
    teardown() {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
}

// A disposable returned by the faked registrations. It must be a callable
// function and must tolerate being invoked (apply() stores it and may close
// over it; nothing requires it to do work in the snapshot).
function makeDisposer() {
  return function disposer() {};
}

// Build a fake Cordis context. `options.services` overrides / seeds the service
// table read back by `ctx.get(name)` and consumed by `ctx.inject(deps, fn)`.
// `webServer` and `systemPrompt` are provided by default so an out-of-the-box
// apply() registers the settings route and the systemPrompt sections; override
// them to exercise the optional branches (e.g. no systemPrompt => no sections).
function createFakeCtx(options = {}) {
  const services = { ...(options.services ?? {}) };
  const records = {
    logs: { info: [], warn: [], error: [] },
    effects: [],
    injects: [],
    provides: [],
    registerProviderCalls: [],
    registerToolCalls: [],
    webServerRegisterCalls: [],
    sectionCalls: [],
    contextCalls: [],
    schemaCalls: [],
    agentCreateCalls: 0,
  };

  const logger = {
    info: (...args) => records.logs.info.push(args),
    warn: (...args) => records.logs.warn.push(args),
    error: (...args) => records.logs.error.push(args),
  };

  // Cordis `effect(fn)` runs the setup `fn` immediately and keeps the disposer
  // it returns; running it now is what lets the webServer.register call inside
  // the settings-route effect actually fire during apply().
  const runEffect = (fn, label) => {
    const disposer = fn();
    records.effects.push({ label, fn, disposer });
    return disposer;
  };

  const makeScope = (deps) => {
    const scope = {
      effect: runEffect,
      get: (name) => services[name],
      provide: (name, service) => records.provides.push({ name, service }),
      logger,
    };
    for (const dep of deps) scope[dep] = services[dep];
    return scope;
  };

  // webServer service (optional in the bundle; fake provides one by default so
  // the settings-route inject scope has something to call). Pass `{ webServer:
  // undefined }` to exercise the missing-webServer branch (the inject scope then
  // defers and the route is never registered).
  const webServer = 'webServer' in services
    ? services.webServer
    : {
        register(config) {
          records.webServerRegisterCalls.push(config);
          return makeDisposer();
        }
      };
  services.webServer = webServer;

  // systemPrompt service (optional in the bundle; fake provides one by default
  // so apply() registers the two systemPrompt sections the snapshot asserts).
  // Pass `{ systemPrompt: undefined }` to exercise the no-systemPrompt branch.
  const systemPrompt = 'systemPrompt' in services
    ? services.systemPrompt
    : {
        section(config) { records.sectionCalls.push(config); },
        context(config) { records.contextCalls.push(config); }
      };
  services.systemPrompt = systemPrompt;

  const ctx = {
    get(name) { return services[name]; },
    provide(name, service) { records.provides.push({ name, service }); },
    inject(deps, fn) {
      const scope = makeScope(deps);
      records.injects.push({ deps, fn, scope });
      // Match Cordis: run the callback only once every requested service is
      // present. A missing service (e.g. webServer not provided) defers forever,
      // which is what apply() expects — the settings-route registration is
      // optional. In the snapshot webServer is always provided, so fn runs.
      if (deps.every((dep) => services[dep] !== undefined)) fn(scope);
      return scope;
    },
    effect: runEffect,
    logger,
    subagents: {
      registerProvider(provider) { records.registerProviderCalls.push(provider); return makeDisposer(); },
      start() { throw new Error('ctx.subagents.start is not available in the characterization fake'); },
      startContinuable() { throw new Error('ctx.subagents.startContinuable is not available in the characterization fake'); }
    },
    tools: {
      register(tool) { records.registerToolCalls.push(tool); return makeDisposer(); },
      schemas(...args) { records.schemaCalls.push(args); return []; },
      restrict() { throw new Error('ctx.tools.restrict is not available in the characterization fake'); }
    },
    agents: {
      // Not implemented (SPEC §6.2). Present only as a tripwire: if apply()
      // ever reaches it at the top level, this throws loudly and bumps the
      // counter, which the characterization test asserts stays at 0.
      create() { records.agentCreateCalls += 1; throw new Error('ctx.agents.create is not implemented in the characterization fake — apply() must not reach it'); }
    }
  };

  return { ctx, records };
}

export { createFakeCtx, makeIsolatedDshHome };
