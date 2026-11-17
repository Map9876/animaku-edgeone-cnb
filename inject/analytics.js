/**
 * Animaku 访问行为埋点 SDK（注入层，非侵入）
 *
 * 依赖上游暴露的协议入口（见 docs/P2 提案）：
 *   window.__ANIMAKU_CONFIG__.trackStats === 'on'
 *   window.__ANIMAKU_HOOKS__ 的 onRouteChange / onSearch / onSourceSwitch
 *
 * 只采集精简字段，绝不碰用户凭证。批量上报到 /track，localStorage 缓冲防丢。
 */
;(function () {
  'use strict'

  var CFG = window.__ANIMAKU_CONFIG__ || {}
  if (String(CFG.trackStats).toLowerCase() !== 'on') {
    return // 上游没开统计开关，静默不注入
  }

  var ENDPOINT = CFG.trackEndpoint || '/api/track'
  var BUFFER_KEY = 'animaku_analytics_buffer'
  var FLUSH_MS = 8000
  var MAX_BUFFER = 50

  // 匿名设备 ID：localStorage 持久化，不含任何登录信息
  function deviceId() {
    try {
      var did = localStorage.getItem('animaku_did')
      if (!did) {
        did = 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
        localStorage.setItem('animaku_did', did)
      }
      return did
    } catch (e) {
      return 'd-anon'
    }
  }
  var DID = deviceId()

  // 解析 utm_source：URL 参数优先，否则从 document.referrer 推断
  function utmSource() {
    try {
      var u = new URL(location.href)
      var q = u.searchParams.get('utm_source')
      if (q) return q
      var ref = document.referrer
      if (!ref) return '(direct)'
      var host = new URL(ref).hostname
      if (/bilibili/i.test(host)) return 'bilibili'
      if (/google|baidu|bing|sogou|so\.com/i.test(host)) return 'search-engine'
      if (/weibo|twitter|x\.com/i.test(host)) return 'social'
      return 'referral:' + host
    } catch (e) {
      return '(direct)'
    }
  }
  var SOURCE = utmSource()

  function loadBuffer() {
    try {
      return JSON.parse(localStorage.getItem(BUFFER_KEY) || '[]')
    } catch (e) {
      return []
    }
  }
  function saveBuffer(arr) {
    try {
      localStorage.setItem(BUFFER_KEY, JSON.stringify(arr.slice(-MAX_BUFFER)))
    } catch (e) {}
  }

  function push(fields) {
    var ev = {
      utm_source: SOURCE,
      did: DID,
      ts: Date.now(),
    }
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) ev[k] = fields[k]
    }
    var buf = loadBuffer()
    buf.push(ev)
    saveBuffer(buf)
    if (buf.length >= MAX_BUFFER) flush()
  }

  function flush() {
    var buf = loadBuffer()
    if (!buf.length) return
    // 上报成功后清空缓冲（失败保留，下次重试）
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buf),
      keepalive: true,
    })
      .then(function (r) {
        if (r.ok) saveBuffer([])
      })
      .catch(function () {})
  }

  var lastRoute = ''
  var currentEntry = '(unknown)'

  // 注册到上游协议 hooks（若上游已实现）
  var hooks = (window.__ANIMAKU_HOOKS__ = window.__ANIMAKU_HOOKS__ || {})

  hooks.onRouteChange = wrap(hooks.onRouteChange, function (path, search) {
    var to = String(path || '')
    push({
      entry: currentEntry,
      fromPage: lastRoute,
      toPage: to,
      subjectId: extractSubjectId(to),
    })
    lastRoute = to
    // 路由带 utm 参数时更新一次来源
    if (search && /utm_source=/.test(String(search))) SOURCE = utmSource()
  })

  hooks.onSearch = wrap(hooks.onSearch, function (keyword, source) {
    push({ entry: 'search', fromPage: lastRoute, toPage: 'search', subjectId: '' })
    currentEntry = 'search'
  })

  hooks.onSourceSwitch = wrap(hooks.onSourceSwitch, function (from, to, ok) {
    push({ entry: 'source-switch:' + (ok ? 'ok' : 'fail'), fromPage: String(from), toPage: String(to) })
  })

  function extractSubjectId(path) {
    var m = /\/subject\/([^/?#]+)/.exec(path) || /\/play\/([^/?#]+)/.exec(path)
    return m ? m[1] : ''
  }

  function wrap(old, fn) {
    if (typeof old !== 'function') return fn
    return function () {
      try { fn.apply(null, arguments) } catch (e) {}
      return old.apply(null, arguments)
    }
  }

  // 兜底：即使上游没装 hooks，也用 MutationObserver + popstate 抓路由变化
  window.addEventListener('popstate', function () {
    var to = location.pathname
    if (to !== lastRoute) {
      push({ entry: currentEntry, fromPage: lastRoute, toPage: to, subjectId: extractSubjectId(to) })
      lastRoute = to
    }
  })
  lastRoute = location.pathname

  window.addEventListener('beforeunload', flush)
  setInterval(flush, FLUSH_MS)

  // 暴露给调试
  window.__animakuAnalytics = { push: push, flush: flush }
  console.log('[animaku-analytics] injected, did=' + DID + ', source=' + SOURCE)
})()
