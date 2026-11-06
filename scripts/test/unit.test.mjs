// Unit tests: seeds and inputs on the command line, the scaffold and its argument checks, the header
// reader, the static contract of every shipped effect, the outputs, the light model and PNG. No SDK
// needed.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { effectsIn, parsePairs, parseSeeds } from "../lib/cli.mjs"
import { animOf, glowOf, readEffect } from "../lib/fx.mjs"
import { lightFromMask } from "../lib/light.mjs"
import { createImage, decodePng, encodePng, pixelHash } from "../lib/png.mjs"

const skill = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CONTRACT_INPUTS = { frame: "u32", frames: "u32", renderPass: "u32", power: "f32", sigma: "f32", blur: "f32", tint: "color" }
const newFx = (cwd, ...args) => spawnSync(process.execPath, [join(skill, "scripts", "new-fx.mjs"), ...args], { cwd, encoding: "utf8" })
const withDir = (body) => {
  const dir = mkdtempSync(join(tmpdir(), "iprop-effects-test-"))
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("seed lists and input pairs", () => {
  assert.deepEqual(parseSeeds("1-4"), [1, 2, 3, 4])
  assert.deepEqual(parseSeeds("3, 7,10-11"), [3, 7, 10, 11])
  assert.throws(() => parseSeeds("1-4,x"), /not a seed/)
  assert.throws(() => parseSeeds(""), /no seeds/)
  assert.deepEqual(parsePairs(["tint=#40c0ff", "style=2", "note=a=b"]), { tint: "#40c0ff", style: "2", note: "a=b" })
  assert.throws(() => parsePairs(["=3"]), /name=value/)
})

test("new-fx writes a one-shot and a loop that keep the contract", () => withDir((dir) => {
  assert.equal(newFx(dir, "fx/arcane", "--name", "rune-trap", "--size", "112x96", "--frames", "24-36", "--duration", "1.2-1.5", "--variety", "high").status, 0)
  assert.equal(newFx(dir, "fx", "--name", "torch", "--category", "fire", "--loop", "--size", "48x80", "--origin", "24,76", "--frames", "12-24", "--fps", "15-18").status, 0)
  const trap = readEffect(join(dir, "fx", "arcane", "rune-trap.ips"))
  assert.equal(trap.asset, "RuneTrap")
  assert.deepEqual([trap.width, trap.height, trap.originX, trap.originY], [112, 96, 56, 84])
  assert.deepEqual([trap.category, trap.loop, trap.variety, trap.title], ["arcane", false, "high", "Rune trap"])
  assert.match(trap.header, /rolls 24-36 frames over 1\.2-1\.5 s/)
  const torch = readEffect(join(dir, "fx", "torch.ips"))
  assert.deepEqual([torch.width, torch.height, torch.originX, torch.originY], [48, 80, 24, 76])
  assert.deepEqual([torch.category, torch.loop, torch.variety], ["fire", true, "medium"])
  assert.match(torch.header, /rolls 12, 18 or 24 frames at 15\.0-18\.0 fps/)
  for (const effect of [trap, torch]) {
    const source = readFileSync(effect.file, "utf8")
    assert.doesNotMatch(source, /__[A-Z_]+__/)
    assert.deepEqual(Object.fromEntries(effect.inputs.map((input) => [input.name, input.type])), CONTRACT_INPUTS)
    assert.deepEqual(effect.outputs.map((output) => `${output.kind} ${output.name}`), ["rect anim", "circle glow"])
  }
  assert.match(readFileSync(torch.file, "utf8"), /rolled = pick\(12, 18, 24\)\n\s+rate = 15\.0 to 18\.0/)
}))

test("new-fx refuses what it cannot make", () => withDir((dir) => {
  assert.equal(newFx(dir, "fx", "--name", "spark").status, 0)
  const refused = (args, message) => {
    const result = newFx(dir, ...args)
    assert.equal(result.status, 2, args.join(" "))
    assert.match(result.stderr, message, args.join(" "))
  }
  refused(["fx", "--name", "spark"], /exists/)
  refused(["fx", "--name", "Spark_2"], /kebab-case/)
  refused(["fx", "--name", "glow", "--variety", "huge"], /--variety/)
  refused(["fx", "--name", "glow", "--loop", "--duration", "1-2"], /a loop takes --fps/)
  refused(["fx", "--name", "glow", "--fps", "12"], /a one-shot takes --duration/)
  refused(["fx", "--name", "glow", "--frames", "1-80"], /--frames/)
  refused(["fx", "--name", "glow", "--size", "96x96", "--origin", "100,40"], /outside/)
  refused(["fx", "--name", "glow", "--colour", "red"], /unknown option --colour/)
  refused(["My Effects", "--name", "glow"], /--category/)
  assert.equal(newFx(dir, "fx", "--name", "spark", "--force").status, 0)
}))

test("every shipped effect declares the contract and ships its .iprop", () => {
  const effects = effectsIn(join(skill, "examples"))
  assert.ok(effects.length >= 10, `only ${effects.length} effects`)
  for (const file of effects) {
    const effect = readEffect(file)
    const inputs = Object.fromEntries(effect.inputs.map((input) => [input.name, input.type]))
    for (const [name, type] of Object.entries(CONTRACT_INPUTS)) assert.equal(inputs[name], type, `${effect.id}: input ${name}`)
    const outputs = effect.outputs.map((output) => `${output.kind} ${output.name}`)
    assert.ok(outputs.includes("rect anim") && outputs.includes("circle glow"), `${effect.id}: outputs ${outputs}`)
    assert.match(effect.header, /Category: [\w -]+\. (One-shot|Loop)\./, `${effect.id}: Category line`)
    assert.ok(["low", "medium", "high", "extreme"].includes(effect.variety), `${effect.id}: Variety ${effect.variety}`)
    assert.ok(effect.width > 0 && effect.height > 0, `${effect.id}: size`)
    assert.ok(existsSync(file.replace(/\.ips$/, ".iprop")), `${effect.id}: no .iprop`)
  }
})

test("anim and glow outputs read as the contract says", () => {
  assert.deepEqual(animOf({ anim: { x: 24, y: 18.5, w: 1, h: 3 } }), { frames: 24, fps: 18.5, loop: true, frame: 3 })
  assert.deepEqual(animOf({ anim: { x: 12, y: 20, w: 0, h: 0 } }), { frames: 12, fps: 20, loop: false, frame: 0 })
  assert.equal(animOf({}), null)
  assert.deepEqual(glowOf({ glow: { x: 2.5, y: 9, r: 1.5 } }), { power: 2.5, sigma: 9, blur: 1.5 })
  assert.deepEqual(glowOf({}), { power: 0, sigma: 0, blur: 0 })
})

test("the light model: no power, no light; one glowing pixel lights its surroundings evenly", () => {
  const image = createImage(21, 21)
  image.rgba.set([255, 160, 40, 255], (10 * 21 + 10) * 4)
  assert.ok(lightFromMask(image.rgba, 21, 21, 0, 4, 1).every((value) => value === 0))
  const light = lightFromMask(image.rgba, 21, 21, 3, 4, 1)
  const alpha = (x, y) => light[(y * 21 + x) * 4 + 3]
  assert.ok(alpha(10, 10) > alpha(13, 10) && alpha(13, 10) > alpha(17, 10) && alpha(17, 10) > 0)
  assert.ok(Math.abs(alpha(13, 10) - alpha(7, 10)) < 1e-6 && Math.abs(alpha(10, 13) - alpha(10, 7)) < 1e-6)
  assert.ok(light.every((value) => value >= 0 && value <= 1))
})

test("PNG round trip keeps every pixel", () => {
  const image = createImage(9, 5)
  for (let i = 0; i < 9 * 5; i++) image.rgba.set([i * 5, 255 - i * 5, i % 7 * 30, i % 3 ? 255 : 90], i * 4)
  const back = decodePng(encodePng(image))
  assert.deepEqual([back.width, back.height], [9, 5])
  assert.equal(pixelHash(back), pixelHash(image))
})
