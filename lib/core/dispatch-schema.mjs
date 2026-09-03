// lib/core/dispatch-schema.mjs — dispatch 工具的纯数据声明（零依赖）：输入参数
// schema（DISPATCH_PARAMETERS）与 output 结果 schema（DISPATCH_OUTPUT_SCHEMA，
// closed oneOf），均从 dispatch-tool.mjs 拆出以守文件行门。
//
// 三个结果分支（background / continuable / foreground）共享同一套元数据键集
// （判别键 kind/jobId/subagentId/output 除外），由 pure.mjs 的
// assertResultSchemaConsistency 在 apply 时锁定——任一分支漏补共享字段即 throw。
// decisionTrace 是共享键：三分支都必须携带，但只锁「存在性」（深层结构由
// lib/core/decision-trace.mjs 的纯函数与单测保证），它经 output.presentationMeta
// 投影进会话块 meta 供客户端台账展示，不进模型可见面。

// 输入参数 schema（从 dispatch-tool.mjs 逐字移入；defineTool 只读不改）。
export const DISPATCH_PARAMETERS = {
  // 参数轴归属与约束（能力轴 / 预算轴 / 防护 / 模式）：
  //   能力轴 preset→whitelist 闸；model/provider→llm 目录核验；persona→仅 shadow
  //   order 0（不进任何闸）；toolFilter→工具交集闸（只减不增）。
  //   预算轴 reasoningEffort/reasoning_effort（双名，官方名经 normalizeReasoningEffort
  //   归一为 camel）→resolveCallConfig；maxTokens→MAX_TOKENS 硬上限；
  //   tokenTier→可执行档位（无显式 effort/maxTokens 时派生默认配置，显式值与
  //   档位承诺冲突 fail-loud）。
  //   防护 maxDepth→MAX_DEPTH 硬上限。
  //   策略 strategy（'auto' 或 7 策略字段对象）→ expandStrategy 展开为顶层字段
  //   （顶层显式字段优先），展开后走全部既有闸。
  //   模式字段（run_in_background/continuable/envelope）是派发方式选择，不入配置覆盖。
  // 新增字段时须按上列轴归类，并同步键集测试（percall-spec）的 WHITELIST_KEYS。
  // per-call 规范化清单闭合：宿主 dsh-tools 的 DSL 参数解析**默认拒绝
  // 未知键**（2026-08 实测：参数级 additionalProperties 只接受 value schema 对象、
  // 不接受 boolean，故无法显式声明；键集闭合由 percall-spec 测试「键集恰为 17 键
  // （含双名键 reasoningEffort/reasoning_effort）」锁定；mergeProfileArgs 只透传
  // 白名单 9 键（merge 前经 normalizeReasoningEffort 归一官方名），未知字段到不了子请求）。
  profile: { type: 'string', description: '容器选择（profile 注册表 id：内建 swap-standard/researcher，或设置页自建）；省略则该 subagent 原样继承父预设与工具集，不加配置覆盖。' },
  preset: { type: 'string', description: '能力轴·目标预设强制覆盖；必须是本运行时 system-trust 预设（白名单内的受信任预设），否则 fail-loud 拒绝；与父 composed 预设相同时改写为 inherit（不换装）。' },
  model: { type: 'string', description: '能力轴·子 Agent 显式模型覆盖，per-call 优先于 profile；必须在该 provider 目录中已发布，否则 fail-loud 拒绝（无发现能力的空目录 adapter 无法校验时按兼容模式开关决定）。派发已遵循官方模型选择白名单（本会话启用时；未启用则继承父模型）。' },
  provider: { type: 'string', description: '能力轴·子 Agent 显式 provider 覆盖，per-call 优先于 profile；必须已注册在其 provider 目录中，否则 fail-loud 拒绝。' },
  reasoningEffort: { type: 'string', description: '预算轴·注入每个子请求的推理档位覆盖，per-call 优先于 profile；经 resolveCallConfig 校验该档受显式 provider/model 支持，否则 fail-loud 拒绝；continuable 模式忽略本字段（子会话不支持）。（弃用别名，请用 reasoning_effort）' },
  reasoning_effort: { type: 'string', description: '预算轴·与 reasoningEffort 同义的官方字段名（与官方 subagent 工具字段同名）：注入每个子请求的推理档位覆盖，per-call 优先于 profile；经 resolveCallConfig 校验该档受显式 provider/model 支持，否则 fail-loud 拒绝；continuable 模式忽略本字段（子会话不支持）。与 reasoningEffort 同送（两义即歧义）时 fail-loud 拒绝，请二选一。' },
  tokenTier: { type: 'string', enum: ['cheap', 'balanced', 'premium'], description: '预算轴·成本/深度档位（估算口径，非计费）：cheap 省 token、balanced 均衡、premium 高成本。覆盖 profile 的 tokenTier；缺省 balanced。设置档位后，无显式 reasoning_effort/maxTokens 时按档位派生默认配置（cheap=off/8000、balanced=high/16000、premium=max/32000，推理档按模型支持收敛）；显式值与档位承诺冲突时 fail-loud。' },
  persona: { type: 'string', description: '能力轴·覆盖子 Agent 的部署 persona 段（只 shadow order 0 的 persona 影子段，不进 descriptor）；per-call 优先于 profile。' },
  toolFilter: {
    type: 'object',
    // 能力轴·工具白名单交集：只减不增，不能给子 Agent 添加任何父集没有的工具。
    // DSL 对象参数默认拒绝未知键，toolFilter 必须闭合其 schema，
    // 否则 defineTool 在 apply 时 throw、插件加载失败。
    additionalProperties: false,
    description: '能力轴·给子工具集额外做白名单交集（与父工具集求交，只减不增）：不能给子 Agent 添加任何父集没有的工具。',
    properties: {
      allow: { type: 'array', items: { type: 'string' }, description: '提供时，仅保留这些工具名。' },
      deny: { type: 'array', items: { type: 'string' }, description: '这些工具名总是被移除。' }
    }
  },
  maxTokens: { type: 'number', description: '预算轴·子 Agent 显式 token 预算覆盖，per-call 优先于 profile；超过部署硬上限（MAX_TOKENS）fail-loud 拒绝。' },
  maxDepth: { type: 'number', description: '防护·子 Agent 显式绝对递归深度上限覆盖，per-call 优先于 profile；超过部署硬上限（MAX_DEPTH）fail-loud 拒绝。' },
  run_in_background: { type: 'boolean', description: '模式选择·异步 one-shot：走 jobs.start 包 start()，返回 jobId；仍单轮即弃，非 continuable。不入配置覆盖。' },
  continuable: { type: 'boolean', description: '模式选择·启动持久可 continuation 的 subagent 而非 one-shot：立即返回 subagentId 并经 send_message 工具在后续轮次延续对话；默认 false。不入配置覆盖；与 run_in_background 同真时本字段优先，忽略 preset 换用与 reasoningEffort。失败经结算通知回报；超时可 send_message 追问。' },
  // 信封模式 = opt-in（仅「中段即交付物」的任务用）：true 时把信封骨架追加进
  // 子 persona（systemPrompt 影子段，模型可见），子 Agent 按结构化信封汇报；
  // 默认 false 走结果剪枝回收。
  envelope: { type: 'boolean', description: '模式选择·true 时子 Agent 按结构化信封汇报（简短结论 + 结构分项 + 关键发现落点），适合中段即交付物的长任务；默认 false 走剪枝回收。不入配置覆盖。' },
  prompt: { type: 'string', required: true, description: '任务文本·该 subagent 完成的自包含任务（它看不到当前对话）。' },
  strategy: {
    oneOf: [
      { type: 'string', enum: ['auto'], description: '显式声明按「方案 → 父级 → provider 默认」链解析每个策略字段；生效来源在决策轨迹标记为 auto。' },
      {
        type: 'object',
        additionalProperties: false,
        description: '7 策略字段（preset/provider/model/reasoning_effort/tokenTier/maxTokens/maxDepth）的分组等价体，未知键 fail-loud。',
        properties: {
          preset: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoning_effort: { type: 'string' },
          reasoningEffort: { type: 'string' },
          tokenTier: { type: 'string', enum: ['cheap', 'balanced', 'premium'] },
          maxTokens: { type: 'number' },
          maxDepth: { type: 'number' },
        },
      },
    ],
    description: '策略对象：传 auto 按「方案 → 父级 → provider 默认」优先级链解析每个策略字段并显式陈述生效来源；传对象则把 7 个策略字段（preset/provider/model/reasoning_effort/tokenTier/maxTokens/maxDepth）分组传入，与顶层同名字段完全等价，顶层显式字段优先。',
  },
  // 继承变更确认：布尔开关（缺省 false），调用方动作——不进 strategy、不进 merged。
  confirm: { type: 'boolean', description: '确认使用继承/auto 解析产生的模型变更；不传且发生继承变更时调用将失败。' },
};

