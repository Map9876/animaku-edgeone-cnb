/**
 * undici 的最小 stub，仅用于满足 cheerio 的顶层 `import * as undici from 'undici'`。
 *
 * cheerio 1.2.0 在模块顶层执行 `import * as undici`，其真实 undici 的 CJS 模块
 * (decompress.js) 在 EdgeOne 生产 bundle 下加载即崩（"reading 'bind'"）。
 * Animaku 只用 cheerio.load(html) 解析字符串，从不调用 cheerio.fromURL()，
 * 因此 undici 的 Client/interceptors 永远不会被实际执行。
 *
 * 这里提供 `__importStar` 会访问的占位导出，保证模块加载不崩即可。
 */

export class Client {
  constructor(_origin?: string) {}
  compose(_fn: unknown) { return this }
  async [Symbol.asyncIterator]() {}
}

export const interceptors = {
  redirect: (_opts?: unknown) => (_next?: unknown) => undefined,
  retry: (_opts?: unknown) => (_next?: unknown) => undefined,
  dump: (_opts?: unknown) => (_next?: unknown) => undefined,
}

export class ResponseError extends Error {
  constructor(message?: string, public statusCode?: number, public data?: unknown) {
    super(message)
  }
  static [Symbol.hasInstance](_x: unknown) { return false }
}

export const errors = { ResponseError }

export const fetch = globalThis.fetch
export class Agent { constructor(_opts?: unknown) {} close() {} }
export function buildConnector(_opts?: unknown) { return (_opts2: unknown, _cb: unknown) => {} }
export class ProxyAgent { constructor(_opts?: unknown) {} close() {} }

export default { Client, interceptors, errors, fetch, Agent, buildConnector, ProxyAgent }
