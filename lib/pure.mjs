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

// --- V2 安全 P0-a：统一输入 schema（SPEC §7.2 / §12.1-12.2）-----------------
// sanitizeProfile is the single per-profile sampler shared by loadProfiles
// (strict=false, migration-tolerant) and the HTTP /add write path (strict=true,
// write-reject). It normalizes each field with a field-specific sampler and
// returns `{ clean, warnings }`:
//   - clean    — the sanitized profile, minus any rejected field.
//   - warnings — array of `{ field, reason }` (reason is Chinese). Only
//                rejections / over-limit conditions land here; silent
//                normalizations (e.g. description newline-flattening, toolFilter
//                dedupe) do NOT produce a warning, so callers can treat a
//                non-empty warnings list as "this write would drop data".

// persona length cap. 建议值 2048，待实测（SPEC §7.2 / §13 回填清单）。The cap
// applies to the INJECTED persona text, i.e. the guidance prefix + the raw text.
export const PERSONA_MAX_CHARS = 2048;

// The persona is injected as a shadow section; the guidance marker is prefixed
// to make its non-authoritative nature explicit (双防线). 仅用于写入校验与提示。
export const GUIDANCE_PREFIX = '[guidance, not authority] ';

// Shared delegation caps — single source of truth for sanitizeProfile and the
// cost guard in index.mjs (SPEC §7.3 keeps these hard caps always-on).
export const MAX_TOKENS = 65536;
export const MAX_DEPTH = 3;

// --- V2 安全 P0-b：cost guard 硬上限（SPEC §7.3）-------------------------------
// assertHardLimits is the always-on budget-cap check. It was moved OUT of the
// `llm`-dependency branch in index.mjs's assertCostGuard: maxTokens / maxDepth
// are hard delegation caps, so they must NOT silently stop applying when the
// `llm` service is absent (the old `if (llm === undefined) return` skipped them).
// 超限 throw（中文、可操作），与 sanitizeProfile 共用同一组常量。非数字/未设值
// 不触发（sanitizeProfile 已在写路径拒绝非数字，这里仅兜底运行时竞态）。
export function assertHardLimits(maxTokens, maxDepth) {
  if (typeof maxTokens === 'number' && maxTokens > MAX_TOKENS) {
    throw new Error(`dispatch: maxTokens ${maxTokens} 超过委派上限 ${MAX_TOKENS}`);
  }
  if (typeof maxDepth === 'number' && maxDepth > MAX_DEPTH) {
    throw new Error(`dispatch: maxDepth ${maxDepth} 超过委派上限 ${MAX_DEPTH}`);
  }
}

// --- V2 安全 P0-b：continuable 工具门闭集（SPEC §7.1）-------------------------
// computeContinuableAllow pre-computes the CLOSED tool `allow` set for the
// continuable dispatch path: 父工具集 − run_code − (toolFilter.deny)，并在存在
// toolFilter.allow 时再 ∩ allow。空集 fail-loud（throw）—— 绝不静默派发零工具。
//
// 代码编辑者注意：这里写代码注释的「假设 / 失效条件」必须与 index.mjs
// continuable 分支的注释保持一致（SPEC §7.1 要求写入代码注释与 README）。
export function computeContinuableAllow(parentNames, toolFilter = {}) {
  const parent = new Set(parentNames);
  parent.delete('run_code');
  // deny 与 allow 对称守卫：非数组（如恶意/异常输入）按「无 deny」处理，防抛裸
  // TypeError；allow 同理在下方用 Array.isArray 守卫。
  const deny = Array.isArray(toolFilter?.deny) ? toolFilter.deny : [];
  for (const name of deny) parent.delete(name);
  let result = [...parent];
  const allow = toolFilter?.allow;
  if (Array.isArray(allow)) {
    const allowSet = new Set(allow);
    result = result.filter((name) => allowSet.has(name));
  }
  // 空集 fail-loud：派发一个零工具子 Agent 是静默降级，必须拒绝。
  if (result.length === 0) {
    throw new Error('dispatch: continuable 工具集为空，拒绝派发');
  }
  return result;
}

// description/name sampler: `\n→空格`压平. These are display lines (the
// dispatch:profiles section interpolates them into a single row), so a newline
// would break the row. 压平仅作存储层；引号包裹由显示层负责——显示层在该行给
// description 加引号（空时显示 '(无描述)' 不套引号），本纯函数只保证存储值
// 是单行、无换行。
function sanitizeShortText(value) {
  return value.replace(/\r\n|\r|\n/g, ' ');
}

// The full field set that may live on a profile. ANY other key — including
// __proto__ / constructor / prototype (which JSON.parse can produce as OWN
// properties) — is dropped instead of copied, so assignment never walks into
// the object prototype chain (prototype-pollution guard).
const KNOWN_PROFILE_FIELDS = new Set([
  'id', 'name', 'description', 'persona', 'preset', 'provider', 'model',
  'reasoningEffort', 'enabled', 'maxTokens', 'maxDepth', 'toolFilter',
  'builtin', 'deleted',
]);

