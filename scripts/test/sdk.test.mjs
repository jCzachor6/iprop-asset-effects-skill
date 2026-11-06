// Integration tests with the SDK: skipped unless the SDK is already available (IPROP_SDK or the
// cache). Run `node scripts/sdk.mjs` once to download it.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { effectsIn } from "../lib/cli.mjs"
import { compileEffect, readEffect } from "../lib/fx.mjs"
import { decodePng } from "../lib/png.mjs"
import { findSdk } from "../lib/sdk.mjs"

const skill = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
let sdk = null
try {
  sdk = findSdk(undefined, { fetch: false })
} catch {}
const options = { skip: sdk ? false : "no Infinite Props SDK in IPROP_SDK or the cache (run node scripts/sdk.mjs)" }

const run = (script, args, cwd = skill) => spawnSync(process.execPath, [join(skill, "scripts", script), ...args], { cwd, encoding: "utf8", maxBuffer: 64 << 20 })
const check = (target, extra = []) => {
  const result = run("check-fx.mjs", [target, "--json", ...extra])
  assert.ok(result.stdout, result.stderr)
  return { status: result.status, report: JSON.parse(result.stdout) }
}
const withDir = (body) => {
  const dir = mkdtempSync(join(tmpdir(), "iprop-effects-test-"))
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const summary = (effect) => `${effect.id} ${effect.status}: ${[...effect.fails, ...effect.warns].join("; ")}`

test("new-fx skeletons pass check-fx with no warnings", options, () => withDir((dir) => {
  assert.equal(run("new-fx.mjs", ["fx", "--name", "rune-trap", "--category", "arcane", "--size", "112x96", "--frames", "24-36", "--duration", "1.2-1.5"], dir).status, 0)
  assert.equal(run("new-fx.mjs", ["fx", "--name", "torch", "--category", "fire", "--loop", "--size", "48x80", "--frames", "12-24", "--fps", "15-18"], dir).status, 0)
  const { status, report } = check(join(dir, "fx"), ["--seeds", "1-3", "--variety", "1-12"])
  assert.equal(status, 0)
  assert.equal(report.effects.length, 2)
  for (const effect of report.effects) assert.equal(effect.status, "PASS", summary(effect))
}))

test("every shipped .iprop is compiled from its source", options, () => withDir((dir) => {
  for (const file of effectsIn(join(skill, "examples"))) {
    const out = join(dir, "x.iprop")
    const compiled = compileEffect(sdk, file, out)
    assert.ok(compiled.ok, `${file}: ${compiled.error}`)
    assert.ok(readFileSync(out).equals(readFileSync(file.replace(/\.ips$/, ".iprop"))), `${readEffect(file).id}: the .iprop is stale; run check-fx.mjs examples --emit`)
  }
}))

test("every shipped effect passes check-fx", options, () => {
  const { status, report } = check(join(skill, "examples"), ["--seeds", "1", "--variety", "1-8"])
  assert.equal(status, 0)
  for (const effect of report.effects) assert.equal(effect.status, "PASS", summary(effect))
})

test("render-fx writes engine sheets with the forced frame count", options, () => withDir((dir) => {
  const result = run("render-fx.mjs", [join(skill, "examples", "impacts", "hit-spark.ips"), "--seeds", "2", "--frames", "8", "--sheet", "--uniform", "tint=#40c0ff"], dir)
  assert.equal(result.status, 0, result.stderr)
  const out = join(dir, "out", "hit-spark")
  for (const name of ["contact.png", "hit-spark-2.png", "hit-spark-2.json"]) assert.ok(existsSync(join(out, name)), name)
  const sheet = decodePng(readFileSync(join(out, "hit-spark-2.png")))
  const meta = JSON.parse(readFileSync(join(out, "hit-spark-2.json"), "utf8"))
  assert.equal(meta.meta.iprop.frames, 8)
  assert.equal(Object.keys(meta.frames).length, 16)
  assert.deepEqual([sheet.width, sheet.height], [8 * 112, 2 * 80])
}))

test("the lightning's lightColor recolours the light and leaves the bolt alone", options, () => withDir((dir) => {
  const binary = join(dir, "lightning.iprop")
  assert.ok(compileEffect(sdk, join(skill, "examples", "lightning", "lightning-strike.ips"), binary).ok)
  const render = (pass, extra = []) => {
    const png = join(dir, "frame.png")
    const result = spawnSync(sdk.ipgen, [binary, "--seed", "2", "--uniform", `renderPass=${pass}`, ...extra, "-o", png], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return readFileSync(png)
  }
  const amber = ["--uniform", "lightColor=#ffb030"]
  assert.ok(render(0).equals(render(0, amber)), "the sprite changed")
  assert.ok(!render(1).equals(render(1, amber)), "the light mask did not change")
}))

test("the broken torch of the fix eval still shows its seam", options, () => {
  // evals/fix-torch-loop asks for this seam to be fixed: the check must keep seeing it.
  const { status, report } = check(join(skill, "evals", "fix-torch-loop", "files", "torch", "torch.ips"), ["--variety", "1-8"])
  assert.equal(status, 0)
  assert.equal(report.effects[0].status, "WARN")
  assert.ok(report.effects[0].warns.some((warn) => /loop seam/.test(warn)), summary(report.effects[0]))
})
