#!/usr/bin/env node
// Renders effects so you can look at them: every frame of a few seeds, lit the way a game lights them
// (the light mask blurred by sigma and blur, times power, added under the sprite).
//
// Usage: node render-fx.mjs <effect.ips | folder> [options]
//   --seeds 1-4        seeds to render (ranges and lists: 1-4,9)
//   --frames N         force the frame count (the `frames` input); default: each seed's own
//   --zoom 3           integer zoom of the contact sheet
//   --stage night      night | dark | sky | light | none: what the effect plays over
//   --layers           add rows for the sprite alone, the light mask and the IPS-baked light
//   --baked            light the frames with renderPass 2 (the asset's own blur) instead of the mask
//   --sheet            write engine sprite sheets: <stem>-<seed>.png (colour row, light row) + .json
//   --gif              write <stem>-<seed>.gif with the light (needs ffmpeg)
//   --uniform k=v      any other input (repeatable), e.g. --uniform style=2 --uniform tint=#40c0ff
//   --out dir          output folder (default: out/<stem> under the current folder; out/<stem> inside
//                      it when the target is a folder of effects)
// Writes <out>/contact.png and keeps the one it replaces as contact-previous.png.
// Prints frames, fps, glow and fuel per seed. Exit 1 when an effect fails to compile or traps, 2 on a
// mistake on the command line.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { effectsIn, fail, pairsOption, parseArgs, seedsOption } from "./lib/cli.mjs"
import { requireSdk } from "./lib/sdk.mjs"
import { blank, blit, compileEffect, composeFrame, copyInto, label, onBlack, onChecker, readEffect, renderSeed, scratchDir, writePng } from "./lib/fx.mjs"

const USAGE = "Usage: node render-fx.mjs <effect.ips | folder> [--seeds 1-4] [--frames N] [--zoom 3] [--stage night|dark|sky|light|none] [--layers] [--baked] [--sheet] [--gif] [--uniform name=value]... [--out dir]"
const STAGES = ["night", "dark", "sky", "light", "none"]
const cli = parseArgs(process.argv.slice(2), {
  valued: ["--seeds", "--frames", "--zoom", "--stage", "--uniform", "--out"],
  flags: ["--layers", "--baked", "--sheet", "--gif"],
  usage: USAGE,
})
const { option, flag } = cli
const [target] = cli.positionals
if (!target || cli.positionals.length > 1) fail(USAGE)
if (!existsSync(target)) fail(`${target} does not exist`)
const seeds = seedsOption(option("--seeds", "1-4"), USAGE)
const zoom = Math.max(1, Math.round(Number(option("--zoom", "3")) || 1))
const stage = option("--stage", "night")
if (!STAGES.includes(stage)) fail(`--stage is one of ${STAGES.join(", ")}`, USAGE)
const uniforms = pairsOption(cli.options("--uniform"), USAGE)
if (option("--frames")) uniforms.frames = option("--frames")
const files = effectsIn(target)
if (!files.length) fail(`no .ips effects in ${target}`)
const many = statSync(target).isDirectory()
const sdk = requireSdk()
const scratch = scratchDir()
let failed = false

