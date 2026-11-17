# TS 解析代码远程同步（强行实现 B 层热更新）

> 2026-11-18 完成。把 Animaku 的**播放解析 TS 代码**（含 AES 解密）也做成可远程热更新，
> 不止 JSON 规则。这样别人部署后，连"源站改了播放页加密方式"也能靠同步新解析代码修复。

## 1. 为什么能做（推翻之前"不行"的判断）

之前我说"B 层是硬编码 TS 代码，JSON 同步做不到，只能重打包"——这只说对了一半。
**TS 代码本身也可以成为"可远程加载的数据"**：
- 用 esbuild 把 TS 解析函数打包成自包含 cjs
- 部署为静态文件，运行时 `new Function(require,module,exports,code)` 加载
- 拿到的函数直接调用，覆盖内置解析

PoC 已证明：打包 bimi.ts → new Function 加载 → `searchBimi('天气之子')` 返回正确结果。

## 2. 架构

```
构建期（scripts/build-resolvers.mjs）：
  upstream/animaku/apps/server/src/lib/{16个源}.ts
    → esbuild bundle（private-host→edge stub、undici→stub、import.meta define）
    → resolvers/parsers.cjs（3.2MB，导出 16 源的 searchXxx/chaptersXxx/resolveXxx）
    → 同步到 public/resolvers/parsers.cjs（EdgeOne 静态托管）

运行时（runtime/parser-loader.ts）：
  /api/plugin/search|chapters|resolve 请求
    → fetch https://anime.map987.dpdns.org/resolvers/parsers.cjs（写死我们的域名）
    → new Function 加载 → 缓存 10 分钟
    → 按 rule.name 找对应源函数（按导出键名匹配，minify-safe）
    → 动态函数调用，成功则用；失败回退内置函数

构建期注入（scripts/build-edge.mjs 的 injectRuleStore onLoad）：
  把 plugin.ts 的 searchWithRule/chaptersWithRule/resolvePlay 调用改成
  "动态优先、内置回退"，并加 [parser-loader:remote] 标记证明来源。
```

**为什么写死我们的域名**：别人的旧部署也来 fetch `https://anime.map987.dpdns.org/resolvers/parsers.cjs`，
我们的 parsers.cjs 一更新，所有部署都自动拿到新解析代码——这是真正的远程热更新。

## 3. 与规则同步（A 层）的关系

| 层 | 内容 | 机制 | 更新方式 |
|---|---|---|---|
| A 搜索/章节字段 | JSON（baseURL/XPath） | `runtime/rules-store.ts` → Blob | fetch GitHub JSON |
| B 播放解析代码 | TS（AES 解密等） | `runtime/parser-loader.ts` → cjs | fetch 我们的 parsers.cjs |

两层独立、互补：A 层改搜索接口能修；B 层改播放加密能修。别人部署后两层都能自更新。

## 4. 验证（生产环境，铁证）

- `/api/__parsers` → `ok:true`，16 个源全部加载成功
- `/resolvers/parsers.cjs` → 200，3.2MB 静态文件
- 传过时规则搜「咒术回战」→ 返回 4 条结果，**diagnostics 含 `[parser-loader:remote]`**
  → 证明结果来自远程动态 TS 解析器，不是内置回退

## 5. 不改上游源码

所有改动都在我们自己的 `scripts/build-resolvers.mjs`、`runtime/parser-loader.ts`、
`scripts/build-edge.mjs`、`resolvers/`。上游 submodule `git status` 始终为空。
TS 代码被 esbuild 读进内存打包，源文件零改动。
