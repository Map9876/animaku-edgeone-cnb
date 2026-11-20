/**
 * [已废弃 2026-11-20] 最近更新页的运行时 DOM 覆盖方案。
 *
 * 本文件曾是 /recent 的实现：往 body 塞 fixed 全屏层 + CSS 隐藏原站 footer/main。
 * 该做法违反 docs/二次开发规范-禁止DOM破坏性注入.md —— 破坏原站结构、导致 footer 闪现/文字错位。
 *
 * 现行方案：构建期侵入式 patch（scripts/apply-web-patches.mjs）把「原站范式」的
 * RecentPage（web-overlay/RecentPage.tsx）+ NavLinks 菜单项注入上游源码，
 * 构建出原生 React 路由 /recent。本文件已不被 inject-into-html.mjs 引用，保留仅为记录。
 */
