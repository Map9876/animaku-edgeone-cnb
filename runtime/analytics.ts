/**
 * 访问行为统计（Hono 路由），合并进 api 单函数，保证 Blob 单进程共享。
 * 端点：POST /api/track   GET /api/stats
 */
import { Hono } from 'hono'
import { getStore } from '@edgeone/pages-blob'

const STORE = { name: 'animaku-analytics', consistency: 'strong' }

const FIELDS = ['utm_source', 'entry', 'fromPage', 'toPage', 'subjectId', 'did', 'ts']
const MAX_BODY = 32 * 1024

function sanitize(v: unknown, maxLen = 128): string {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  return String(v).slice(0, maxLen)
}

function topN(map: Record<string, number>, n = 20) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }))
}

// ---- 排行榜（P0）：从我们自己的 Blob 事件聚合播放量 ----
// 上游 stats.ts 的 rank 依赖 SQLite，EdgeOne 无状态下恒空 → 这里覆盖 /api/stats/rank*。
// 播放量定义：进入 /subject/:id 或 /play/:id 记一次（analytics.js 已埋 subjectId）。
type RankEvent = { ts: number; subjectId: string; did: string }
let rankCache: { events: RankEvent[]; at: number } | null = null
const RANK_TTL = 60 * 1000 // 1 分钟，避免每次全量读 Blob

async function loadRankEvents(): Promise<RankEvent[]> {
  const now = Date.now()
  if (rankCache && now - rankCache.at < RANK_TTL) return rankCache.events
  let keys: string[] = []
  try {
    const store = getStore(STORE)
    const listed = await store.list({ prefix: 'events/' }) as { blobs?: Array<{ key: string }> }
    keys = (listed.blobs || []).map((b) => b.key).filter(Boolean)
  } catch { return [] }
  const events: RankEvent[] = []
  // 只读最近 2 万条，足够算总榜且避免超时
  for (const key of keys.slice(-20000)) {
    try {
      const ev = await getStore(STORE).get(key, { type: 'json' }) as Record<string, unknown> | null
      if (ev && ev.subjectId) {
        events.push({
          ts: Number(ev.serverTs || ev.ts || 0),
          subjectId: String(ev.subjectId),
          did: String(ev.did || ''),
        })
      }
    } catch { continue }
  }
  rankCache = { events, at: now }
  return events
}

function rankByType(type: string, limit: number) {
  const now = Date.now()
  const windowMs = type === 'today' ? 24 * 3600e3
    : type === 'week' ? 7 * 24 * 3600e3
    : type === 'month' ? 30 * 24 * 3600e3
    : Infinity
  return loadRankEvents().then((events) => {
    const counts: Record<string, number> = {}
    for (const e of events) {
      if (windowMs !== Infinity && now - e.ts > windowMs) continue
      const id = Number(e.subjectId)
      if (!Number.isFinite(id) || id <= 0) continue
      counts[String(id)] = (counts[String(id)] || 0) + 1
    }
    const data = Object.entries(counts)
      .map(([id, count]) => ({ bangumiId: Number(id), totalPlayCount: count }))
      .sort((a, b) => b.totalPlayCount - a.totalPlayCount)
      .slice(0, limit)
    return { data, type, limit }
  })
}

export const analyticsRoutes = new Hono()

analyticsRoutes.post('/track', async (c) => {
  let payload: unknown
  try {
    const raw = await c.req.text()
    if (raw.length > MAX_BODY) return c.json({ error: 'too_large' }, 413)
    payload = JSON.parse(raw)
  } catch {
    return c.json({ error: 'bad_json' }, 400)
  }
  const events = Array.isArray(payload) ? payload : [payload]
  if (events.length === 0 || events.length > 100) {
    return c.json({ error: 'bad_count' }, 400)
  }

  const store = getStore(STORE)
  const now = Date.now()
  let written = 0
  for (let i = 0; i < events.length; i++) {
    const e = (events[i] || {}) as Record<string, unknown>
    const clean: Record<string, string | number> = {}
    for (const f of FIELDS) {
      if (e[f] !== undefined && e[f] !== null) clean[f] = sanitize(e[f])
    }
    clean.serverTs = now
    if (!clean.utm_source) clean.utm_source = '(direct)'
    const key = `events/${now}-${i}-${Math.floor(Math.random() * 1e6)}.json`
    try {
      await store.setJSON(key, clean)
      written++
    } catch (err) {
      console.error('[track] write failed:', err)
    }
  }
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  if (written > 0) rankCache = null // 新事件写入后让排行榜缓存失效
  return c.json({ ok: true, written })
})

analyticsRoutes.options('/track', (c) => {
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return new Response(null, { status: 204 })
})

