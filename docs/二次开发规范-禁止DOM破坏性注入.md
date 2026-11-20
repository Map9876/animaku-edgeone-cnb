# Animaku 二次开发规范：禁止 DOM 破坏性注入，先做原站范式再迁 EdgeOne

> 本文是后续开发的**依据与记忆**。起因：2026-11-20 `/recent` 最近更新页的注入方式被判定为错误方向。
> 核心铁律：**禁止 DOM 覆盖 / CSS 隐藏原站元素的破坏性注入**；正确路径是「先基于原网站做非 EdgeOne 的二次开发，形成范式，再把范式迁移到 EdgeOne 端」。

---

## 一、概念澄清：什么是不对的，什么是对的

### 1.1 错误做法（我犯过的）：DOM 覆盖 / 页面劫持

运行时往 `document.body` 塞一个 `position:fixed; inset:0` 的全屏层，再用 CSS 把原站元素藏掉：

```js
// ❌ 错误示范（recent-page.js 初版思路）
document.documentElement.classList.add('ae-recent-route')
// CSS: .ae-recent-route #root>div>main{display:none}  ← 隐藏原站内容区
// CSS: .ae-recent-route #root>div>footer{display:none} ← 隐藏原站 footer
var page = document.createElement('div')  // 自己造一个全屏页面盖上去
document.body.appendChild(page)
```

这**不叫注入，叫破坏性改写 / 页面劫持**。后果（均已实际出现）：
- footer 先闪现再消失（隐藏发生在 JS 之后，原站结构被破坏）
- 文字错位、不自适应（自己造的 DOM/CSS 没有继承原站完整的 token 与响应式）
- 顶部菜单和原站割裂（自己 clone 菜单项，React 重渲染会冲掉）
- `/recent` 实际是 SPA fallback 的 404 页被藏掉，不是真正的路由

### 1.2 正确做法：二次开发 + 侵入式 patch

两个层次，顺序不能反：

1. **先做「原站范式」**：拿一份完整的 Animaku 源码（非 EdgeOne 改造版），把新功能**当成原站功能直接加进源码**——加路由、加页面组件、加菜单项、加 API。产出一个"原网站 + 我们的功能"的标准版本。这是**范式（reference implementation）**，是标准。
2. **再做「侵入式 patch」迁移到 EdgeOne**：不改上游源文件，用构建期手段（esbuild `onLoad` 文本替换 / alias，即 patch 桶那套"换元/名称替换"）把范式里的改动在打包时注入进去。产出与范式**功能一致**的 EdgeOne 版本。

这样产出的页面本来就是原站 React 结构：footer/main/header 都在正确位置、响应式继承原站、菜单是原站菜单——**零 DOM 覆盖、零破坏**。

### 1.3 术语表

| 术语 | 含义 |
|---|---|
| **原站范式** | 基于 Animaku 上游源码直接二次开发的完整版本，功能的标准实现 |
| **侵入式 patch** | 不改源文件，构建期改写源码文本/模块解析，把改动叠加上去（= 换元 / 名称替换 / patch 桶）|
| **DOM 破坏性注入** | 运行时塞 DOM + CSS 隐藏原站元素（禁止）|
| **纯注入** | 只通过构建期/加载期改写，不碰运行时 DOM 结构 |

---

## 二、假设完全基于原项目添加，应该加在哪（事实依据）

上游源码在 `upstream/animaku/apps/web/src/`（submodule，只读）。以下位置经源码核实：

### 2.1 新增 `/recent` 页面路由

- **文件**：`apps/web/src/App.tsx`
- **现状**（`App.tsx:66-128`）：
  ```tsx
  <Routes>
    <Route element={<Layout />}>
      <Route index element={<HomePage />} />
      <Route path="timeline" element={<TimelinePage />} />
      <Route path="anime" element={<AnimePage />} />
      ...
      <Route path="*" element={<NotFoundPage />} />   {/* ← /recent 现在落到这里变 404 */}
    </Route>
  </Routes>
  ```
