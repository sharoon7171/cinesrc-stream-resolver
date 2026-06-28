import Hls from '/vendor/hls.mjs'

const REF = 'https://cinesrc.st/'
const MOVIE_ID = '1084242'
const TV_ID = '1396'
const TV_SEASON = '1'
const TV_EPISODE = '1'

const $ = (id) => document.getElementById(id)

const form = $('form')
const typeIn = $('type')
const idIn = $('id')
const idLabel = $('id-label')
const tvFields = $('tv-fields')
const hintMovie = $('hint-movie')
const hintTv = $('hint-tv')
const seasonIn = $('season')
const episodeIn = $('episode')
const panel = $('out')
const heading = $('title')
const video = $('video')
const err = $('err')
const btn = form.querySelector('button')
const rawOut = $('direct')
const vlcOut = $('vlc')
const mpvOut = $('mpv')
const vlcHint = $('vlc-hint')
const mpvHint = $('mpv-hint')
const timing = $('timing')
const tResolve = $('t-resolve')
const tPlay = $('t-play')
const serversEl = $('servers')

let hls = null
let gen = 0
let live = null
let resolveClock = { raf: 0 }
let playbackClock = { raf: 0 }
let lastLabel = ''
let catalog = []
let cache = new Map()
let badgeState = new Map()
let lastActive = ''
let resolveGen = 0

const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`)

function showErr(message) {
  err.textContent = message
  err.hidden = false
}

function stopClock(clock) {
  if (!clock) return
  cancelAnimationFrame(clock.raf)
  clock.raf = 0
}

function startClock(el, clock) {
  stopClock(clock)
  el.className = 'timing__val is-live'
  el.textContent = '0ms'
  const t0 = performance.now()
  const tick = () => {
    el.textContent = fmtMs(performance.now() - t0)
    clock.raf = requestAnimationFrame(tick)
  }
  clock.raf = requestAnimationFrame(tick)
  return () => {
    stopClock(clock)
    el.textContent = fmtMs(performance.now() - t0)
    el.className = 'timing__val is-done'
  }
}

function resetTiming() {
  stopClock(resolveClock)
  resetPlaybackTiming()
  timing.hidden = false
  tResolve.textContent = '—'
  tResolve.className = 'timing__val'
}

function idleResolve() {
  stopClock(resolveClock)
  tResolve.textContent = '—'
  tResolve.className = 'timing__val'
}

function resetPlaybackTiming() {
  stopClock(playbackClock)
  tPlay.textContent = '—'
  tPlay.className = 'timing__val'
}

function beginPlaybackTiming() {
  return startClock(tPlay, playbackClock)
}

function streamNeedsReferer(url) {
  try {
    return new URL(url).hostname !== 'ice.bright67.online'
  } catch {
    return true
  }
}

function vlcCmd(url) {
  if (!streamNeedsReferer(url)) return `vlc "${url}"`
  return `vlc --http-referrer='${REF}' "${url}"`
}

function mpvCmd(url, name) {
  const title = `--force-media-title="${name.replace(/"/g, '\\"')}"`
  if (!streamNeedsReferer(url)) return `mpv ${title} "${url}"`
  return `mpv --referrer='${REF}' ${title} "${url}"`
}

function stopPlayback() {
  gen += 1
  if (hls) {
    hls.destroy()
    hls = null
  }
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function stopAutoResolve() {
  if (live) {
    live.close()
    live = null
  }
}

function stopAll() {
  stopPlayback()
  stopAutoResolve()
  resolveGen += 1
}

function runPlayback(markPlaybackDone, liveNow, start) {
  return new Promise((resolve, reject) => {
    const fail = (message) => {
      if (!liveNow()) return
      reject(new Error(message))
    }
    const onPlaying = () => {
      if (!liveNow()) return
      err.hidden = true
      markPlaybackDone?.()
      resolve()
    }
    video.addEventListener('playing', onPlaying, { once: true })
    video.addEventListener('timeupdate', () => {
      if (video.currentTime > 0) onPlaying()
    }, { passive: true, once: true })
    video.addEventListener('error', () => fail('playback failed'), { once: true })
    start(fail)
    video.play().catch((error) => fail(error.message))
  })
}

function play(entry, markPlaybackDone) {
  stopPlayback()
  const id = gen
  const liveNow = () => id === gen
  const hlsSource =
    entry.source === 'HLS' ||
    /\.m3u8(\?|$)/i.test(entry.url) ||
    /[?&]m3u8=/i.test(entry.url) ||
    /\/m3u8(\?|$)/i.test(entry.url)

  if (hlsSource) {
    if (!Hls.isSupported()) throw new Error('HLS not supported')
    return runPlayback(markPlaybackDone, liveNow, (fail) => {
      hls = new Hls({ enableWorker: true })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) fail(data.details ?? 'playback failed')
      })
      hls.attachMedia(video)
      hls.loadSource(entry.url)
    })
  }

  return runPlayback(markPlaybackDone, liveNow, () => {
    video.src = entry.url
  })
}

