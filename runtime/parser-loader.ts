/**
 * 动态解析加载器：运行时 fetch 远程 parsers.cjs（TS 解析代码包）→ new Function 加载，
 * 用其中的源函数覆盖内置解析，实现"播放解密等 TS 代码的热更新"。
 *
 * 与 rules-store（JSON 规则，A 层）配合，构成两层自更新：
 *   A 层搜索/章节字段 → rules-store（Blob/JSON）
 *   B 层播放 resolve 代码 → parser-loader（cjs/new Function）
 *
 * 设计铁律：任何失败都回退到内置函数，绝不因热更新问题让服务不可用。
 */
import { createRequire } from 'node:module'

const PARSERS_URL = '/resolvers/parsers.cjs' // 同域静态资源（EdgeOne 托管）
const TTL_MS = 10 * 60 * 1000 // 10 分钟检查一次更新

type ParserModule = Record<string, Record<string, (...args: any[]) => Promise<any>>>

let cached: { mod: ParserModule; at: number; url: string } | null = null
let loading: Promise<ParserModule | null> | null = null

const nodeRequire = createRequire(import.meta.url)

async function loadParsers(): Promise<ParserModule | null> {
  const now = Date.now()
  if (cached && now - cached.at < TTL_MS) return cached.mod
  if (loading) return loading

  loading = (async () => {
    try {
      // 同域 fetch（EdgeOne 函数内可用相对 URL 需基于 request，这里用环境域名兜底）
      const base = (globalThis as any).__ANIMAKU_ORIGIN__ || 'https://anime.map987.dpdns.org'
      const res = await fetch(new URL(PARSERS_URL, base).toString())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const code = await res.text()
      const m = { exports: {} as ParserModule }
      // new Function 注入 require/module/exports，执行 cjs
      new Function('require', 'module', 'exports', code)(nodeRequire, m, m.exports)
      cached = { mod: m.exports, at: now, url: base }
      console.log(`[parser-loader] loaded ${Object.keys(m.exports).length} sources`)
      return m.exports
    } catch (e) {
      console.warn('[parser-loader] load failed, will use builtin:', (e as Error).message)
      return null
    } finally {
      loading = null
    }
  })()
  return loading
}

/** 把 rule.name 映射到 parsers.cjs 的源键（如 xifan-next → xifan_next） */
function sourceKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

/** 从远程解析模块里找某源的函数 */
async function getSourceFns(name: string): Promise<Record<string, (...a: any[]) => Promise<any>> | null> {
  const mod = await loadParsers()
  if (!mod) return null
  return mod[sourceKey(name)] || null
}

/**
 * 动态 search：优先远程源函数，失败回退 null（让调用方用内置）
 * 返回 undefined 表示"远程没有该源/失败，请用内置"
 */
export async function dynamicSearch(rule: any, keyword: string): Promise<any | undefined> {
  const fns = await getSourceFns(String(rule?.name || rule?.id || ''))
  if (!fns) return undefined
  // 找 search 开头的函数
  const fn = Object.values(fns).find((f) => /^search/i.test(f.name || '') && typeof f === 'function')
  if (!fn) return undefined
  try {
    const result = await fn(rule, keyword)
    // 打来源标记，便于验证"动态 TS 解析"确实生效（而非内置回退）
    if (result && typeof result === 'object' && Array.isArray(result.diagnostics)) {
      result.diagnostics.push('[parser-loader:remote]')
    } else if (result && typeof result === 'object') {
      result._parser = 'remote'
    }
    return result
  } catch (e) {
    console.warn('[parser-loader] dynamic search failed:', (e as Error).message)
    return undefined
  }
}

export async function dynamicChapters(rule: any, source: string): Promise<any | undefined> {
  const fns = await getSourceFns(String(rule?.name || rule?.id || ''))
  if (!fns) return undefined
  const fn = Object.values(fns).find((f) => /^chapters/i.test(f.name || '') && typeof f === 'function')
  if (!fn) return undefined
  try { return await fn(rule, source) } catch { return undefined }
}

export async function dynamicResolve(rule: any, pageUrl: string): Promise<any | undefined> {
  const fns = await getSourceFns(String(rule?.name || rule?.id || ''))
  if (!fns) return undefined
  const fn = Object.values(fns).find((f) => /^resolve/i.test(f.name || '') && typeof f === 'function')
  if (!fn) return undefined
  try { return await fn(rule, pageUrl) } catch { return undefined }
}

/** 诊断：返回远程解析模块状态 */
export async function debugParsers(): Promise<Record<string, unknown>> {
  const mod = await loadParsers()
  if (!mod) return { ok: false, reason: 'load_failed' }
  return { ok: true, sources: Object.keys(mod), cachedAt: cached?.at }
}
