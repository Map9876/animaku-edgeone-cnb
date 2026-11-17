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
/* 移动端底部五栏：半透明圆角胶囊悬浮（参考稀饭/B站），可隐藏 */
.ae-bottom-nav{position:fixed;left:14px;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));
  z-index:9997;display:none;align-items:center;justify-content:space-around;
  height:56px;padding:0 10px;border-radius:999px;
  background:color-mix(in srgb,var(--kz-bg-elevated) 72%,transparent);
  backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);
  border:1px solid color-mix(in srgb,var(--kz-border) 60%,transparent);
  box-shadow:0 6px 28px rgba(0,0,0,.18);transition:transform .28s ease,opacity .28s ease}
.ae-bottom-nav.hidden{transform:translateY(calc(100% + 24px));opacity:0;pointer-events:none}
.ae-bottom-nav a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  flex:1;height:44px;font-size:10px;color:var(--kz-fg-muted);text-decoration:none;
  border-radius:999px;transition:color .15s,background .15s}
.ae-bottom-nav a.active{color:var(--kz-accent)}
.ae-bottom-nav .ic{font-size:19px;line-height:1}
/* 中间凸起主按钮（参考B站 +）*/
.ae-bottom-nav a.ae-main{flex:0 0 46px;width:46px;height:46px;margin-top:-16px;
  background:var(--kz-accent);color:#fff;border-radius:50%;
  box-shadow:0 4px 14px color-mix(in srgb,var(--kz-accent) 45%,transparent)}
.ae-bottom-nav a.ae-main .ic{font-size:24px;line-height:46px}
/* 显示/隐藏胶囊的小把手（贴在胶囊上沿中央）*/
.ae-nav-toggle{position:fixed;left:50%;transform:translateX(-50%);
  bottom:calc(76px + env(safe-area-inset-bottom));z-index:9996;
  font-size:10px;color:var(--kz-fg-muted);background:color-mix(in srgb,var(--kz-bg-elevated) 70%,transparent);
  border:1px solid var(--kz-border);border-radius:999px;padding:2px 10px;cursor:pointer;
  opacity:0;transition:opacity .25s;-webkit-tap-highlight-color:transparent}
.ae-bottom-nav:hover ~ .ae-nav-toggle,.ae-nav-toggle.show{opacity:1}
@media(max-width:640px){.ae-bottom-nav{display:flex}}

/* ===== 紧凑信息密度（AI 项目通病：卡片间距/分类空白过大）=====
   只覆盖间距类原子样式，不改布局结构、不碰上游源码。
   用 VITE_COMPACT=off 可关闭。 */
html[data-ae-compact='on'] main .space-y-14 > * + *,
html[data-ae-compact='on'] main .space-y-12 > * + *{margin-top:14px !important}
html[data-ae-compact='on'] main .space-y-14,
html[data-ae-compact='on'] main .space-y-12{--tw-space-y-reverse:0}
html[data-ae-compact='on'] main [class*='mb-5']{margin-bottom:10px !important}
html[data-ae-compact='on'] main [class*='mb-4']{margin-bottom:8px !important}
html[data-ae-compact='on'] main [class*='gap-3']{gap:8px !important}
html[data-ae-compact='on'] main [class*='gap-4']{gap:10px !important}
html[data-ae-compact='on'] main [class*='py-8']{padding-top:14px !important;padding-bottom:14px !important}
html[data-ae-compact='on'] main [class*='py-6']{padding-top:10px !important;padding-bottom:10px !important}
html[data-ae-compact='on'] main [class*='py-10']{padding-top:16px !important;padding-bottom:16px !important}
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

  // ---------- 4) 移动端底部胶囊导航（半透明悬浮，可隐藏）----------
  function addBottomNav() {
    if (!BOTTOM_NAV || document.getElementById('ae-bottom-nav')) return
    var nav = document.createElement('nav')
    nav.id = 'ae-bottom-nav'
    nav.className = 'ae-bottom-nav'
    // 中间第 3 项是凸起主按钮（追番），参考 B站 的「+」
    var items = [
      { href: '/', ic: '⌂', label: '首页', path: '/', main: false },
      { href: '/anime', ic: '▦', label: '排行榜', path: '/anime', main: false },
      { href: '/collect', ic: '☆', label: '追番', path: '/collect', main: true },
      { href: '/timeline', ic: '▤', label: '时间表', path: '/timeline', main: false },
      { href: '/settings', ic: '☰', label: '我的', path: '/settings', main: false },
    ]
    var p = location.pathname
    nav.innerHTML = items.map(function (it) {
      var active = p === it.path ? ' active' : ''
      var cls = [active, it.main ? 'ae-main' : ''].filter(Boolean).join(' ')
      return '<a href="' + it.href + '" class="' + cls + '"><span class="ic">' + it.ic + '</span>' +
        (it.main ? '' : it.label) + '</a>'
    }).join('')
    // 恢复隐藏状态
    if (localStorage.getItem('ae_nav_hidden') === '1') nav.classList.add('hidden')
    // 双击胶囊切换显示/隐藏
    nav.addEventListener('dblclick', function () {
      var hidden = nav.classList.toggle('hidden')
      localStorage.setItem('ae_nav_hidden', hidden ? '1' : '0')
    })
    document.body.appendChild(nav)

    // 显示/隐藏小把手：长按或点击切换（桌面端也能用）
    var toggle = document.createElement('button')
    toggle.className = 'ae-nav-toggle'
    toggle.textContent = '导航栏'
    toggle.title = '显示/隐藏底部导航栏'
    toggle.addEventListener('click', function () {
      var hidden = nav.classList.toggle('hidden')
      localStorage.setItem('ae_nav_hidden', hidden ? '1' : '0')
    })
    document.body.appendChild(toggle)
    // 鼠标靠近底部时显示把手
    document.addEventListener('mousemove', function (e) {
      if (e.clientY > window.innerHeight - 90) toggle.classList.add('show')
      else toggle.classList.remove('show')
    })
  }

  // ---------- 初始化 ----------
  function init() {
    if (COMPACT) document.documentElement.setAttribute('data-ae-compact', 'on')
    injectThemeCSS()
    addBottomNav()
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
    if (location.pathname !== lastPath) {
      lastPath = location.pathname
      if (/\/settings/.test(lastPath)) setTimeout(addGitPanel, 300)
    }
  }, 1000)
})()
