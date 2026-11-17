/**
 * EdgeOne Pages middleware（V8 运行时）—— SPA fallback。
 *
 * Animaku 是 React Router SPA，/subject/:id、/anime、/settings 等是客户端路由。
 * 静态托管默认只对真实文件返回内容，未知路径会 404。原版靠 Hono 的 app.get('*')
 * 做 fallback，但 EdgeOne CNB 项目不带 node_modules、只托管静态，所以用 middleware
 * 把「非 API、非静态资源」的路径透明 rewrite 到 /index.html，让 React Router 接管。
 */

const STATIC_EXT = /\.[a-zA-Z0-9]+$/

export function middleware(context) {
  const { request, next, rewrite } = context
  const url = new URL(request.url)
  const path = url.pathname

  // API 请求交给云函数，不 rewrite
  if (path === '/api' || path.startsWith('/api/')) return next()

  // 真实存在的静态资源（带扩展名）/ 首页 / 常见元数据文件，直接放行
  if (path === '/' || path === '/index.html') return next()
  if (STATIC_EXT.test(path)) return next()
  if (
    path === '/robots.txt' ||
    path === '/sitemap.xml' ||
    path === '/site.webmanifest' ||
    path === '/favicon.ico'
  ) return next()

  // 其余一律当作 SPA 客户端路由 → rewrite 到 index.html
  return rewrite('/index.html')
}
