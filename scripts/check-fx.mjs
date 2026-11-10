#!/usr/bin/env node
// Checks effects against the effect contract (references/contract.md): they compile, every frame of
// every pass renders without a trap and within the fuel budget, the outputs say what the game needs,
// one-shots end empty, loops have no seam, the inputs do what they say, and seeds differ.
//
// Usage: node check-fx.mjs <effect.ips | folder> [--seeds 1-6] [--variety 1-48] [--fuel-warn 3500000]
//          [--emit] [--json]
//   --fuel-warn  the most fuel one frame of one pass may spend before the check warns. It is the
//                skill's own bar, far below the program's budget (25,000,000 by default since
//                Infinite Props 1.0): a game renders dozens of frames per effect
//   --emit   write <name>.iprop next to each <name>.ips that does not fail, ready for a game
//   --json   print one JSON report instead of the text
// Prints PASS, WARN or FAIL per effect. Exits with 1 when any effect fails (warnings do not fail), with 2
// on a mistake on the command line or a missing SDK.
import { copyFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { effectsIn, fail, parseArgs, seedsOption } from "./lib/cli.mjs"
import { requireSdk } from "./lib/sdk.mjs"
import { animOf, compileEffect, generate, glowOf, readEffect, runAll, scratchDir } from "./lib/fx.mjs"

const USAGE = "Usage: node check-fx.mjs <effect.ips | folder> [--seeds 1-6] [--variety 1-48] [--fuel-warn 3500000] [--emit] [--json]"
const LEVELS = ["low", "medium", "high", "extreme"]
const cli = parseArgs(process.argv.slice(2), { valued: ["--seeds", "--variety", "--fuel-warn"], flags: ["--emit", "--json"], usage: USAGE })
const [target] = cli.positionals
if (!target || cli.positionals.length > 1) fail(USAGE)
if (!existsSync(target)) fail(`${target} does not exist`)
const json = cli.flag("--json")
const seeds = seedsOption(cli.option("--seeds", "1-6"), USAGE)
const varietySeeds = seedsOption(cli.option("--variety", "1-48"), USAGE)
const fuelWarn = Number(cli.option("--fuel-warn", "3500000"))
const files = effectsIn(target)
if (!files.length) fail(`no .ips effects in ${target}`)
const sdk = requireSdk()
const scratch = scratchDir()
const say = (text) => json || console.log(text)

const digest = (image) => createHash("sha1").update(image.rgba).digest("hex")
const coverage = (image) => {
  let n = 0
  for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] > 8) n++
  return n
}
const difference = (a, b) => {
  let d = 0
  for (let i = 0; i < a.rgba.length; i++) d += Math.abs(a.rgba[i] - b.rgba[i])
  return d / (a.width * a.height)
}
// Opaque-ish pixels on each edge of the canvas: { top, bottom, left, right, total }.
const edges = (image) => {
  const { width: w, height: h, rgba } = image
  const e = { top: 0, bottom: 0, left: 0, right: 0 }
  for (let x = 0; x < w; x++) {
    if (rgba[x * 4 + 3] > 24) e.top++
    if (rgba[((h - 1) * w + x) * 4 + 3] > 24) e.bottom++
  }
  for (let y = 0; y < h; y++) {
    if (rgba[y * w * 4 + 3] > 24) e.left++
    if (rgba[(y * w + w - 1) * 4 + 3] > 24) e.right++
  }
  e.total = e.top + e.bottom + e.left + e.right
  return e
}
const edgeAlpha = (image) => edges(image).total
const edgeText = (frames) => {
  const sum = { top: 0, bottom: 0, left: 0, right: 0 }
  for (const image of frames) {
    const e = edges(image)
    for (const k of Object.keys(sum)) sum[k] = Math.max(sum[k], e[k])
  }
  return Object.entries(sum).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")
}

const report = { sdk: { version: sdk.version, dir: sdk.dir }, target, effects: [] }
for (const file of files) report.effects.push(await checkEffect(file))
rmSync(scratch, { recursive: true, force: true })
const failed = report.effects.filter((effect) => effect.status === "FAIL").length
report.failed = failed
if (json) console.log(JSON.stringify(report, null, 2))
process.exit(failed ? 1 : 0)

