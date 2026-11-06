#!/usr/bin/env node
// Builds the gallery: a page that plays every effect live in the browser, lit the way a game lights it,
// with the light's power, sigma and blur on sliders. Every animation plays three times, then the next
// seed (seed + 1) takes over, so the effects keep changing.
//
// Usage: node gallery.mjs [effects-folder | effect.ips ...] [--seeds 1-6] [--out out/gallery] [--serve] [--port 8770]
//   effects-folder   where the .ips effects are (default: the skill's own examples/)
//   --seeds 1-6      seeds to render into the gallery for every effect (ranges and lists: 1-6,9)
//   --out dir        the folder to write (default: out/gallery under the current folder)
//   --serve          serve the gallery on http://localhost:<port>/ and render every next seed on demand,
//                    so the seeds never repeat; builds the gallery first when it is missing
//   --port 8770      the port for --serve (it listens on 127.0.0.1 only)
//
// For every seed it renders each frame three times: the colour sprite (renderPass 0), the light mask
// (renderPass 1) and the light the asset bakes itself (renderPass 2). The three rows go into one PNG
// strip, embedded as a data URI in <out>/data/<stem>.js, so the page needs no fetch and opens from disk
// (file://). From disk, those seeds take turns. The page lights the frames with light.js, a copy of
// scripts/lib/light.mjs, the same model the contact sheets use.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { effectsIn, fail, parseArgs, seedsOption } from "./lib/cli.mjs"
import { requireSdk } from "./lib/sdk.mjs"
import { blank, compileEffect, copyInto, readEffect, renderSeed, scratchDir } from "./lib/fx.mjs"
import { encodePng } from "./lib/png.mjs"

const USAGE = "Usage: node gallery.mjs [effects-folder | effect.ips ...] [--seeds 1-6] [--out out/gallery] [--serve] [--port 8770]"
const here = dirname(fileURLToPath(import.meta.url))
const cli = parseArgs(process.argv.slice(2), { valued: ["--seeds", "--out", "--port"], flags: ["--serve"], usage: USAGE })
const { option, flag } = cli
const targets = cli.positionals.length ? cli.positionals : [join(here, "..", "examples")]
for (const target of targets) if (!existsSync(target)) fail(`${target} does not exist`)

// The order of the categories on the page; others follow alphabetically.
const ORDER = ["explosions", "fire", "lightning", "impacts", "melee", "projectiles", "arcane", "holy", "shadow", "ice", "nature", "water"]

const seeds = seedsOption(option("--seeds", "1-6"), USAGE)
const out = resolve(option("--out", join("out", "gallery")))
const files = targets.flatMap(effectsIn)
if (!files.length) fail("gallery: no .ips effects found")
const sdk = requireSdk()

// One seed's entry for the page: its timing, light and fuel, and one strip with the sprites, the masks
// and the baked light in three rows, frames left to right.
const entryOf = (result) => {
  const { width: w, height: h } = result.frames[0].sprite
  const strip = blank(w * result.frames.length, h * 3)
  result.frames.forEach((frame, i) => {
    copyInto(strip, frame.sprite, i * w, 0)
    copyInto(strip, frame.mask, i * w, h)
    if (frame.baked) copyInto(strip, frame.baked, i * w, 2 * h)
  })
  return {
    seed: result.seed,
    frames: result.anim.frames,
    fps: Number(result.anim.fps.toFixed(3)),
    loop: result.anim.loop,
    glow: result.frames.map((f) => [f.glow.power, f.glow.sigma, f.glow.blur].map((v) => Number(v.toFixed(3)))),
    fuel: Math.max(...result.frames.map((f) => f.fuel)),
    strip: `data:image/png;base64,${encodePng(strip).toString("base64")}`,
  }
}

