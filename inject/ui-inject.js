/**
 * Animaku UI 注入层（非侵入，配套 docs/P2 协议入口提案）
 *
 * 功能：
 *  1) 白色 switch 风格 / design 风格按钮切换（写 data-theme + 注入 CSS token）
 *  2) 设置页「定时从 GitHub 更新」面板：左侧文字 + 右侧 on/off 开关，
 *     开关左边一个刷新(loading)符号，点击后展示 3 秒「立即刷新」
 *  3) 多源加载失败 → 自动刷新（用户心理学：静默重试 1 次，反复才提示）
 *  4) 导航增强：底部五栏（首页/排行榜/个人…）移动端拇指热区适配
 *
 * 依赖 window.__ANIMAKU_CONFIG__ 与 window.__ANIMAKU_HOOKS__（见 P2 提案）。
 * 无 hooks 时自动降级为 DOM 注入 + 事件监听，不强依赖上游。
 */
;(function () {
  'use strict'

  var CFG = window.__ANIMAKU_CONFIG__ || {}
  var UI_ON = String(CFG.frontTheme || '').toLowerCase() === 'on'
  var SYNC_ON = String(CFG.gitSync || '').toLowerCase() === 'on'
  var AUTO_REFRESH = String(CFG.autoRefresh || '').toLowerCase() === 'on'

  if (!UI_ON && !SYNC_ON && !AUTO_REFRESH) return

  // ---------- 1) 主题 CSS token（白色 switch 风格 + design 风格）----------
  function injectThemeCSS() {
    var css = `
/* ===== Animaku EdgeOne 注入主题 ===== */
html[data-theme='kz-white'] {
  --kz-bg:#ffffff; --kz-bg-elevated:#ffffff; --kz-bg-card:#ffffff;
  --kz-bg-soft:#f7f8fa; --kz-bg-hover:#eef0f3;
  --kz-fg:#1a1d21; --kz-fg-muted:#6b7280;
  --kz-border:#e5e7eb; --kz-border-subtle:#f0f1f3;
  --kz-accent:#2563eb; --kz-accent-hover:#1d4ed8;
  --kz-accent-soft:rgba(37,99,235,.1); --kz-accent-fg:#ffffff;
  color-scheme:light;
}
html[data-theme='kz-design'] {
  --kz-bg:#fafafa; --kz-bg-elevated:#ffffff; --kz-bg-card:#ffffff;
  --kz-bg-soft:#f4f4f5; --kz-bg-hover:#e8e8ea;
  --kz-fg:#18181b; --kz-fg-muted:#71717a;
  --kz-border:#e4e4e7; --kz-border-subtle:#f4f4f5;
  --kz-accent:#7c3aed; --kz-accent-hover:#6d28d9;
  --kz-accent-soft:rgba(124,58,237,.1); --kz-accent-fg:#ffffff;
  color-scheme:light;
}
/* 风格切换按钮：白色 switch 胶囊（参考 Animaku 自带 Switch 组件风格）*/
.ae-style-switch{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:9998;
  display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;
  background:var(--kz-bg-elevated);border:1px solid var(--kz-border);
  box-shadow:0 4px 18px rgba(0,0,0,.14);color:var(--kz-fg);font-size:12px;cursor:pointer;
  -webkit-tap-highlight-color:transparent;user-select:none}
.ae-style-switch .track{width:44px;height:26px;border-radius:999px;background:var(--kz-border);
  position:relative;transition:background .2s;flex:none}
.ae-style-switch .thumb{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;
  background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.ae-style-switch[data-on='1'] .track{background:var(--kz-accent)}
.ae-style-switch[data-on='1'] .thumb{transform:translateX(18px)}
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
/* on/off 开关 */
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

  // ---------- 2) 风格切换按钮 ----------
  function addStyleSwitch() {
    if (document.getElementById('ae-style-switch')) return
    var btn = document.createElement('div')
    btn.id = 'ae-style-switch'
    var on = document.documentElement.getAttribute('data-theme') === 'kz-white' ? '1' : '0'
    btn.className = 'ae-style-switch'
    btn.setAttribute('data-on', on)
    btn.innerHTML = '<span class="track"><span class="thumb"></span></span><span class="lbl">白色风格</span>'
    btn.addEventListener('click', function () {
      var now = btn.getAttribute('data-on') === '1' ? '0' : '1'
      btn.setAttribute('data-on', now)
      applyTheme(now === '1' ? 'kz-white' : 'kz-design')
    })
    document.body.appendChild(btn)
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      // 同步 Animaku zustand store（若上游暴露）
      var stores = window.__ANIMAKU_STORES__ || {}
      if (stores.settings && stores.settings.getState) {
        var st = stores.settings.getState()
        if (st.setTheme) st.setTheme(theme === 'kz-white' ? 'light' : 'dark')
      }
    } catch (e) {}
    try { localStorage.setItem('ae_theme', theme) } catch (e) {}
  }

  // ---------- 3) 设置页 Git 同步面板 ----------
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

  // ---------- 4) 多源失败自动刷新 ----------
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

  // ---------- 5) 移动端底部五栏 ----------
  function addBottomNav() {
    if (document.getElementById('ae-bottom-nav')) return
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
    // 恢复上次主题
    try {
      var saved = localStorage.getItem('ae_theme')
      if (saved === 'kz-white' || saved === 'kz-design') {
        document.documentElement.setAttribute('data-theme', saved)
      }
    } catch (e) {}
    if (UI_ON) { addStyleSwitch(); addBottomNav() }
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
