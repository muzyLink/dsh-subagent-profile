// test/facade.test.mjs — V2 Task 6a: the lib/shims.mjs facade surface.
//
// In this environment the @deepseek-ai packages are junctions that RESOLVE, so
// the real functions win the fail-soft path and the guard-type statics load.
// We cannot delete node_modules to simulate a host-rc rename here, so this test
// (a) asserts every exported helper is a callable function (the real shims that
// index.mjs now imports), and (b) drives the LOCAL fallback implementations
// (exported as `__fallbacks`) directly, locking the degraded semantics that a
// missing/renamed host symbol would select. See the Task 6a fallback-semantics
// report in lib/shims.mjs and the plan's §9.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const shims = await import('../lib/shims.mjs');

test('facade: guard-type helpers are the real fail-loud shims (callable, no fallback)', () => {
  assert.equal(typeof shims.assertSubagentMaxDepth, 'function');
  assert.equal(typeof shims.resolveChildDepth, 'function');
});

test('facade: every function-mapping helper + readResult is exported as a callable', () => {
  for (const name of [
    'foldConsumedWork',
    'finalAssistantOutput',
    'createUserMessage',
    'appendDelegatedPolicyOverrides',
    'captureDelegatedPolicyOverrides',
    'resolveChildAgentOptions',
    'defineTool',
    'readResult',
  ]) {
    assert.equal(typeof shims[name], 'function', `${name} must be exported as a callable`);
  }
});

test('facade: __fallbacks exposes every function-mapping local implementation', () => {
  for (const name of [
    'foldConsumedWork',
    'finalAssistantOutput',
    'createUserMessage',
    'appendDelegatedPolicyOverrides',
    'captureDelegatedPolicyOverrides',
    'resolveChildAgentOptions',
    'defineTool',
  ]) {
    assert.equal(typeof shims.__fallbacks[name], 'function', `__fallbacks.${name} must be a callable`);
  }
});

// --- fallback semantics ------------------------------------------------------

test('fallback createUserMessage: user-role message with a fresh id', () => {
  const msg = shims.__fallbacks.createUserMessage({ content: 'hi', source: { kind: 'user' } });
  assert.equal(msg.role, 'user');
  assert.equal(msg.content, 'hi');
  assert.deepEqual(msg.source, { kind: 'user' });
  assert.equal(typeof msg.id, 'string');
  assert.ok(msg.id.length > 0);
});

test('fallback resolveChildAgentOptions: merges parent route + requested + depth', () => {
  const opts = shims.__fallbacks.resolveChildAgentOptions(
    { options: { provider: 'p', model: 'm', maxTokens: 100 } },
    { maxTokens: 500 },
    2,
  );
  assert.deepEqual(opts, { provider: 'p', model: 'm', maxTokens: 500, subagentDepth: 2 });
});

test('fallback resolveChildAgentOptions: omits absent parent route fields', () => {
  const opts = shims.__fallbacks.resolveChildAgentOptions({ options: {} }, {}, 1);
  assert.deepEqual(opts, { subagentDepth: 1 });
});

test('fallback resolveChildAgentOptions: requested overrides parent route', () => {
  const opts = shims.__fallbacks.resolveChildAgentOptions(
    { options: { provider: 'p', model: 'm' } },
    { model: 'other' },
    3,
  );
  assert.deepEqual(opts, { provider: 'p', model: 'other', subagentDepth: 3 });
});

test('fallback captureDelegatedPolicyOverrides: approval pinned never when service present', () => {
  const overrides = shims.__fallbacks.captureDelegatedPolicyOverrides({
    ctx: { get: (name) => (name === 'approval' ? {} : undefined) },
    session: {},
  });
  assert.deepEqual(overrides, { sandboxMode: undefined, approvalPolicy: 'never' });
});

test('fallback captureDelegatedPolicyOverrides: no approval service -> no pin', () => {
  const overrides = shims.__fallbacks.captureDelegatedPolicyOverrides({
    ctx: { get: () => undefined },
    session: {},
  });
  assert.deepEqual(overrides, { sandboxMode: undefined, approvalPolicy: undefined });
});

