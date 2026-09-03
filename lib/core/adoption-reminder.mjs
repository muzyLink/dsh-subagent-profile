// lib/core/adoption-reminder.mjs — 未采纳判定 → 提醒条目 mint 的统一入口。
// 职责：把 adoption tracker 的「明确未采纳」记录转成提醒中心条目（标题/说明/主会话
// id/子会话 id/任务摘要/结算摘要/估算成本），并保留同源治理审计。提醒 store 未就绪
// 或写失败一律吞掉，绝不阻断判定路径。import-free（仅 node 内置 + cost-evidence），
// 可被裸 CI 单测 import。

import { dispatchCost } from './cost-evidence.mjs';

// prompt 摘要：前 200 字符、不存原文。派发登记与未采纳提醒条目共用同一口径。
export function promptExcerptOf(prompt) {
  return typeof prompt === 'string' ? prompt.slice(0, 200) : '';
}

// 提醒 mint 统一入口：store 未就绪/失败一律吞掉，绝不阻断治理路径。
export function mintReminder(store, entry) {
  try { if (store !== undefined) store.record(entry); } catch { /* 提醒 mint 失败不影响治理路径（fail-soft） */ }
}

// 未采纳审计：与提醒同源留痕（一条判定 = 一条治理审计），写失败不影响判定。
function recordUnadoptedAudit(evoLedger, rec) {
  try {
    evoLedger.recordGovernanceAudit({ kind: 'adoption-false', sessionId: rec.parentSessionId, childId: rec.id, ledgerKey: rec.ledgerKey, mode: rec.mode });
  } catch { /* 审计写失败不影响判定 */ }
}

// 未采纳条目组装：severity 用「注意」级；detail 是说明行；任务行复用 prompt 摘要
// （tracker 侧已截 200 字符）；结果行数据来自结算摘要，成本按请求模型（回退父模型）
// 与 usage 五段计价，算不出就不带成本字段（客户端只显示可得部分）。
export function mintUnadoptedReminder(store, evoLedger, rec) {
  recordUnadoptedAudit(evoLedger, rec);
  // 归因分支：cause=budget-limit（预算中止链导致的未采纳）时标题/说明言明
  // 累计与上限；无 cause 保持常规未采纳文案。数值缺失按 '-' 兜底（不阻断）。
  const budgetCause = rec !== null && typeof rec === 'object' && rec.cause === 'budget-limit';
  const causeTokens = typeof rec.tokens === 'number' && Number.isFinite(rec.tokens) ? rec.tokens : '-';
  const causeLimit = typeof rec.limit === 'number' && Number.isFinite(rec.limit) ? rec.limit : '-';
  const model = rec.requestedModel ?? rec.parentModel;
  const costEstimated = typeof model === 'string' && model !== ''
    ? dispatchCost({ model, usage: rec.settled?.childUsage })
    : undefined;
  const entry = {
    severity: 'P2',
    kind: 'adoption-false',
    title: '派发结果未被采纳',
    detail: '父 Agent 未采用该结果。若你认为结果有价值，可前往查看。',
    sessionId: rec.parentSessionId,
    childId: rec.id,
    childSessionId: rec.childSessionId ?? null,
    childMode: rec.mode ?? null,
    promptExcerpt: rec.promptExcerpt ?? '',
    settled: rec.settled ?? null,
    ...(typeof costEstimated === 'number' && Number.isFinite(costEstimated) ? { costEstimated } : {}),
  };
  if (budgetCause) {
    entry.title = '派发结果未被采纳（因预算中止）';
    entry.detail = '该子代理结果未纳入（派发链因 token 预算上限中止：累计 ' + causeTokens + ' / 上限 ' + causeLimit + '）。若你认为结果有价值，可前往查看。';
  }
  mintReminder(store, entry);
}
