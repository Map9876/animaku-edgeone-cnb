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
  let src = readFileSync(nav, 'utf8')
  const anchor = "  { to: '/timeline', label: '时间表' },"
  if (!src.includes("to: '/recent'")) {
    if (!src.includes(anchor)) throw new Error('NavLinks.tsx mainLinks 锚点未命中（上游已改？）')
    src = src.replace(anchor, anchor + "\n  { to: '/recent', label: '最近更新' },")
  }
  writeFileSync(nav, src)
  console.log('[web-patch] NavLinks.tsx: 「最近更新」菜单项已注入')
}

if (revert) {
  for (const p of [app, nav]) {
    if (existsSync(p)) {
      // 用 git 恢复上游文件到干净状态（不影响 submodule commit 指针）
      const { execSync } = await import('node:child_process')
      execSync(`git -C "${path.join(root, 'upstream/animaku')}" checkout -- "${path.relative(path.join(root, 'upstream/animaku'), p)}"`, { stdio: 'inherit' })
    }
  }
  if (existsSync(pageDst)) { unlinkSync(pageDst); console.log('[web-patch] 已删除 apps/web/src/pages/RecentPage.tsx') }
  console.log('[web-patch] 上游源码已恢复干净')
} else {
  mustExist(app); mustExist(nav); mustExist(pageSrc)
  patchApp()
  patchNav()
  copyFileSync(pageSrc, pageDst)
  console.log('[web-patch] RecentPage.tsx 已复制到 apps/web/src/pages/')
  console.log('[web-patch] 全部 patch 应用完成（构建后务必 --revert 恢复）')
}