- **应加**：在 `path="timeline"` 后插入：
  ```tsx
  <Route path="recent" element={<RecentPage />} />
  ```
  并在 `path="*"` 之前，确保 `/recent` 命中真实路由而非 404。

### 2.2 路由懒加载（可选，跟随原站范式）

- **文件**：`apps/web/src/App.tsx:45-52` + `apps/web/src/lib/route-preload.ts`
- **现状**：次级页面用 `lazy(routeImports.search)` 等统一预加载器。
- **应加**：`const RecentPage = lazy(routeImports.recent)`，并在 `route-preload.ts` 注册 `recent` 加载器。

### 2.3 页面组件

- **目录**：`apps/web/src/pages/`（现有 `TimelinePage.tsx` / `HomePage.tsx` 等）
- **应加**：`apps/web/src/pages/RecentPage.tsx`，范式参照 `TimelinePage.tsx`——用原站的 Layout/卡片/响应式 token，数据从 API 取。

### 2.4 顶部菜单「最近更新」入口

- **文件**：`apps/web/src/components/nav/NavLinks.tsx:10-14`
- **现状**：
  ```tsx
  const mainLinks = [
    { to: '/', label: '首页', end: true },
    { to: '/anime', label: '番剧' },
    { to: '/timeline', label: '时间表' },
  ]
  ```
- **应加**：`{ to: '/recent', label: '最近更新' }`。
- 注意：原站还有 `customNavLinks`（用户自定义导航，`useSiteConfigStore`），菜单项渲染逻辑在 `NavLinks.tsx` 后半段，改 `mainLinks` 即可原生融入。

### 2.5 数据 API

- **后端**：Animaku Hono 路由在 `apps/server/src/routes/`（如 `plugin.ts` / `stats.ts`）。
- **应加**：`apps/server/src/routes/recent.ts` —— `GET /api/recent`，作为 webhook 数据的服务端代理（或直接让前端读 webhook 的 CORS API）。
- 实时推送：前端用 `EventSource`/`WebSocket` 连 webhook `/ws`，这是标准浏览器 API，不需要 DOM 覆盖。

### 2.6 小结：原站范式改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `App.tsx` 路由表 | 加 `<Route path="recent" element={<RecentPage />} />` |
| 2 | `App.tsx` / `route-preload.ts` | 加 lazy import `RecentPage` |
| 3 | `pages/RecentPage.tsx` | 新建页面组件（参照 `TimelinePage`）|
| 4 | `components/nav/NavLinks.tsx` | `mainLinks` 加 `{ to:'/recent', label:'最近更新' }` |
| 5 | `apps/server/src/routes/recent.ts` | 加 `GET /api/recent` 数据代理 |

---

## 三、不改动源文件的侵入式方案（EdgeOne 迁移）

目标：上游 submodule 一字不改，构建期把 §2 的范式改动**等价注入**，产出与范式功能一致的 EdgeOne 版本。

### 3.1 机制（与现有 patch 桶一致）

- **文件**：`patches/manifest.json`（声明式 patch）+ `scripts/build-edge.mjs`（`injectPatches` 用 esbuild `onLoad` 应用）。
- **原则**：每条 patch 声明 `target`（相对 `apps/web/src/` 或 `apps/server/src/`）、`match`/`matchRegex`、`replace`、`idempotentBy`、`layer`。
- **失配显式报错**：上游升级后 match 不命中 → 构建失败并报出 id/target，绝不静默跳过（避免"前端在但功能没了"）。

### 3.2 §2 各改动对应的 patch

| 范式改动 | patch 实现 |
|---|---|
| App.tsx 加路由 | patch `App.tsx`：在 `<Route path="timeline" .../>` 后插入 `<Route path="recent" ...>` |
| lazy import | patch `App.tsx` 的 lazy 声明区 + `route-preload.ts` 注册表 |
| RecentPage 组件 | 作为**自有文件**放 `src/`（如 `web-overlay/RecentPage.tsx`），patch 加 import 指向它 |
| NavLinks 菜单 | patch `NavLinks.tsx`：`mainLinks` 数组插入 `{ to:'/recent', label:'最近更新' }` |
| 数据 API | 作为自有文件（如 `runtime/recent-route.ts`），在 `edge-index.ts` 挂载路由；或复用现有 analytics 路由模式 |