test('fallback appendDelegatedPolicyOverrides: appends sandbox/mode and approval/policy', () => {
  const appended = [];
  shims.__fallbacks.appendDelegatedPolicyOverrides(
    { append: (type, data) => appended.push([type, data]) },
    { sandboxMode: 'workspace-write', approvalPolicy: 'never' },
  );
  assert.deepEqual(appended, [
    ['sandbox/mode', { mode: 'workspace-write', source: 'delegation' }],
    ['approval/policy', { policy: 'never', source: 'delegation' }],
  ]);
});

test('fallback appendDelegatedPolicyOverrides: no overrides -> no appends', () => {
  const appended = [];
  shims.__fallbacks.appendDelegatedPolicyOverrides(
    { append: (type, data) => appended.push([type, data]) },
    {},
  );
  assert.deepEqual(appended, []);
});

test('fallback finalAssistantOutput: last non-empty assistant/message wins', () => {
  const events = [
    { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'abc' } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hello' }] } } },
    { type: 'assistant/message', data: { message: { content: [] } } },
  ];
  assert.deepEqual(shims.__fallbacks.finalAssistantOutput(events), [{ type: 'text', text: 'hello' }]);
});

test('fallback finalAssistantOutput: no message -> accumulated text-delta', () => {
  const events = [
    { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'a' } } },
    { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'b' } } },
  ];
  assert.deepEqual(shims.__fallbacks.finalAssistantOutput(events), [{ type: 'text', text: 'ab' }]);
});

test('fallback finalAssistantOutput: no output -> undefined', () => {
  assert.equal(shims.__fallbacks.finalAssistantOutput([{ type: 'step/start', data: {} }]), undefined);
});

test('fallback foldConsumedWork: returns the last turn/end as .end for a stepped turn', () => {
  const end = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } };
  const result = shims.__fallbacks.foldConsumedWork([
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1 } },
    end,
  ]);
  assert.equal(result.end, end);
  assert.equal(result.droppedUnrun, false);
});

test('fallback foldConsumedWork: no turn/end -> empty .end', () => {
  assert.deepEqual(shims.__fallbacks.foldConsumedWork([{ type: 'turn/start', data: { turn: 1 } }]), { droppedUnrun: false });
});

test('fallback defineTool: throws the clear dsh-tools missing message', () => {
  assert.throws(() => shims.__fallbacks.defineTool({ name: 'x' }), {
    message: 'dsh-tools 缺失：dispatch 工具不可用',
  });
});

// --- loadSoft failure routing (injectable importer seals the catch / not-a-function branches) ---

test('loadSoft routing: importer throws -> catch branch selects the fallback + warns', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await shims.loadSoft('fake-pkg', 'missing', 'fallback-val', '路由告警', async () => {
      throw new Error('boom');
    });
    assert.equal(result, 'fallback-val');
    assert.ok(warnings.length >= 1, 'must emit a warning');
    assert.match(warnings[0], /路由告警/);
    assert.match(warnings[0], /导入失败/);
    assert.match(warnings[0], /boom/);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadSoft routing: importer returns a module missing the symbol -> not-a-function branch selects the fallback + warns', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await shims.loadSoft('fake-pkg', 'missing', 'fallback-val', '路由告警', async () => ({ other: 1 }));
    assert.equal(result, 'fallback-val');
    assert.ok(warnings.length >= 1, 'must emit a warning');
    assert.match(warnings[0], /路由告警/);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadSoft routing: importer returns the symbol as a function -> uses it, no warn', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const fn = () => 'real';
    const result = await shims.loadSoft('fake-pkg', 'present', 'fallback-val', '路由告警', async () => ({ present: fn }));
    assert.equal(result, fn);
    assert.equal(warnings.length, 0, 'no warning when the symbol resolves as a function');
  } finally {
    console.warn = originalWarn;
  }
});
