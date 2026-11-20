/**
 * Animaku UI 注入层（非侵入，配套 docs/P2 协议入口提案）
 *
 * 功能：
 *  1) 设置页「定时从 GitHub 更新」面板：左侧文字 + 右侧 on/off 开关，
 *     开关左边一个刷新(loading)符号，点击后展示 3 秒「立即刷新」
 *  2) 多源加载失败 → 自动刷新（用户心理学：静默重试 1 次，反复才提示）
 *  3) 导航增强：底部五栏（首页/排行榜/个人…）移动端拇指热区适配
 *
 * 设计风格一致性：所有注入 UI 沿用「定时从 GitHub 更新 / 自动同步源规则与界面；
 * 关闭则暂停」这一套——左侧标题 + 副标题说明、右侧 on/off 胶囊开关、
 * 开关左侧刷新图标，统一字号/圆角/间距/配色，与 Animaku 原生 Switch 组件一致。
 *
 * 依赖 window.__ANIMAKU_CONFIG__ 与 window.__ANIMAKU_HOOKS__（见 P2 提案）。
 * 无 hooks 时自动降级为 DOM 注入 + 事件监听，不强依赖上游。
 */
;(function () {
  'use strict'

  var CFG = window.__ANIMAKU_CONFIG__ || {}
  var SYNC_ON = String(CFG.gitSync || '').toLowerCase() === 'on'
  var AUTO_REFRESH = String(CFG.autoRefresh || '').toLowerCase() === 'on'
  // 底部五栏默认开启，可用 VITE_BOTTOM_NAV=off 关闭
  var BOTTOM_NAV = String(CFG.bottomNav === undefined ? 'on' : CFG.bottomNav).toLowerCase() !== 'off'
  // 紧凑信息密度默认开启，可用 VITE_COMPACT=off 关闭
  var COMPACT = String(CFG.compact === undefined ? 'on' : CFG.compact).toLowerCase() !== 'off'

  if (!SYNC_ON && !AUTO_REFRESH && !BOTTOM_NAV && !COMPACT) return

  // ---------- 1) 注入样式（统一设计风格）----------
  function injectThemeCSS() {
    var css = `
/* ===== Animaku EdgeOne 注入样式（与设置页开关风格一致）===== */
/* 设置页 Git 同步面板 */
.ae-git-panel{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 14px;border-radius:12px;background:var(--kz-bg-card);
  border:1px solid var(--kz-border);margin:10px 0}
.ae-git-left{display:flex;align-items:center;gap:10px;min-width:0}
.ae-git-label{font-size:13px;font-weight:600;color:var(--kz-fg)}
.ae-git-desc{font-size:11px;color:var(--kz-fg-muted);margin-top:2px}
.ae-git-right{display:flex;align-items:center;gap:8px;flex:none}
/* 刷新(loading)符号：点击后旋转 */
.ae-refresh{width:20px;height:20px;flex:none;cursor:pointer;color:var(--kz-fg-muted);
  transition:transform .2s;-webkit-tap-highlight-color:transparent}
.ae-refresh.spin{animation:ae-spin .8s linear infinite;color:var(--kz-accent)}
@keyframes ae-spin{to{transform:rotate(360deg)}}
/* on/off 开关（与 Animaku 原生 Switch 风格一致）*/
.ae-switch{width:44px;height:26px;border-radius:999px;background:var(--kz-border);position:relative;
  cursor:pointer;transition:background .2s;flex:none;-webkit-tap-highlight-color:transparent}
.ae-switch[data-on='1']{background:var(--kz-accent)}
.ae-switch .t{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;
  background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .25s}
.ae-switch[data-on='1'] .t{transform:translateX(18px)}
/* 点击后展示 3 秒的「立即刷新」提示（相邻设计：贴近刷新按钮）*/
.ae-toast{position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom));
  transform:translateX(-50%);z-index:10000;padding:9px 16px;border-radius:999px;
  background:rgba(24,24,27,.92);color:#fff;font-size:13px;white-space:nowrap;
  box-shadow:0 6px 24px rgba(0,0,0,.3);opacity:0;pointer-events:none;transition:opacity .2s}
.ae-toast.show{opacity:1}
/* ===== 底部导航：逐字复刻 next.xifanacg.com 原站编译产物（2026-11-18 抓取）=====
   原站 <nav aria-label="移动导航"> 的真实 class + computed style + SVG path。
   brand 原站实测 #cd7083；胶囊圆角 24px / bg 不透明度 .9 / blur 24px / min-h 4rem / gap 1 / p 1.5。 */
.ae-xf-nav{position:fixed;left:0;right:0;bottom:0;z-index:50;padding-left:.75rem;padding-right:.75rem;
  padding-bottom:calc(.75rem + env(safe-area-inset-bottom));display:none;transition:transform .28s,opacity .28s}
.ae-xf-nav>div{margin-left:auto;margin-right:auto;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));
  gap:.25rem;min-height:4rem;max-width:520px;border-radius:1.5rem;
  border:1px solid color-mix(in oklab,#fff 50%,transparent);
  background:color-mix(in oklab,#fff 90%,transparent);
  box-shadow:0 18px 46px -24px rgba(0,0,0,.52),0 0 0 1px color-mix(in oklab,#fff 50%,transparent);
  padding:.375rem;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
.ae-xf-nav a{position:relative;display:flex;min-height:3rem;min-width:0;flex-direction:column;
  align-items:center;justify-content:center;gap:.25rem;border-radius:1.125rem;padding-left:.25rem;padding-right:.25rem;
  font-size:11px;font-weight:500;line-height:1;text-decoration:none;
  color:color-mix(in oklch,#141416 70%,transparent);transition:color .15s,transform .15s}
.ae-xf-nav a:active{transform:scale(.97)}
.ae-xf-nav a.ae-active{color:#cd7083}
.ae-xf-nav a.ae-active>span.ae-bg{position:absolute;inset:0;border-radius:1.125rem;
  background:color-mix(in oklch,#cd7083 14%,transparent);
  box-shadow:0 10px 24px -18px #cd7083;
  border:1px solid color-mix(in oklch,#cd7083 18%,transparent)}
.ae-xf-nav svg{position:relative;width:1.25rem;height:1.25rem;flex-shrink:0;fill:currentColor;
  transition:transform .15s}
.ae-xf-nav a.ae-active svg{transform:scale(1.05);
  filter:drop-shadow(0 6px 10px color-mix(in oklch,#cd7083 24%,transparent))}
.ae-xf-nav a:not(.ae-active):hover svg{transform:translateY(-2px)}
.ae-xf-nav a>span.ae-label{position:relative;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-xf-nav.hidden{transform:translateY(calc(100% + 24px));opacity:0;pointer-events:none}
.ae-nav-toggle{position:fixed;left:50%;transform:translateX(-50%);
  bottom:calc(84px + env(safe-area-inset-bottom));z-index:49;
  font-size:10px;color:var(--kz-fg-muted);background:color-mix(in srgb,var(--kz-bg-elevated) 70%,transparent);
  border:1px solid var(--kz-border);border-radius:999px;padding:2px 10px;cursor:pointer;
  opacity:0;transition:opacity .25s;-webkit-tap-highlight-color:transparent}
.ae-nav-toggle.show{opacity:1}
/* 最近更新悬浮入口（顶栏下方右侧，避免挤占顶栏搜索/头像）*/
.ae-recent-fab{position:fixed;top:72px;right:12px;z-index:60;
  display:inline-flex;align-items:center;gap:6px;padding:7px 12px;
  border:1px solid var(--kz-border);border-radius:999px;cursor:pointer;
  background:var(--kz-bg-card);color:var(--kz-fg);font-size:12px;font-weight:700;
  box-shadow:0 6px 20px -10px rgba(0,0,0,.35);text-decoration:none;
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.ae-recent-fab .ae-rf-dot{width:7px;height:7px;border-radius:50%;background:var(--kz-accent,#cd7083);flex:none}
.ae-recent-fab.ae-active{color:var(--kz-accent);border-color:var(--kz-accent-ring,var(--kz-accent));
  background:color-mix(in oklab,var(--kz-accent) 10%,var(--kz-bg-card))}
@media(min-width:1024px){.ae-recent-fab{top:76px;right:20px}}
@media(min-width:1024px){.ae-xf-nav{display:none}}
@media(max-width:1023px){.ae-xf-nav{display:block}}
`
    var s = document.createElement('style')
    s.id = 'ae-inject-style'
    s.textContent = css
    ;(document.head || document.documentElement).appendChild(s)
  }

  // ---------- 2) 设置页 Git 同步面板 ----------
  function addGitPanel() {
    if (!SYNC_ON || document.getElementById('ae-git-panel')) return
    // 优先注入到上游预留容器
    var host = document.getElementById('animaku-ext-settings')
    if (!host) {
      // 降级：找到设置页主体
      var h = document.querySelector('main') || document.querySelector('[class*="settings"]') || document.body
      host = document.createElement('div')
      host.id = 'animaku-ext-settings'
      h.appendChild(host)
    }
    var panel = document.createElement('div')
    panel.id = 'ae-git-panel'
    panel.className = 'ae-git-panel'
    var enabled = localStorage.getItem('ae_git_sync') === '1'
    panel.innerHTML =
      '<div class="ae-git-left"><div><div class="ae-git-label">定时从 GitHub 更新</div>' +
      '<div class="ae-git-desc">自动同步源规则与界面；关闭则暂停</div></div></div>' +
      '<div class="ae-git-right">' +
      '<svg class="ae-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-label="立即刷新">' +
      '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>' +
      '<div class="ae-switch" data-on="' + (enabled ? '1' : '0') + '"><span class="t"></span></div>' +
      '</div>'
    host.appendChild(panel)

    var sw = panel.querySelector('.ae-switch')
    var refresh = panel.querySelector('.ae-refresh')

    sw.addEventListener('click', function () {
      var on = sw.getAttribute('data-on') === '1' ? '0' : '1'
      sw.setAttribute('data-on', on)
      localStorage.setItem('ae_git_sync', on)
      showToast(on === '1' ? '已开启定时更新' : '已暂停定时更新')
    })

    // 点击刷新符号 → 旋转 + 展示 3 秒「立即刷新」
    refresh.addEventListener('click', function () {
      refresh.classList.add('spin')
      showToast('立即刷新')
      setTimeout(function () {
        refresh.classList.remove('spin')
      }, 3000)
      // 触发上游刷新 hook（若有）
      try {
        var hooks = window.__ANIMAKU_HOOKS__ || {}
        if (typeof hooks.onManualRefresh === 'function') hooks.onManualRefresh()
      } catch (e) {}
    })
  }

  var toastTimer
  function showToast(text) {
    var t = document.getElementById('ae-toast')
    if (!t) {
      t = document.createElement('div')
      t.id = 'ae-toast'
      t.className = 'ae-toast'
      document.body.appendChild(t)
    }
    t.textContent = text
    t.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { t.classList.remove('show') }, 3000)
  }

  // ---------- 3) 多源失败自动刷新 ----------
  function setupAutoRefresh() {
    if (!AUTO_REFRESH) return
    var hooks = (window.__ANIMAKU_HOOKS__ = window.__ANIMAKU_HOOKS__ || {})
    var failCount = {}
    var old = hooks.onSourceSwitch
    hooks.onSourceSwitch = function (from, to, ok) {
      try {
        if (!ok) {
          var k = String(to || from)
          failCount[k] = (failCount[k] || 0) + 1
          if (failCount[k] <= 1) {
            // 第 1 次静默自动重试（用户无感，最小努力原则）
            setTimeout(function () {
              try {
                var s = window.__ANIMAKU_STORES__ || {}
                if (s.source && s.source.retry) s.source.retry(to)
                else location.reload()
              } catch (e) { location.reload() }
            }, 600)
          } else {
            // 反复失败 → 非模态轻提示，给拇指热区的「换源」主按钮
            showToast('线路不稳定，点此换源')
          }
        } else {
          failCount[String(to)] = 0
        }
      } catch (e) {}
      if (typeof old === 'function') return old.apply(null, arguments)
    }
  }

  // ---------- 4) 底部导航：逐字复刻原站 HTML + SVG（只映射 href）----------
  function svgIcon(path) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" ' +
      'viewBox="0 0 256 256" aria-hidden="true"><path d="' + path + '"></path></svg>'
  }
  // 底部导航 active 状态：按当前 pathname 同步，避免 React SPA 软导航后粉色卡住。
  function syncBottomActive() {
    var nav = document.getElementById('ae-xf-nav')
    if (!nav) return
    var p = location.pathname
    nav.querySelectorAll('a[data-nav-path]').forEach(function (a) {
      var on = a.getAttribute('data-nav-path') === p
      a.classList.toggle('ae-active', on)
      var bg = a.querySelector('.ae-bg')
      if (on && !bg) {
        bg = document.createElement('span')
        bg.className = 'ae-bg'
        bg.setAttribute('aria-hidden', 'true')
        a.insertBefore(bg, a.firstChild)
      } else if (!on && bg) {
        bg.remove()
      }
    })
  }
  // 最近更新悬浮入口（顶栏下方右侧）——顶栏不加第4项，避免挤占搜索/头像。
  function addRecentFab() {
    if (document.getElementById('ae-recent-fab')) return
    var fab = document.createElement('a')
    fab.id = 'ae-recent-fab'
    fab.className = 'ae-recent-fab'
    fab.setAttribute('href', '/recent')
    fab.setAttribute('aria-label', '最近更新')
    fab.innerHTML = '<span class="ae-rf-dot" aria-hidden="true"></span><span>最近更新</span>'
    // SPA 软导航（与底部导航一致，不整页刷新）
    fab.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      if (location.pathname !== '/recent') {
        history.pushState({}, '', '/recent')
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
      syncRecentFab()
    })
    document.body.appendChild(fab)
    syncRecentFab()
  }
  function syncRecentFab() {
    var fab = document.getElementById('ae-recent-fab')
    if (!fab) return
    fab.classList.toggle('ae-active', location.pathname.replace(/\/+$/, '') === '/recent')
  }

  function addBottomNav() {
    if (!BOTTOM_NAV || document.getElementById('ae-xf-nav')) return
    var nav = document.createElement('nav')
    nav.id = 'ae-xf-nav'
    nav.className = 'ae-xf-nav'
    nav.setAttribute('aria-label', '移动导航')
    // 5 项：label / href（映射到 Animaku 路由）/ 原站 SVG path，逐字抄
    // 原站入口: 首页 / 排行榜 / 周表 / 最近更新 / 我的
    var items = [
      { label: '首页', href: '/', path: '/',
        svg: 'M224,120v96a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V164a4,4,0,0,0-4-4H108a4,4,0,0,0-4,4v52a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a16,16,0,0,1,4.69-11.31l80-80a16,16,0,0,1,22.62,0l80,80A16,16,0,0,1,224,120Z' },
      { label: '排行榜', href: '/anime', path: '/anime',
        svg: 'M112.41,102.53a8,8,0,0,1,5.06-10.12l12-4A8,8,0,0,1,140,96v40a8,8,0,0,1-16,0V107.1l-1.47.49A8,8,0,0,1,112.41,102.53ZM248,208a8,8,0,0,1-8,8H16a8,8,0,0,1,0-16h8V104A16,16,0,0,1,40,88H80V56A16,16,0,0,1,96,40h64a16,16,0,0,1,16,16v72h40a16,16,0,0,1,16,16v56h8A8,8,0,0,1,248,208Zm-72-64v56h40V144ZM96,200h64V56H96Zm-56,0H80V104H40Z' },
      { label: '周表', href: '/timeline', path: '/timeline',
        svg: 'M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Zm-68-76a12,12,0,1,1-12-12A12,12,0,0,1,140,132Zm44,0a12,12,0,1,1-12-12A12,12,0,0,1,184,132ZM96,172a12,12,0,1,1-12-12A12,12,0,0,1,96,172Zm44,0a12,12,0,1,1-12-12A12,12,0,0,1,140,172Zm44,0a12,12,0,1,1-12-12A12,12,0,0,1,184,172Z' },
      { label: '最新', href: '/recent', path: '/recent',
        svg: 'M136,80v43.47l36.12,21.67a8,8,0,0,1-8.24,13.72l-40-24A8,8,0,0,1,120,128V80a8,8,0,0,1,16,0Zm88-24a8,8,0,0,0-8,8V82c-6.35-7.36-12.83-14.45-20.12-21.83a96,96,0,1,0-2,137.7,8,8,0,0,0-11-11.64A80,80,0,1,1,184.54,71.4C192.68,79.64,199.81,87.58,207,96H184a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V64A8,8,0,0,0,224,56Z' },
      { label: '我的', href: '/settings', path: '/settings',
        svg: 'M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z' },
    ]
    var inner = '<div>'
    for (var i = 0; i < items.length; i++) {
      var it = items[i]
      inner += '<a class="group" href="' + it.href + '" data-nav-path="' + it.path + '">' +
        svgIcon(it.svg) + '<span class="ae-label">' + it.label + '</span></a>'
    }
    nav.innerHTML = inner + '</div>'
    // SPA 软导航：拦截 <a> 点击，用 history.pushState + popstate 让 React Router 接管，
    // 和顶部原生 <Link> 行为一致（不整页刷新）。
    nav.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-nav-path]')
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      var href = a.getAttribute('href')
      if (!href || href === location.pathname) { e.preventDefault(); return }
      e.preventDefault()
      history.pushState({}, '', href)
      window.dispatchEvent(new PopStateEvent('popstate'))
      syncBottomActive()
    })
    syncBottomActive()
    if (localStorage.getItem('ae_nav_hidden') === '1') nav.classList.add('hidden')
    nav.addEventListener('dblclick', function () {
      var hidden = nav.classList.toggle('hidden')
      localStorage.setItem('ae_nav_hidden', hidden ? '1' : '0')
    })
    document.body.appendChild(nav)

    var toggle = document.createElement('button')
    toggle.className = 'ae-nav-toggle'
    toggle.textContent = '导航栏'
    toggle.title = '显示/隐藏底部导航栏'
    toggle.addEventListener('click', function () {
      var hidden = nav.classList.toggle('hidden')
      localStorage.setItem('ae_nav_hidden', hidden ? '1' : '0')
    })
    document.body.appendChild(toggle)
    document.addEventListener('mousemove', function (e) {
      if (e.clientY > window.innerHeight - 90) toggle.classList.add('show')
      else toggle.classList.remove('show')
    })
  }

  // ---------- 初始化 ----------
  // 注：顶部菜单「最近更新」已改为构建期 patch NavLinks.tsx 原生加入，不在此 DOM 注入。
  function init() {
    if (COMPACT) document.documentElement.setAttribute('data-ae-compact', 'on')
    injectThemeCSS()
    addBottomNav()
    addRecentFab()
    if (SYNC_ON) addGitPanel()
    setupAutoRefresh()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
  // SPA 路由变化后补注入设置面板（React 重渲染会冲掉 DOM）
  var lastPath = location.pathname
  setInterval(function () {
    // 每秒都同步 active：React hydration/重渲染会冲掉 class，靠这个补回来。
    syncBottomActive()
    syncRecentFab()
    if (location.pathname !== lastPath) {
      lastPath = location.pathname
      if (/\/settings/.test(lastPath)) setTimeout(addGitPanel, 300)
    }
  }, 1000)
})()
