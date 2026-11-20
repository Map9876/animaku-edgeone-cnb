/**
 * 前端侵入式 patch（构建期，不改源文件仓库）。
 *
 * 作用：把「原站范式」的 /recent 功能，在 vite 构建前注入到 submodule 工作副本：
 *   1. App.tsx   import + 路由表加 <Route path="recent" ...>
 *   2. NavLinks.tsx mainLinks 加「最近更新」
 *   3. 自有 web-overlay/RecentPage.tsx → 复制到 apps/web/src/pages/RecentPage.tsx
 *
 * 构建完成后用 `node scripts/apply-web-patches.mjs --revert` 恢复：
 *   git checkout 被改的上游文件 + 删除复制的 page 文件。
 * 这样上游 submodule 的 commit 指针与 git status 始终干净——「侵入但不改源文件」。
 *
 * 规范见 docs/二次开发规范-禁止DOM破坏性注入.md
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const web = path.join(root, 'upstream/animaku/apps/web/src')
const app = path.join(web, 'App.tsx')
const nav = path.join(web, 'components/nav/NavLinks.tsx')
const pageDst = path.join(web, 'pages/RecentPage.tsx')
const pageSrc = path.join(root, 'web-overlay/RecentPage.tsx')
const revert = process.argv.includes('--revert')

function mustExist(p) {
  if (!existsSync(p)) {
    console.error(`[web-patch] 源文件缺失: ${p}（先 git submodule update --init upstream/animaku）`)
    process.exit(1)
  }
}

function patchApp() {
  let src = readFileSync(app, 'utf8')
  // 1) import（在 NotFoundPage import 后加，若未加过）
  const importAnchor = "import { NotFoundPage } from './pages/NotFoundPage'"
  if (!src.includes('pages/RecentPage')) {
    if (!src.includes(importAnchor)) throw new Error('App.tsx import 锚点未命中（上游已改？）')
    src = src.replace(importAnchor, importAnchor + "\nimport { RecentPage } from './pages/RecentPage'")
  }
  // 2) 路由表（在 timeline 路由后，若未加过）
  const routeAnchor = '        <Route path="timeline" element={<TimelinePage />} />'
  if (!src.includes('path="recent"')) {
    if (!src.includes(routeAnchor)) throw new Error('App.tsx 路由锚点未命中（上游已改？）')
    src = src.replace(routeAnchor, routeAnchor + '\n        <Route path="recent" element={<RecentPage />} />')
  }
  writeFileSync(app, src)
  console.log('[web-patch] App.tsx: import + /recent 路由已注入')
}

function patchNav() {
  // 顶栏不再加「最近更新」第4项（窄屏挤占搜索/头像）。改为顶栏下方右侧独立悬浮按钮
  // （见 inject/ui-inject.js 的 addRecentFab）。上游 NavLinks.tsx 保持原样。
  console.log('[web-patch] NavLinks.tsx: 保持原样（最近更新入口改为顶栏下悬浮按钮）')
}

function patchNavNoWrap() {
  let src = readFileSync(nav, 'utf8')
  if (src.includes('whitespace-nowrap')) return // 已应用
  const anchor = '<nav\n      className="flex h-full min-w-0 items-center gap-1 sm:gap-2 lg:gap-3"'
  if (!src.includes(anchor)) {
    // 兼容单行写法
    const anchor2 = 'className="flex h-full min-w-0 items-center gap-1 sm:gap-2 lg:gap-3"'
    if (!src.includes(anchor2)) throw new Error('NavLinks.tsx nav className 锚点未命中（上游已改？）')
    src = src.replace(anchor2, anchor2.replace('flex h-full', 'flex whitespace-nowrap h-full'))
  } else {
    src = src.replace(anchor, anchor.replace('flex h-full', 'flex whitespace-nowrap h-full'))
  }
  writeFileSync(nav, src)
  console.log('[web-patch] NavLinks.tsx: 窄屏菜单 whitespace-nowrap（防「最近更新」竖排分行）')
}

function patchCardLabel() {
  const ui = path.join(web, 'components/ui.tsx')
  let src = readFileSync(ui, 'utf8')
  if (src.includes('aeDisplayLabel')) return // 已应用
  const anchor = '  const airLabel = airProgressLabel(item)'
  if (!src.includes(anchor)) throw new Error('ui.tsx airLabel 锚点未命中（上游已改？）')
  // 我们的 RecentPage 在 item.info 里塞了「更新至 X/Y · 11月20日」，让卡片右上角
  // 优先显示它（源站判定的真实更新日期），而非推算的放送进度。其他页面 info 不含日期，
  // displayLabel 回退到 airLabel，零副作用。
  src = src.replace(anchor, anchor +
    "\n  const aeDisplayLabel = (item.info && /\\d+月\\d+日|今天|昨天|前天|天前/.test(item.info)) ? item.info : airLabel")
  // 渲染处 3 个 airLabel → aeDisplayLabel（声明行刚加的保留）
  src = src.replace(/\{airLabel && \(/g, '{aeDisplayLabel && (')
  src = src.replace(/\{airLabel\}/g, '{aeDisplayLabel}')
  writeFileSync(ui, src)
  console.log('[web-patch] ui.tsx: BangumiCard 优先显示 item.info 里的更新日期')
}

const uiFile = path.join(web, 'components/ui.tsx')

if (revert) {
  for (const p of [app, nav, uiFile]) {
    if (existsSync(p)) {
      // 用 git 恢复上游文件到干净状态（不影响 submodule commit 指针）
      const { execSync } = await import('node:child_process')
      execSync(`git -C "${path.join(root, 'upstream/animaku')}" checkout -- "${path.relative(path.join(root, 'upstream/animaku'), p)}"`, { stdio: 'inherit' })
    }
  }
  if (existsSync(pageDst)) { unlinkSync(pageDst); console.log('[web-patch] 已删除 apps/web/src/pages/RecentPage.tsx') }
  console.log('[web-patch] 上游源码已恢复干净')
} else {
  mustExist(app); mustExist(nav); mustExist(uiFile); mustExist(pageSrc)
  patchApp()
  patchNav()
  patchCardLabel()
  copyFileSync(pageSrc, pageDst)
  console.log('[web-patch] RecentPage.tsx 已复制到 apps/web/src/pages/')
  console.log('[web-patch] 全部 patch 应用完成（构建后务必 --revert 恢复）')
}
