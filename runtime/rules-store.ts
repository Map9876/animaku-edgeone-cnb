/**
 * 规则自更新存储（EdgeOne Blob）。
 *
 * 目的：别人一键部署静态包后，源规则不再固化在 bundle 里，而是运行时按需从
 * GitHub（uerax/Animaku default-plugins/*.json）fetch 最新规则，缓存到 EdgeOne Blob，
 * 后续请求读 Blob。这样"源规则/解析配置"能自更新，前端零改动、单层、不慢。
 *
 * 用法：esbuild plugin 把 route plugin.ts 的 parseRuleOrThrow 实现替换成
 * resolveRuleFromStore(raw)，其余逻辑不变。
 */
import { getStore } from '@edgeone/pages-blob'

const STORE = { name: 'animaku-rules', consistency: 'strong' as const }
const GITHUB_RAW = 'https://raw.githubusercontent.com/uerax/Animaku/master/apps/web/src/data/default-plugins'
const TTL_MS = 60 * 60 * 1000 // 1 小时；规则变化慢，TTL 足够

type Rule = Record<string, unknown>

let memCache: { rules: Record<string, Rule>; at: number } | null = null

function store() {
  return getStore(STORE)
}

/** 从 Blob 读整包规则（one-file-per-record 太碎，规则集小，单文档 + TTL 足够） */
async function loadRules(): Promise<Record<string, Rule>> {
  const now = Date.now()
  if (memCache && now - memCache.at < TTL_MS) return memCache.rules
  try {
    const doc = await store().get('rules.json', { type: 'json' }) as { at: number; rules: Record<string, Rule> } | null
    if (doc && doc.rules && now - doc.at < TTL_MS * 24) {
      memCache = { rules: doc.rules, at: doc.at }
      // 后台刷新（不阻塞当前请求）
      if (now - doc.at > TTL_MS) void refreshRules()
      return doc.rules
    }
  } catch (e) {
    console.warn('[rules] blob read failed:', (e as Error).message)
  }
  // 没有 Blob 缓存 → 同步 fetch 一次（首次会稍慢，之后走 Blob）
  const rules = await refreshRules()
  return rules
}

/** 从 GitHub fetch 所有规则 JSON，写回 Blob */
async function refreshRules(): Promise<Record<string, Rule>> {
  // 规则文件名列表（上游 default-plugins/index.ts 里的 import 集合）
  const names = [
    'cycani', 'tvtfun', 'animoe', 'akianime', 'huazi', 'jzacg', 'moonci', 'mifun',
    'girigiri', 'lzizy', 'xifan-next', 'bimi', 'anime1', 'neosek', 'sorani', 'mxdm', 'omofun',
  ]
  const rules: Record<string, Rule> = {}
  await Promise.all(names.map(async (n) => {
    try {
      const res = await fetch(`${GITHUB_RAW}/${n}.json`)
      if (res.ok) {
        const rule = await res.json() as Rule
        rules[n] = rule
        // 同时按 name 建索引，便于覆盖前端传来的 rule
        if (typeof rule.name === 'string') rules[rule.name.toLowerCase()] = rule
      }
    } catch (e) {
      console.warn(`[rules] fetch ${n} failed:`, (e as Error).message)
    }
  }))
  if (Object.keys(rules).length) {
    memCache = { rules, at: Date.now() }
    try {
      await store().setJSON('rules.json', { at: Date.now(), rules })
    } catch (e) {
      console.warn('[rules] blob write failed:', (e as Error).message)
    }
  }
  return rules
}

/**
 * 替代 plugin.ts 的 parseRuleOrThrow：
 * 用 Blob/GitHub 最新规则覆盖前端传来的同名旧规则（这样别人部署后能自更新）；
 * 若覆盖失败则回退到前端原始 rule（保证不因网络问题挂掉）。
 */
/** 诊断：返回 Blob 规则状态（验证自更新是否生效） */
export async function debugRules(): Promise<Record<string, unknown>> {
  try {
    const doc = await store().get('rules.json', { type: 'json' }) as { at: number; rules: Record<string, Rule> } | null
    if (!doc || !doc.rules) return { ok: false, reason: 'no_blob' }
    const names = Object.keys(doc.rules).filter((k) => !doc.rules![k]._index)
    return {
      ok: true,
      updatedAt: doc.at,
      ageMs: Date.now() - doc.at,
      ruleCount: names.length,
      names: names.slice(0, 30),
      sample: doc.rules['bimi'] || doc.rules[names[0]],
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/** 诊断：给定规则名，返回 resolveRuleFromStore 会用来覆盖的规则 */
export async function debugResolve(name: string): Promise<Record<string, unknown>> {
  const rules = await loadRules()
  const key = name.toLowerCase()
  const fresh = rules[key]
  return {
    key,
    found: !!fresh,
    keys: Object.keys(rules).slice(0, 30),
    fresh: fresh ? { name: fresh.name, hasSearchURL: !!fresh.searchURL, baseURL: fresh.baseURL } : null,
  }
}

export async function resolveRuleFromStore(raw: unknown): Promise<Rule> {
  const incoming = (raw && typeof raw === 'object') ? raw as Rule : {}
  const name = String(incoming.name || incoming.id || '').toLowerCase()
  try {
    const rules = await loadRules()
    const fresh = name ? rules[name] : null
    if (fresh && Object.keys(fresh).length) {
      // 用新规则覆盖，但保留前端可能带的临时字段（如自定义 baseURL 覆盖）
      return { ...fresh }
    }
  } catch (e) {
    console.warn('[rules] resolve fallback to incoming:', (e as Error).message)
  }
  return incoming
}
