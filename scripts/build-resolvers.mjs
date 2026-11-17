/**
 * 把 Animaku 的源解析层（lib/*.ts，含播放解密的 TS 代码）打包成一个自包含 cjs，
 * 作为可远程更新的"解析代码包"。运行时由 EdgeOne 函数 fetch + new Function 加载，
 * 实现 B 层（播放 resolve）的热更新——这是"强行同步 TS 解析代码"的核心。
 *
 * 每个源的 searchXxx/chaptersXxx/resolveXxx 都会被导出到 parsers.cjs 的 module.exports。
 * 上游 TS 改了（如 bimi 改了 AES 解密）→ CI 重跑此脚本 → 新 parsers.cjs → 运行时自动用新的。
 */
import { build } from 'esbuild'
import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const serverSrc = path.join(root, 'upstream/animaku/apps/server/src/lib')
const privateHostEdge = path.join(root, 'runtime/private-host-edge.ts')
const undiciStub = path.join(root, 'runtime/undici-edge-stub.ts')
const sqliteStub = path.join(root, 'runtime/sqlite-stub.ts')
const shared = path.join(root, 'upstream/animaku/packages/shared/src/index.ts')

// 17 个源解析文件（与 Animaku default-plugins 对应）
const SOURCES = [
  'akianime', 'anime1', 'animoe', 'bimi', 'cycani', 'girigiri', 'huazi',
  'jzacg', 'lzizy', 'mifun', 'moonci', 'neosek', 'omofun', 'sorani', 'tvtfun', 'xifan-next',
]

// 生成入口：re-export 所有源的解析函数（统一命名 resolveFor<Source> 等）
let entry = '// 自动生成 by build-resolvers.mjs — 源解析层统一出口\n'
for (const s of SOURCES) {
  const file = path.join(serverSrc, `${s}.ts`)
  if (!readFileSync(file, 'utf8')) continue
  entry += `export * as ${s.replace(/[^a-zA-Z0-9]/g, '_')} from '${path.join(serverSrc, s + '.ts')}';\n`
}
const entryPath = path.join(root, 'runtime/_resolvers-entry.ts')
writeFileSync(entryPath, entry, 'utf8')

// 替换 private-host → edge 版（undici 在 EdgeOne 崩）
const repl = {
  name: 'repl-private-host',
  setup(b) {
    b.onResolve({ filter: /private-host$/ }, () => ({ path: 'ph', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: readFileSync(privateHostEdge, 'utf8'), loader: 'ts', resolveDir: root,
    }))
  },
}

mkdirSync(path.join(root, 'resolvers'), { recursive: true })
await build({
  entryPoints: [entryPath],
  outfile: path.join(root, 'resolvers/parsers.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: true,
  logLevel: 'warning',
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [repl],
  alias: {
    'node:sqlite': sqliteStub,
    'sqlite': sqliteStub,
    'undici': undiciStub,
    '@animaku/shared': shared,
  },
  define: {
    'import.meta.dirname': '"/tmp"',
    'import.meta.url': '"file:///tmp/resolvers.js"',
  },
})

// 同步一份到 public/（EdgeOne 静态站点根，运行时 fetch 用）
mkdirSync(path.join(root, 'public/resolvers'), { recursive: true })
writeFileSync(path.join(root, 'public/resolvers/parsers.cjs'), readFileSync(path.join(root, 'resolvers/parsers.cjs')))

console.log(`✅ resolvers/parsers.cjs (${SOURCES.length} 个源的 TS 解析代码)`)
