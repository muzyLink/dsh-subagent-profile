// test/pure.test.mjs — true unit tests for the import-free helpers extracted
// into lib/pure.mjs (V2 T0-2). These are the only pure module functions; they
// carry no @deepseek-ai dependency and no fs side effects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textFrom, toStopReason, stopReasonError, withPartialText } from '../lib/pure.mjs';

test('toStopReason maps turn-end reasons to the seam terminal vocabulary', () => {
  assert.equal(toStopReason({ kind: 'completed' }), 'completed');
  assert.equal(toStopReason({ kind: 'max-tokens' }), 'max-tokens');
  assert.equal(toStopReason({ kind: 'aborted' }), 'aborted');
  assert.equal(toStopReason({ kind: 'blocked' }), 'refusal');
  assert.equal(toStopReason({ kind: 'whatever' }), 'error');
  assert.equal(toStopReason(undefined), 'error');
});

test('stopReasonError maps complete (no error) and the terminal stops', () => {
  assert.equal(stopReasonError({ stopReason: 'completed' }), undefined);
  assert.equal(stopReasonError({ stopReason: 'aborted' }), 'dispatch: subagent run was cancelled');
  assert.equal(stopReasonError({ stopReason: 'error' }), 'dispatch: subagent run failed');
  assert.equal(stopReasonError({ stopReason: 'max-tokens' }), 'dispatch: subagent run hit its token limit before finishing');
  assert.equal(stopReasonError({ stopReason: 'refusal' }), 'dispatch: subagent declined the task');
  assert.equal(stopReasonError({ stopReason: 'weird' }), 'dispatch: subagent run ended abnormally (weird)');
});

test('textFrom joins only text blocks with string text', () => {
  assert.equal(textFrom(undefined), '');
  assert.equal(textFrom('nope'), '');
  assert.equal(textFrom([]), '');
  assert.equal(textFrom([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab');
  // Non-text blocks and non-string text are dropped.
  assert.equal(textFrom([{ type: 'image' }, { type: 'text', text: 'x' }, { type: 'text' }, { type: 'text', text: 5 }]), 'x');
});

test('withPartialText: empty output returns the error unchanged', () => {
  assert.equal(withPartialText('boom', []), 'boom');
  assert.equal(withPartialText('boom', undefined), 'boom');
  assert.equal(withPartialText('boom', [{ type: 'image' }]), 'boom');
  assert.equal(withPartialText('boom', [{ type: 'text', text: '' }]), 'boom');
});

test('withPartialText: error plus a text output is concatenated with the header', () => {
  assert.equal(
    withPartialText('boom', [{ type: 'text', text: 'partial' }]),
    'boom\nPartial output before the run ended:\npartial'
  );
  // Mixed blocks: only text blocks are included.
  assert.equal(
    withPartialText('boom', [{ type: 'image' }, { type: 'text', text: 'a' }]),
    'boom\nPartial output before the run ended:\na'
  );
});

test('withPartialText: no error yet a text output still produces the header (empty prefix)', () => {
  assert.equal(
    withPartialText('', [{ type: 'text', text: 'p' }]),
    '\nPartial output before the run ended:\np'
  );
});
