/**
 * 最近更新数据代理（Hono 路由）：GET /api/recent。
 *
 * 服务端代理 webhook 的 /api/latest，前端同源读取，避免跨域。
 * 关键：EdgeOne 多实例下 fetch webhook 偶发失败（实测 10 次 1 次 502），
 * 故加内存缓存 + 失败回退旧值——即使某次上游抖动也返回上次成功数据，不抛 502。
 * 规范见 docs/二次开发规范-禁止DOM破坏性注入.md（§2.5 数据层）。
 */
import { Hono } from 'hono'

export const recentRoutes = new Hono()

const WEBHOOK_BASE = 'https://new-anime-webhook.map987.dpdns.org'
const TTL = 60 * 1000 // 1 分钟内直接用缓存，降低 webhook 压力 + 规避抖动

type RecentData = { items: unknown[]; counts: Record<string, number>; updatedAt: number }
let cache: { data: RecentData; at: number } | null = null

async function load(): Promise<RecentData | null> {
  const now = Date.now()
  if (cache && now - cache.at < TTL) return cache.data
  try {
    const res = await fetch(`${WEBHOOK_BASE}/api/latest`, {
      headers: { 'User-Agent': 'animaku-edgeone/1.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    const d = await res.json() as { items?: unknown[]; counts?: Record<string, number>; updatedAt?: number }
    const data: RecentData = { items: d.items || [], counts: d.counts || {}, updatedAt: d.updatedAt || 0 }
    if (data.items.length) cache = { data, at: now } // 只在有数据时缓存
    return data
  } catch {
    // 上游失败：回退到上次成功缓存（哪怕过期），绝不返回 502
    return cache ? cache.data : null
  }
}

recentRoutes.get('/recent', async (c) => {
  const data = await load()
  if (data) return c.json({ ok: true, ...data }, 200)
  return c.json({ ok: false, items: [], error: 'upstream unavailable' }, 200) // 仍 200，前端显示空但不报错
})
