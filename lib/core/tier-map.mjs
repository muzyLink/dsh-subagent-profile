// lib/core/tier-map.mjs — 档位 → 推理档/token 预算的映射与互锁判定（纯函数、零依赖）。
//
// 用途语义：档位默认 = 无显式 reasoning_effort / maxTokens 时的派生默认；
// 显式 reasoning_effort / maxTokens 恒优先。档位映射仅在请求显式携带档位
// （per-call 或方案绑定）时生效——不带档位的调用不派生、不互锁，行为与旧版一致。
// 互锁：显式值与档位承诺冲突（显式推理档高于档位允许上限、显式 maxTokens 超过
// 档位默认预算）时由 applyTierLockGate 闸 fail-loud。

// 官方推理档全序（DeepSeek adapter 白名单，无 medium）。
export const EFFORT_ORDER = Object.freeze(['off', 'low', 'high', 'max']);

// 档位默认表：派生默认（无显式值时注入）与 maxTokens 预算承诺。
export const TIER_DEFAULTS = Object.freeze({
  cheap: Object.freeze({ reasoningEffort: 'off', maxTokens: 8000 }),
  balanced: Object.freeze({ reasoningEffort: 'high', maxTokens: 16000 }),
  premium: Object.freeze({ reasoningEffort: 'max', maxTokens: 32000 }),
});

// 档位允许的显式推理档上限（按官方档位序比较）：cheap 允许 off/low，
// balanced 允许至 high，premium 无上限。显式推理档超过上限即与档位承诺冲突；
// 低于上限（显式降档）恒放行。
export const TIER_EFFORT_CEILING = Object.freeze({
  cheap: 'low',
  balanced: 'high',
  premium: 'max',
});

// 归一档位 id：未知/缺省值按 balanced 处理（与展示口径一致）。
export function tierIdOf(tokenTier) {
  return typeof tokenTier === 'string' && TIER_DEFAULTS[tokenTier] !== undefined ? tokenTier : 'balanced';
}

// efforts 条目归一为档位 id 列表：接受字符串或 { id } 对象（catalog 快照形状），
// 无法识别的条目剔除。
function effortIdsOf(modelEfforts) {
  if (!Array.isArray(modelEfforts)) return [];
  const ids = [];
  for (const entry of modelEfforts) {
    const id = typeof entry === 'string' ? entry : (entry !== null && typeof entry === 'object' ? entry.id : undefined);
    if (typeof id === 'string' && id !== '') ids.push(id);
  }
  return ids;
}

// 档位派生默认：effort 受模型支持性校正——模型 efforts 列表不支持档位默认档时，
// 取列表中「不低于目标档」的最近档（按 EFFORT_ORDER 比较）；列表中全部低于目标档时
// 取最高可用档（最近的相邻档）。模型无 efforts 数据时返回默认表值不判支持性。
export function deriveTierConfig(tokenTier, modelEfforts) {
  const tier = tierIdOf(tokenTier);
  const def = TIER_DEFAULTS[tier];
  const ranks = effortIdsOf(modelEfforts)
    .map((id) => EFFORT_ORDER.indexOf(id))
    .filter((rank) => rank >= 0)
    .sort((a, b) => a - b);
  if (ranks.length === 0) return { reasoningEffort: def.reasoningEffort, maxTokens: def.maxTokens };
  const targetRank = EFFORT_ORDER.indexOf(def.reasoningEffort);
  const atLeast = ranks.filter((rank) => rank >= targetRank);
  const picked = atLeast.length > 0 ? atLeast[0] : ranks[ranks.length - 1];
  return { reasoningEffort: EFFORT_ORDER[picked], maxTokens: def.maxTokens };
}

// 推理档序号：未知档按最高档保守判定（无法分类即视为最重负载，宁可 fail-loud）。
function effortRankOf(effort) {
  const rank = EFFORT_ORDER.indexOf(effort);
  return rank >= 0 ? rank : EFFORT_ORDER.length - 1;
}

// 互锁判定（纯函数）：merged 显式携带档位时逐字段比对——显式 reasoningEffort 超过
// 档位上限、显式 maxTokens 超过档位默认预算均记冲突；无档位时返回 check:false
// （不互锁，调用方跳过闸）。不 throw，由闸统一 fail-loud。
export function tierLockVerdictOf(merged) {
  const tier = merged !== null && typeof merged === 'object' && typeof merged.tokenTier === 'string' && TIER_DEFAULTS[merged.tokenTier] !== undefined
    ? merged.tokenTier
    : undefined;
  if (tier === undefined) return { check: false };
  const conflicts = [];
  if (typeof merged.reasoningEffort === 'string' && merged.reasoningEffort !== '') {
    const ceiling = TIER_EFFORT_CEILING[tier];
    if (effortRankOf(merged.reasoningEffort) > effortRankOf(ceiling)) {
      conflicts.push({ field: 'reasoningEffort', requested: merged.reasoningEffort, ceiling });
    }
  }
  if (typeof merged.maxTokens === 'number' && merged.maxTokens > TIER_DEFAULTS[tier].maxTokens) {
    conflicts.push({ field: 'maxTokens', requested: merged.maxTokens, ceiling: TIER_DEFAULTS[tier].maxTokens });
  }
  return { check: true, tier, conflicts, allowed: conflicts.length === 0 };
}