// strategy 对象允许的 7 个策略字段（单一事实来源；与 DISPATCH_PARAMETERS.strategy
// 的 properties 键集一致）。persona/toolFilter 是结构注入与工具交集、模式字段是
// 派发方式、confirm 是调用方动作，均不进 strategy。
export const STRATEGY_FIELDS = Object.freeze(['preset', 'provider', 'model', 'reasoningEffort', 'tokenTier', 'maxTokens', 'maxDepth']);

// 已知 per-call 参数键集（单一事实来源）：decisionTrace 的 requested 快照据此把
// 未知字段记录为 unknown_keys（fail-visible，不静默吞）。宿主 dsh-tools DSL 对
// 参数默认拒绝未知键，此处是插件侧决策轨迹的可观测兜底。双名键（reasoningEffort /
// reasoning_effort）均在其中，任一名的请求都不会误报 unknown_keys。
export const DISPATCH_PARAMETER_KEYS = Object.freeze(Object.keys(DISPATCH_PARAMETERS));

// 字段双名归一（mergeProfileArgs 合并前调用）：官方名 reasoning_effort 与内部旧名
// reasoningEffort 等效（同值同行为）。只传官方名时归一为 reasoningEffort（下游
// 只读 camel）；同送两义即歧义 → fail-loud 拒绝（与「未知键拒绝」同风格，绝不
// 静默二选一）。旧名保留为弃用别名（description 已标），后续 major 移除。
export function normalizeReasoningEffort(args) {
  if (args === null || typeof args !== 'object') return args;
  const snake = args.reasoning_effort;
  const camel = args.reasoningEffort;
  if (snake !== undefined && camel !== undefined) {
    throw new Error('dispatch: reasoning_effort 与 reasoningEffort 不得同送（两义即歧义，请二选一）');
  }
  if (snake === undefined) return args;
  const normalized = { ...args, reasoningEffort: snake };
  delete normalized.reasoning_effort;
  return normalized;
}

