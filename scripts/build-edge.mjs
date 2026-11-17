/**
 * 把 Animaku 的 Hono 后端打包成 EdgeOne Pages Node 函数。
 *
 * 关键 alias：
 *  - node:sqlite        → runtime/sqlite-stub.ts   （EdgeOne 无状态，node:sqlite 不可用）
 *  - @animaku/shared    → animaku/packages/shared/src/index.ts
 *
 * 输出：
 *  - cloud-functions/api/[[default]].js  （export default app，框架模式，路由 /api/*）
 */
import { build } from 'esbuild'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const animaku = path.resolve(root, 'upstream/animaku')
const privateHostEdge = path.join(root, 'runtime/private-host-edge.ts')
const privateHostEdgeSrc = readFileSync(privateHostEdge, 'utf8')
const outboundProxyEdge = path.join(root, 'runtime/outbound-proxy-edge.ts')
const outboundProxyEdgeSrc = readFileSync(outboundProxyEdge, 'utf8')
const undiciStub = path.join(root, 'runtime/undici-edge-stub.ts')
const rulesStore = path.join(root, 'runtime/rules-store.ts')

// 规则自更新：把 plugin.ts 的 parseRuleOrThrow 改成 async，优先用 Blob/GitHub 最新规则。
// 构建期源码文本替换，不改上游 submodule 文件（单行 import + 函数签名 + 3 处 await）。
const injectRuleStore = {
  name: 'inject-rule-store',
  setup(b) {
    b.onLoad({ filter: /routes[\\/]plugin\.ts$/ }, (args) => {
      let src = readFileSync(args.path, 'utf8')
      if (!src.includes('resolveRuleFromStore')) {
        src = src.replace(
          "import { Hono } from 'hono'",
          "import { Hono } from 'hono'\nimport { resolveRuleFromStore } from '@rules-store'",
        )
        src = src.replace(
          /function parseRuleOrThrow\(raw: unknown\): PluginRule \{\s*return parsePluginRule\(raw\)\s*\}/,
          "async function parseRuleOrThrow(raw: unknown): Promise<PluginRule> { return parsePluginRule(await resolveRuleFromStore(raw)) }",
        )
        src = src.replace(/rule = parseRuleOrThrow\(body\.rule\)/g, 'rule = await parseRuleOrThrow(body.rule)')
      }
      // --- 动态解析注入（B 层热更新）---
      if (!src.includes('dynamicSearch')) {
        src = src.replace(
          "import { resolveRuleFromStore } from '@rules-store'",
          "import { resolveRuleFromStore } from '@rules-store'\nimport { dynamicSearch, dynamicChapters, dynamicResolve } from '@parser-loader'",
        )
        src = src.replace(
          'loader: () => searchWithRule(rule, keyword),',
          'loader: async () => (await dynamicSearch(rule, keyword)) ?? searchWithRule(rule, keyword),',
        )
        src = src.replace(
          'loader: () => chaptersWithRule(rule, source),',
          'loader: async () => (await dynamicChapters(rule, source)) ?? chaptersWithRule(rule, source),',
        )
        src = src.replace(
          '() => resolvePlay(rule, pageUrl),',
          'async () => (await dynamicResolve(rule, pageUrl)) ?? resolvePlay(rule, pageUrl),',
        )
      }
      return { contents: src, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
  },
}

// 用原生 fetch 版替换 private-host.ts / outbound-proxy.ts（undici 在 EdgeOne 生产 bundle 下
// 顶层加载即崩溃：decompress.js "reading 'bind'"）。彻底切断 undici 依赖。
// onResolve 标记 edge-stub namespace，onLoad 提供 stub 内容，避免被 alias 二次解析回原文件。
const replaceUndiciModules = {
  name: 'replace-undici-modules',
  setup(b) {
    b.onResolve({ filter: /private-host$/ }, () => ({
      path: 'private-host-edge-stub', namespace: 'edge-stub',
    }))
    b.onResolve({ filter: /outbound-proxy$/ }, () => ({
      path: 'outbound-proxy-edge-stub', namespace: 'edge-stub',
    }))
    b.onLoad({ filter: /.*/, namespace: 'edge-stub' }, (args) => ({
      contents: args.path.includes('outbound') ? outboundProxyEdgeSrc : privateHostEdgeSrc,
      loader: 'ts', resolveDir: root,
    }))
  },
}

await build({
  entryPoints: [path.join(root, 'runtime/edge-index.ts')],
  outfile: path.join(root, 'cloud-functions/api/[[default]].js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'bundle',
  // 不 minify：EdgeOne CLI 靠源码字面 "export default"/"onRequest" 识别函数入口，
  // minify 成 export{x as default} 会被判为非函数文件跳过（"No node functions found"）
  minify: false,
  logLevel: 'info',
  // 源码在 upstream/animaku/，但依赖装在我们的 node_modules，
  // 让 esbuild 从项目根解析 bare import
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [replaceUndiciModules, injectRuleStore],
  alias: {
    'node:sqlite': path.join(root, 'runtime/sqlite-stub.ts'),
    'sqlite': path.join(root, 'runtime/sqlite-stub.ts'),
    '@animaku/shared': path.join(animaku, 'packages/shared/src/index.ts'),
    // cheerio 顶层 import undici，真实 undici 的 CJS 在 EdgeOne 生产 bundle 下崩。
    // Animaku 只用 cheerio.load()，从不调 fromURL，stub 掉 undici 即可。
    'undici': undiciStub,
    '@rules-store': rulesStore,
    '@parser-loader': path.join(root, 'runtime/parser-loader.ts'),
    // sharp 原生模块（libvips）在 EdgeOne 云构建下无 linux-x64 二进制，加载即崩。
    // 只用于管理后台生成 favicon，非核心链路，stub 掉保证函数不崩。
    'sharp': path.join(root, 'runtime/sharp-edge-stub.ts'),
  },
  // CJS 依赖（cheerio/opencc 等）运行时调用 require("buffer")，
  // ESM 输出注入 createRequire 否则报 "Dynamic require of buffer is not supported"
  banner: {
    js: "import { createRequire as __cr } from 'node:module';const require=__cr(import.meta.url);",
  },
  define: {
    'process.env.APP_VERSION': JSON.stringify(process.env.APP_VERSION || 'v-edge-1.0.0'),
  },
  // EdgeOne CLI 识别函数靠源码字面 "onRequest"；同时注入具名 handler 兜底，
  // 保证无论被判为框架模式还是 Handler 模式都能路由到 Hono app。
  footer: {
    js: `
// EdgeOne entry adapter (injected by build-edge.mjs)
export function onRequest(context) {
  return edge_index_default.fetch(context.request, context.env);
}
`,
  },
})

console.log('✅ bundle → cloud-functions/api/[[default]].js')
