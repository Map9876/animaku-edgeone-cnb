/**
 * sharp 的最小 stub，满足 EdgeOne 生产环境。
 *
 * 真实 sharp 是原生模块（libvips），EdgeOne CDN bundler 不带 linux-x64 二进制，
 * 加载即崩："Could not load the sharp module using the linux-x64 runtime"。
 * 本地 dev + CLI 部署有 node_modules 时正常，只有 CNB→EdgeOne 云构建这条路崩。
 *
 * sharp 在 Animaku 里只用于 site-config.ts 的 generateIconSuite（管理后台上传
 * 自定义 favicon 时生成多尺寸图标），非核心播放/搜索链路。这里提供链式 API 占位，
 * toBuffer() 返回原始 buffer（不真正缩放/锐化），保证管理功能不崩即可。
 */

type Chain = {
  rotate(): Chain
  clone(): Chain
  resize(..._args: unknown[]): Chain
  sharpen(..._args: unknown[]): Chain
  png(..._args: unknown[]): Chain
  toBuffer(): Promise<Buffer>
}

function makeChain(buf: Buffer): Chain {
  const chain: Chain = {
    rotate() { return chain },
    clone() { return makeChain(buf) },
    resize() { return chain },
    sharpen() { return chain },
    png() { return chain },
    async toBuffer() { return buf },
  }
  return chain
}

function sharp(input: Buffer | Uint8Array | unknown): Chain {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from((input as Uint8Array) || new Uint8Array())
  return makeChain(buf)
}

export default sharp
