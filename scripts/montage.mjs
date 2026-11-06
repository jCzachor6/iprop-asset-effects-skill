#!/usr/bin/env node
// One picture of many effects: each effect's hero frame (frame 0) for a few seeds, lit the way a game
// lights it, labelled and packed into rows. For a README, a store page or a quick look at a folder.
//
// Usage: node montage.mjs [effects-folder | effect.ips ...] [--seeds 1,2] [--pick 3 --from 1-12]
//                         [--zoom 2] [--width 1600] [--stage night] [--out out/montage.png]
//   effects-folder         where the .ips effects are (default: the skill's own examples/)
//   --pick N --from 1-12   show the N seeds of that range that look most unlike each other, instead of --seeds
// Effects that float (their origin well above the bottom of the canvas) get the sky without a floor.
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { effectsIn, fail, parseArgs, seedsOption } from "./lib/cli.mjs"
import { requireSdk } from "./lib/sdk.mjs"
import { blank, blit, compileEffect, composeFrame, generate, glowOf, label, readEffect, scratchDir, writePng } from "./lib/fx.mjs"

const USAGE = "Usage: node montage.mjs [effects-folder | effect.ips ...] [--seeds 1,2] [--pick 3 --from 1-12] [--zoom 2] [--width 1600] [--stage night|dark|sky|light|none] [--out out/montage.png]"
const STAGES = ["night", "dark", "sky", "light", "none"]
const here = dirname(fileURLToPath(import.meta.url))
const cli = parseArgs(process.argv.slice(2), { valued: ["--seeds", "--pick", "--from", "--zoom", "--width", "--stage", "--out"], usage: USAGE })
const { option } = cli
const targets = cli.positionals.length ? cli.positionals : [join(here, "..", "examples")]
for (const target of targets) if (!existsSync(target)) fail(`${target} does not exist`)
const pick = Number(option("--pick", "0"))
const seeds = pick > 0 ? seedsOption(option("--from", "1-12"), USAGE) : seedsOption(option("--seeds", "1,2"), USAGE)
const zoom = Math.max(1, Math.round(Number(option("--zoom", "2")) || 1))
const maxWidth = Number(option("--width", "1600"))
const stage = option("--stage", "night")
if (!STAGES.includes(stage)) fail(`--stage is one of ${STAGES.join(", ")}`, USAGE)
const out = resolve(option("--out", join("out", "montage.png")))

// A seed's look in a few numbers: the mean colour of its opaque pixels, weighted, and how much it covers.
const look = (image) => {
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < image.rgba.length; i += 4) {
    const a = image.rgba[i + 3] / 255
    if (a < 0.1) continue
    r += image.rgba[i] * a; g += image.rgba[i + 1] * a; b += image.rgba[i + 2] * a; n += a
  }
  return n ? [r / n, g / n, b / n, Math.sqrt(n) * 2] : [0, 0, 0, 0]
}
// Greedy: start from the first seed, then keep adding the one farthest from all those chosen.
const mostUnlike = (tiles, count) => {
  const dist = (a, b) => Math.hypot(...a.look.map((v, i) => v - b.look[i]))
  const chosen = [tiles[0]]
  while (chosen.length < Math.min(count, tiles.length)) {
    let best = null, bestD = -1
    for (const t of tiles) {
      if (chosen.includes(t)) continue
      const d = Math.min(...chosen.map((c) => dist(c, t)))
      if (d > bestD) { bestD = d; best = t }
    }
    chosen.push(best)
  }
  return chosen.sort((a, b) => a.seed - b.seed)
}

const sdk = requireSdk()
const scratch = scratchDir()
const cells = []
for (const file of targets.flatMap(effectsIn)) {
  const effect = readEffect(file)
  const binary = join(scratch, `${effect.stem}.iprop`)
  const compiled = compileEffect(sdk, file, binary)
  if (!compiled.ok) {
    console.error(`${effect.id}: does not compile\n${compiled.error}`)
    continue
  }
  const floats = effect.originY < effect.height * 0.7
  let tiles = []
  for (const seed of seeds) {
    const [sprite, mask] = await Promise.all([0, 1].map((pass) => generate(sdk, binary, seed, { renderPass: pass }, scratch)))
    if (!sprite.ok || !mask.ok) {
      console.error(`${effect.id} seed ${seed}: ${(sprite.ok ? mask : sprite).error}`)
      continue
    }
    const image = composeFrame(effect, { sprite: sprite.image, mask: mask.image, glow: glowOf(sprite.outputs) },
      { stage: stage === "night" && floats ? "sky" : stage })
    tiles.push({ seed, image, look: look(sprite.image) })
  }
  if (!tiles.length) continue
  if (pick > 0) tiles = mostUnlike(tiles, pick)
  tiles = tiles.map((t) => t.image)
  // A cell: the seeds side by side, a gap between, the name underneath.
  const w = (effect.width * zoom + 4) * tiles.length - 4, h = effect.height * zoom + 22
  const cell = blank(w, h, [18, 16, 24, 255])
  tiles.forEach((tile, i) => blit(cell, tile, i * (effect.width * zoom + 4), 0, zoom))
  label(cell, `${effect.title.toUpperCase()}  ${effect.loop ? "LOOP" : "ONE-SHOT"}`, 2, effect.height * zoom + 6, [214, 206, 190, 255], 2)
  cells.push(cell)
  console.log(`${effect.id}: ${tiles.length} seeds`)
}
rmSync(scratch, { recursive: true, force: true })
if (!cells.length) process.exit(1)

// Shelf packing: cells left to right until the row is full, rows top to bottom.
const gap = 10
const rows = []
let row = { cells: [], width: 0, height: 0 }
for (const cell of cells) {
  if (row.cells.length && row.width + gap + cell.width > maxWidth) {
    rows.push(row)
    row = { cells: [], width: 0, height: 0 }
  }
  row.width += (row.cells.length ? gap : 0) + cell.width
  row.height = Math.max(row.height, cell.height)
  row.cells.push(cell)
}
rows.push(row)
const sheet = blank(Math.max(...rows.map((r) => r.width)) + 2 * gap, rows.reduce((s, r) => s + r.height + gap, gap), [12, 11, 16, 255])
let y = gap
for (const r of rows) {
  let x = gap
  for (const cell of r.cells) {
    blit(sheet, cell, x, y + (r.height - cell.height))
    x += cell.width + gap
  }
  y += r.height + gap
}
mkdirSync(dirname(out), { recursive: true })
writePng(out, sheet)
console.log(`montage: ${cells.length} effects, ${sheet.width}x${sheet.height} -> ${out}`)
