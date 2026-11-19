/**
 * 最近更新面板（注入层，不改 Animaku 上游源码）
 *
 * 数据源（通用，不依赖 EdgeOne）：
 *   HTTP GET  {base}/api/latest  —— 基线，面板常驻（webhook 仓库本体存数据）
 *   WS        {base}/ws          —— 实时增量 + 弹动画；断开不收起面板
 *   定时 HTTP 补拉（WS 断时兜底）
 *
 * 开关：window.__ANIMAKU_CONFIG__.recentPanel = 'on'|'off'
 * 域名：window.__ANIMAKU_CONFIG__.recentBase（默认 new-anime-webhook.map987.dpdns.org）
 */
;(function () {
  'use strict'
  var CFG = window.__ANIMAKU_CONFIG__ || {}
  if (String(CFG.recentPanel === undefined ? 'on' : CFG.recentPanel).toLowerCase() === 'off') return
  var BASE = String(CFG.recentBase || 'https://new-anime-webhook.map987.dpdns.org').replace(/\/$/, '')

  // ---------- CSS（复用源站 token，逐字对齐原站风格）----------
  var css = `
.ae-recent{position:fixed;right:16px;top:76px;z-index:9995;width:min(360px,calc(100vw - 32px));
  max-height:calc(100dvh - 160px);display:flex;flex-direction:column;overflow:hidden;
  border-radius:1.5rem;border:1px solid color-mix(in oklab,#fff 50%,transparent);
  background:color-mix(in oklab,#fff 90%,transparent);
  box-shadow:0 18px 46px -24px rgba(0,0,0,.52);backdrop-filter:blur(24px);
  -webkit-backdrop-filter:blur(24px);font-family:inherit;transition:transform .3s,opacity .3s}
.ae-recent.hidden{transform:translateX(calc(100% + 24px));opacity:0;pointer-events:none}
.ae-recent-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:12px 16px 8px;flex-shrink:0}
.ae-recent-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;
  color:#141416}
.ae-recent-dot{width:8px;height:8px;border-radius:50%;background:#cd7083;
  box-shadow:0 0 0 4px color-mix(in oklab,#cd7083 18%,transparent)}
.ae-recent-dot.off{background:#9ca3af;box-shadow:none}
.ae-recent-live{font-size:10px;color:#9c27b0;background:color-mix(in oklab,#9c27b0 12%,transparent);
  padding:2px 8px;border-radius:999px;font-weight:600}
.ae-recent-live.off{color:#9ca3af;background:color-mix(in oklab,#9ca3af 12%,transparent)}
.ae-recent-body{overflow-y:auto;overscroll-behavior:contain;padding:4px 12px 12px}
.ae-recent-body::-webkit-scrollbar{width:4px}
.ae-recent-body::-webkit-scrollbar-thumb{background:color-mix(in oklab,#141416 20%,transparent);border-radius:4px}
/* 瀑布流：CSS columns 多列自适应 */
.ae-recent-grid{columns:2;column-gap:8px}
@media(min-width:1100px){.ae-recent-grid{columns:3}}
.ae-recent-item{display:inline-block;width:100%;break-inside:avoid;margin:0 0 8px;
  border-radius:.75rem;overflow:hidden;text-align:left;
  background:color-mix(in oklab,#fff 60%,transparent);
  border:1px solid color-mix(in oklab,#141416 8%,transparent);
  text-decoration:none;color:inherit;cursor:pointer;
  transition:transform .18s,box-shadow .18s}
.ae-recent-item:hover{transform:translateY(-2px);box-shadow:0 6px 18px -8px rgba(0,0,0,.3)}
.ae-recent-item.pop{animation:ae-recent-pop .5s ease}
@keyframes ae-recent-pop{0%{transform:scale(.94);opacity:.5}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
.ae-recent-cover{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#eee}
.ae-recent-meta{padding:6px 8px 8px}
.ae-recent-name{font-size:12px;font-weight:600;line-height:1.3;color:#141416;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ae-recent-ep{font-size:10px;color:#cd7083;margin-top:3px;font-weight:600}
.ae-recent-foot{display:flex;align-items:center;justify-content:space-between;margin-top:4px}
.ae-recent-src{font-size:9px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.ae-recent-score{font-size:10px;color:#9c27b0;font-weight:700}
.ae-recent-toggle{position:fixed;right:16px;top:76px;z-index:9994;
  border:1px solid var(--kz-border);border-radius:999px;padding:6px 12px;cursor:pointer;
  background:color-mix(in oklab,#fff 90%,transparent);backdrop-filter:blur(24px);
  font-size:12px;font-weight:600;color:#141416;box-shadow:0 6px 20px -10px rgba(0,0,0,.3);
  display:none}
.ae-recent-toggle.show{display:block}
@media(max-width:640px){.ae-recent{top:auto;bottom:100px;right:8px;width:calc(100vw - 16px);
  max-height:46dvh}.ae-recent-toggle{top:auto;bottom:100px}}
`
  var s = document.createElement('style')
  s.textContent = css
  document.head.appendChild(s)

  // ---------- DOM ----------
  if (document.getElementById('ae-recent')) return
  var panel = document.createElement('aside')
  panel.id = 'ae-recent'
  panel.className = 'ae-recent'
  panel.innerHTML =
    '<div class="ae-recent-head"><div class="ae-recent-title">' +
    '<span class="ae-recent-dot" id="ae-recent-dot"></span>最近更新</div>' +
    '<span class="ae-recent-live" id="ae-recent-live">连接中…</span></div>' +
    '<div class="ae-recent-body"><div class="ae-recent-grid" id="ae-recent-grid"></div></div>'
  document.body.appendChild(panel)

  var toggle = document.createElement('button')
  toggle.className = 'ae-recent-toggle'
  toggle.textContent = '最近更新'
  toggle.addEventListener('click', function () { panel.classList.remove('hidden'); toggle.classList.remove('show') })
  document.body.appendChild(toggle)

  var grid = document.getElementById('ae-recent-grid')
  var dot = document.getElementById('ae-recent-dot')
  var live = document.getElementById('ae-recent-live')
  var lastIds = new Set()

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function timeAgo(ts) {
    if (!ts) return ''
    var d = Date.now() - Number(ts)
    if (d < 0) return ''
    if (d < 60000) return Math.floor(d / 1000) + '秒前'
    if (d < 3600000) return Math.floor(d / 60000) + '分钟前'
    if (d < 86400000) return Math.floor(d / 3600000) + '小时前'
    return Math.floor(d / 86400000) + '天前'
  }
  function render(items, animate) {
    if (!Array.isArray(items) || items.length === 0) return
    var html = items.map(function (it) {
      var name = it.bgmName || it.title || ''
      var href = it.bgmId ? ('https://bgm.tv/subject/' + it.bgmId)
        : (it.animeId ? (BASE + '/anime/' + it.animeId) : '#')
      var isNew = animate && !lastIds.has(it.title)
      return '<a class="ae-recent-item' + (isNew ? ' pop' : '') + '" href="' + esc(href) + '" target="_blank" rel="noopener">' +
        (it.cover ? '<img class="ae-recent-cover" src="' + esc(it.cover) + '" loading="lazy" referrerpolicy="no-referrer">' : '') +
        '<div class="ae-recent-meta"><div class="ae-recent-name">' + esc(name) + '</div>' +
        (it.episode ? '<div class="ae-recent-ep">' + esc(it.episode) + '</div>' : '') +
        '<div class="ae-recent-foot"><span class="ae-recent-src">' + esc(it.sourceName || it.source || '') + '</span>' +
        (it.score ? '<span class="ae-recent-score">' + esc(it.score) + '</span>' : '') + '</div></div></a>'
    }).join('')
    grid.innerHTML = html
    lastIds = new Set(items.map(function (x) { return x.title }))
  }
  function setLive(on, text) {
    dot.classList.toggle('off', !on)
    live.classList.toggle('off', !on)
    live.textContent = text || (on ? '实时' : '离线·显示缓存')
  }

  // ---------- HTTP 基线（持久，不依赖 WS）----------
  async function httpLoad() {
    try {
      var res = await fetch(BASE + '/api/latest', { cache: 'no-store' })
      var d = await res.json()
      if (d && d.items && d.items.length) { render(d.items, false); return true }
    } catch (e) {}
    return false
  }
  httpLoad()
  setInterval(httpLoad, 5 * 60 * 1000) // WS 断时兜底补拉

  // ---------- WS 增量（实时 + 动画；断开不收起面板）----------
  function connectWS() {
    var wsUrl = BASE.replace(/^http/, 'ws') + '/ws'
    try {
      var ws = new WebSocket(wsUrl)
      ws.onopen = function () { setLive(true, '实时') }
      ws.onmessage = function (e) {
        try {
          var d = JSON.parse(e.data)
          if (Array.isArray(d.items) && d.items.length) render(d.items, d.type === 'update')
        } catch (err) {}
      }
      ws.onclose = function () {
        setLive(false, '离线·显示缓存') // 面板不收起，保留 HTTP 基线数据
        setTimeout(connectWS, 10 * 1000) // 重连
      }
      ws.onerror = function () { try { ws.close() } catch (err) {} }
    } catch (e) { setLive(false, '离线·显示缓存'); setTimeout(connectWS, 15 * 1000) }
  }
  connectWS()
})()
