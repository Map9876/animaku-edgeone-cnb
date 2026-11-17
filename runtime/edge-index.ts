/**
 * Animaku → EdgeOne 专用入口。
 *
 * 复用 Animaku 的全部 Hono 路由与 lib，但：
 *  - 不调用 serve() / 不启动 HTTP server（EdgeOne 托管）
 *  - 不做 serveStatic（静态资源由 EdgeOne Pages 直接托管）
 *  - 不起 setInterval / IndexNow 后台任务（EdgeOne 无状态）
 *  - node:sqlite 由 esbuild alias 指向无状态 stub（DB_ENABLED=false）
 *
 * 导出 Hono app 实例，由 cloud-functions/api/[[default]].js 以
 * `export default app` 框架模式挂载。
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { config } from '../upstream/animaku/apps/server/src/config'
import { initBangumiDataMapping } from '../upstream/animaku/apps/server/src/lib/bangumi-data'
import { corsOriginDecision } from '../upstream/animaku/apps/server/src/lib/access'
import { accessLogger } from '../upstream/animaku/apps/server/src/lib/logger'
import { ipAccessAndRateLimit } from '../upstream/animaku/apps/server/src/lib/ip-rate-limit'
import { bangumiRoutes } from '../upstream/animaku/apps/server/src/routes/bangumi'
import { danmakuRoutes } from '../upstream/animaku/apps/server/src/routes/danmaku'
import { bilibiliDanmakuRoutes } from '../upstream/animaku/apps/server/src/routes/bilibili-danmaku'
import { danmuboxRoutes } from '../upstream/animaku/apps/server/src/routes/danmubox'
import { pluginRoutes } from '../upstream/animaku/apps/server/src/routes/plugin'
import { sourceRoutes } from '../upstream/animaku/apps/server/src/routes/source'
import { mediaRoutes } from '../upstream/animaku/apps/server/src/routes/media'
import { statsRoutes } from '../upstream/animaku/apps/server/src/routes/stats'
import { siteRoutes, adminSiteRoutes } from '../upstream/animaku/apps/server/src/routes/site'
import { analyticsRoutes } from './analytics'

// 初始化 Bangumi 跨站映射（无 DB 时从内嵌 snapshot 读，esbuild 会把 JSON 打进 bundle）
try {
  initBangumiDataMapping()
} catch (err) {
  console.warn('[edge] initBangumiDataMapping failed:', err)
}

const app = new Hono()

// 结构化访问日志 + IP 限流（无状态下限流为 no-op）
app.use('*', accessLogger())
app.use('*', ipAccessAndRateLimit())

// API 不被搜索引擎索引
app.use('/api/*', async (c, next) => {
  await next()
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
})

// CORS：沿用 Animaku 的 Origin 决策（reflect allowlist，不用 *）
app.use(
  '*',
  cors({
    origin: (origin) => corsOriginDecision(origin),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: false,
  }),
)

// 健康检查
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    version: config.version,
    runtime: 'edgeone-node',
    danmakuConfigured: true,
  }),
)

// EdgeOne 诊断端点（我们自己的，验证注入/统计链路）
app.get('/api/__diag', (c) =>
  c.json({
    ok: true,
    runtime: process.version,
    version: config.version,
    dbEnabled: config.dbEnabled,
    ts: Date.now(),
  }),
)

// ---- 统计埋点（我们自己的，单进程 Blob 共享）----
app.route('/api', analyticsRoutes)

// ---- Animaku 全部业务路由 ----
app.route('/api/bangumi', bangumiRoutes)
app.route('/api/danmaku', danmakuRoutes)
app.route('/api/danmaku', bilibiliDanmakuRoutes)
app.route('/api/danmaku', danmuboxRoutes)
app.route('/api/plugin', pluginRoutes)
app.route('/api/source', sourceRoutes)
app.route('/api/media', mediaRoutes)
app.route('/api/stats', statsRoutes)
app.route('/api/site', siteRoutes)
app.route('/api/admin', adminSiteRoutes)

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404))
app.onError((err, c) => {
  const name = err instanceof Error ? err.name : ''
  const msg = err instanceof Error ? err.message : String(err)
  if (name === 'TimeoutError' || name === 'AbortError' || /aborted|timeout/i.test(msg)) {
    return c.json({ error: 'upstream', message: msg }, 504)
  }
  console.error('[edge] error:', err)
  return c.json({ error: 'internal_error', message: msg.slice(0, 200) }, 500)
})

export default app