// 双名归一 + 键集校验共用：strategy 对象内的 reasoning_effort/reasoningEffort
// 与顶层同规则（同送两义 fail-loud；只送官方名归一为 camel），其余键需在
// STRATEGY_FIELDS 内（未知键 fail-loud）。
function strategyCamelEffortOf(strategy) {
  const snake = strategy.reasoning_effort;
  const camel = strategy.reasoningEffort;
  if (snake !== undefined && camel !== undefined) {
    throw new Error('dispatch: strategy 内 reasoning_effort 与 reasoningEffort 不得同送（两义即歧义，请二选一）');
  }
  for (const key of Object.keys(strategy)) {
    if (!STRATEGY_FIELDS.includes(key) && key !== 'reasoning_effort') {
      throw new Error(`dispatch: strategy 含未知字段 "${key}"（仅接受 preset/provider/model/reasoning_effort/reasoningEffort/tokenTier/maxTokens/maxDepth）`);
    }
  }
  return camel !== undefined ? camel : snake;
}

// strategy 展开（mergeProfileArgs 之前执行，纯函数）：strategy 对象 = 顶层同名
// 字段的分组等价体——展开为顶层字段后走既有全部闸，顶层显式字段优先（不报错）。
// strategy:'auto' 按「方案 → 父级 → provider 默认」链逐字段解析：方案已配置取
// 方案值；未配置继承父会话当前值；双方均无只记录 default（不产生显式覆盖）。
// 返回 { args, resolution }：args 为展开后的新对象（strategy 键保留供来源判定）；
// resolution 仅 auto 时非空，记录逐字段解析来源（call 表示顶层显式覆盖）。
export function expandStrategy(args, ctx) {
  if (args === null || typeof args !== 'object' || args.strategy === undefined) return { args, resolution: undefined };
  const strategy = args.strategy;
  const profile = ctx !== null && typeof ctx === 'object' && ctx.profile !== null && typeof ctx.profile === 'object' ? ctx.profile : {};
  const parentOptions = ctx !== null && typeof ctx === 'object' && ctx.parentOptions !== null && typeof ctx.parentOptions === 'object' ? ctx.parentOptions : {};
  if (strategy === 'auto') {
    const next = { ...args };
    const resolution = {};
    for (const key of STRATEGY_FIELDS) {
      if (args[key] !== undefined) { resolution[key] = 'call'; continue; }
      if (profile[key] !== undefined) { next[key] = profile[key]; resolution[key] = 'profile'; }
      else if (parentOptions[key] !== undefined) { next[key] = parentOptions[key]; resolution[key] = 'parent'; }
      else { resolution[key] = 'default'; }
    }
    return { args: next, resolution };
  }
  if (strategy === null || typeof strategy !== 'object') {
    throw new Error('dispatch: strategy 只接受字符串 "auto" 或 7 策略字段对象');
  }
  const camelEffort = strategyCamelEffortOf(strategy);
  const next = { ...args };
  for (const key of STRATEGY_FIELDS) {
    if (key === 'reasoningEffort') {
      // 顶层双名任一已显式指定 → 顶层胜出（不覆盖、不报错）。
      if (args.reasoningEffort === undefined && args.reasoning_effort === undefined && camelEffort !== undefined) next.reasoningEffort = camelEffort;
      continue;
    }
    if (args[key] === undefined && strategy[key] !== undefined) next[key] = strategy[key];
  }
  return { args: next, resolution: undefined };
}

