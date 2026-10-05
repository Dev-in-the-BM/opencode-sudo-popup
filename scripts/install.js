import { readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const CONFIG_DIR = join(HOME, ".config", "opencode")
const PLUGIN_DIR = join(CONFIG_DIR, "plugins")
const PLUGIN_DEST = join(PLUGIN_DIR, "sudo-reason.js")
// V1-era install location; V2 no longer loads plugins from here.
const LEGACY_PLUGIN_DEST = join(CONFIG_DIR, "plugin", "sudo-reason.js")

// V1-era askpass plumbing the gate no longer needs.
const LEGACY_ASKPASS = [
  join(CONFIG_DIR, "sudo-askpass.sh"),
  join(CONFIG_DIR, "sudo-askpass-gjs.js"),
]

const MARKER = "# added by opencode-sudo-popup"

async function ensurePlugin() {
  await mkdir(PLUGIN_DIR, { recursive: true })
  const src = join(__dirname, "..", "src", "index.js")
  const content = await readFile(src)
  await writeFile(PLUGIN_DEST, content)
  // Drop the stale V1 copy (if any) so only the V2 plugin remains installed.
  await rm(LEGACY_PLUGIN_DEST, { force: true })
  return PLUGIN_DEST
}

// Remove the old askpass helper files from the opencode config dir.
async function removeLegacyAskpass() {
  const removed = []
  for (const file of LEGACY_ASKPASS) {
    if (existsSync(file)) {
      await rm(file, { force: true })
      removed.push(file)
    }
  }
  return removed
}

function shellRcFiles() {
  if (platform() === "win32") return []
  return [
    join(HOME, ".zshenv"),
    join(HOME, ".bashrc"),
    join(HOME, ".config", "fish", "config.fish"),
  ].filter(existsSync)
}

// Strip the "added by opencode-sudo-popup" marker and its SUDO_ASKPASS line
// from a shell rc file. Anything else in the file is left untouched.
function stripAskpassBlock(text) {
  const lines = text.split("\n")
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === MARKER) {
      // Drop the marker, plus the export/set line that follows it (if ours).
      if (i + 1 < lines.length && lines[i + 1].includes("SUDO_ASKPASS")) i++
      // Drop one leading blank line so we don't accumulate whitespace.
      if (out.length && out[out.length - 1].trim() === "") out.pop()
      continue
    }
    out.push(lines[i])
  }
  return out.join("\n")
}

async function cleanShellRc() {
  const cleaned = []
  for (const rc of shellRcFiles()) {
    const cur = await readFile(rc, "utf8")
    if (!cur.includes(MARKER) && !cur.includes("SUDO_ASKPASS")) continue
    const next = stripAskpassBlock(cur)
    if (next !== cur) {
      await writeFile(rc, next)
      cleaned.push(rc)
    }
  }
  return cleaned
}

async function main() {
  const plugin = await ensurePlugin()
  console.log(`[opencode-sudo-popup] plugin -> ${plugin}`)

  const removed = await removeLegacyAskpass()
  for (const f of removed) console.log(`[opencode-sudo-popup] removed legacy ${f}`)

  const rc = await cleanShellRc()
  for (const f of rc) console.log(`[opencode-sudo-popup] removed SUDO_ASKPASS wiring from ${f}`)

  console.log("[opencode-sudo-popup] next: npm run install-system  (installs the root-owned gate + sudoers rule via run0)")
}

main().catch((e) => {
  // Never fail the whole npm install because of a helper issue.
  console.error("[opencode-sudo-popup] setup warning:", e.message)
})
