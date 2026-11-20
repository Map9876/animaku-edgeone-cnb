/**
 * 最近更新页 — 原站范式页面组件（构建期 patch 注入，不运行时 DOM 覆盖）。
 *
 * 这是"先基于原网站二次开发"的标准实现：
 * - 用原站组件 PageHeader / BangumiGrid / BangumiGridSkeleton（布局、响应式、token 全继承）
 * - 数据同源 GET /api/recent（EdgeOne 后端代理 webhook），WS 增量走 /api/recent-ws 或直接连 webhook
 * - 时间显示用「今天/昨天/前天」档位（和原站 xifan recent 一致，不用会每分钟跳的 HH:MM）
 * - 无变化不重建列表（签名对比），避免刷新瞬间错位
 */
import { useEffect, useMemo, useState } from 'react'
import type { BangumiItem } from '@animaku/shared'
import { BangumiGrid, BangumiGridSkeleton, EmptyState, PageHeader } from '../components/ui'

type RecentItem = {
  title: string
  animeId: string | null
  cover: string
  episode: string
  score: number | null
  source: string
  sourceName: string
  bgmId: number | null
  bgmName: string
  lastSeenAt: number
  updatedAt: string
  /** 源站判定的真实更新日期（如「11月20日」），优先于我们推算的 lastSeenAt 档位 */
  updateDay?: string
}

const WEBHOOK_WS = 'wss://new-anime-webhook.map987.dpdns.org/ws'

function updDay(ts: number, sourceDay?: string): string {
  // 优先用源站自己判定的更新日期（固定不变、比我们推算可靠）
  if (sourceDay) return sourceDay
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - day.getTime()) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days === 2) return '前天'
  if (days < 7) return `${days}天前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}

// 把 webhook 条目映射成原站 BangumiItem，直接复用原站卡片/网格（原生感来源）。
function toBangumiItem(it: RecentItem, idx: number): BangumiItem {
  const name = it.bgmName || it.title || ''
  const day = updDay(it.lastSeenAt, it.updateDay)
  const progress = it.episode ? `${it.episode} · ${day}` : day
  return {
    id: it.bgmId || hashId(`${it.source}:${it.animeId || it.title}`),
    type: 2,
    name,
    nameCn: name,
    summary: `${it.sourceName || it.source} · ${progress}`,
    airDate: '',
    airWeekday: 0,
    rank: idx + 1,
    images: it.cover ? { common: it.cover, large: it.cover, thumb: it.cover, grid: it.cover } : {},
    tags: [],
    alias: [],
    ratingScore: it.score || 0,
    votes: 0,
    info: progress,
    eps: 0,
    totalEpisodes: 0,
  }
}

export function RecentPage() {
  const [items, setItems] = useState<RecentItem[]>([])
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)

  const keyOf = (x: RecentItem) => `${x.source}:${x.animeId ?? x.title}`
  const contentChanged = (a: RecentItem, b: RecentItem) =>
    a.title !== b.title || a.cover !== b.cover || a.episode !== b.episode ||
    a.score !== b.score || a.bgmId !== b.bgmId || a.bgmName !== b.bgmName ||
    a.updateDay !== b.updateDay

  // 彻底锁定顺序：源站每轮返回的条目集合会波动（某些 animeId 这轮有下轮没有），
  // 任何"集合签名对比"都会因集合变化触发全量重建 → 顺序乱跳。
  // 改为增量 merge：已有条目保持原位（只更新内容），新条目追加到末尾，消失的保留。
  const apply = (next: RecentItem[]) => {
    if (!next.length) return
    setItems((prev) => {
      if (!prev.length) return next
      const nextMap = new Map(next.map((x) => [keyOf(x), x]))
      const merged: RecentItem[] = []
      let changed = false
      // 保持 prev 顺序，更新内容
      for (const old of prev) {
        const fresh = nextMap.get(keyOf(old))
        if (fresh && contentChanged(old, fresh)) {
          merged.push({ ...old, ...fresh })
          changed = true
        } else {
          merged.push(old)
        }
      }
      // 新条目追加到末尾（不插队、不打乱已有顺序）
      const prevKeys = new Set(prev.map(keyOf))
      for (const x of next) {
        if (!prevKeys.has(keyOf(x))) { merged.push(x); changed = true }
      }
      if (!changed) return prev // 内容没变，返回同一引用 → React 不重渲染
      return merged.slice(0, 120) // 上限，避免无限增长
    })
  }

  useEffect(() => {
    let alive = true
    // HTTP 基线：优先同源 /api/recent（EdgeOne 后端代理 webhook）；
    // 本地 dev 无后端时回退直读 webhook（CORS 已开），保证两环境都能渲染。
    const loadBaseline = async () => {
      try {
        const r = await fetch('/api/recent', { cache: 'no-store' })
        if (r.ok) {
          const d = await r.json()
          if (d && Array.isArray(d.items)) return d.items
        }
      } catch { /* 本地无同源后端，回退直读 */ }
      const r2 = await fetch('https://new-anime-webhook.map987.dpdns.org/api/latest', { cache: 'no-store' })
      const d2 = await r2.json()
      return Array.isArray(d2?.items) ? d2.items : []
    }
    loadBaseline()
      .then((items) => {
        if (!alive) return
        apply(items)
        setLoading(false)
      })
      .catch(() => alive && setLoading(false))

    // WS 增量：直连 webhook（同源 API 不可 WS 时回退到这里）
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      try {
        ws = new WebSocket(WEBHOOK_WS)
        ws.onopen = () => alive && setLive(true)
        ws.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data)
            if (Array.isArray(d.items) && d.items.length) apply(d.items)
          } catch { /* ignore */ }
        }
        ws.onclose = () => {
          alive && setLive(false)
          retry = setTimeout(connect, 10000)
        }
        ws.onerror = () => { try { ws?.close() } catch { /* ignore */ } }
      } catch {
        retry = setTimeout(connect, 15000)
      }
    }
    connect()
    return () => {
      alive = false
      if (retry) clearTimeout(retry)
      try { ws?.close() } catch { /* ignore */ }
    }
  }, [])

  const bangumiItems = useMemo<BangumiItem[]>(() => items.map(toBangumiItem), [items])

  return (
    <div>
      <PageHeader
        title="最近更新"
        description={`全网多源 · 按来源聚合 · ${live ? '实时' : '显示缓存'}`}
      />
      {loading ? (
        <BangumiGridSkeleton count={12} />
      ) : bangumiItems.length ? (
        <BangumiGrid items={bangumiItems} eagerCount={12} coverSize="thumb" />
      ) : (
        <EmptyState text="暂无最近更新数据" />
      )}
    </div>
  )
}