for (const file of effectsIn(target)) {
  const effect = readEffect(file)
  const out = resolve(option("--out") ? (many ? join(option("--out"), effect.stem) : option("--out")) : join("out", effect.stem))
  mkdirSync(out, { recursive: true })
  const binary = join(out, `${effect.stem}.iprop`)
  const compiled = compileEffect(sdk, file, binary)
  if (!compiled.ok) {
    console.error(`${effect.id}: does not compile\n${compiled.error}`)
    failed = true
    continue
  }
  const rows = []
  for (const seed of seeds) {
    const result = await renderSeed(sdk, binary, seed, { uniforms, baked: flag("--baked") || flag("--layers"), scratch })
    if (!result.ok) {
      console.error(`${effect.id}: ${result.error}`)
      failed = true
      continue
    }
    const { anim, frames } = result
    const fuel = Math.max(...frames.map((f) => f.fuel))
    const powers = frames.map((f) => f.glow.power)
    console.log(`${effect.id} seed ${seed}: ${anim.frames} frames at ${anim.fps.toFixed(1)} fps, ${anim.loop ? "loop" : "one-shot"}; ` +
      `power ${Math.min(...powers).toFixed(1)}-${Math.max(...powers).toFixed(1)}, sigma ${frames[0].glow.sigma.toFixed(1)}-${frames.at(-1).glow.sigma.toFixed(1)}, ` +
      `blur ${frames[0].glow.blur.toFixed(1)}; peak fuel ${fuel.toLocaleString("en")}`)
    const lit = frames.map((frame) => composeFrame(effect, frame, { stage, source: flag("--baked") ? "baked" : "mask" }))
    const strips = [{ name: `SEED ${seed}  ${anim.frames} FR  ${anim.fps.toFixed(1)} FPS`, images: lit }]
    if (flag("--layers")) {
      strips.push({ name: "SPRITE", images: frames.map((f) => onChecker(f.sprite)) })
      strips.push({ name: "LIGHT MASK", images: frames.map((f) => onBlack(f.mask)) })
      strips.push({ name: "BAKED LIGHT (PASS 2)", images: frames.map((f) => composeFrame(effect, f, { stage, source: "baked" })) })
    }
    rows.push(...strips)

    if (flag("--sheet")) {
      // An engine sheet: the colour frames in the first row, their light masks in the second.
      const w = effect.width, h = effect.height
      const sheet = blank(w * frames.length, h * 2)
      frames.forEach((f, i) => {
        copyInto(sheet, f.sprite, i * w, 0)
        copyInto(sheet, f.mask, i * w, h)
      })
      writePng(join(out, `${effect.stem}-${seed}.png`), sheet)
      const json = {
        frames: Object.fromEntries(frames.flatMap((f, i) => [
          [`${effect.stem} ${i + 1}`, { frame: { x: i * w, y: 0, w, h }, duration: Math.round(1000 / anim.fps) }],
          [`${effect.stem} light ${i + 1}`, { frame: { x: i * w, y: h, w, h }, duration: Math.round(1000 / anim.fps) }],
        ])),
        meta: {
          app: "iprop-asset-effects", image: `${effect.stem}-${seed}.png`, size: { w: sheet.width, h: sheet.height },
          iprop: { effect: effect.id, seed, frames: anim.frames, fps: anim.fps, loop: anim.loop, pivot: { x: effect.originX, y: effect.originY },
            glow: frames.map((f) => ({ power: +f.glow.power.toFixed(3), sigma: +f.glow.sigma.toFixed(3), blur: +f.glow.blur.toFixed(3) })) },
        },
      }
      writeFileSync(join(out, `${effect.stem}-${seed}.json`), JSON.stringify(json, null, 1))
    }

    if (flag("--gif")) {
      const frameDir = join(scratch, `${effect.stem}-${seed}`)
      mkdirSync(frameDir, { recursive: true })
      lit.forEach((image, i) => {
        const big = blank(image.width * zoom, image.height * zoom)
        blit(big, image, 0, 0, zoom)
        writePng(join(frameDir, `f${String(i).padStart(3, "0")}.png`), big)
      })
      const gif = join(out, `${effect.stem}-${seed}.gif`)
      const made = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(anim.fps), "-i", join(frameDir, "f%03d.png"),
        "-filter_complex", "split[a][b];[a]palettegen=reserve_transparent=0:stats_mode=full[p];[b][p]paletteuse=dither=none", "-loop", "0", gif])
      if (made.status !== 0) console.error(`${effect.id}: no GIF (is ffmpeg installed?) ${made.stderr ?? ""}`)
      rmSync(frameDir, { recursive: true, force: true })
    }
  }
  if (!rows.length) continue

  // The contact sheet: one labelled row per strip, frames left to right.
  const w = effect.width * zoom, h = effect.height * zoom, gap = 2 * zoom, head = 9
  const columns = Math.max(...rows.map((r) => r.images.length))
  const sheet = blank(columns * (w + gap) + gap, rows.length * (h + head + gap) + gap, [24, 22, 28, 255])
  rows.forEach((row, r) => {
    const y = gap + r * (h + head + gap)
    label(sheet, row.name, gap, y + 1, [214, 206, 190, 255])
    row.images.forEach((image, c) => {
      blit(sheet, image, gap + c * (w + gap), y + head, zoom)
      label(sheet, String(c + 1), gap + c * (w + gap) + 2, y + head + 2, [120, 116, 110, 255])
    })
  })
  // Keep the last round's sheet next to the new one, to see whether a fix helped.
  if (existsSync(join(out, "contact.png"))) renameSync(join(out, "contact.png"), join(out, "contact-previous.png"))
  writePng(join(out, "contact.png"), sheet)
  console.log(`  ${join(out, "contact.png")}`)
}
rmSync(scratch, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