/**
 * Sanitize one profile entry. `options.strict`:
 *   - strict=false (migration read): an over-length persona is KEPT (not
 *     truncated) and warned; over-limit maxTokens/maxDepth and illegal
 *     toolFilter subfields are dropped (field removed) + warned.
 *   - strict=true (write path): an over-length persona is also REMOVED from
 *     clean and warned, so the caller can reject the whole write with a 400.
 * Non-rejection normalizations (description/name flatten, toolFilter dedupe) are
 * silent and never produce a warning.
 *
 * Security (P1): `clean` is `Object.create(null)` (no inherited `__proto__`
 * setter) and only whitelisted fields are copied, so a hostile `__proto__` /
 * `constructor` / `prototype` key is ignored rather than polluting the result.
 */
export function sanitizeProfile(profile, options = {}) {
  const { strict = false } = options;
  const clean = Object.create(null);
  const warnings = [];
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    return { clean, warnings: [{ field: '(root)', reason: 'profile 不是对象' }] };
  }
  for (const [key, value] of Object.entries(profile)) {
    if (!KNOWN_PROFILE_FIELDS.has(key)) {
      warnings.push({ field: key, reason: '未知字段已忽略' });
      continue;
    }
    switch (key) {
      case 'name':
      case 'description': {
        if (value === undefined) break;
        // null / '' are the "clear this field" sentinels the /add merge layer
        // handles; pass them through unchanged rather than flagging null as an
        // illegal type. Any OTHER non-string (number / object / array) is
        // rejected.
        if (value === null || value === '') { clean[key] = value; break; }
        if (typeof value !== 'string') {
          warnings.push({ field: key, reason: `${key} 必须为字符串` });
          break;
        }
        clean[key] = sanitizeShortText(value);
        break;
      }
      case 'persona': {
        if (value === undefined) break;
        if (typeof value !== 'string') {
          warnings.push({ field: 'persona', reason: 'persona 必须为字符串' });
          break;
        }
        const wrappedLength = value.length === 0 ? 0 : GUIDANCE_PREFIX.length + value.length;
        if (wrappedLength > PERSONA_MAX_CHARS) {
          if (strict) {
            warnings.push({
              field: 'persona',
              reason: `persona 超长：计入引导前缀 '${GUIDANCE_PREFIX.trim()}' 后 ${wrappedLength} 字符，超过上限 ${PERSONA_MAX_CHARS}，拒绝写入`,
            });
            break;
          }
          warnings.push({
            field: 'persona',
            reason: `persona 超长：计入引导前缀 '${GUIDANCE_PREFIX.trim()}' 后 ${wrappedLength} 字符，超过上限 ${PERSONA_MAX_CHARS}；保留原值（不截断），建议人工精简`,
          });
          clean[key] = value;
          break;
        }
        clean[key] = value;
        break;
      }
      case 'maxTokens': {
        if (value === undefined) break;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          warnings.push({ field: 'maxTokens', reason: 'maxTokens 必须为有限数字' });
          break;
        }
        if (value > MAX_TOKENS) {
          warnings.push({ field: 'maxTokens', reason: `maxTokens ${value} 超过上限 ${MAX_TOKENS}` });
          break;
        }
        clean[key] = value;
        break;
      }
      case 'maxDepth': {
        if (value === undefined) break;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          warnings.push({ field: 'maxDepth', reason: 'maxDepth 必须为有限数字' });
          break;
        }
        if (value > MAX_DEPTH) {
          warnings.push({ field: 'maxDepth', reason: `maxDepth ${value} 超过上限 ${MAX_DEPTH}` });
          break;
        }
        clean[key] = value;
        break;
      }
      case 'toolFilter': {
        if (value === undefined) break;
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          warnings.push({ field: 'toolFilter', reason: 'toolFilter 必须为对象' });
          break;
        }
        const tf = {};
        for (const op of ['allow', 'deny']) {
          const sub = value[op];
          if (sub === undefined) continue;
          if (!Array.isArray(sub) || !sub.every((s) => typeof s === 'string')) {
            warnings.push({ field: `toolFilter.${op}`, reason: `toolFilter.${op} 必须为字符串数组` });
            continue;
          }
          const deduped = [...new Set(sub.filter((s) => s.length > 0))];
          if (deduped.length > 0) tf[op] = deduped;
        }
        // Unknown toolFilter keys are ignored; an empty (or fully-invalid)
        // toolFilter is simply omitted from clean (mirrors the /add write path).
        if (Object.keys(tf).length > 0) clean.toolFilter = tf;
        break;
      }
      default:
        clean[key] = value;
        break;
    }
  }
  return { clean, warnings };
}
