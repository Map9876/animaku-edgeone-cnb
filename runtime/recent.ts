/**
 * 最近更新数据代理（Hono 路由）：GET /api/recent。
 *
 * 服务端代理 webhook 的 /api/latest，前端同源读取，避免跨域；
 * 同时给一个短 HTTP 缓存降低 webhook 压力（前端还有 WS 增量）。
 * 这是"侵入式 patch 原生路由"方案的数据层（见 docs/二次开发规范-禁止DOM破坏性注入.md §2.5）。
 */
import { Hono } from 'hono'

export const recentRoutes = new Hono()

const WEBHOOK_BASE = 'https://new-anime-webhook.map987.dpdns.org'

recentRoutes.get('/recent', async (c) => {
  try {
    const res = await fetch(`${WEBHOOK_BASE}/api/latest`, {
      headers: { 'User-Agent': 'animaku-edgeone/1.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return c.json({ ok: false, items: [] }, 502)
    const data = await res.json() as { items?: unknown[]; counts?: Record<string, number>; updatedAt?: number }
    return c.json(
      { ok: true, items: data.items || [], counts: data.counts || {}, updatedAt: data.updatedAt || 0 },
      200,
    )
  } catch (e) {
    return c.json({ ok: false, items: [], error: String(e) }, 502)
  }
})