### 3.3 构建流程

```
upstream/animaku (只读 submodule)
  │  git submodule update --remote 跟最新
  ▼
build-edge.mjs / sync-web.mjs（构建期）
  ├─ injectPatches：按 patches/manifest.json 改写 App.tsx / NavLinks.tsx / route-preload.ts ...
  ├─ 自有文件（RecentPage / recent-route）被 patch 的 import 引用进来
  ├─ pnpm build → dist（此时 /recent 已是原生路由，不是 404 页）
  └─ dist 复制到根 assets/ + public/assets/（EdgeOne 双份静态）
  ▼
EdgeOne Pages（CNB 类型 webhook 部署）
```

### 3.4 验收标准（可判定）

1. 直接访问 `/recent` → 返回**真实渲染的 RecentPage**，不是 404 页、不是全屏覆盖层。
2. 顶部菜单原生含「最近更新」且 active 高亮，与「首页/番剧/时间表」同一 DOM 结构。
3. footer/main 在原位置正常渲染，无闪现、无被隐藏。
4. 响应式与原站一致（手机/桌面），文字不错位。
5. patrol 上游升级后 patch 要么全部命中（功能保留），要么构建显式报错（不静默失效）。

---

## 四、开发顺序（强制）

1. **第一步：原站范式**。在一份完整的 Animaku 源码副本上（非 EdgeOne），按 §2 把功能直接加进源码，跑通、截图验收，作为标准。
2. **第二步：EdgeOne 迁移**。把范式的每处改动翻译成 §3 的 patch，跑 EdgeOne 构建，用 §3.4 验收标准逐条核对与范式一致。
3. **禁止**：跳过第一步直接在 EdgeOne 产物上贴 DOM 覆盖脚本。

---

## 五、与现有代码的关系（2026-11-20 现状）

- 当前 `/recent` 是 `inject/recent-page.js`（运行时 DOM 覆盖）+ `scripts/inject-into-html.mjs`（CSS 隐藏 footer/main）——**违反本规范**，是待重构对象。
- `inject/ui-inject.js` 的顶部菜单 clone（`addTopMenu()`）也是运行时 DOM 操作——违反本规范，应改为 §3.2 的 `NavLinks.tsx` patch。
- 现行 `patches/manifest.json` 已有 7 条（A/B 层规则与解析），机制正确，§3 的 patch 按同样格式追加。
- webhook 的 `data/bangumi-catalog.json` 由 webhook 每 6h 自拉（`src/catalog-fetch.js`），与本规范的数据层（§2.5）对接。

---

## 六、一句话铁律

> 先原站范式，后 EdgeOne 迁移；改源码用构建期 patch（换元/名称替换），**绝不运行时 DOM 覆盖或 CSS 隐藏原站元素**。

---

## 七、实施记录（2026-11-20，/recent 已按本规范重构）

### 7.1 已落地文件

| 文件 | 作用 |
|---|---|
| `web-overlay/RecentPage.tsx` | 原站范式页面组件：用原站 `PageHeader`/`BangumiGrid`/`BangumiGridSkeleton`/`EmptyState`，webhook 数据映射成 `BangumiItem`，WS 增量 + 签名去重（无变化不重建），时间档位「今天/昨天/前天」|
| `runtime/recent.ts` | 后端 `GET /api/recent` 同源代理 webhook（避免跨域），挂载在 `edge-index.ts` |
| `scripts/apply-web-patches.mjs` | 构建期 patch：`--apply`（默认）把范式改动注入 submodule 工作副本；`--revert` 用 git checkout 恢复。submodule commit 指针与 git status 始终干净 |
| `scripts/sync-web.mjs` | build 前自动 `apply-web-patches`，build 后（成功/失败）`--revert` |

### 7.2 patch 实际改动（均经源码核实）

