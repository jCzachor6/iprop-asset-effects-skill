// iprop-asset-effects gallery: plays every effect live, lit the way a game lights it. Every animation plays
// three times, then the next seed takes over (seed + 1), so the effects keep changing. The frames come
// from data/*.js (window.IPROP_EFFECTS, written by scripts/gallery.mjs). Opened from disk, the seeds rendered
// there take turns. Served by `node scripts/gallery.mjs --serve`, every next seed is rendered on demand,
// so it never repeats. The light model is light.js, a copy of scripts/lib/light.mjs.
// Copied into the gallery by scripts/gallery.mjs: edit scripts/gallery/app.js.
"use strict"
;(() => {
  const ORDER = ["explosions", "fire", "lightning", "impacts", "melee", "projectiles", "arcane", "holy", "shadow", "ice", "nature", "water"]
  const rank = (c) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length)
  const FX = (window.IPROP_EFFECTS || []).slice().sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title))

  const PLAYS = 3 // each seed plays this many times before the next one
  const REST = 0.6 // seconds of empty stage after a one-shot, before it plays again
  const settings = { stage: "night", light: "mask", scale: 2, speed: 1, paused: false }
  const STAGES = ["night", "dark", "sky", "light", "checker"]
  const LIGHTS = [["mask", "mask"], ["baked", "baked"], ["off", "off"]]
  const VIEWS = [["lit", "lit"], ["sprite", "sprite"], ["mask", "mask"], ["light", "light"]]

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue
      if (k === "class") e.className = v
      else if (k === "text") e.textContent = v
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v)
      else e.setAttribute(k, v === true ? "" : v)
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) e.append(kid)
    return e
  }
  const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d)

  // ---- seeds: from data/, or rendered on demand when the gallery is served ------------------------------
  const live = { on: false, checked: !location.protocol.startsWith("http") }
  const liveListeners = []
  if (!live.checked) {
    fetch("api/info", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => { live.on = !!(info && info.live) })
      .catch(() => {})
      .finally(() => { live.checked = true; for (const f of liveListeners) f() })
  }
  const fetched = new Map() // `${fx.id}|${seed}` -> Promise of the entry, or null
  // The entry (one seed's frames) for `seed`: from data/ when it was rendered there, else from the server.
  const entryFor = (fx, seed, priority = 0) => {
    const own = fx.seeds.find((e) => e.seed === seed)
    if (own) return Promise.resolve(own)
    if (!live.on) return Promise.resolve(null)
    const key = `${fx.id}|${seed}`
    if (!fetched.has(key)) {
      fetched.set(key, fetch(`api/seed?fx=${encodeURIComponent(fx.id)}&seed=${seed}&priority=${priority}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((e) => (e && e.strip ? e : null))
        .catch(() => null))
      while (fetched.size > 64) fetched.delete(fetched.keys().next().value)
    }
    return fetched.get(key)
  }
  // The seed after `seed`: seed + 1. From disk, past the last one in data/, the first one again.
  const seedAfter = (fx, seed) => {
    const next = seed + 1
    if (live.on || fx.seeds.some((e) => e.seed === next)) return next
    return fx.seeds[0].seed
  }

  // ---- frames: a seed's strip (sprites, masks, baked light in three rows) as RGBA per frame ----------
  const decoded = new Map() // a few recent strips, so the viewer and its card share one decode
  const decode = (fx, entry) => {
    if (decoded.has(entry)) {
      const hit = decoded.get(entry)
      decoded.delete(entry)
      decoded.set(entry, hit)
      return hit
    }
    const job = new Promise((resolve, reject) => {
      const w = fx.width, h = fx.height, n = entry.frames
      const img = new Image()
      img.onload = () => {
        const c = document.createElement("canvas")
        c.width = w * n
        c.height = h * 3
        const ctx = c.getContext("2d", { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const rows = [[], [], []]
        for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) rows[r].push(ctx.getImageData(i * w, r * h, w, h).data)
        resolve({ sprite: rows[0], mask: rows[1], baked: rows[2] })
      }
      img.onerror = reject
      img.src = entry.strip
    })
    decoded.set(entry, job)
    while (decoded.size > 40) decoded.delete(decoded.keys().next().value)
    return job
  }

  // ---- stages: the backdrops from light.js, plus a checker to judge transparency ---------------------
  const stages = new Map()
  const stageImage = (fx, stage) => {
    const key = `${fx.width}x${fx.height}|${fx.originY}|${stage}`
    if (!stages.has(key)) {
      let img
      if (stage === "checker") {
        img = new Uint8ClampedArray(fx.width * fx.height * 4)
        for (let y = 0; y < fx.height; y++)
          for (let x = 0; x < fx.width; x++) {
            const o = (y * fx.width + x) * 4, v = ((x >> 2) + (y >> 2)) % 2 ? 46 : 34
            img[o] = v; img[o + 1] = v - 2; img[o + 2] = v + 6; img[o + 3] = 255
          }
      } else {
        // Effects that float (their origin well above the bottom) get the night sky without the floor.
        const floats = fx.originY < fx.height * 0.7
        img = backdrop(fx.width, fx.height, Math.round(fx.originY), stage === "night" && floats ? "sky" : stage)
      }
      stages.set(key, img)
    }
    return stages.get(key)
  }

  // ---- a player: one effect on one canvas, seed after seed --------------------------------------------
  let deadline = 0 // light computed for the grid stops here each animation frame, so playback stays smooth
  class Player {
    constructor(fx, canvas, scale, { eager = false, entry = fx.seeds[0] } = {}) {
      this.fx = fx
      this.canvas = canvas
      this.eager = eager
      this.override = { power: null, sigma: null, blur: null }
      this.view = "lit"
      this.off = document.createElement("canvas")
      this.off.width = fx.width
      this.off.height = fx.height
      this.offCtx = this.off.getContext("2d")
      this.lights = new Map()
      this.visible = true
      this.resize(scale)
      this.load(entry)
    }
    resize(scale) {
      this.scale = scale
      this.canvas.width = this.fx.width * scale
      this.canvas.height = this.fx.height * scale
      this.dirty = true
    }
    // Shows `entry` from its first frame; `data` is its decoded frames when they are already there.
    load(entry, data = null) {
      this.entry = entry
      this.data = data
      this.lights.clear()
      this.time = 0
      this.frame = 0
      this.plays = 0
      this.upcoming = null
      this.dirty = true
      if (!data) decode(this.fx, entry).then((d) => {
        if (this.entry === entry) {
          this.data = d
          this.dirty = true
        }
      })
    }
    // Fetches and decodes the next seed while this one plays, once per seed.
    prepare() {
      if (this.upcoming) return
      const up = { seed: seedAfter(this.fx, this.entry.seed), ready: null, failed: false }
      this.upcoming = up
      entryFor(this.fx, up.seed, this.eager ? 1 : 0)
        .then((e) => (e ? decode(this.fx, e).then((d) => { up.ready = { entry: e, data: d } }) : Promise.reject()))
        .catch(() => { up.failed = true })
    }
    // Where the next seed stands: null (none asked yet), "loading", or "ready".
    get nextState() {
      if (!this.upcoming) return null
      return this.upcoming.ready || this.upcoming.failed ? "ready" : "loading"
    }
    // This frame's power, sigma and blur: its own, or the sliders'.
    glow(f) {
      const g = this.entry.glow[Math.max(0, f)] || [0, 0, 0], o = this.override
      return [o.power ?? g[0], o.sigma ?? g[1], o.blur ?? g[2]]
    }
    advance(dt) {
      if (!this.data) return
      const e = this.entry, n = e.frames, period = n / e.fps
      const cycle = e.loop ? period : period + REST
      this.time += dt * settings.speed
      if (live.checked) this.prepare()
      const plays = Math.floor(this.time / cycle)
      // Three plays done: the next seed takes over at the top of a play, as soon as it is here (until
      // then this one plays on).
      if (plays >= PLAYS && plays > this.plays && this.upcoming && (this.upcoming.ready || this.upcoming.failed)) {
        const up = this.upcoming
        if (up.ready) this.load(up.ready.entry, up.ready.data)
        else this.load(this.fx.seeds[0])
        return
      }
      this.plays = plays
      const t = this.time % cycle
      if (e.loop) this.frame = Math.floor(t * e.fps) % n
      else this.frame = t < period ? Math.min(n - 1, Math.floor(t * e.fps)) : -1
    }
    step(by) {
      const e = this.entry, n = e.frames
      const f = this.frame < 0 ? 0 : this.frame
      this.frame = (((f + by) % n) + n) % n
      this.time = this.plays * (e.loop ? n / e.fps : n / e.fps + REST) + (this.frame + 0.5) / e.fps
    }
    seek(f) {
      const e = this.entry, n = e.frames
      this.frame = Math.max(0, Math.min(n - 1, f))
      this.time = this.plays * (e.loop ? n / e.fps : n / e.fps + REST) + (this.frame + 0.5) / e.fps
    }
    light(f, mode) {
      const [p, s, b] = this.glow(f)
      const key = mode === "baked" ? `${f}|baked` : `${f}|${p}|${s}|${b}`
      let light = this.lights.get(key)
      if (light) return light
      if (mode === "mask" && !this.eager && performance.now() > deadline) return null
      const w = this.fx.width, h = this.fx.height
      light = mode === "baked" ? lightFromBaked(this.data.baked[f], w, h) : lightFromMask(this.data.mask[f], w, h, p, s, b)
      if (this.lights.size > 400) this.lights.clear()
      this.lights.set(key, light)
      return light
    }
    draw() {
      if (!this.data) return
      const f = this.frame
      if (f === this.shown && this.entry === this.shownEntry && !this.dirty) return
      const w = this.fx.width, h = this.fx.height
      const out = new ImageData(w, h)
      let bg = stageImage(this.fx, settings.stage), light = null, sprite = null
      if (f >= 0) {
        sprite = this.data.sprite[f]
        if (this.view === "mask") {
          bg = null
          sprite = this.data.mask[f]
        } else if (this.view !== "sprite" && settings.light !== "off") {
          light = this.light(f, settings.light === "baked" ? "baked" : "mask")
          if (!light) return // over this frame's budget: keep the last picture, try again next frame
          if (this.view === "light") {
            bg = null
            sprite = null
          }
        }
      }
      composite(out.data, w, h, bg, light, sprite)
      this.offCtx.putImageData(out, 0, 0)
      const ctx = this.canvas.getContext("2d")
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this.off, 0, 0, w * this.scale, h * this.scale)
      this.shown = f
      this.shownEntry = this.entry
      this.dirty = false
    }
    // "seed 7 · 2/3", and what comes next once the three plays are done.
    status() {
      const e = this.entry
      let text = `seed ${e.seed} · ${Math.min(this.plays + 1, PLAYS)}/${PLAYS}`
      if (this.plays >= PLAYS && this.nextState === "loading") text += " · rendering the next seed"
      return text
    }
  }

  // ---- the top bar ---------------------------------------------------------------------------------------
  const players = []
  const topChoices = []
  const refreshAll = () => {
    for (const p of players) p.dirty = true
    if (viewer.player) viewer.player.dirty = true
    for (const c of topChoices) c.sync()
  }
  const choice = (label, options, get, set) => {
    const box = el("div", { class: "choice" }, el("span", { class: "label", text: label }))
    const buttons = options.map(([value, text]) => {
      const b = el("button", { text, onclick: () => { set(value); sync() } })
      box.append(b)
      return [value, b]
    })
    const sync = () => buttons.forEach(([value, b]) => b.classList.toggle("on", get() === value))
    sync()
    box.sync = sync
    return box
  }
  const top = document.getElementById("top")
  const pool = Math.max(0, ...FX.map((fx) => fx.seeds.length))
  const pause = el("button", { text: "pause", onclick: () => { settings.paused = !settings.paused; pause.textContent = settings.paused ? "play" : "pause" } })
  const lead = el("p")
  const mode = el("p", { class: "mode" })
  const describe = () => {
    lead.textContent = `${FX.length} seeded pixel effects made with Infinite Props. Each effect draws its sprite, a light mask, and the light under the pixels with power, sigma and blur. Every animation plays ${PLAYS} times, then the next seed (seed + 1) takes over. Click an effect to change the light.`
    mode.textContent = live.on
      ? "Live: every next seed is rendered on demand by ipgen, so it never repeats."
      : `From disk: each effect cycles through the ${pool} seeds rendered into data/. For new seeds without end, run node scripts/gallery.mjs --serve.`
  }
  describe()
  liveListeners.push(describe)
  topChoices.push(
    choice("stage", STAGES.map((s) => [s, s]), () => settings.stage, (v) => { settings.stage = v; refreshAll() }),
    choice("light", LIGHTS, () => settings.light, (v) => { settings.light = v; refreshAll() }))
  top.append(
    el("div", { class: "title" }, el("h1", { text: "iprop-asset-effects" }), lead, mode),
    el("div", { class: "controls" },
      ...topChoices,
      choice("scale", [[1, "1x"], [2, "2x"], [3, "3x"]], () => settings.scale, (v) => { settings.scale = v; for (const p of players) p.resize(v) }),
      choice("speed", [[0.25, "¼"], [0.5, "½"], [1, "1x"], [2, "2x"]], () => settings.speed, (v) => (settings.speed = v)),
      pause))

  // ---- the grid ------------------------------------------------------------------------------------------
  const grid = document.getElementById("grid")
  const watcher = "IntersectionObserver" in window
    ? new IntersectionObserver((items) => { for (const it of items) it.target.player.visible = it.isIntersecting }, { rootMargin: "200px" })
    : null
  const cards = []
  for (const fx of FX) {
    const canvas = el("canvas", { title: "open" })
    const player = new Player(fx, canvas, settings.scale)
    players.push(player)
    const seedText = el("span", { class: "seed" })
    const info = el("span", { class: "info" })
    const card = el("article", { class: "card" },
      el("div", { class: "screen", onclick: () => openViewer(fx, player.entry) }, canvas),
      el("div", { class: "meta" },
        el("h3", { text: fx.title, onclick: () => openViewer(fx, player.entry) }),
        el("span", { class: "tags" },
          el("span", { class: "tag cat", text: fx.category }),
          el("span", { class: "tag", text: fx.loop ? "loop" : "one-shot" }))),
      el("p", { class: "summary", text: fx.summary }),
      el("div", { class: "row" }, seedText, info))
    card.player = player
    // Rewrites the seed line only when it changes.
    card.sync = () => {
      const e = player.entry
      const s = player.status(), i = `${e.frames} fr · ${fmt(e.fps, 1)} fps`
      if (seedText.textContent !== s) seedText.textContent = s
      if (info.textContent !== i) info.textContent = i
    }
    if (watcher) watcher.observe(card)
    grid.append(card)
    cards.push(card)
    card.sync()
  }

  // ---- the viewer ------------------------------------------------------------------------------------------
  const viewer = { root: document.getElementById("viewer"), player: null, paused: false, sync: () => {} }
  const closeViewer = () => {
    if (viewer.player && location.hash) history.replaceState(null, "", location.pathname + location.search)
    viewer.root.hidden = true
    viewer.root.textContent = ""
    viewer.player = null
    document.body.classList.remove("viewing")
  }
  const openViewer = (fx, entry) => {
    closeViewer()
    const fit = Math.max(1, Math.floor(Math.min((innerWidth - 420) / fx.width, (innerHeight - 120) / fx.height, 8)))
    const canvas = el("canvas")
    const player = new Player(fx, canvas, fit, { eager: true, entry })
    viewer.player = player
    viewer.paused = false

    const sliders = {}
    const slider = (name, max, step) => {
      const range = el("input", { type: "range", min: 0, max, step, value: 0 })
      const auto = el("input", { type: "checkbox", checked: true })
      const value = el("output")
      range.addEventListener("input", () => {
        auto.checked = false
        player.override[name] = Number(range.value)
        player.lights.clear()
        player.dirty = true
      })
      auto.addEventListener("change", () => {
        player.override[name] = auto.checked ? null : Number(range.value)
        player.lights.clear()
        player.dirty = true
      })
      sliders[name] = { range, auto, value }
      return el("label", { class: "slider" }, el("span", { class: "label", text: name }), range, value, el("span", { class: "auto" }, auto, " own"))
    }
    const seedText = el("span", { class: "seed" })
    const views = choice("view", VIEWS, () => player.view, (v) => { player.view = v; player.dirty = true })
    const lights = choice("light", LIGHTS, () => settings.light, (v) => { settings.light = v; refreshAll() })
    const stagesBox = choice("stage", STAGES.map((s) => [s, s]), () => settings.stage, (v) => { settings.stage = v; refreshAll() })
    const play = el("button", { text: "pause", onclick: () => { viewer.paused = !viewer.paused; play.textContent = viewer.paused ? "play" : "pause" } })
    const hold = () => { viewer.paused = true; play.textContent = "play" }
    const scrub = el("input", { type: "range", min: 1, max: player.entry.frames, step: 1, value: 1 })
    scrub.addEventListener("input", () => {
      hold()
      player.seek(Number(scrub.value) - 1)
    })
    const frameText = el("span", { class: "info" })
    const stats = el("p", { class: "stats" })
    const note = el("p", { class: "note" })
    const seedNote = el("p", { class: "note" })
    viewer.hold = hold
    viewer.sync = () => {
      const e = player.entry, f = Math.max(0, player.frame)
      const s = player.status() + (viewer.paused || settings.paused ? " · paused" : "")
      if (seedText.textContent !== s) seedText.textContent = s
      seedNote.textContent = live.on
        ? `Plays ${PLAYS} times, then seed + 1, rendered now by ipgen. Pause to stay on this seed.`
        : `Plays ${PLAYS} times, then the next seed in data/. Pause to stay on this seed.`
      scrub.max = e.frames
      if (player.frame >= 0) scrub.value = f + 1
      frameText.textContent = player.frame < 0 ? `— / ${e.frames}` : `${f + 1} / ${e.frames}`
      const own = e.glow[f] || [0, 0, 0]
      for (const [i, name] of ["power", "sigma", "blur"].entries()) {
        const sl = sliders[name]
        if (sl.auto.checked) sl.range.value = own[i]
        sl.value.textContent = fmt(player.override[name] ?? own[i], 2)
        sl.range.disabled = settings.light === "baked"
      }
      stats.textContent = `${e.frames} frames at ${fmt(e.fps, 1)} fps, ${e.loop ? "loop" : "one-shot"} · ${fx.width}x${fx.height}, origin ${fx.originX},${fx.originY} · peak fuel ${e.fuel.toLocaleString("en")}`
      note.textContent = settings.light === "baked"
        ? "Baked: the light the asset paints itself (renderPass 2) at each frame's own power, sigma and blur."
        : settings.light === "off" ? "Light off: the colour sprite alone." : "Mask: the light computed here from the light mask (renderPass 1); move a slider to override the frame's own value."
    }
    const panel = el("div", { class: "panel" },
      el("div", { class: "stagebox" }, canvas),
      el("aside", {},
        el("button", { class: "close", text: "×", title: "close (Esc)", onclick: closeViewer }),
        el("h2", { text: fx.title }),
        el("p", { class: "summary", text: fx.summary }),
        el("div", { class: "row" }, seedText),
        seedNote,
        views, lights, stagesBox,
        el("div", { class: "sliders" }, slider("power", 10, 0.05), slider("sigma", 12, 0.1), slider("blur", 4, 0.05)),
        note,
        el("div", { class: "row transport" },
          el("button", { text: "◀", title: "previous frame", onclick: () => { hold(); player.step(-1) } }),
          play,
          el("button", { text: "▶", title: "next frame", onclick: () => { hold(); player.step(1) } }),
          scrub, frameText),
        stats,
        el("details", {}, el("summary", { text: "about this effect" }), el("pre", { text: fx.header }))))
    viewer.root.append(el("div", { class: "backdrop", onclick: closeViewer }), panel)
    viewer.root.hidden = false
    document.body.classList.add("viewing")
    history.replaceState(null, "", `#${fx.stem}`)
    viewer.sync()
  }
  // A link to index.html#<effect> (its file name, like #frost-nova) opens that effect.
  const fromHash = () => {
    const name = decodeURIComponent(location.hash.slice(1))
    const i = FX.findIndex((f) => f.stem === name || f.id === name)
    if (i >= 0) openViewer(FX[i], players[i].entry)
  }
  addEventListener("hashchange", fromHash)
  addEventListener("keydown", (e) => {
    if (!viewer.player) return
    if (e.key === "Escape") closeViewer()
    else if (e.key === " ") {
      e.preventDefault()
      viewer.paused = !viewer.paused
    } else if (e.key === "ArrowRight") { viewer.hold(); viewer.player.step(1) }
    else if (e.key === "ArrowLeft") { viewer.hold(); viewer.player.step(-1) }
  })

  // ---- the clock -------------------------------------------------------------------------------------------
  let last = performance.now()
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (viewer.player) {
      if (!viewer.paused && !settings.paused) viewer.player.advance(dt)
      viewer.player.draw()
      viewer.sync()
    }
    deadline = performance.now() + 10
    for (const card of cards) {
      const p = card.player
      if (!p.visible || viewer.player) continue
      if (!settings.paused) p.advance(dt)
      p.draw()
      card.sync()
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  fromHash()
})()
