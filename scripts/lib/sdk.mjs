// The Infinite Props SDK the scripts compile and render with: IPROP_SDK (an unpacked SDK folder) when
// it is set, then the cache, and otherwise the GitHub release, downloaded into the cache and checked
// against the release's SHA256SUMS.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

// The release the skill is written for. Noise masks, geometry and dynamic parts need it (materials
// need 0.8); older releases still compile older sources.
export const DEFAULT_VERSION = "0.9.0"
const RELEASES = "https://github.com/jCzachor6/infinite-props/releases/download"

export const platform = () => {
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64"
  if (process.platform === "linux" && process.arch === "x64") return "linux-x86_64"
  if (process.platform === "win32" && process.arch === "x64") return "windows-x86_64"
  return null
}

const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name)
const cacheDir = () => resolve(process.env.IPROP_SDK_CACHE || join(homedir(), ".cache/iprop-asset/sdk"))

const sdkAt = (dir, version) => {
  if (!dir || !existsSync(join(dir, "bin", exe("ipc")))) return null
  let declared = null
  try {
    declared = JSON.parse(readFileSync(join(dir, "release.json"), "utf8")).product_version
  } catch {}
  if (version && declared && declared !== version) return null
  const bin = (name) => (existsSync(join(dir, "bin", exe(name))) ? join(dir, "bin", exe(name)) : null)
  const share = (...parts) => (existsSync(join(dir, "share", "iprop", ...parts)) ? join(dir, "share", "iprop", ...parts) : null)
  return {
    dir,
    version: declared ?? version,
    ipc: bin("ipc"),
    ipval: bin("ipval"),
    ipgen: bin("ipgen"),
    ipsheet: bin("ipsheet"),
    ipdis: bin("ipdis"),
    reference: share("LLM_REFERENCE.md"),
    docs: share("docs", "language"),
    examples: share("examples"),
    backends: share("backends"),
  }
}

/** The SDK for `version` (default: IPROP_VERSION, then DEFAULT_VERSION); null when it cannot be found. */
export const findSdk = (version = process.env.IPROP_VERSION || DEFAULT_VERSION, { fetch: allowFetch = true } = {}) => {
  if (process.env.IPROP_SDK) return sdkAt(resolve(process.env.IPROP_SDK), null)
  const cached = sdkAt(join(cacheDir(), version), version)
  if (cached) return cached
  const name = platform()
  return allowFetch && name ? downloadSdk(version, name) : null
}

const downloadSdk = (version, name) => {
  const asset = `iprop-${version}-${name}.tar.gz`
  const base = `${RELEASES}/v${version}`
  const dir = join(cacheDir(), version)
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, asset)
  try {
    process.stderr.write(`downloading Infinite Props ${version} (${name}) into ${dir}\n`)
    execFileSync("curl", ["-fsSL", "-o", archive, `${base}/${asset}`])
    const sums = execFileSync("curl", ["-fsSL", `${base}/iprop-${version}-SHA256SUMS.txt`], { encoding: "utf8" })
    const expected = sums.split("\n").map((line) => line.trim().split(/\s+/)).find((parts) => parts[1]?.replace("*", "") === asset)?.[0]
    const actual = createHash("sha256").update(readFileSync(archive)).digest("hex")
    if (!expected || expected.toLowerCase() !== actual) throw new Error(`SHA-256 mismatch for ${asset}`)
    execFileSync("tar", ["-xzf", archive, "-C", dir, "--strip-components=1"])
    rmSync(archive, { force: true })
    return sdkAt(dir, version)
  } catch (cause) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`cannot download Infinite Props ${version} (${name}): ${cause.message}`)
  }
}

/** findSdk for a command line: exits with a readable message instead of returning null. */
export const requireSdk = (version, options) => {
  let sdk = null
  try {
    sdk = findSdk(version, options)
  } catch (cause) {
    console.error(cause.message)
    process.exit(2)
  }
  if (!sdk?.ipc || !sdk.ipgen) {
    const where = platform() ? "allow the download" : `no prebuilt SDK for ${process.platform}/${process.arch}; build it from source`
    console.error(`Infinite Props SDK not found: set IPROP_SDK to an unpacked SDK folder or ${where}`)
    process.exit(2)
  }
  return sdk
}

/** Splits `x.y.z` for comparisons. */
export const versionAtLeast = (version, minimum) => {
  const [a, b] = [version, minimum].map((value) => String(value).split(".").map(Number))
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}
