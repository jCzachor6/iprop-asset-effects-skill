#!/usr/bin/env node
// Makes sure the Infinite Props SDK is available and prints where its tools and its language reference
// are, with the reference's section index, so you can read it section by section.
// Usage: node sdk.mjs [--sdk-version x.y.z] [--no-fetch] [--json]
import { readFileSync } from "node:fs"
import { requireSdk } from "./lib/sdk.mjs"

const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const sdk = requireSdk(option("--sdk-version"), { fetch: !args.includes("--no-fetch") })

const sections = []
if (sdk.reference) {
  readFileSync(sdk.reference, "utf8").split("\n").forEach((line, index) => {
    if (line.startsWith("## ")) sections.push({ line: index + 1, title: line.slice(3).trim() })
  })
}

if (args.includes("--json")) {
  console.log(JSON.stringify({ ...sdk, sections }, null, 2))
} else {
  console.log(`Infinite Props ${sdk.version} SDK: ${sdk.dir}`)
  for (const name of ["ipc", "ipval", "ipgen", "ipsheet", "ipdis"]) if (sdk[name]) console.log(`  ${name.padEnd(9)} ${sdk[name]}`)
  console.log(`  reference ${sdk.reference ?? "(missing: use https://infiniteprops.dev/LLM_REFERENCE.md)"}`)
  if (sdk.docs) console.log(`  handbook  ${sdk.docs}`)
  if (sdk.examples) console.log(`  examples  ${sdk.examples}`)
  if (sdk.backends) console.log(`  backends  ${sdk.backends}`)
  if (sections.length) {
    const rules = sections.findIndex((section) => section.title === "Compiler rules")
    const end = rules >= 0 && sections[rules + 1] ? sections[rules + 1].line - 1 : 440
    console.log(`\nLLM_REFERENCE.md sections (read lines 1-${end} before writing code):`)
    for (const section of sections) console.log(`  ${String(section.line).padStart(5)}  ${section.title}`)
  }
}
