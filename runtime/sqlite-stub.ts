/**
 * EdgeOne 无状态运行时：node:sqlite 的替代 stub。
 *
 * EdgeOne 打包时 esbuild 会把 `node:sqlite` 的 `node:` 前缀剥掉变成
 * `import("sqlite")` 导致 resolve 失败（2026-11-17 实测），所以这里通过
 * esbuild alias 把 `node:sqlite` 全部指向本文件。
 *
 * Animaku 自带 DB_ENABLED=false 无状态模式：repo 层在这模式下只 no-op /
 * 用内存 Map。本 stub 让 connection.ts 的静态 import 不炸；只要不调用
 * getDatabase() 的真实持久化路径（无状态下不会），它就完全安全。
 */

export class StatementSync {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(..._args: any[]): unknown {
    return { changes: 0, lastInsertRowid: 0 }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(..._args: any[]): unknown {
    return undefined
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all(..._args: any[]): unknown[] {
    return []
  }
}

export class DatabaseSync {
  isOpen = false
  constructor(_path?: string, _options?: unknown) {
    // no-op：EdgeOne 无状态，不打开真实文件
  }
  exec(_sql: string): void {
    // no-op
  }
  prepare(_sql: string): StatementSync {
    return new StatementSync()
  }
  close(): void {
    this.isOpen = false
  }
}
