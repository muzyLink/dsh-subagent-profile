// lib/pure.mjs — import-free pure helpers extracted from index.mjs (V2 T0-2).
// These four have no @deepseek-ai imports and no external dependencies; each
// function body is verbatim from index.mjs. @deepseek-ai symbols stay out of
// this module — the readResult symbols converge in lib/shims.mjs, and index.mjs's
// remaining direct @deepseek-ai imports converge there too after the V2.0-mid
// 12-module split (target state).

// Shipped toStopReason: map a turn-end reason to the seam's terminal vocabulary.
export function toStopReason(reason) {
  switch (reason?.kind) {
    case 'completed': return 'completed';
    case 'max-tokens': return 'max-tokens';
    case 'aborted': return 'aborted';
    case 'blocked': return 'refusal';
    default: return 'error';
  }
}

// Shipped stopReasonError + withPartialText wording (dsh-tool-subagent L55-75).
export function stopReasonError(result) {
  switch (result.stopReason) {
    case 'completed': return;
    case 'aborted': return 'dispatch: subagent run was cancelled';
    case 'error': return 'dispatch: subagent run failed';
    case 'max-tokens': return 'dispatch: subagent run hit its token limit before finishing';
    case 'refusal': return 'dispatch: subagent declined the task';
    default: return `dispatch: subagent run ended abnormally (${String(result.stopReason)})`;
  }
}

export function withPartialText(error, output) {
  const text = (Array.isArray(output) ? output : [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('');
  return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`;
}

export function textFrom(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}