- `App.tsx:44` 加 `import { RecentPage } from './pages/RecentPage'`
- `App.tsx:71` 路由表 `<Route path="recent" element={<RecentPage />} />`（在 timeline 后）
- `NavLinks.tsx:12` `mainLinks` 加 `{ to: '/recent', label: '最近更新' }`
- `pages/RecentPage.tsx` 由 `web-overlay/RecentPage.tsx` 复制进构建

### 7.3 已废弃（违反规范，不再引用）

- `inject/recent-page.js`：旧 DOM 覆盖方案（塞 body + CSS 隐藏 footer/main），已标记废弃、不再被 `inject-into-html.mjs` 引用。
- `inject/ui-inject.js` 的 `addTopMenu()`：旧运行时 clone 菜单方案，已删除；菜单改由 `NavLinks.tsx` patch 原生加入。
- `inject-into-html.mjs` 的 `.ae-recent-route` CSS 隐藏块：已删除。
- 上述废弃文件保留仅为记录（遵守"不删代码只发新版本"铁律）。

### 7.4 验收结果（playwright 桌面 1280 + 手机 390）

- `/recent` 返回真实渲染的 RecentPage（`h1=最近更新`），非 404、非全屏覆盖层 ✅
- 顶部菜单原生含「最近更新」且 active 高亮，class 与「首页/番剧/时间表」同源 ✅
- header/footer/main 全部 `display:block` 正常渲染，footer 不再闪现/隐藏 ✅
- `ae-rp`（废弃 DOM 层）不存在，`has404=false` ✅
- 数据加载后渲染 342+ 原生卡片（kz 组件），状态「实时」，标题/评分正常 ✅
- 构建后 submodule `git status` 干净，patch 无残留 ✅
- 构建耗时 ~4s，`index-*.js` 含「全网多源」特征串（证明 patch 进了产物）✅

### 7.5 已知数据侧问题（非规范问题）

- 部分源站条目 `cover` 为空 → 原生卡片显示「无封面」占位（数据抓取问题，旧方案同样如此）。
- 本地 dev 无 `/api/recent` 后端时，RecentPage 回退直读 webhook CORS API；线上 EdgeOne 走同源代理。



## 八、数据稳定性策略（2026-11-20 补充）

### 8.1 顺序锁定（最近更新不再乱跳）
- 根因：源站 recent 页每轮返回的条目集合会波动（某些 animeId 这轮有下轮没有），任何「集合签名对比」都会因集合变化触发全量重建 → 顺序乱跳。
- 解法（前端 RecentPage）：**锁定顺序 + 增量 merge**——首次按服务端顺序渲染；后续已有条目保持原位只更新内容（title/cover/episode/score/bgmId/updateDay），新条目追加到末尾，消失的保留，上限 120 条。内容无变化返回同一引用（React 不重渲染）。
- 服务端双保险：`itemsSignature` 用 normEp 抹平集数格式差异（"7 / 12" vs "7/12"）+ sort 排序无关；BGM 结果和 poll 都做签名对比，无变化不广播。

### 8.2 窄屏菜单横排
- patch `NavLinks.tsx` 的 nav className 加 `whitespace-nowrap`，修复手机端「最近更新」4字被拆成竖排两行（原站默认窄屏换行）。实测截图确认单行横排。


## 九、最近更新入口形态决策（2026-11-20）

- 顶栏**不加**「最近更新」第4项：手机窄屏会把搜索图标/用户头像挤到边缘（实测 390px 下 4 菜单项+logo+搜索+头像塞满）。撤销了 `NavLinks.tsx` 的菜单项 patch（顶栏恢复原站 3 项：首页/番剧/时间表）。
- 入口改为**顶栏下方右侧独立悬浮按钮**（`inject/ui-inject.js` 的 `addRecentFab()`），brand 色胶囊+圆点，SPA 软导航（history.pushState+popstate），active 跟随路由。
  - 踩坑：active 状态初版用 `--kz-accent-fg`（为深色按钮设计的白字）配浅色背景 → 文字不可见只剩圆点；改用 `--kz-accent` 文字 + accent 10% 淡背景修复。
- 底部导航「最近更新」简写为「**最新**」（2字）——原4字在 67px 格子里偏挤，用户要求简短显示。