const build = async () => {
  mkdirSync(join(out, "data"), { recursive: true })
  for (const name of readdirSync(join(out, "data"))) if (name.endsWith(".js")) rmSync(join(out, "data", name))
  const scratch = scratchDir()
  const written = []
  let failed = 0

  for (const file of files) {
    const effect = readEffect(file)
    const binary = join(scratch, `${effect.stem}.iprop`)
    const compiled = compileEffect(sdk, file, binary)
    if (!compiled.ok) {
      console.error(`${effect.id}: does not compile\n${compiled.error}`)
      failed++
      continue
    }
    const entries = []
    for (const seed of seeds) {
      const result = await renderSeed(sdk, binary, seed, { baked: true, scratch })
      if (!result.ok) {
        console.error(`${effect.id}: ${result.error}`)
        failed++
        continue
      }
      entries.push(entryOf(result))
      console.log(`${effect.id} seed ${seed}: ${result.anim.frames} frames at ${result.anim.fps.toFixed(1)} fps`)
    }
    if (!entries.length) continue
    // The summary: the header's first paragraph, without the "Title:" lead.
    const paragraph = effect.header.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, " ").replace(/^[^:]*:\s*/, "").trim()
    const data = {
      id: effect.id,
      stem: effect.stem,
      title: effect.title,
      summary: paragraph.charAt(0).toUpperCase() + paragraph.slice(1),
      category: effect.category,
      loop: effect.loop,
      variety: effect.variety,
      width: effect.width,
      height: effect.height,
      originX: effect.originX,
      originY: effect.originY,
      header: effect.header,
      inputs: effect.inputs,
      seeds: entries,
    }
    const name = `${effect.id.replace(/[^\w-]+/g, "-")}.js`
    writeFileSync(join(out, "data", name), `// Generated by scripts/gallery.mjs from ${effect.id}.ips: do not edit.\n(window.IPROP_EFFECTS = window.IPROP_EFFECTS || []).push(${JSON.stringify(data)});\n`)
    written.push({ name, category: effect.category, stem: effect.stem })
  }
  rmSync(scratch, { recursive: true, force: true })

  // The page: the static app and style, the light model, then one script per effect.
  const rank = (category) => (ORDER.includes(category) ? ORDER.indexOf(category) : ORDER.length)
  written.sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category) || a.stem.localeCompare(b.stem))
  copyFileSync(join(here, "gallery", "app.js"), join(out, "app.js"))
  copyFileSync(join(here, "gallery", "style.css"), join(out, "style.css"))
  writeFileSync(join(out, "light.js"), "// Copied from scripts/lib/light.mjs by scripts/gallery.mjs (exports removed): do not edit.\n" +
    readFileSync(join(here, "lib", "light.mjs"), "utf8").replace(/^export /gm, ""))
  const scripts = written.map((w) => `<script src="data/${w.name}"></script>`).join("\n")
  writeFileSync(join(out, "index.html"), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iprop-asset-effects gallery</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header id="top"></header>
<main id="grid"></main>
<div id="viewer" hidden></div>
<script src="light.js"></script>
${scripts}
<script src="app.js"></script>
</body>
</html>
`)
  const bytes = readdirSync(join(out, "data")).reduce((sum, name) => sum + statSync(join(out, "data", name)).size, 0)
  console.log(`gallery: ${written.length} effects, ${seeds.length} seeds each, ${(bytes / 1048576).toFixed(1)} MB of frames in ${out}`)
  return failed
}

// --serve: the gallery over HTTP, plus api/info and api/seed?fx=<id>&seed=<n>, which renders one seed
// of one effect with ipgen (the same entry the build writes) for the page's next seed. One seed renders
// at a time (each already runs eight ipgen at once); the viewer's requests go first.
const serve = () => {
  const port = Number(option("--port", 8770))
  const scratch = scratchDir()
  const effects = new Map()
  for (const file of files) {
    const effect = readEffect(file)
    const binary = join(scratch, `${effect.stem}.iprop`)
    const compiled = compileEffect(sdk, file, binary)
    if (compiled.ok) effects.set(effect.id, binary)
    else console.error(`${effect.id}: does not compile\n${compiled.error}`)
  }
  const done = new Map() // `${id}|${seed}` -> the entry as JSON text, the most recent few
  const waiting = new Map() // `${id}|${seed}` -> its job in the queue
  const queue = []
  let busy = false
  const pump = async () => {
    if (busy || !queue.length) return
    busy = true
    queue.sort((a, b) => b.priority - a.priority || a.order - b.order)
    const job = queue.shift()
    let text = null
    try {
      const result = await renderSeed(sdk, job.binary, job.seed, { baked: true, scratch })
      if (result.ok) text = JSON.stringify(entryOf(result))
      else console.error(`${job.key}: ${result.error}`)
    } catch (error) {
      console.error(`${job.key}: ${error.message}`)
    }
    waiting.delete(job.key)
    if (text) {
      done.set(job.key, text)
      while (done.size > 48) done.delete(done.keys().next().value)
      console.log(`rendered ${job.key.replace("|", " seed ")}`)
    }
    job.resolve(text)
    busy = false
    pump()
  }
  let order = 0
  const render = (id, seed, priority) => {
    const key = `${id}|${seed}`
    if (done.has(key)) return Promise.resolve(done.get(key))
    const queued = waiting.get(key)
    if (queued) {
      queued.priority = Math.max(queued.priority, priority)
      return queued.promise
    }
    const job = { key, binary: effects.get(id), seed, priority, order: order++ }
    job.promise = new Promise((resolve) => (job.resolve = resolve))
    waiting.set(key, job)
    queue.push(job)
    pump()
    return job.promise
  }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json" }
  const send = (res, status, type, body) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" })
    res.end(body)
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost")
    if (url.pathname === "/api/info") return send(res, 200, types[".json"], JSON.stringify({ live: true, effects: [...effects.keys()] }))
    if (url.pathname === "/api/seed") {
      const id = url.searchParams.get("fx"), seed = Number(url.searchParams.get("seed"))
      const priority = Number(url.searchParams.get("priority")) || 0
      if (!effects.has(id) || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) return send(res, 400, "text/plain", "unknown effect or seed")
      const text = await render(id, seed, priority)
      return text ? send(res, 200, types[".json"], text) : send(res, 500, "text/plain", "the seed did not render")
    }
    let path
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return send(res, 400, "text/plain", "bad path")
    }
    if (path.endsWith("/")) path += "index.html"
    const full = resolve(out, `.${path}`)
    if (!full.startsWith(out + sep)) return send(res, 403, "text/plain", "outside the gallery")
    if (!existsSync(full) || !statSync(full).isFile()) return send(res, 404, "text/plain", "not found")
    send(res, 200, types[extname(full)] || "application/octet-stream", readFileSync(full))
  })
  const stop = () => {
    rmSync(scratch, { recursive: true, force: true })
    process.exit(0)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  server.listen(port, "127.0.0.1", () => {
    console.log(`gallery: http://localhost:${port}/ plays ${effects.size} effects; every next seed renders on demand (Ctrl+C to stop)`)
  })
}

if (flag("--serve")) {
  if (!existsSync(join(out, "index.html")) && (await build())) process.exit(1)
  serve()
} else if (await build()) process.exit(1)
