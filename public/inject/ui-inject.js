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

  if (!SYNC_ON && !AUTO_REFRESH && !BOTTOM_NAV) return

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
/* 移动端底部五栏（首页/排行榜/个人…，拇指热区）*/
.ae-bottom-nav{position:fixed;left:0;right:0;bottom:0;z-index:9997;display:none;
  grid-template-columns:repeat(5,1fr);background:var(--kz-bg-elevated);
  border-top:1px solid var(--kz-border);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
.ae-bottom-nav a{display:flex;flex-direction:column;align-items:center;gap:2px;
  font-size:10px;color:var(--kz-fg-muted);text-decoration:none;padding:4px 0}
.ae-bottom-nav a.active,.ae-bottom-nav a:active{color:var(--kz-accent)}
.ae-bottom-nav .ic{font-size:18px;line-height:1}
@media(max-width:640px){.ae-bottom-nav{display:grid}}
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

  // ---------- 4) 移动端底部五栏 ----------
  function addBottomNav() {
    if (!BOTTOM_NAV || document.getElementById('ae-bottom-nav')) return
    var nav = document.createElement('nav')
    nav.id = 'ae-bottom-nav'
    nav.className = 'ae-bottom-nav'
    var items = [
      { href: '/', ic: '⌂', label: '首页', path: '/' },
      { href: '/anime', ic: '▦', label: '排行榜', path: '/anime' },
      { href: '/timeline', ic: '▤', label: '时间表', path: '/timeline' },
      { href: '/collect', ic: '☆', label: '追番', path: '/collect' },
      { href: '/settings', ic: '☰', label: '我的', path: '/settings' },
    ]
    var p = location.pathname
    nav.innerHTML = items.map(function (it) {
      var active = p === it.path ? ' active' : ''
      return '<a href="' + it.href + '" class="' + active.trim() + '"><span class="ic">' + it.ic + '</span>' + it.label + '</a>'
    }).join('')
    document.body.appendChild(nav)
  }

  // ---------- 初始化 ----------
  function init() {
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