async function checkEffect(file) {
  const effect = readEffect(file)
  const fails = [], warns = [], notes = []
  const result = { id: effect.id, file, loop: effect.loop, width: effect.width, height: effect.height, variety: effect.variety }
  const finish = (status) => {
    Object.assign(result, { status, fails: [...new Set(fails)], warns: [...new Set(warns)], notes })
    if (status === "FAIL" && !notes.length) say(`FAIL ${effect.id}`)
    else say(`${status} ${effect.id} (${effect.loop ? "loop" : "one-shot"}, ${effect.width}x${effect.height}): ${notes.join("; ")}`)
    for (const message of result.fails.slice(0, 12)) say(`  fail: ${message}`)
    for (const message of result.warns.slice(0, 12)) say(`  warn: ${message}`)
    return result
  }
  const binary = join(scratch, `${effect.stem}.iprop`)
  const compiled = compileEffect(sdk, file, binary)
  if (!compiled.ok) {
    fails.push(`does not compile\n${compiled.error}`)
    return finish("FAIL")
  }

  // The contract's declarations.
  const inputs = new Map(effect.inputs.map((i) => [i.name, i]))
  for (const [name, type] of [["frame", "u32"], ["frames", "u32"], ["renderPass", "u32"], ["power", "f32"], ["sigma", "f32"], ["blur", "f32"]]) {
    if (!inputs.has(name)) fails.push(`input ${type} ${name} is missing`)
    else if (inputs.get(name).type !== type) fails.push(`input ${name} is ${inputs.get(name).type}, the contract says ${type}`)
  }
  const outputs = new Map(effect.outputs.map((o) => [o.name, o]))
  if (outputs.get("anim")?.kind !== "rect") fails.push("output rect anim is missing")
  if (outputs.get("glow")?.kind !== "circle") fails.push("output circle glow is missing")
  if (!/Category:/.test(effect.header)) warns.push("the header has no `Category: <name>. One-shot|Loop.` line")
  if (!effect.variety) warns.push("the header has no `Variety:` line")
  else if (!LEVELS.includes(effect.variety)) warns.push(`the header's Variety is "${effect.variety}", not one of ${LEVELS.join(", ")}`)

  // Every frame of a few seeds, every pass.
  const peakFuel = [0, 0, 0], frameCounts = []
  let budget = 0
  for (const seed of seeds) {
    const first = await generate(sdk, binary, seed, { frame: 1 }, scratch)
    if (!first.ok) { fails.push(`seed ${seed} frame 1 traps: ${first.error}`); continue }
    budget = first.budget
    const anim = animOf(first.outputs)
    if (!anim) { fails.push(`seed ${seed}: anim output not written`); continue }
    frameCounts.push(anim.frames)
    if (anim.frames < 2 || anim.frames > 64) { fails.push(`seed ${seed}: anim says ${anim.frames} frames (2..64)`); continue }
    if (!(anim.fps >= 4 && anim.fps <= 60)) warns.push(`seed ${seed}: ${anim.fps.toFixed(1)} fps is outside 4..60`)
    if (anim.loop !== effect.loop) warns.push(`seed ${seed}: anim says ${anim.loop ? "loop" : "one-shot"}, the header says ${effect.loop ? "Loop" : "One-shot"}`)
    const jobs = []
    for (let f = 1; f <= anim.frames + 1; f++) for (const pass of [0, 1, 2]) jobs.push(() => generate(sdk, binary, seed, { frame: f, renderPass: pass }, scratch))
    const results = await runAll(jobs, 8)
    const frames = []
    for (let f = 1; f <= anim.frames + 1; f++) {
      const [c, m, b] = results.slice((f - 1) * 3, f * 3)
      for (const [pass, r] of [[0, c], [1, m], [2, b]]) {
        if (!r.ok) fails.push(`seed ${seed} frame ${f} renderPass ${pass} traps: ${r.error}`)
        else peakFuel[pass] = Math.max(peakFuel[pass], r.fuel)
      }
      if (c.ok && m.ok && b.ok) frames.push({ c: c.image, m: m.image, b: b.image, glow: glowOf(c.outputs), anim: animOf(c.outputs) })
    }
    if (frames.length !== anim.frames + 1) continue
    const real = frames.slice(0, anim.frames), after = frames[anim.frames]
    real.forEach((fr, i) => {
      const g = fr.glow
      if (!(g.power >= 0 && g.power <= 16) || !(g.sigma >= 0 && g.sigma <= 24) || !(g.blur >= 0 && g.blur <= 8)) fails.push(`seed ${seed} frame ${i + 1}: glow out of range (${g.power}, ${g.sigma}, ${g.blur})`)
      if (g.power > 0.05 && coverage(fr.m) === 0) warns.push(`seed ${seed} frame ${i + 1}: power ${g.power.toFixed(2)} but the light mask is empty`)
      if (coverage(fr.c) === 0 && !(i === 0 || i === anim.frames - 1)) warns.push(`seed ${seed} frame ${i + 1}: the sprite is empty mid-animation`)
      if (fr.anim?.frame !== i + 1) fails.push(`seed ${seed} frame ${i + 1}: anim reports frame ${fr.anim?.frame}`)
    })
    if (effect.loop) {
      if (digest(after.c) !== digest(real[0].c)) fails.push(`seed ${seed}: frame ${anim.frames + 1} is not frame 1 (a loop wraps)`)
      const steps = real.slice(1).map((fr, i) => difference(real[i].c, fr.c))
      const seam = difference(real.at(-1).c, real[0].c)
      const typical = steps.slice().sort((a, b) => a - b)[Math.floor(steps.length / 2)] || 0
      if (typical > 0 && seam > typical * 2.5 + 1) warns.push(`seed ${seed}: the loop seam (frame ${anim.frames} to 1) changes ${(seam / typical).toFixed(1)}x a typical step`)
    } else {
      if (coverage(after.c) || coverage(after.m) || coverage(after.b)) fails.push(`seed ${seed}: frame ${anim.frames + 1} (after the end) is not empty`)
      if (after.anim?.frame !== 0) fails.push(`seed ${seed}: after the end anim.frame should be 0, got ${after.anim?.frame}`)
      const peak = Math.max(...real.map((fr) => coverage(fr.c)))
      const last = coverage(real.at(-1).c)
      if (peak && last > peak * 0.3) warns.push(`seed ${seed}: the last frame still covers ${Math.round((100 * last) / peak)}% of the peak (a one-shot should fade out)`)
    }
    const spill = Math.max(...real.map((fr) => edgeAlpha(fr.c)))
    if (spill > 6) warns.push(`seed ${seed}: the sprite touches the canvas edge (${edgeText(real.map((fr) => fr.c))} px)`)
    const lightSpill = Math.max(...real.map((fr) => edgeAlpha(fr.b)))
    if (lightSpill > effect.width) warns.push(`seed ${seed}: the baked light is cut by the canvas edge (${lightSpill} px): leave 3 sigma of room`)
  }

  // The inputs do what they say.
  const seed = seeds[0]
  const forced = await generate(sdk, binary, seed, { frame: 2, frames: 24, power: 3.25, sigma: 5.5, blur: 2.25 }, scratch)
  if (!forced.ok) fails.push(`frames=24 power=3.25 traps: ${forced.error}`)
  else {
    const a = animOf(forced.outputs), g = glowOf(forced.outputs)
    if (a?.frames !== 24) fails.push(`frames=24 gives anim.frames ${a?.frames}`)
    if (Math.abs(g.power - 3.25) > 1e-3 || Math.abs(g.sigma - 5.5) > 1e-3 || Math.abs(g.blur - 2.25) > 1e-3) fails.push(`forced power/sigma/blur come back as ${g.power}/${g.sigma}/${g.blur}`)
  }
  const six = await generate(sdk, binary, seed, { frame: 6, frames: 6 }, scratch)
  if (!six.ok) fails.push(`frames=6 frame 6 traps: ${six.error}`)
  const again = await generate(sdk, binary, seed, { frame: 2 }, scratch)
  const twice = await generate(sdk, binary, seed, { frame: 2 }, scratch)
  if (again.ok && twice.ok && digest(again.image) !== digest(twice.image)) fails.push("the same seed and frame render differently (unseeded randomness)")
  const heavy = await generate(sdk, binary, seed, { frame: 0, renderPass: 2, power: 16, sigma: 24, blur: 8 }, scratch)
  if (!heavy.ok) fails.push(`renderPass 2 at power 16, sigma 24, blur 8 traps (clamp sigma to keep the fuel): ${heavy.error}`)
  else peakFuel[2] = Math.max(peakFuel[2], heavy.fuel)

  // Seeds differ: the hero frames of many seeds.
  const heroes = await runAll(varietySeeds.map((s) => () => generate(sdk, binary, s, {}, scratch)), 8)
  const traps = heroes.filter((r) => !r.ok)
  if (traps.length) fails.push(`${traps.length} of ${heroes.length} hero frames trap: ${traps[0].error}`)
  const unique = new Set(heroes.filter((r) => r.ok).map((r) => digest(r.image))).size
  const empties = heroes.filter((r) => r.ok && coverage(r.image) === 0).length
  if (empties) fails.push(`${empties} hero frames are empty`)
  if (unique < heroes.length * 0.9) warns.push(`only ${unique} of ${heroes.length} hero frames differ`)

  for (const [pass, fuel] of peakFuel.entries()) {
    if (fuel > fuelWarn) warns.push(`renderPass ${pass} peaks at ${fuel.toLocaleString("en")} fuel: keep a frame under ${fuelWarn.toLocaleString("en")}${budget ? ` (the budget is ${budget.toLocaleString("en")})` : ""}`)
  }
  if (frameCounts.length) notes.push(`frames ${Math.min(...frameCounts)}-${Math.max(...frameCounts)}`)
  notes.push(`heroes ${unique}/${heroes.length} distinct`, `peak fuel ${peakFuel.map((f) => f.toLocaleString("en")).join(" / ")} (sprite / mask / baked)`)
  Object.assign(result, {
    frames: frameCounts.length ? [Math.min(...frameCounts), Math.max(...frameCounts)] : null,
    heroes: { distinct: unique, total: heroes.length },
    fuel: { sprite: peakFuel[0], mask: peakFuel[1], baked: peakFuel[2], budget },
  })
  if (!fails.length && cli.flag("--emit")) {
    copyFileSync(binary, file.replace(/\.ips$/, ".iprop"))
    notes.push(`wrote ${effect.stem}.iprop`)
    result.emitted = file.replace(/\.ips$/, ".iprop")
  }
  return finish(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS")
}
