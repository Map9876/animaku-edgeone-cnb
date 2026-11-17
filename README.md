# Animaku EdgeOne

> **在线网站：https://anime.map987.dpdns.org/**

把 [uerax/Animaku](https://github.com/uerax/Animaku) 全栈部署到 EdgeOne Pages（Node 运行时），
不改上游源码（git submodule + 注入层），叠加访问统计、定时从 GitHub 更新、移动端底部五栏等功能，
并通过 CNB CI 实现"上游更新 → 自动重新打包 → 自动部署"的自循环。

线上已实测全绿：首页、SPA 路由（`/subject/:id` 等）、全部 API、静态资源、统计端点均 200。

---

## 目录

1. [在线地址](#在线地址)
2. [整体架构](#整体架构)
3. [完整解决方案（逐层说明）](#完整解决方案逐层说明)
4. [自监督性开发：用 agent-browser 做网络调试与截图](#自监督性开发用-agent-browser-做网络调试与截图)
5. [本地开发与部署](#本地开发与部署)
6. [验证记录](#验证记录)
7. [附录：CI 构建/回写机制问答原话（一字不落）](#附录ci-构建回写机制问答原话一字不落)

---

## 在线地址

**https://anime.map987.dpdns.org**

- DNS：`anime.map987.dpdns.org → anime.map987.dpdns.org.pages.dnsoe9.com`（EdgeOne 分配），证书由 EdgeOne 自动签发。
- 每次改动 push 后，CI 自动构建 + 部署，通过该域名即可查看最新效果。

---

## 整体架构

```
uerax/Animaku (GitHub master)
   │  git submodule（只读，不修改）
   ▼
upstream/animaku
   │  esbuild bundle（build-edge.mjs）
   ▼
cloud-functions/api/[[default]].js   ← Hono 全栈后端 + 统计端点（EdgeOne Node 函数）
   │
   ├─ runtime/edge-index.ts       入口：组装 Hono app，export default app
   ├─ runtime/analytics.ts        /api/track + /api/stats（Blob 统计）
   ├─ runtime/sqlite-stub.ts      替代 node:sqlite（EdgeOne 不可用）
   ├─ runtime/private-host-edge.ts 原生 fetch 版 SSRF 防护（替 undici）
   ├─ runtime/outbound-proxy-edge.ts 空实现（替 undici ProxyAgent）
   ├─ runtime/undici-edge-stub.ts 替 cheerio 间接依赖的 undici
   └─ runtime/sharp-edge-stub.ts  替原生 sharp（EdgeOne 无 libvips）

public/ + 根目录（静态站点双份，EdgeOne 取哪个都能命中）
   ├─ index.html（注入 __ANIMAKU_CONFIG__ + 注入脚本）
   ├─ assets/（Vite 构建产物）
   └─ inject/（analytics.js + ui-inject.js）

middleware.js   ← SPA fallback：非 API/非静态路径 rewrite 到 /index.html
.cnb.yml        ← CNB push → 构建回写 → webhook 通知 EdgeOne 部署
```

---

## 完整解决方案（逐层说明）

### 1. 为什么这样设计

- **不改上游源码**：Animaku 持续更新，直接 fork 改代码会被 `submodule update` 覆盖或冲突（正是上游 issue #5 的痛点）。所以用 submodule + 独立目录 + 注入层。
- **全栈迁 EdgeOne**：后端 Hono + 前端 Vite 都跑在 EdgeOne Pages（Node 运行时）。
- **自循环**：CI 定时拉上游最新 → 重新打包 → 提交回仓库 → webhook 通知 EdgeOne → 线上验证。

### 2. 后端迁移（`scripts/build-edge.mjs`）

用 esbuild 把 Animaku 全部 Hono 路由打包成单个 ESM（`cloud-functions/api/[[default]].js`，约 4.6MB），
`export default app` 框架模式挂载，路由 `/api/*`。关键处理：

| 问题 | 解决 |
|---|---|
| `node:sqlite` 在 EdgeOne 打包时前缀被剥、resolve 失败 | esbuild alias → `runtime/sqlite-stub.ts`，配 `DB_ENABLED=false` 无状态模式 |
| undici（cheerio 1.2.0 间接依赖）在 EdgeOne 生产 bundle 下崩（`decompress.js reading 'bind'`） | alias `undici` → stub + plugin 替换 private-host/outbound-proxy 为原生 fetch / 空实现 |
| sharp 原生模块（libvips）EdgeOne 云构建无 linux-x64 二进制 | alias `sharp` → stub（链式 API 占位，仅影响管理后台生成 favicon） |
| CLI 靠源码字面识别函数入口 | 不 minify + footer 注入具名 `export function onRequest` |
| 框架模式路由重复 | 文件路径已映射 `/api/*`，Hono 里不要再加 `.basePath('/api')` |

**关于"别损坏原项目"**：以上 stub 全部在我们自己的 `runtime/` 和 `build-edge.mjs` 里，
`upstream/animaku` 上游源码**一字未改**，submodule 照常 `update --remote` 拉新版，无冲突。
stub 是平台限制下的适配——EdgeOne 报错路径 `file:///var/user/index.mjs` 证明 CNB→EdgeOne
部署只上传 bundle 单文件、不带 node_modules，所以这些依赖无法 external 加载。

### 3. 统计（`runtime/analytics.ts`）

- `POST /api/track`：接收精简字段（utm_source / entry / fromPage→toPage / subjectId / did / ts），
  one-file-per-record 写 EdgeOne Blob（`@edgeone/pages-blob`，`getStore({name, consistency:'strong'})`）。
  **绝不采集登录凭证**（不仿 B站 app 那一堆鉴权参数，只借"入口上下文透传"思想）。
- `GET /api/stats`：读 Blob 聚合，输出 utm_source 频率、入口频率、某动漫频率、页面流转、时间趋势。
- 前端 SDK `inject/analytics.js`：localStorage 缓冲批量上报，依赖上游 P2 协议 hooks（见 `docs/P2-给上游的协议入口提案.md`）。

注意：EdgeOne Blob `list()` 返回 `{ blobs: [{key,etag}], directories: [] }`（不是 `keys`）。

### 4. 注入层（`inject/`）

- `ui-inject.js`：设置页"定时从 GitHub 更新"on/off 开关（开关左侧刷新图标，点击展示 3 秒
  "立即刷新"）；多源失败静默重试 1 次、反复才提示；移动端底部五栏。
- **设计风格一致性**：所有注入 UI 沿用"定时从 GitHub 更新 / 自动同步源规则与界面；关闭则暂停"
  这套——左侧标题+副标题、右侧 on/off 胶囊开关、开关左侧刷新图标，与 Animaku 原生 Switch 组件统一。
- 依赖 `window.__ANIMAKU_CONFIG__` 开关（`FRONT_THEME=ON` 等），由 `scripts/inject-into-html.mjs` 注入 index.html。

### 5. SPA fallback（`middleware.js`）

Animaku 是 React Router SPA，`/subject/:id`、`/anime` 等是客户端路由。EdgeOne 静态托管默认对未知路径 404
（原版靠 Hono `app.get('*')`，迁移时删了）。用 EdgeOne 官方 middleware（V8）：

- `/api/*` → 放行给云函数
- 带扩展名的静态资源 / 首页 / 元数据文件 → 放行
- 其余路径 → `rewrite('/index.html')`，交给 React Router

### 6. CI 自动回写（`.cnb.yml` + `scripts/ci-commit-artifacts.sh`）

CNB push → 构建阶段：`npm install` → `git submodule update --init --remote --recursive`（拉上游最新）
→ `build-edge.mjs` → `sync-web.mjs` → `inject-into-html.mjs` → `ci-commit-artifacts.sh`（有变化才 commit+push 回仓库）
→ webhook 通知 EdgeOne。防循环：`git diff --cached --quiet` 无变化则停 + `[skip ci]` 双保险。

详见文末附录问答原话。

---

## 自监督性开发：用 agent-browser 做网络调试与截图

每次迭代都用 **agent-browser CLI**（真实浏览器，非自写脚本、非读代码推理）做线上自监督：
打开网站 → snapshot 看真实 DOM → 截图肉眼核对外观 → 发现问题回到改码。

获取 session（独立会话，避免干扰其他 agent）：

```bash
S=$(agent-browser session id --scope worktree --prefix animaku | tail -1)
```

打开页面并看 React 是否真实挂载：

```bash
agent-browser open "https://anime.map987.dpdns.org/subject/269235" --session "$S"
sleep 5
agent-browser snapshot -i --session "$S"      # 看可交互元素/真实内容
```

截图肉眼核对（DOM 表达不了的视觉问题必须截图）：

```bash
agent-browser screenshot "/path/to/shot.png" --session "$S"
```

网络调试（API 请求/响应）：

```bash
curl -s -w "\nhttp=%{http_code}\n" "https://anime.map987.dpdns.org/api/health"
```

用完关闭：`agent-browser close --session "$S"`。

**铁律**：截图后必须肉眼核对实际外观，不能只靠 `snapshot`/`eval`/读代码就宣称通过；
前端每次改动都要在真实浏览器复测关键交互。

---

## 本地开发与部署

```bash
cd animaku-edgeone
npm install
npm run build                    # esbuild 打包 → cloud-functions/api/[[default]].js

# 本地验证（Node 函数 + middleware，端口 808x）
edgeone makers dev -t <EDGEONE_TOKEN> -n animaku-edgeone --skip-env-sync --skip-ai-gateway-sync

# 部署（本项目是 CNB 类型，走 .cnb.yml webhook，CLI deploy 不支持）
git push origin HEAD:main        # CI 自动构建 + webhook → EdgeOne
```

---

## 验证记录

线上 https://anime.map987.dpdns.org 实测（2026-11-17）：

| 项 | 结果 |
|---|---|
| 首页 `/` | 200，完整 index.html |
| SPA 路由 `/subject/269235` `/play` `/anime` `/settings` `/timeline` `/collect` `/search` | 全 200 |
| API `/api/health` `/api/__diag` `/api/site/config` `/api/source/list` `/api/track` `/api/stats` | 全 200 |
| 静态 `/assets/*` `/inject/*` | 200 |
| 证书 | SAN 含 `anime.map987.dpdns.org` |

浏览器验证：agent-browser 打开 `/subject/269235`，React 完整挂载（天气之子详情、选集、视频源、
番剧推荐），注入的设置页开关与底部五栏正常。截图：`docs/线上验证-subject269235.png`。

---

## 附录：CI 构建/回写机制问答原话（一字不落）

> 以下为 2026-11-17 关于「bundle 谁构建 / 哪里 push / 哪里破局」问答的完整原话，一字不落保留。

好问题，这正是这套机制最绕的地方。我先验证一下实际提交内容，再给你讲清楚"哪里 push、哪里破局"，不靠猜。

实测铁证：CI 那次自动提交 `f99c421` 里，`upstream/animaku` 指针从 `1db50dd` → `6b2817cf`（上游最新）。所以 **CI 确实把拉取到的新 submodule 指针 push 回去了**。

现在讲清楚你问的两个问题。

### 1. bundle 是谁构建的？

**两处都会构建，但分工不同：**
- **我本地手动构建了一次**（种子）：让你第一次 push 时仓库里就有现成 bundle，EdgeOne 一上来能部署。
- **之后每次都是 CI 构建**：`build-edge.mjs` 在 CNB 的构建容器里跑。你本地不跑也有。

所以 bundle 不是非得本地构建——本地那次只是"点火"。

### 2. "晚一步" + "哪里 push / 哪里破局"

你的直觉完全对，这就是个**两阶段接力**。我用时序讲：

```
① 你/我 本地 push 一次代码
   （此时 submodule 指针 = 旧的 1db50dd）
   └─ 这只是"点火”，告诉 CI：开工

② 第一次 CI 收到通知，开工：
   ├─ checkout：拿到旧指针 1db50dd
   ├─ git submodule update --remote  ← 关键！去 GitHub 拉 master 最新 → 6b2817cf
   │                                   （这就是你说的"晚一步"才拉到）
   ├─ build-edge.mjs：用新源码重新打包 bundle
   ├─ sync-web.mjs：重新构建前端
   └─ ci-commit-artifacts.sh  ★破局点在这里★
        ├─ git add upstream/animaku（把新指针 6b2817cf 加进去）
        ├─ 发现指针变了 → git commit
        └─ git push origin HEAD:main   ← "哪里 push"：就是这一行
                                          把新指针 + 新 bundle 推回仓库

③ 这个 push 又触发第二次 CI：
   ├─ checkout：拿到新指针 6b2817cf（已经是最新了）
   ├─ submodule update --remote：上游没更新，还是 6b2817cf，不变
   ├─ 重新打包：bundle 内容一样
   └─ ci-commit-artifacts.sh
        └─ git diff --cached --quiet → 无变化 → 不提交、不 push
                                          ↑ "破局"：循环在这里终止
```

**回答你的三个小问：**
- **CI 拉取的 submodule 会 push 吗？** 会。就在 `ci-commit-artifacts.sh` 的 `git add upstream/animaku` + `git commit` + `git push`（脚本第 45 行）。实测 `f99c421` 里指针确实变成 newest。
- **哪里 push 的？** 脚本 `scripts/ci-commit-artifacts.sh` 里的 `git push origin "HEAD:${BRANCH}"`（第 45 行），跑在 CNB 的构建容器里。
- **哪里破局（终止循环）？** 同脚本第 28 行 `git diff --cached --quiet`——第二次构建发现产物没变化，直接 `exit 0`，不 commit 不 push，链条就断了。再加 `[skip ci]` 双保险。

**一句话**：第一次 push 是"点火"，CI 拉新源码→重新打包→**自己把成果 push 回去**（这是破局的 push 点），第二次 CI 发现没变化就停。整个链条自运转，你只点火一次。
