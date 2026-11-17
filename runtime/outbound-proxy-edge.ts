/**
 * EdgeOne 版 outbound-proxy：空实现。
 *
 * 原版用 undici 的 ProxyAgent 做企业代理，但 undici 在 EdgeOne 生产 bundle 下
 * 顶层加载即崩溃（decompress.js "reading 'bind'"）。EdgeOne 无状态环境不做
 * 企业出站代理，这里全部 no-op，彻底切断 undici 依赖。
 */
export function getDispatcherForSource(_sourceName: string): null {
  return null
}
export function clearProxyAgentCache(): void {}
