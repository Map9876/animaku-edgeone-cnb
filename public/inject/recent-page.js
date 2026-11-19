/**
 * 最近更新 · 独立单页（/recent）——注入层，不改 Animaku 上游源码。
 *
 * 与「番剧时间表 /timeline」一致的逻辑：按来源分组 + 卡片瀑布流 + 评分 + 实时更新。
 * 仅在 location.pathname === '/recent' 时渲染，覆盖 SPA fallback 出的首页内容。
 * 底部导航「最近更新」入口与电脑版右侧挂件（recent-panel.js）都指向此页/共享数据源。
 *
 * 数据源与 recent-panel.js 完全一致（generic 直读 webhook / blob 读 animaku 同域 Blob），
 * 开关：recentPanel / recentMode / recentBase（见 __ANIMAKU_CONFIG__）。
 */
;(function () {
  'use strict'
  if (location.pathname.replace(/\/+$/, '') !== '/recent') return
  var CFG = window.__ANIMAKU_CONFIG__ || {}
  if (String(CFG.recentPanel === undefined ? 'on' : CFG.recentPanel).toLowerCase() === 'off') return
  var BASE = String(CFG.recentBase || 'https://new-anime-webhook.map987.dpdns.org').replace(/\/$/, '')
  var MODE = String(CFG.recentMode || 'generic').toLowerCase() === 'blob' ? 'blob' : 'generic'
  var BASE_HTTP = MODE === 'blob' ? '/api/latest-cache' : (BASE + '/api/latest')

  var css = `
html,body{scroll-behavior:auto}
.ae-rp{position:relative;z-index:9990;min-height:100dvh;box-sizing:border-box;
  padding:72px max(12px,env(safe-area-inset-left)) calc(96px + env(safe-area-inset-bottom));
  font-family:inherit;color:#141416}
.ae-rp-hd{display:flex;align-items:center;gap:10px;margin:0 0 16px}
.ae-rp-hd h1{font-size:22px;font-weight:800;margin:0;letter-spacing:.5px}
.ae-rp-dot{width:10px;height:10px;border-radius:50%;background:#cd7083;
  box-shadow:0 0 0 5px color-mix(in oklab,#cd7083 18%,transparent)}
.ae-rp-dot.off{background:#9ca3af;box-shadow:none}
.ae-rp-live{font-size:11px;color:#9c27b0;background:color-mix(in oklab,#9c27b0 12%,transparent);
  padding:3px 10px;border-radius:999px;font-weight:600}
.ae-rp-live.off{color:#6b7280;background:color-mix(in oklab,#6b7280 12%,transparent)}
.ae-rp-sub{font-size:12px;color:#6b7280;margin:0 0 20px}
.ae-rp-group{margin:0 0 26px}
.ae-rp-group-t{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;
  margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid color-mix(in oklab,#141416 10%,transparent)}
.ae-rp-group-t .ae-rp-n{font-size:11px;color:#9ca3af;font-weight:500}
.ae-rp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.ae-rp-item{display:block;border-radius:.85rem;overflow:hidden;text-decoration:none;color:inherit;
  background:color-mix(in oklab,#fff 70%,transparent);
  border:1px solid color-mix(in oklab,#141416 8%,transparent);
  transition:transform .18s,box-shadow .18s}
.ae-rp-item:active{transform:scale(.97)}
.ae-rp-item.pop{animation:ae-rp-pop .5s ease}
@keyframes ae-rp-pop{0%{transform:scale(.94);opacity:.5}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
.ae-rp-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#eee}
.ae-rp-meta{padding:8px}
.ae-rp-name{font-size:12px;font-weight:600;line-height:1.35;color:#141416;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}
.ae-rp-ep{font-size:11px;color:#cd7083;margin-top:4px;font-weight:600}
.ae-rp-foot{display:flex;align-items:center;justify-content:space-between;margin-top:6px;gap:6px}
.ae-rp-time{font-size:10px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ae-rp-score{font-size:11px;color:#9c27b0;font-weight:800;flex-shrink:0}
.ae-rp-score::before{content:'★ ';font-size:9px}
.ae-rp-empty{text-align:center;color:#9ca3af;padding:60px 12px;font-size:14px}
@media(max-width:640px){.ae-rp{padding-left:max(10px,env(safe-area-inset-left));padding-right:max(10px,env(safe-area-inset-right))}
  .ae-rp-grid{grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:8px}}
`
  var s = document.createElement('style')
  s.textContent = css
  document.head.appendChild(s)

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function timeAgo(ts) {
    if (!ts) return ''
    var d = Date.now() - Number(ts)
    if (d < 0 || d < 60000) return d < 0 ? '' : Math.floor(d / 1000) + '秒前'
    if (d < 3600000) return Math.floor(d / 60000) + '分钟前'
    if (d < 86400000) return Math.floor(d / 3600000) + '小时前'
    return Math.floor(d / 86400000) + '天前'
  }

  // ---------- 建页面 DOM，覆盖 SPA 首页内容 ----------
  var page = document.createElement('div')
  page.id = 'ae-rp'
  page.className = 'ae-rp'
  page.innerHTML =
    '<div class="ae-rp-hd"><h1>最近更新</h1>' +
    '<span class="ae-rp-dot" id="ae-rp-dot"></span>' +
    '<span class="ae-rp-live" id="ae-rp-live">连接中…</span></div>' +
    '<p class="ae-rp-sub">全网多源 · 按来源分组 · 实时更新（与番剧时间表一致）</p>' +
    '<div id="ae-rp-root"><div class="ae-rp-empty">加载中…</div></div>'
  function mount() {
    // SPA fallback 后上游 React 会在 #root 渲染 404 页；隐藏它，只显示本页。
    var rootEl = document.getElementById('root')
    if (rootEl) rootEl.style.display = 'none'
    // 电脑版右侧挂件在本页重复，隐藏（本页已是全屏最近更新）。
    var aside = document.getElementById('ae-recent')
    if (aside) aside.style.display = 'none'
    document.body.appendChild(page)
    document.body.style.overflowY = 'auto'
    // React 可能在 defer 脚本之后再改 title，延迟覆盖确保是我们的标题。
    setTimeout(function () { document.title = '最近更新 - 扎口动漫' }, 300)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()

  var root = page.querySelector('#ae-rp-root')
  var dot = page.querySelector('#ae-rp-dot')
  var live = page.querySelector('#ae-rp-live')
  var lastTitles = new Set()

  function setLive(on, text) {
    dot.classList.toggle('off', !on)
    live.classList.toggle('off', !on)
    live.textContent = text || (on ? '实时' : '离线·显示缓存')
  }

  function render(items, animate) {
    if (!Array.isArray(items) || !items.length) return
    // 按来源分组（与时间表按星期分组同构）
    var groups = new Map()
    for (var i = 0; i < items.length; i++) {
      var it = items[i]
      var key = it.sourceName || it.source || '其他'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(it)
    }
    var html = ''
    groups.forEach(function (arr, name) {
      html += '<section class="ae-rp-group"><div class="ae-rp-group-t">' + esc(name) +
        '<span class="ae-rp-n">' + arr.length + ' 部</span></div><div class="ae-rp-grid">'
      for (var j = 0; j < arr.length; j++) {
        var it = arr[j]
        var name2 = it.bgmName || it.title || ''
        var href = it.bgmId ? ('https://bgm.tv/subject/' + it.bgmId)
          : (it.animeId ? ('https://anime.map987.dpdns.org/subject/' + it.animeId) : '#')
        var isNew = animate && !lastTitles.has(it.title)
        html += '<a class="ae-rp-item' + (isNew ? ' pop' : '') + '" href="' + esc(href) + '" target="_blank" rel="noopener">' +
          (it.cover ? '<img class="ae-rp-cover" src="' + esc(it.cover) + '" loading="lazy" referrerpolicy="no-referrer">' : '') +
          '<div class="ae-rp-meta"><div class="ae-rp-name">' + esc(name2) + '</div>' +
          (it.episode ? '<div class="ae-rp-ep">' + esc(it.episode) + '</div>' : '') +
          '<div class="ae-rp-foot">' +
          '<span class="ae-rp-time">' + esc(timeAgo(it.lastSeenAt || it.updatedAt)) + '</span>' +
          (it.score ? '<span class="ae-rp-score">' + esc(it.score) + '</span>' : '') +
          '</div></div></a>'
      }
      html += '</div></section>'
    })
    root.innerHTML = html
    lastTitles = new Set(items.map(function (x) { return x.title }))
  }

  // ---------- HTTP 基线 ----------
  async function httpLoad() {
    try {
      var res = await fetch(BASE_HTTP, { cache: 'no-store' })
      var d = await res.json()
      var payload = (MODE === 'blob' && d && d.data) ? d.data : d
      if (payload && payload.items && payload.items.length) { render(payload.items, false); return true }
    } catch (e) {}
    if (!root.querySelector('.ae-rp-group')) root.innerHTML = '<div class="ae-rp-empty">暂无数据（服务离线）</div>'
    return false
  }
  httpLoad()
  setInterval(httpLoad, 5 * 60 * 1000)

  // ---------- WS 增量 ----------
  function connectWS() {
    try {
      var ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws')
      ws.onopen = function () { setLive(true, '实时') }
      ws.onmessage = function (e) {
        try {
          var d = JSON.parse(e.data)
          if (Array.isArray(d.items) && d.items.length) render(d.items, d.type === 'update')
        } catch (err) {}
      }
      ws.onclose = function () { setLive(false, '离线·显示缓存'); setTimeout(connectWS, 10 * 1000) }
      ws.onerror = function () { try { ws.close() } catch (err) {} }
    } catch (e) { setLive(false, '离线·显示缓存'); setTimeout(connectWS, 15 * 1000) }
  }
  connectWS()
})()