analyticsRoutes.get('/stats', async (c) => {
  const since = Number(c.req.query('since') || 0)
  const limit = Math.min(Number(c.req.query('limit') || 5000), 20000)
  let store
  try {
    store = getStore(STORE)
  } catch (e) {
    return c.json({ error: 'store_unavailable', message: String((e as Error).message || e) }, 500)
  }

  let keys: string[] = []
  try {
    // EdgeOne Blob list() 实测返回 { blobs: [{ key, etag }], directories: [] }
    const listed = await store.list({ prefix: 'events/' }) as { blobs?: Array<{ key: string }> }
    const arr = listed.blobs || []
    keys = arr.map((b) => b.key).filter(Boolean)
  } catch (e) {
    return c.json({ error: 'list_failed', message: String((e as Error).message || e) }, 500)
  }

  const utm: Record<string, number> = {}, entry: Record<string, number> = {}
  const subject: Record<string, number> = {}, flow: Record<string, number> = {}, hourly: Record<string, number> = {}
  let total = 0

  const recent = keys.slice(-limit)
  for (const key of recent) {
    let ev: Record<string, unknown> | null
    try {
      ev = await store.get(key, { type: 'json' }) as Record<string, unknown> | null
    } catch {
      continue
    }
    if (!ev) continue
    const ts = Number(ev.serverTs || ev.ts || 0)
    if (since && ts < since) continue
    total++
    if (ev.utm_source) utm[String(ev.utm_source)] = (utm[String(ev.utm_source)] || 0) + 1
    if (ev.entry) entry[String(ev.entry)] = (entry[String(ev.entry)] || 0) + 1
    if (ev.subjectId) subject[String(ev.subjectId)] = (subject[String(ev.subjectId)] || 0) + 1
    if (ev.fromPage && ev.toPage) {
      const f = `${ev.fromPage}→${ev.toPage}`
      flow[f] = (flow[f] || 0) + 1
    }
    if (ts) {
      const hour = new Date(ts).toISOString().slice(0, 13)
      hourly[hour] = (hourly[hour] || 0) + 1
    }
  }

  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Cache-Control', 'no-store')
  return c.json({
    ok: true, total, availableKeys: keys.length,
    byUtmSource: topN(utm), byEntry: topN(entry),
    bySubject: topN(subject), byFlow: topN(flow),
    byHour: Object.entries(hourly).sort((a, b) => a[0].localeCompare(b[0])).map(([key, count]) => ({ key, count })),
  })
})

// 排行榜路由：覆盖上游 /api/stats/rank*（SQLite 空），改用我们 Blob 的真实访问数据。
// 注意这些挂在 analyticsRoutes(/api) 下，先于上游 statsRoutes(/api/stats) 注册 → 优先命中。
async function rankHandler(c: any, fixed?: string) {
  const raw = (fixed || c.req.query('type') || 'total').toLowerCase()
  const type = ['today', 'week', 'month'].includes(raw) ? raw : 'total'
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 20) || 20, 1), 100)
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Cache-Control', 'public, max-age=60')
  return c.json(await rankByType(type, limit))
}
analyticsRoutes.get('/stats/rank', (c) => rankHandler(c))
analyticsRoutes.get('/stats/rank/top', (c) => rankHandler(c))
analyticsRoutes.get('/stats/rank/today', (c) => rankHandler(c, 'today'))
analyticsRoutes.get('/stats/rank/day', (c) => rankHandler(c, 'today'))
analyticsRoutes.get('/stats/rank/week', (c) => rankHandler(c, 'week'))
analyticsRoutes.get('/stats/rank/month', (c) => rankHandler(c, 'month'))
analyticsRoutes.get('/stats/rank/total', (c) => rankHandler(c, 'total'))

// 写事件后让 rank 缓存失效（下次读立刻反映新播放）
// 通过在 /track 成功后清缓存实现：见下方 patch 点
// ---- 最近更新快照（webhook → animaku Blob 同步）----
// 前端 HTTP GET 读这份快照做持久展示；WS 断了也不收起面板。
const LATEST_STORE = { name: 'animaku-latest', consistency: 'strong' as const }
const SYNC_TOKEN = process.env.ANIMAKU_SYNC_TOKEN || 'animaku-latest-sync-2026'
let latestMem: { data: unknown; at: number } | null = null

analyticsRoutes.post('/latest-cache', async (c) => {
  const token = c.req.header('X-Sync-Token') || ''
  if (token !== SYNC_TOKEN) return c.json({ error: 'unauthorized' }, 401)
  let payload: unknown
  try {
    const raw = await c.req.text()
    if (raw.length > 2 * 1024 * 1024) return c.json({ error: 'too_large' }, 413)
    payload = JSON.parse(raw)
  } catch { return c.json({ error: 'bad_json' }, 400) }
  try {
    await getStore(LATEST_STORE).setJSON('latest.json', { at: Date.now(), data: payload })
    latestMem = { data: payload, at: Date.now() }
    return c.json({ ok: true, at: latestMem.at })
  } catch (e) {
    return c.json({ error: 'write_failed', message: String((e as Error).message || e) }, 500)
  }
})

analyticsRoutes.get('/latest-cache', async (c) => {
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Cache-Control', 'public, max-age=30')
  if (latestMem && Date.now() - latestMem.at < 60 * 1000) {
    return c.json({ ok: true, cached: true, at: latestMem.at, data: latestMem.data })
  }
  try {
    const doc = await getStore(LATEST_STORE).get('latest.json', { type: 'json' }) as { at: number; data: unknown } | null
    if (doc && doc.data) {
      latestMem = { data: doc.data, at: doc.at }
      return c.json({ ok: true, cached: false, at: doc.at, data: doc.data })
    }
  } catch {}
  return c.json({ ok: false, data: null })
})
