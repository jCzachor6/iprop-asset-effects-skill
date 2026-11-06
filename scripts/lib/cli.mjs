// Command-line helpers the scripts share: options, seed lists, input values and finding effects.
import { readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Splits argv into positionals, valued options and flags. `valued` and `flags` name the options a script
 * knows; an unknown option, or a valued one without its value, prints `usage` and exits with 2.
 */
export const parseArgs = (argv, { valued = [], flags = [], usage = "" }) => {
  const values = new Map()
  const set = new Set()
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) positionals.push(arg)
    else if (valued.includes(arg)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) fail(`${arg} needs a value`, usage)
      values.set(arg, [...(values.get(arg) ?? []), argv[++i]])
    } else if (flags.includes(arg)) set.add(arg)
    else fail(`unknown option ${arg}`, usage)
  }
  return {
    positionals,
    option: (name, fallback) => values.get(name)?.at(-1) ?? fallback,
    options: (name) => values.get(name) ?? [],
    flag: (name) => set.has(name),
  }
}

/** Prints the message (and the usage) and exits with 2: a mistake on the command line. */
export const fail = (message, usage = "") => {
  console.error(usage ? `${message}\n${usage}` : message)
  process.exit(2)
}

/** "1-24", "3,7,19", "1-5,40" → [1, ..., 24]. Throws on anything else. */
export const parseSeeds = (text) => {
  const seeds = []
  for (const part of String(text).split(",").map((value) => value.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) for (let seed = Number(range[1]); seed <= Number(range[2]); seed++) seeds.push(seed)
    else if (/^\d+$/.test(part)) seeds.push(Number(part))
    else throw new Error(`not a seed or a range: "${part}"`)
  }
  if (!seeds.length) throw new Error(`no seeds in "${text}"`)
  return seeds
}

/** ["tint=#40c0ff", "style=2"] → { tint: "#40c0ff", style: "2" }. Throws on a pair without a name. */
export const parsePairs = (pairs) =>
  Object.fromEntries(pairs.map((pair) => {
    const at = pair.indexOf("=")
    if (at < 1) throw new Error(`--uniform takes name=value, got "${pair}"`)
    return [pair.slice(0, at), pair.slice(at + 1)]
  }))

/**
 * The effects at a path: the file itself, or every .ips under a folder, sorted, skipping hidden folders,
 * out/, node_modules/ and files that start with "_".
 */
export const effectsIn = (path) => {
  const full = resolve(path)
  if (statSync(full).isFile()) return [full]
  const found = []
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const sub = join(dir, name)
      if (name.startsWith(".") || name === "out" || name === "node_modules") continue
      if (statSync(sub).isDirectory()) visit(sub)
      else if (name.endsWith(".ips") && !name.startsWith("_")) found.push(sub)
    }
  }
  visit(full)
  return found
}

/** parseSeeds for a command line: a readable message and exit 2 instead of a stack trace. */
export const seedsOption = (text, usage) => {
  try {
    return parseSeeds(text)
  } catch (error) {
    return fail(error.message, usage)
  }
}

/** parsePairs for a command line. */
export const pairsOption = (pairs, usage) => {
  try {
    return parsePairs(pairs)
  } catch (error) {
    return fail(error.message, usage)
  }
}