function cleanServerName(name) {
  return String(name || '').replace(/^[⭐️\s]+/, '').trim()
}

function toEntry(data) {
  return {
    id: data.id,
    name: cleanServerName(data.name || data.id),
    ms: data.ms ?? 0,
    url: data.url,
    source: data.source,
  }
}

function clearExports() {
  rawOut.value = ''
  vlcOut.value = ''
  mpvOut.value = ''
  vlcHint.textContent = 'VLC command'
  mpvHint.textContent = 'MPV command'
}

function bindExports(entry) {
  const needsReferer = streamNeedsReferer(entry.url)
  rawOut.value = entry.url
  vlcOut.value = vlcCmd(entry.url)
  mpvOut.value = mpvCmd(entry.url, lastLabel)
  vlcHint.textContent = needsReferer ? 'VLC with cinesrc.st referer' : 'VLC direct — no referer needed'
  mpvHint.textContent = needsReferer ? 'MPV with cinesrc.st referer' : 'MPV direct — no referer needed'
}

function setBadgeState(id, state, ms = 0) {
  badgeState.set(id, { state, ms })
  renderServers()
}

function renderServers() {
  serversEl.innerHTML = catalog
    .map((provider) => {
      const name = cleanServerName(provider.name)
      const { state = 'idle', ms = 0 } = badgeState.get(provider.id) || {}
      const active = provider.id === lastActive ? ' badge--active' : ''
      const loading = state === 'loading' ? ' badge--loading' : ''
      const failed = state === 'failed' ? ' badge--failed' : ''
      const disabled = state === 'loading' ? ' disabled' : ''
      const msLabel = state === 'ok' && ms ? `<span class="badge__ms">${fmtMs(ms)}</span>` : ''
      return `<button type="button" class="badge${active}${loading}${failed}" data-id="${provider.id}"${disabled}><span class="badge__name">${name}</span>${msLabel}</button>`
    })
    .join('')
  serversEl.closest('.card').hidden = catalog.length === 0
}

function selectServer(entry) {
  lastActive = entry.id
  heading.textContent = `${lastLabel} · ${entry.name}`
  renderServers()
  bindExports(entry)
}

async function playSelected(entry) {
  const markPlaybackDone = beginPlaybackTiming()
  stopPlayback()
  err.hidden = true
  selectServer(entry)
  await play(entry, markPlaybackDone)
}

function storeStream(data) {
  const entry = toEntry(data)
  cache.set(entry.id, entry)
  setBadgeState(entry.id, 'ok', entry.ms)
  return entry
}

function queryParams() {
  const params = new URLSearchParams({ type: typeIn.value, id: idIn.value.trim() })
  if (typeIn.value === 'tv') {
    params.set('season', seasonIn.value.trim())
    params.set('episode', episodeIn.value.trim())
  }
  return params
}

function mediaLabel(type) {
  return `${type === 'tv' ? 'TV' : 'Movie'} · TMDB ${idIn.value.trim()}`
}

