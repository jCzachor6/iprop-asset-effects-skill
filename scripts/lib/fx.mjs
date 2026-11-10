// Compiling, rendering and composing effects with the Infinite Props SDK.
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { decodePng, encodePng } from "./png.mjs"
import { drawText } from "./font.mjs"
import { backdrop, composite, lightFromBaked, lightFromMask } from "./light.mjs"

/** The effect's declared facts, read from its source: name, size, origin, inputs, outputs, header. */
export const readEffect = (file) => {
  const source = readFileSync(file, "utf8")
  const size = source.match(/^\s*size\s+(\d+)\s*[x ]\s*(\d+)/m)
  const origin = source.match(/^\s*origin\s+(-?[\d.]+)\s*,?\s*(-?[\d.]+)/m)
  const asset = source.match(/^\s*asset\s+([A-Za-z_]\w*)/m)
  const inputs = [...source.matchAll(/^\s*input\s+(u32|i32|f32|color)\s+([A-Za-z_]\w*)\s*=\s*([^\s/]+)/gm)].map((m) => ({ type: m[1], name: m[2], value: m[3] }))
  const outputs = [...source.matchAll(/^\s*output\s+(list\s+)?(point|rect|circle|part)\s+([A-Za-z_]\w*)/gm)].map((m) => ({ kind: m[2], name: m[3], list: !!m[1] }))
  const header = []
  for (const line of source.split("\n")) {
    if (!line.startsWith("//")) break
    header.push(line.replace(/^\/\/ ?/, ""))
  }
  const text = header.join("\n")
  const category = text.match(/Category:\s*([\w -]+?)\./)?.[1]?.trim() ?? basename(dirname(file))
  const loop = /\bLoop\b/.test(text.match(/Category:[^\n]*/)?.[0] ?? "")
  const variety = text.match(/^Variety:\s*(\w+)/m)?.[1] ?? null
  return {
    file: resolve(file),
    id: `${basename(dirname(file))}/${basename(file, ".ips")}`,
    stem: basename(file, ".ips"),
    asset: asset?.[1] ?? basename(file, ".ips"),
    width: Number(size?.[1] ?? 0),
    height: Number(size?.[2] ?? 0),
    originX: Number(origin?.[1] ?? 0),
    originY: Number(origin?.[2] ?? 0),
    inputs,
    outputs,
    header: text,
    title: header[0]?.replace(/:.*$/, "").trim() ?? basename(file, ".ips"),
    summary: header[0]?.replace(/^[^:]*:\s*/, "").trim() ?? "",
    category,
    loop,
    variety,
  }
}

/** ipc into `output`: { ok } or { ok: false, error }. */
export const compileEffect = (sdk, file, output) => {
  const full = resolve(file)
  const result = spawnSync(sdk.ipc, [full, "-o", resolve(output)], { cwd: dirname(full), encoding: "utf8" })
  return result.status === 0 ? { ok: true } : { ok: false, error: (result.stderr || result.stdout).trim() }
}

const uniformValue = (value) => (/^-\d+$/.test(String(value)) ? String((Number(value) + 2 ** 32) >>> 0) : String(value))

/**
 * Renders one generation with ipgen, asynchronously: { ok, image, outputs, fuel, budget } or
 * { ok: false, error }. `fuel` is what the generation spent and `budget` what the program allows.
 * `uniforms` is an object { name: value }.
 */
export const generate = (sdk, binary, seed, uniforms = {}, scratch) =>
  new Promise((done) => {
    const png = join(scratch, `${process.pid}-${Math.random().toString(36).slice(2)}.png`)
    const args = [binary, "--seed", String(seed >>> 0), "--omit-part-outputs"]
    for (const [name, value] of Object.entries(uniforms)) args.push("--uniform", `${name}=${uniformValue(value)}`)
    args.push("-o", png)
    const child = spawn(sdk.ipgen, args)
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("close", (status) => {
      if (status !== 0) {
        rmSync(png, { force: true })
        return done({ ok: false, error: (stderr || stdout).trim().replace(/^ipgen:\s*/, "") })
      }
      try {
        const info = JSON.parse(stdout)
        const image = decodePng(readFileSync(png))
        rmSync(png, { force: true })
        const outputs = {}
        for (const slot of info.outputs ?? []) outputs[slot.name] = slot.values?.[0] ?? null
        done({ ok: true, image, outputs, fuel: info.fuel?.spent ?? 0, budget: info.fuel?.budget ?? 0 })
      } catch (error) {
        done({ ok: false, error: String(error.message ?? error) })
      }
    })
  })