export const DISPATCH_OUTPUT_SCHEMA = {
  // 每个结果上的可观测元数据。oneOf 覆盖 background 变体（kind/jobId）与
  // foreground 变体（output），两者闭合且都携带生效的委派值。`ignored` 必须
  // 出现在全部三个分支（连同共享的 `preset` / `provider` / `model` /
  // `reasoningEffort` / `profile`），保持闭合 oneOf 一致——
  // apply() 里 assertResultSchemaConsistency(dispatchTool.output.schema)
  // 任一分支漏补该字段即 throw。
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'background' },
        jobId: { type: 'string', required: true },
        profile: { type: 'string' },
        preset: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        reasoningEffort: { type: 'string' },
        tokenTier: { type: 'string', enum: ['cheap', 'balanced', 'premium'], description: '成本/深度分层（估算口径，非计费）。' },
        imageText: { type: 'string', description: '一句话生效画像（方案/模型路由/档位），经 presentationMeta 供决策卡片展示；不进 render 行。' },
        childTotalTokens: { type: 'number', description: '子 Agent 会话 token 估算总量（宿主启发式估算，非计费 usage token）；后台结算经 job 结果携带，dispatch 结果不带。' },
        childUsage: {
          type: 'object',
          additionalProperties: false,
          description: '真实计费 token 五段分解（缓存读/写为可选）；后台结算经 job 结果携带，dispatch 结果不带。',
          properties: {
            inputTokens: { type: 'number' },
            outputTokens: { type: 'number' },
            cacheReadTokens: { type: 'number' },
            cacheWriteTokens: { type: 'number' },
            reasoningTokens: { type: 'number' }
          }
        },
        elapsedMs: { type: 'number', description: '派发耗时（毫秒，execute 入口到结算时刻）；后台结算经 job 结果携带，dispatch 结果不带。' },
        stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'], description: '子 Agent 结束原因；后台结算经 job 结果携带，dispatch 结果不带。' },
        ignored: { type: 'array', items: { type: 'string' } },
        decisionTrace: { type: 'object', additionalProperties: true, description: '派发决策轨迹（供客户端台账展示，不进模型可见面）' }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'continuable' },
        subagentId: { type: 'string', required: true },
        profile: { type: 'string' },
        preset: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        reasoningEffort: { type: 'string' },
        tokenTier: { type: 'string', enum: ['cheap', 'balanced', 'premium'], description: '成本/深度分层（估算口径，非计费）。' },
        imageText: { type: 'string', description: '一句话生效画像（方案/模型路由/档位），经 presentationMeta 供决策卡片展示；不进 render 行。' },
        childTotalTokens: { type: 'number', description: '子 Agent 会话 token 估算总量（宿主启发式估算，非计费 usage token）；仅前台/后台结算时携带，continuable 实际省略。' },
        childUsage: {
          type: 'object',
          additionalProperties: false,
          description: '真实计费 token 五段分解（缓存读/写为可选）；仅前台/后台 completed 结算时携带，continuable 实际省略。',
          properties: {
            inputTokens: { type: 'number' },
            outputTokens: { type: 'number' },
            cacheReadTokens: { type: 'number' },
            cacheWriteTokens: { type: 'number' },
            reasoningTokens: { type: 'number' }
          }
        },
        elapsedMs: { type: 'number', description: '派发耗时（毫秒，execute 入口到结算时刻）；continuable 不结算，实际省略。' },
        stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'], description: '子 Agent 结束原因；continuable 不结算，实际省略。' },
        ignored: { type: 'array', items: { type: 'string' } },
        decisionTrace: { type: 'object', additionalProperties: true, description: '派发决策轨迹（供客户端台账展示，不进模型可见面）' }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        output: { type: 'string', required: true },
        profile: { type: 'string' },
        preset: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        reasoningEffort: { type: 'string' },
        tokenTier: { type: 'string', enum: ['cheap', 'balanced', 'premium'], description: '成本/深度分层（估算口径，非计费）。' },
        imageText: { type: 'string', description: '一句话生效画像（方案/模型路由/档位），经 presentationMeta 供决策卡片展示；不进 render 行。' },
        childTotalTokens: { type: 'number', description: '子 Agent 会话 token 估算总量（宿主启发式估算，非计费 usage token）；仅前台 completed 结算时携带。' },
        childUsage: {
          type: 'object',
          additionalProperties: false,
          description: '真实计费 token 五段分解（缓存读/写为可选）；前台 completed 结算时携带。',
          properties: {
            inputTokens: { type: 'number' },
            outputTokens: { type: 'number' },
            cacheReadTokens: { type: 'number' },
            cacheWriteTokens: { type: 'number' },
            reasoningTokens: { type: 'number' }
          }
        },
        elapsedMs: { type: 'number', description: '派发耗时（毫秒，execute 入口到结算时刻）；前台 completed 结算时携带。' },
        stopReason: { type: 'string', enum: ['completed', 'max-tokens', 'aborted', 'refusal', 'error'], description: '子 Agent 结束原因；前台 completed 结算时携带。' },
        ignored: { type: 'array', items: { type: 'string' } },
        decisionTrace: { type: 'object', additionalProperties: true, description: '派发决策轨迹（供客户端台账展示，不进模型可见面）' }
      }
    }
  ]
};

