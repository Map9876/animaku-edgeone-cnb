# 叠加层 patch 桶（animaku-edgeone）

## 这是什么

我们不 fork / 不改 Animaku 上游源码（`upstream/animaku` 是只读 submodule，CI `submodule update --remote` 自动跟最新）。
所有"在构建期改写上游源码"的动作都集中声明在 `manifest.json`，由 `scripts/build-edge.mjs` 读取并应用。

这是**叠加式 patch**：上游文件本身一个字都不动，改写只发生在 esbuild 的内存里（onLoad 钩子）。
好处：
- 上游随便升，零 fork 冲突、零 merge。
- 所有改动集中、可审查、可 enumerate，不再散落在 JS 的 `src.replace()` 里。
- 上游改了源码导致 patch 匹配不上时，**构建显式报错**（以前是静默跳过 → 功能悄悄失效）。

## 目录

```
patches/
├── manifest.json   # 唯一真相源：所有 patch 声明
└── README.md       # 本文
```

## manifest.json 字段

每个 patch：

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识，日志里出现 |
| `target` | 相对 `upstream/animaku/apps/server/src/` 的路径，如 `routes/plugin.ts` |
| `layer` | 语义分组，如 `A-rule-autoupdate` / `B-parser-hotupdate` |
| `match` / `matchRegex` | 精确字符串 / 正则。二选一 |
| `replace` | 替换文本 |
| `global` | 是否全局替换（`match` 用 split-join，`matchRegex` 用 `g` flag）|
| `idempotentBy` | 幂等标记：源码含此串则视为已应用，跳过 |
| `note` | 人读说明 |

## 加一个新 patch

1. 在 `manifest.json` 的 `patches` 数组追加一项。
2. `target` 必须是上游文件相对 `apps/server/src/` 的路径。
3. `match` 尽量取上游源码里**稳定的唯一片段**；优先 `matchRegex` 容忍空白差异。
4. `idempotentBy` 填替换后才会出现的标记串（防重复应用）。
5. 本地跑构建验证：
   ```bash
   node scripts/build-edge.mjs
   ```
   日志应出现 `[patch] applied <id> (layer)`。若报 `未命中目标`，说明 match 写错或上游已变，按报错提示修正。

## 上游升级后怎么办

CI 每次 `submodule update --remote` 拉最新上游，然后跑 `build-edge.mjs`：
- 若所有 patch 都命中 → 正常构建，改动自动叠加到新上游。
- 若某个 patch 未命中 → **构建失败并报出 id / target / 期望匹配文本**。此时：
  1. 看上游新源码对应位置改成了什么。
  2. 更新该 patch 的 `match`/`replace`（必要时调 `note`）。
  3. 提交 manifest，CI 重跑即可。

这就是 patch 桶的核心价值：上游破坏性改动会**显式暴露**，不再静默产生"前端在但功能没了"的隐 bug。

## 当前 patch 清单

| id | target | layer | 作用 |
|---|---|---|---|
| `rule-store-import` | routes/plugin.ts | A-rule-autoupdate | 注入 Blob/GitHub 规则自更新依赖 |
| `parse-rule-async` | routes/plugin.ts | A-rule-autoupdate | parseRuleOrThrow 改 async |
| `parse-rule-await-calls` | routes/plugin.ts | A-rule-autoupdate | 3 处调用加 await |
| `parser-loader-import` | routes/plugin.ts | B-parser-hotupdate | 注入 TS 解析热更新依赖 |
| `dynamic-search` | routes/plugin.ts | B-parser-hotupdate | 搜索动态解析优先 |
| `dynamic-chapters` | routes/plugin.ts | B-parser-hotupdate | 章节列表动态解析优先 |
| `dynamic-resolve` | routes/plugin.ts | B-parser-hotupdate | 播放解析动态解析优先 |

> 注：EdgeOne 平台适配的 alias/stub（node:sqlite→sqlite-stub、undici/sharp→stub、private-host/outbound-proxy 替换）在 `build-edge.mjs` 的 `alias` 和 `replaceUndiciModules` 里，它们是"模块替换"而非"文本改写上游源码"，故不放进 patch 桶。