/** Runs async jobs with at most `limit` at once, keeping their order. */
export const runAll = async (jobs, limit = 8) => {
  const results = new Array(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++
      results[index] = await jobs[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
  return results
}

export const scratchDir = () => mkdtempSync(join(tmpdir(), "iprop-effects-"))

/** anim output as { frames, fps, loop, frame }. */
export const animOf = (outputs) => {
  const a = outputs?.anim
  return a ? { frames: Math.round(a.x), fps: a.y, loop: a.w >= 0.5, frame: Math.round(a.h) } : null
}

/** glow output as { power, sigma, blur }. */
export const glowOf = (outputs) => {
  const g = outputs?.glow
  return g ? { power: g.x, sigma: g.y, blur: g.r } : { power: 0, sigma: 0, blur: 0 }
}

/**
 * Every frame of one seed: { anim, frames: [{ sprite, mask, baked, glow, fuel }] }, rendering the
 * colour sprite (pass 0), the light mask (pass 1) and, with `baked`, the light under the pixels (pass 2).
 */
export const renderSeed = async (sdk, binary, seed, { uniforms = {}, baked = false, scratch, limit = 8 } = {}) => {
  const probe = await generate(sdk, binary, seed, { ...uniforms, frame: 1 }, scratch)
  if (!probe.ok) return { ok: false, error: `seed ${seed}, frame 1: ${probe.error}` }
  const anim = animOf(probe.outputs)
  if (!anim || anim.frames < 1) return { ok: false, error: `seed ${seed}: no anim output (declare output rect anim)` }
  const jobs = []
  for (let f = 1; f <= anim.frames; f++) {
    const passes = baked ? [0, 1, 2] : [0, 1]
    for (const pass of passes) jobs.push(() => generate(sdk, binary, seed, { ...uniforms, frame: f, renderPass: pass }, scratch))
  }
  const results = await runAll(jobs, limit)
  const frames = []
  const per = baked ? 3 : 2
  for (let f = 0; f < anim.frames; f++) {
    const [sprite, mask, bakedResult] = results.slice(f * per, f * per + per)
    for (const [pass, result] of [[0, sprite], [1, mask], [2, bakedResult]]) {
      if (result && !result.ok) return { ok: false, error: `seed ${seed}, frame ${f + 1}, renderPass ${pass}: ${result.error}` }
    }
    frames.push({
      sprite: sprite.image,
      mask: mask.image,
      baked: bakedResult?.image ?? null,
      glow: glowOf(sprite.outputs),
      anim: animOf(sprite.outputs),
      fuel: Math.max(sprite.fuel, mask.fuel, bakedResult?.fuel ?? 0),
      fuelBaked: bakedResult?.fuel ?? 0,
    })
  }
  return { ok: true, seed, anim, frames }
}

/** One composed frame (8-bit RGBA image): stage, light from the mask (or the baked pass), sprite. */
export const composeFrame = (effect, frame, { stage = "night", source = "mask", lightK = 1, scaleGlow = {} } = {}) => {
  const w = frame.sprite.width, h = frame.sprite.height
  const bg = stage === "none" ? null : backdrop(w, h, Math.round(effect.originY), stage)
  let light = null
  if (source === "baked" && frame.baked) light = lightFromBaked(frame.baked.rgba, w, h)
  else if (source === "mask") {
    const g = frame.glow
    light = lightFromMask(frame.mask.rgba, w, h, g.power * (scaleGlow.power ?? 1), g.sigma * (scaleGlow.sigma ?? 1), g.blur * (scaleGlow.blur ?? 1))
  }
  const out = new Uint8ClampedArray(w * h * 4)
  composite(out, w, h, bg, light, frame.sprite.rgba, lightK)
  return { width: w, height: h, rgba: Buffer.from(out.buffer) }
}

/** A blank image filled with one colour. */
export const blank = (width, height, [r, g, b, a] = [0, 0, 0, 0]) => {
  const rgba = Buffer.alloc(width * height * 4)
  if (r || g || b || a) for (let i = 0; i < width * height; i++) rgba.set([r, g, b, a], i * 4)
  return { width, height, rgba }
}

/** Copies `src` into `dst` at (x, y), scaled by an integer `zoom` (nearest neighbour), alpha over. */
export const blit = (dst, src, x, y, zoom = 1) => {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const s = (sy * src.width + sx) * 4
      const a = src.rgba[s + 3]
      if (!a) continue
      for (let dy = 0; dy < zoom; dy++) {
        const ty = y + sy * zoom + dy
        if (ty < 0 || ty >= dst.height) continue
        for (let dx = 0; dx < zoom; dx++) {
          const tx = x + sx * zoom + dx
          if (tx < 0 || tx >= dst.width) continue
          const d = (ty * dst.width + tx) * 4
          if (a === 255) {
            dst.rgba[d] = src.rgba[s]; dst.rgba[d + 1] = src.rgba[s + 1]; dst.rgba[d + 2] = src.rgba[s + 2]; dst.rgba[d + 3] = 255
          } else {
            const k = a / 255
            for (let c = 0; c < 3; c++) dst.rgba[d + c] = Math.round(src.rgba[s + c] * k + dst.rgba[d + c] * (1 - k))
            dst.rgba[d + 3] = Math.max(dst.rgba[d + 3], a)
          }
        }
      }
    }
  }
}

/** Copies `src` into `dst` at (x, y) byte for byte: straight alpha kept exactly, translucent pixels too.
 *  Use it to pack frames into sheets and strips; `blit` composites, which darkens translucent pixels. */
export const copyInto = (dst, src, x, y) => {
  for (let sy = 0; sy < src.height; sy++) {
    const from = sy * src.width * 4
    src.rgba.copy(dst.rgba, ((y + sy) * dst.width + x) * 4, from, from + src.width * 4)
  }
}

/** A transparent image shown on a checker, so empty and translucent pixels read in a sheet. */
export const onChecker = (image, size = 4) => {
  const out = blank(image.width, image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const v = (Math.floor(x / size) + Math.floor(y / size)) % 2 ? 44 : 36
      out.rgba.set([v, v, v + 6, 255], (y * image.width + x) * 4)
    }
  }
  blit(out, image, 0, 0, 1)
  return out
}

/** A light mask shown over black, so its colour and strength read. */
export const onBlack = (image) => {
  const out = blank(image.width, image.height, [0, 0, 0, 255])
  blit(out, image, 0, 0, 1)
  return out
}

export const label = (image, text, x, y, colour = [220, 214, 200, 255], scale = 1) => drawText(image, text, x, y, colour, scale)

export const writePng = (path, image) => writeFileSync(path, encodePng(image))
