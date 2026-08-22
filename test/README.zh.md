# test/ — 插件宿主侧自动化测试

本目录用内置 `node:test` 做插件**宿主侧**自动化测试（零新增依赖，不引入 npm 测试包），锁应用行为
与纯函数：`characterization.test.mjs` 为 `apply(ctx)` 行为快照，`pure.test.mjs` 为纯函数单测。

## 运行

```bash
node --test "test/**/*.test.mjs"
```

> Node 24 不再支持裸目录参数 `node --test test/`（按单模块解析，报 `MODULE_NOT_FOUND`），须用上方
> glob 写法（仅匹配 `*.test.mjs`）；仓库根亦可 `npm test`。

## 快照维护

`characterization.test.mjs` 为 `apply()` 可观察行为的快照；宿主升级或有意改动时，须按新服务签名
重核 `test/harness/ctx.mjs` 的假上下文与断言，并在提交信息中说明快照更新的原因。

设计依据见 `docs/V2-SPEC.md` §6.4 测试矩阵。
