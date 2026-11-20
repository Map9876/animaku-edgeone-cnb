/**
 * 构建后处理：把 EdgeOne 注入层的配置和脚本注入 Animaku 的 index.html。
 * 在 pnpm 构建 web 并把 dist/* 复制后运行 `node scripts/inject-into-html.mjs`。
 * 幂等：重复运行不会重复插入。同时处理根目录与 public/ 两份（EdgeOne 静态根可能是任一）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const targets = [
  path.join(root, 'index.html'),
  path.join(root, 'public', 'index.html'),
].filter((p) => existsSync(p))

if (targets.length === 0) {
  console.error('index.html 不存在，请先构建 web 并复制 dist')
  process.exit(1)
}

// 部署开关：默认全开，可通过环境变量覆盖
const cfg = {
  gitSync: process.env.VITE_GIT_SYNC || 'on',
  autoRefresh: process.env.VITE_AUTO_REFRESH || 'on',
  bottomNav: process.env.VITE_BOTTOM_NAV || 'on',
  compact: process.env.VITE_COMPACT || 'on',
  trackStats: process.env.VITE_TRACK_STATS || 'on',
  trackEndpoint: process.env.VITE_TRACK_ENDPOINT || '/api/track',
  recentPanel: process.env.VITE_RECENT_PANEL || 'off', // 右侧悬浮挂件：默认关（改为顶部菜单入口 → /recent 独立页）
  recentPage: process.env.VITE_RECENT_PAGE || 'on',    // /recent 独立页：默认开
  recentMode: process.env.VITE_RECENT_MODE || 'generic', // generic=webhook本体 / blob=EdgeOne Blob
  recentBase: process.env.VITE_RECENT_BASE || 'https://new-anime-webhook.map987.dpdns.org',
}

const injectBlock = `
    <!-- ===== Animaku EdgeOne 注入层（由 scripts/inject-into-html.mjs 生成）===== -->
    <script>
      window.__ANIMAKU_CONFIG__ = ${JSON.stringify(cfg)};
      window.__ANIMAKU_HOOKS__ = window.__ANIMAKU_HOOKS__ || {};
      // /recent 是注入层独立页：只隐藏 React 的 404 内容区(main)，保留原站 header/footer。
      // 这样顶部菜单原生显示（含我们注入的「最近更新」入口），不动上游源码。
      if (location.pathname.replace(/\\/+$/, '') === '/recent') {
        document.documentElement.classList.add('ae-recent-route');
        var _s = document.createElement('style');
        _s.textContent = '.ae-recent-route #root>div>main{display:none!important}'
          + '.ae-recent-route header{z-index:10000!important}';
        document.head.appendChild(_s);
      }
    </script>
    <script src="/inject/analytics.js" defer></script>
    <script src="/inject/ui-inject.js" defer></script>
    <script src="/inject/recent-page.js" defer></script>
    <!-- ===== /注入层 ===== -->
`

for (const htmlPath of targets) {
  let html = readFileSync(htmlPath, 'utf8')
  if (html.includes('__ANIMAKU_CONFIG__')) {
    console.log('已注入过，跳过:', path.relative(root, htmlPath))
    continue
  }
  html = html.replace('</head>', injectBlock + '\n  </head>')
  writeFileSync(htmlPath, html, 'utf8')
  console.log('✅ 注入完成:', path.relative(root, htmlPath), cfg)
}
