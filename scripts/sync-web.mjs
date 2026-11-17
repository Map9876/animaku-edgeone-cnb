/**
 * CI 专用：从 submodule 的 Animaku 源码构建 web 前端，把 dist 复制到项目根。
 * 本地通常已手动复制好；CI 在 submodule update 后运行此脚本保证前端与上游同步。
 *
 * 若构建失败（缺依赖/网络），保留仓库里已提交的 dist，不阻断部署。
 */
import { cpSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const animaku = path.join(root, 'upstream/animaku')
const dist = path.join(animaku, 'apps/web/dist')

if (!existsSync(path.join(animaku, 'pnpm-lock.yaml'))) {
  console.log('submodule 源码不存在，跳过 web 同步（使用仓库已有 dist）')
  process.exit(0)
}

try {
  console.log('安装 Animaku 依赖并构建 web...')
  execSync('pnpm install --ignore-scripts', { cwd: animaku, stdio: 'inherit' })
  execSync('pnpm --filter @animaku/web build', { cwd: animaku, stdio: 'inherit' })
  if (existsSync(dist)) {
    // 清除根目录的旧静态文件（保留项目自有目录）
    for (const name of readdirSync(root)) {
      if (['assets', 'index.html', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png',
        'apple-touch-icon.png', 'android-chrome-192x192.png', 'android-chrome-512x512.png',
        'logo.png', 'plyr.svg', 'robots.txt', 'sitemap.xml', 'site.webmanifest'].includes(name)) {
        const p = path.join(root, name)
        if (existsSync(p)) {
          if (name === 'assets') execSync(`rm -rf "${p}"`)
          else execSync(`rm -f "${p}"`)
        }
      }
    }
    // 复制 dist 全部内容到根目录
    for (const name of readdirSync(dist)) {
      cpSync(path.join(dist, name), path.join(root, name), { recursive: true })
    }
    // 同步一份到 public/：EdgeOne Pages 不同版本/配置可能以 public/ 为静态根，
    // 两边都放可确保无论取哪个目录都能命中（inject 注入后执行，含注入脚本）
    const pub = path.join(root, 'public')
    execSync(`mkdir -p "${pub}"`)
    for (const name of readdirSync(dist)) {
      cpSync(path.join(root, name), path.join(pub, name), { recursive: true })
    }
    cpSync(path.join(root, 'inject'), path.join(pub, 'inject'), { recursive: true })
    console.log('✅ web 同步完成（根目录 + public/ 双份）')
  }
} catch (err) {
  console.warn('[sync-web] 构建失败，保留仓库已有 dist：', err.message)
}
