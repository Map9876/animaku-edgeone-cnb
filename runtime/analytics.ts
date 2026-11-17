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
