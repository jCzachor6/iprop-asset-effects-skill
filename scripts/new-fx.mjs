#!/usr/bin/env node
// Starts a new effect from the skill's templates. The result compiles, keeps the effect contract and
// passes check-fx; replace its placeholder `scene` with the effect and keep the rest.
// Usage: node new-fx.mjs <dir> --name rune-trap [--category arcane] [--loop] [--size 96x96]
//          [--origin 48,84] [--frames 15-24] [--duration 0.8-1.1 | --fps 16.5-19.5]
//          [--variety low|medium|high|extreme] [--force]
// Writes <dir>/<name>.ips. The category defaults to the folder's name. A one-shot rolls a frame count
// in --frames over a duration in --duration (seconds); a loop rolls one of three counts from --frames
// (12-24 gives 12, 18 or 24) and plays it at a rate in --fps.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { fail, parseArgs } from "./lib/cli.mjs"

const USAGE = "Usage: node new-fx.mjs <dir> --name rune-trap [--category arcane] [--loop] [--size 96x96] [--origin 48,84] [--frames 15-24] [--duration 0.8-1.1 | --fps 16.5-19.5] [--variety low|medium|high|extreme] [--force]"
const LEVELS = ["low", "medium", "high", "extreme"]
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const cli = parseArgs(process.argv.slice(2), {
  valued: ["--name", "--category", "--size", "--origin", "--frames", "--duration", "--fps", "--variety"],
  flags: ["--loop", "--force"],
  usage: USAGE,
})
const [parent] = cli.positionals
const name = cli.option("--name")
if (!parent || !name || cli.positionals.length > 1) fail(USAGE)
if (!KEBAB.test(name)) fail(`--name is the effect's name in kebab-case, such as rune-trap or frost-nova (got "${name}")`)
const category = cli.option("--category") ?? basename(resolve(parent)).toLowerCase()
if (!KEBAB.test(category)) fail(`--category is a kebab-case word such as arcane or fire; "${category}" (the folder's name) is not: pass --category`)
const loop = cli.flag("--loop")
if (loop && cli.option("--duration")) fail("--duration is for one-shots; a loop takes --fps")
if (!loop && cli.option("--fps")) fail("--fps is for loops; a one-shot takes --duration")

const size = cli.option("--size", "96x96").match(/^(\d+)x(\d+)$/)
if (!size) fail("--size is WIDTHxHEIGHT, such as 96x96")
const [w, h] = [Number(size[1]), Number(size[2])]
if (w < 16 || h < 16 || w > 512 || h > 512) fail("--size takes 16 to 512 pixels a side")
const origin = cli.option("--origin", `${Math.round(w / 2)},${h - 12}`).match(/^(\d+),(\d+)$/)
if (!origin) fail("--origin is X,Y in pixels, such as 48,84: the floor under a ground effect, the head of a projectile")
const [ox, oy] = [Number(origin[1]), Number(origin[2])]
if (ox >= w || oy >= h) fail(`--origin ${ox},${oy} is outside the ${w}x${h} canvas`)

const range = (option, fallback, test, what) => {
  const text = cli.option(option, fallback)
  const match = text.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/) ?? text.match(/^(\d+(?:\.\d+)?)()$/)
  const lo = Number(match?.[1])
  const hi = match?.[2] ? Number(match[2]) : lo
  if (!match || !(lo <= hi) || !test(lo) || !test(hi)) fail(`${option} is ${what} (got "${text}")`)
  return [lo, hi]
}
const [flo, fhi] = range("--frames", loop ? "12-24" : "15-24", (n) => Number.isInteger(n) && n >= 2 && n <= 64, "a frame count or a range of them in 2..64, such as 15-24")
const decimal = (n) => (Number.isInteger(n) ? `${n}.0` : String(n))
const variety = cli.option("--variety", "medium")
if (!LEVELS.includes(variety)) fail(`--variety is one of ${LEVELS.join(", ")}`)

const words = name.split("-")
const values = {
  __TITLE__: [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" "),
  __ASSET__: words.map((word) => word[0].toUpperCase() + word.slice(1)).join(""),
  __CATEGORY__: category,
  __W__: w, __H__: h, __OX__: ox, __OY__: oy,
  __ORIGIN_NOTE__: oy >= h - 16 ? "the floor under the effect" : "the effect's heart",
  __VARIETY__: variety,
}
if (loop) {
  const [rlo, rhi] = range("--fps", "16.5-19.5", (n) => n >= 4 && n <= 60, "a frame rate or a range of them in 4..60, such as 16.5-19.5")
  const counts = [...new Set([flo, Math.round((flo + fhi) / 2), fhi])]
  Object.assign(values, {
    __FRAMES_ROLL__: counts.length === 1 ? String(flo) : `pick(${counts.join(", ")})`,
    __FRAMES_TEXT__: counts.length === 1 ? String(flo) : `${counts.slice(0, -1).join(", ")} or ${counts.at(-1)}`,
    __RLO__: decimal(rlo), __RHI__: decimal(rhi),
  })
} else {
  const [dlo, dhi] = range("--duration", "0.8-1.1", (n) => n > 0 && n <= 10, "a duration in seconds or a range of them, such as 0.8-1.1")
  Object.assign(values, { __FLO__: flo, __FHI__: fhi, __DLO__: decimal(dlo), __DHI__: decimal(dhi) })
}

const here = dirname(fileURLToPath(import.meta.url))
let text = readFileSync(join(here, "..", "templates", loop ? "loop.ips" : "oneshot.ips"), "utf8")
for (const [key, value] of Object.entries(values)) text = text.replaceAll(key, String(value))
const left = text.match(/__[A-Z_]+__/)
if (left) fail(`template placeholder ${left[0]} was not filled: the templates and new-fx.mjs disagree`)

const out = resolve(parent, `${name}.ips`)
if (existsSync(out) && !cli.flag("--force")) fail(`${out} exists; choose another name or add --force`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, text)
const shown = relative(process.cwd(), out).startsWith("..") ? out : relative(process.cwd(), out)
console.log(`wrote ${shown} (${loop ? "loop" : "one-shot"}, ${w}x${h}, origin ${ox},${oy}, variety ${variety})`)
console.log(`next: node ${join(here, "render-fx.mjs")} ${shown} --layers`)
console.log(`      node ${join(here, "check-fx.mjs")} ${shown}`)