// 一句话生效画像（imageText）：有 profile → `方案 X；provider/model 或继承父；
// 档位 Y`；无 profile（继承父）→ `继承父方案；provider/model；档位 Y`。字段随
// presentationMeta 投影进决策卡片，不进 render 行（UI 展示留后续版本）。
export function imageTextOf(meta) {
  const tier = meta !== null && typeof meta === 'object' && typeof meta.tokenTier === 'string' && meta.tokenTier !== '' ? meta.tokenTier : 'balanced';
  const profile = meta !== null && typeof meta === 'object' ? meta.profile : undefined;
  const hasProfile = typeof profile === 'string' && profile !== '' && profile !== '(inline)';
  const provider = meta !== null && typeof meta === 'object' && typeof meta.provider === 'string' ? meta.provider : '(parent)';
  const model = meta !== null && typeof meta === 'object' && typeof meta.model === 'string' ? meta.model : '(parent)';
  const routeKnown = provider !== '(parent)' && model !== '(parent)';
  if (hasProfile) return `方案 ${profile}；${routeKnown ? `${provider}/${model}` : '继承父'}；档位 ${tier}`;
  return `继承父方案；${provider}/${model}；档位 ${tier}`;
}

// 结果 render 行（从 dispatch-tool.mjs 逐字移入以守文件行门）：continuable 丢弃
// preset 换用与 reasoningEffort —— 渲染行把 `ignored` 列表回显出来
// （`reasoningEffort=<值>(ignored)`，再加 ignored 项明细），让模型「看见」被丢弃项；
// background/foreground 无忽略项时该后缀为空。
export const DISPATCH_RENDER = (_args, value) => {
  const ignored = value.ignored !== undefined && value.ignored.length > 0
    ? `(ignored: ${value.ignored.join(', ')})`
    : '';
  const tier = typeof value.tokenTier === 'string' && value.tokenTier !== ''
    ? ` · tokenTier=${value.tokenTier}`
    : '';
  const tokens = typeof value.childTotalTokens === 'number'
    ? ` · childTotalTokens=${value.childTotalTokens}`
    : '';
  const elapsed = typeof value.elapsedMs === 'number'
    ? ` · elapsedMs=${value.elapsedMs}`
    : '';
  const stopReason = typeof value.stopReason === 'string' && value.stopReason !== ''
    ? ` · stopReason=${value.stopReason}`
    : '';
  // childUsage 是嵌套对象，render 行是扁平的 key=value，故 JSON 序列化为单段
  // 供 client 侧 parseDispatchText 解析回对象（五段分解）。仅前台 completed 结算
  // 携带；后台结算经 job 结果携带，continuable 不携带，故该段只在 foreground 行。
  const usage = value.childUsage !== undefined && value.childUsage !== null && typeof value.childUsage === 'object'
    ? ` · childUsage=${JSON.stringify(value.childUsage)}`
    : '';
  const text = value.kind === 'background'
    ? `[dispatch] background job ${value.jobId} · profile=${value.profile} · preset=${value.preset} · provider=${value.provider} · model=${value.model} · reasoningEffort=${value.reasoningEffort}${ignored}${tier}`
    : value.kind === 'continuable'
      ? `[dispatch] started subagent ${value.subagentId} · profile=${value.profile} · preset=${value.preset} · provider=${value.provider} · model=${value.model} · reasoningEffort=${value.reasoningEffort}${ignored}${tier}`
      : `[dispatch] profile=${value.profile} · preset=${value.preset} · provider=${value.provider} · model=${value.model} · reasoningEffort=${value.reasoningEffort}${ignored}${tier}${tokens}${usage}${elapsed}${stopReason}\n\n${value.output}`;
  return [{ type: 'text', text }];
};
