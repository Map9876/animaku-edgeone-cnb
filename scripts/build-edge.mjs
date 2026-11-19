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

// 叠加层 patch 桶：所有对上游源码的改写都声明在 patches/manifest.json。
// 构建期按声明应用，不修改上游 submodule 文件。
// 关键改进：上游升级后若 match 不再命中，构建会显式报错，不再静默跳过导致功能悄悄失效。
const manifest = JSON.parse(readFileSync(path.join(root, 'patches/manifest.json'), 'utf8'))
const patchByTarget = {}
for (const p of manifest.patches) {
  ;(patchByTarget[p.target] ||= []).push(p)
}

// 把 args.path 归一成 manifest 里的 target（相对 upstream/animaku/apps/server/src 的路径）。
function patchTargetOf(absPath) {
  const rel = path.relative(path.join(animaku, 'apps/server/src'), absPath).replace(/\\/g, '/')
  return rel
}

function applyPatches(src, patches, absPath) {
  for (const p of patches) {
    // 幂等：已应用过（源码含 idempotentBy 标记）就跳过。
    if (p.idempotentBy && src.includes(p.idempotentBy)) continue
    const re = p.matchRegex ? new RegExp(p.matchRegex, p.global ? 'g' : undefined) : null
    const hit = re ? re.test(src) : src.includes(p.match)
    if (!hit) {
      throw new Error(
        `[patch] ${p.id} 未命中目标 ${patchTargetOf(absPath)}（上游已改？）\n` +
        `  layer=${p.layer} note=${p.note}\n` +
        `  期望匹配: ${p.matchRegex || p.match}\n` +
        `  处理：检查上游新源码，更新 patches/manifest.json 的 match/replace。`
      )
    }
    src = re ? src.replace(re, p.replace) : (p.global ? src.split(p.match).join(p.replace) : src.replace(p.match, p.replace))
    console.log(`[patch] applied ${p.id} (${p.layer})`)
  }
  return src
}

const injectPatches = {
  name: 'inject-patches',
  setup(b) {
    b.onLoad({ filter: /routes[\\/].*\.ts$/ }, (args) => {
      const target = patchTargetOf(args.path)
      const patches = patchByTarget[target]
      if (!patches || !patches.length) return null // 让 esbuild 继续用默认 loader
      let src = readFileSync(args.path, 'utf8')
      src = applyPatches(src, patches, args.path)
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
  plugins: [replaceUndiciModules, injectPatches],
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
