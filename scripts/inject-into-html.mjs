/**
 * 构建后处理：把 EdgeOne 注入层的配置和脚本注入 Animaku 的 index.html。
 *
 * 在 pnpm 构建 web 并把 dist/* 复制到项目根后运行 `node scripts/inject-into-html.mjs`。
 * 幂等：重复运行不会重复插入。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const htmlPath = path.join(root, 'index.html')

if (!existsSync(htmlPath)) {
  console.error('index.html 不存在，请先构建 web 并复制 dist')
  process.exit(1)
}

let html = readFileSync(htmlPath, 'utf8')

// 已注入则跳过（幂等）
if (html.includes('__ANIMAKU_CONFIG__')) {
  console.log('已注入过，跳过')
  process.exit(0)
}

// 部署开关：默认全开，可通过环境变量覆盖
const cfg = {
  frontTheme: process.env.VITE_FRONT_THEME || 'on',
  gitSync: process.env.VITE_GIT_SYNC || 'on',
  autoRefresh: process.env.VITE_AUTO_REFRESH || 'on',
  trackStats: process.env.VITE_TRACK_STATS || 'on',
  trackEndpoint: process.env.VITE_TRACK_ENDPOINT || '/api/track',
}

const injectBlock = `
    <!-- ===== Animaku EdgeOne 注入层（由 scripts/inject-into-html.mjs 生成）===== -->
    <script>
      window.__ANIMAKU_CONFIG__ = ${JSON.stringify(cfg)};
      window.__ANIMAKU_HOOKS__ = window.__ANIMAKU_HOOKS__ || {};
    </script>
    <script src="/inject/analytics.js" defer></script>
    <script src="/inject/ui-inject.js" defer></script>
    <!-- ===== /注入层 ===== -->
`

html = html.replace('</head>', injectBlock + '\n  </head>')
writeFileSync(htmlPath, html, 'utf8')
console.log('✅ 注入完成：', cfg)