async function loadCatalog() {
  const res = await fetch(`/api/catalog?${queryParams()}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `catalog failed (${res.status})`)
  }
  const data = await res.json()
  catalog = data.providers || []
  lastLabel = mediaLabel(data.type)
  heading.textContent = lastLabel
  badgeState = new Map(catalog.map((p) => [p.id, { state: 'idle', ms: 0 }]))
  cache.clear()
  panel.hidden = false
  renderServers()
}

async function resolveProvider(providerId) {
  const myGen = resolveGen
  setBadgeState(providerId, 'loading')
  startClock(tResolve, resolveClock)
  err.hidden = true
  try {
    const res = await fetch(`/api/stream/provider?${queryParams()}&provider=${encodeURIComponent(providerId)}`)
    const data = await res.json()
    if (myGen !== resolveGen) return null
    if (!res.ok || data.error) throw new Error(data.error || 'resolve failed')
    if (!data.ok) {
      setBadgeState(providerId, 'failed', data.ms || 0)
      idleResolve()
      throw new Error(data.reason || 'no stream')
    }
    stopClock(resolveClock)
    tResolve.textContent = fmtMs(data.ms || 0)
    tResolve.className = 'timing__val is-done'
    return storeStream(data)
  } catch (error) {
    if (myGen === resolveGen && badgeState.get(providerId)?.state === 'loading') {
      setBadgeState(providerId, 'failed')
      idleResolve()
    }
    throw error
  }
}

function beginServerSwitch(providerId) {
  resolveGen += 1
  stopAutoResolve()
  stopPlayback()
  clearExports()
  err.hidden = true
  lastActive = ''
  renderServers()
  if (providerId) setBadgeState(providerId, 'loading')
}

function clearLoadingBadges() {
  for (const provider of catalog) {
    if (badgeState.get(provider.id)?.state === 'loading') setBadgeState(provider.id, 'idle')
  }
}

function startAutoResolve() {
  stopAutoResolve()
  let finishResolve = null
  live = new EventSource(`/api/stream/live?${queryParams()}`)

  live.addEventListener('probing', (ev) => {
    const data = JSON.parse(ev.data)
    setBadgeState(data.id, 'loading')
    if (!finishResolve) finishResolve = startClock(tResolve, resolveClock)
  })

  live.addEventListener('skipped', (ev) => {
    const data = JSON.parse(ev.data)
    setBadgeState(data.id, 'failed', data.ms || 0)
  })

  live.addEventListener('ready', async (ev) => {
    const entry = storeStream(JSON.parse(ev.data))
    finishResolve?.()
    stopAutoResolve()
    clearLoadingBadges()
    try {
      await playSelected(entry)
    } catch (e) {
      resetPlaybackTiming()
      showErr(e.message)
    }
  })

  live.addEventListener('fail', (ev) => {
    finishResolve?.()
    stopAutoResolve()
    clearLoadingBadges()
    try {
      showErr(JSON.parse(ev.data).error || 'No playable stream')
    } catch {
      showErr('No playable stream')
    }
  })

  live.onerror = () => {
    if (live) stopAutoResolve()
  }
}

function syncType() {
  const tv = typeIn.value === 'tv'
  tvFields.hidden = !tv
  hintMovie.hidden = tv
  hintTv.hidden = !tv
  idLabel.textContent = tv ? 'TV ID' : 'Movie ID'
  idIn.placeholder = tv ? TV_ID : MOVIE_ID
  seasonIn.required = tv
  episodeIn.required = tv
  const current = idIn.value.trim()
  if (tv && (!current || current === MOVIE_ID)) idIn.value = TV_ID
  if (!tv && (!current || current === TV_ID)) idIn.value = MOVIE_ID
  if (tv) {
    if (!seasonIn.value.trim()) seasonIn.value = TV_SEASON
    if (!episodeIn.value.trim()) episodeIn.value = TV_EPISODE
  } else {
    seasonIn.value = ''
    episodeIn.value = ''
  }
}

document.querySelectorAll('[data-copy]').forEach((node) => {
  node.addEventListener('click', async () => {
    const field = $(node.dataset.copy)
    await navigator.clipboard.writeText(field.value)
    const label = node.textContent
    node.textContent = 'Copied'
    node.classList.add('ok')
    setTimeout(() => {
      node.textContent = label
      node.classList.remove('ok')
    }, 1200)
  })
})

serversEl.addEventListener('click', async (event) => {
  const btnNode = event.target.closest('[data-id]')
  if (!btnNode || btnNode.disabled) return
  const providerId = btnNode.dataset.id
  if (providerId === lastActive && cache.has(providerId)) return

  resetPlaybackTiming()

  const cached = cache.get(providerId)
  if (cached) {
    stopAutoResolve()
    try {
      await playSelected(cached)
    } catch (e) {
      resetPlaybackTiming()
      showErr(e.message)
    }
    return
  }

  beginServerSwitch(providerId)
  try {
    const entry = await resolveProvider(providerId)
    if (!entry) return
    await playSelected(entry)
  } catch (e) {
    resetPlaybackTiming()
    showErr(e.message)
  }
})

typeIn.addEventListener('change', syncType)
syncType()

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  btn.disabled = true
  err.hidden = true
  panel.hidden = true
  stopAll()
  catalog = []
  cache.clear()
  badgeState.clear()
  lastActive = ''
  serversEl.innerHTML = ''
  clearExports()
  resetTiming()
  try {
    await loadCatalog()
    startAutoResolve()
  } catch (e) {
    timing.hidden = true
    showErr(e.message)
  } finally {
    btn.disabled = false
  }
})
