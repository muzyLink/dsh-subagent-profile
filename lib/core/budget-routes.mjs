// lib/core/budget-routes.mjs — 派发预算设置路由处理：GET /options/budget 只读
// 返回 guard 内存生效值（保存即时生效后无需重启即可见）；POST /set-budget
// 区间校验 fail-loud，合法值先 configure 即时生效再原子持久化。loopback 与
// CSRF 守卫由 createHttpRoutes 入口统一完成，本模块只做 body 解析与响应组装。
// 独立文件与 evolution-routes/data-maintenance 同理：http-routes.mjs 已触及
// 400 行文件行门，路由处理逻辑外置以守住行门。

import { DISPATCH_BUDGET_LIMITS } from './dispatch-guard.mjs';
import { json, readBody, persistOk } from './http-helpers.mjs';

// 写路径校验：两值都必须是区间内整数，任一非法 fail-loud 中文提示。读取时的
// fail-soft 归一（profiles-store）与写入时的严格拒绝互补：读宽容、写严格。
function dispatchBudgetFromBody(body) {
  const src = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const tokens = src.maxParentTokens;
  const concurrent = src.maxConcurrent;
  const tokensOk = typeof tokens === 'number' && Number.isInteger(tokens)
    && tokens >= DISPATCH_BUDGET_LIMITS.maxParentTokens.min && tokens <= DISPATCH_BUDGET_LIMITS.maxParentTokens.max;
  const concurrentOk = typeof concurrent === 'number' && Number.isInteger(concurrent)
    && concurrent >= DISPATCH_BUDGET_LIMITS.maxConcurrent.min && concurrent <= DISPATCH_BUDGET_LIMITS.maxConcurrent.max;
  if (!tokensOk || !concurrentOk) {
    return {
      error: `会话派发 token 上限需为 ${DISPATCH_BUDGET_LIMITS.maxParentTokens.min}~${DISPATCH_BUDGET_LIMITS.maxParentTokens.max} 的整数，并发派发数上限需为 ${DISPATCH_BUDGET_LIMITS.maxConcurrent.min}~${DISPATCH_BUDGET_LIMITS.maxConcurrent.max} 的整数`,
    };
  }
  return { dispatchBudget: { maxParentTokens: tokens, maxConcurrent: concurrent } };
}

// GET / POST 共用分发：GET 回读 guard 生效值；POST 校验 → configure 即时生效 →
// 持久化（persistOk 回传 persisted 信号）。
export async function handleBudgetRoute(deps, req, res) {
  if (req.method === 'GET') {
    const snapshot = deps.guard.snapshot();
    return json(res, 200, { ok: true, dispatchBudget: { maxParentTokens: snapshot.maxParentTokens, maxConcurrent: snapshot.maxConcurrent } });
  }
  const body = await readBody(req);
  const parsed = dispatchBudgetFromBody(body);
  if (parsed.error !== undefined) return json(res, 400, { ok: false, error: parsed.error });
  deps.guard.configure(parsed.dispatchBudget);
  const persist = deps.store.persistDispatchBudget(parsed.dispatchBudget);
  return persistOk(res, { dispatchBudget: parsed.dispatchBudget }, persist);
}
