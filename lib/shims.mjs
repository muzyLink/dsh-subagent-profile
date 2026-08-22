// lib/shims.mjs — the convergence point for the @deepseek-ai symbols that
// readResult uses (V2 T0-2). index.mjs still direct-imports other @deepseek-ai
// symbols; those converge here only after the V2.0-mid 12-module split (target
// state). Keeping readResult out of index.mjs is what lets lib/pure.mjs stay
// import-free.

import { foldConsumedWork } from '@deepseek-ai/dsh-agent';
import { finalAssistantOutput } from '@deepseek-ai/dsh-subagent';
import { toStopReason } from './pure.mjs';

// readResult: shipped shape. The terminal turn reason comes from the imported
// foldConsumedWork; the selected output comes from the imported
// finalAssistantOutput (last non-empty assistant message, else joined
// text-delta chunks, else undefined -> []).
function readResult(child, boundary, cancelled) {
  const own = child.session.events.slice(boundary);
  const end = foldConsumedWork(own).end;
  const recorded = toStopReason(end?.data.reason);
  const stopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded;
  return { output: finalAssistantOutput(own) ?? [], stopReason };
}

export { readResult };
