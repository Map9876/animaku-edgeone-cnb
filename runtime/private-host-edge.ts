/**
 * EdgeOne 版 private-host：原生 fetch 替代 undici。
 *
 * 原版 private-host.ts 用 undici 的 Agent/buildConnector 做 SSRF 防护，
 * 但 EdgeOne 生产运行时用 esbuild 二次 bundle 后 undici 的 CJS 模块
 * (decompress.js) 加载崩溃：Cannot read properties of undefined (reading 'bind')。
 * 本地 dev(Node v24) 正常，生产(Node v20 + EdgeOne bundler) 崩。
 *
 * 本模块通过 esbuild alias 替换原 private-host.ts，保留域名/IP 审计（纯 JS），
 * 用原生 fetch 实现 fetchPublic。EdgeOne 本身在边缘沙箱运行，SSRF 风险可控。
 */
import dns from 'node:dns'

function stripBrackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1)
  return hostname
}
function parseIpv4(h: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((n) => n > 255)) return null
  return parts
}
function ipv4FromMapped(h: string): number[] | null {
  const lower = h.toLowerCase()
  const m = /:ffff:(\d{1,3}\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}))$/.exec(lower)
  if (m) return parseIpv4(m.slice(1).join('.'))
  const hex = /:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (!hex) return null
  const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [(a >> 8) & 0xff, a & 0xff, (b >> 8) & 0xff, b & 0xff]
}
function isPrivateIpv4(parts: number[]): boolean {
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 88 && c === 99) return true
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224) return true
  return false
}
function isPrivateIpv6(h: string): boolean {
  const s = h.toLowerCase().trim()
  if (s === '::' || s === '::1') return true
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true
  if (s.startsWith('ff') || s.startsWith('2001:db8') || s.startsWith('2001:0db8') || s.startsWith('100::')) return true
  if (s.startsWith('::ffff:') || s.includes('::ffff:')) { const v4 = ipv4FromMapped(s); if (v4) return isPrivateIpv4(v4) }
  if (s.startsWith('64:ff9b::')) { const v4 = parseIpv4(s.slice('64:ff9b::'.length)); if (v4) return isPrivateIpv4(v4) }
  return false
}
const BLOCKED_HOSTNAMES = new Set(['localhost','localhost.localdomain','metadata','metadata.google.internal','metadata.goog','kubernetes.default','kubernetes.default.svc'])

export function isPublicIp(ip?: string | null): boolean {
  if (!ip) return false
  const s = stripBrackets(ip).trim().toLowerCase()
  if (!s) return false
  const v4 = parseIpv4(s)
  if (v4) return !isPrivateIpv4(v4)
  const mapped = ipv4FromMapped(s)
  if (mapped) return !isPrivateIpv4(mapped)
  if (s.includes(':')) return !isPrivateIpv6(s)
  return false
}
export function isLoopbackIp(ip: string | undefined | null): boolean {
  if (!ip) return true
  const s = stripBrackets(ip).trim().toLowerCase()
  if (!s) return true
  if (s === '127.0.0.1' || s === '::1' || s === 'localhost' || s === '0.0.0.0' || s === '::' || s === '::ffff:127.0.0.1') return true
  if (s.startsWith('127.') || s.startsWith('::ffff:127.')) return true
  return false
}
export function isPrivateHost(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase().trim()
  if (!h) return true
  if (BLOCKED_HOSTNAMES.has(h)) return true
  if (h.endsWith('.local') || h.endsWith('.localhost') || h.endsWith('.internal')) return true
  const v4 = parseIpv4(h)
  if (v4) return isPrivateIpv4(v4)
  const mapped = ipv4FromMapped(h)
  if (mapped) return isPrivateIpv4(mapped)
  if (h.includes(':')) return isPrivateIpv6(h)
  return false
}
export function assertPublicHttpUrl(raw: string, label = 'url'): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error(`${label} 无效`) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`${label} 仅支持 http/https`)
  if (isPrivateHost(u.hostname)) throw new Error(`${label} 禁止访问内网地址`)
  return u
}
export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>
// 兼容导出：保留符号但不依赖 undici
export function createSafeConnector(_customLookup?: DnsLookupFn) {
  return (_opts: unknown, cb: (err: Error | null, socket: unknown) => void) => cb(new Error('not supported on edge'), null)
}
export const safeDispatcher = null

export async function fetchPublic(
  input: string | URL,
  init: RequestInit = {},
  opts: { timeoutMs?: number; maxRedirects?: number; dispatcher?: unknown; source?: string } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const maxRedirects = opts.maxRedirects ?? 5
  const callerRedirectMode = init.redirect ?? 'follow'
  let current = typeof input === 'string' ? assertPublicHttpUrl(input) : new URL(input.toString())
  if (isPrivateHost(current.hostname)) throw new Error('禁止访问内网地址')
  const currentHeaders = new Headers(init.headers || {})
  let currentMethod = (init.method || 'GET').toUpperCase()
  let currentBody: BodyInit | null | undefined = init.body

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const signal = init.signal ?? (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined)
    let res: Response
    try {
      res = await fetch(current.toString(), {
        ...init, method: currentMethod, headers: currentHeaders,
        body: currentMethod === 'GET' || currentMethod === 'HEAD' ? undefined : currentBody,
        redirect: 'manual', signal,
      } as RequestInit)
    } catch (e) { throw e }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      let nextUrl: URL
      try { nextUrl = new URL(loc, current) } catch { if (res.body) try { await res.body.cancel() } catch {}; throw new Error(`重定向 Location 无效: ${loc}`) }
      if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') { if (res.body) try { await res.body.cancel() } catch {}; throw new Error('重定向仅支持 http/https') }
      if (isPrivateHost(nextUrl.hostname)) { if (res.body) try { await res.body.cancel() } catch {}; throw new Error('禁止重定向到内网地址') }
      if (callerRedirectMode === 'manual') return res
      if (res.body) try { await res.body.cancel() } catch {}
      const previousOrigin = current.origin
      if (res.status === 303) { currentMethod = 'GET'; currentBody = undefined }
      else if (res.status === 301 || res.status === 302) { if (currentMethod === 'POST') { currentMethod = 'GET'; currentBody = undefined } }
      if (nextUrl.origin !== previousOrigin) { currentHeaders.delete('authorization'); currentHeaders.delete('cookie'); currentHeaders.delete('host') }
      current = nextUrl
      continue
    }
    return res
  }
  throw new Error(`超过最大重定向次数 (${maxRedirects})`)
}
