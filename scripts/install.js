import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const CONFIG_DIR = join(HOME, ".config", "opencode")
const ASKPASS_DEST = join(CONFIG_DIR, "sudo-askpass.sh")
const GJS_DEST = join(CONFIG_DIR, "sudo-askpass-gjs.js")
const PLUGIN_DIR = join(CONFIG_DIR, "plugin")
const PLUGIN_DEST = join(PLUGIN_DIR, "sudo-reason.js")

const ASKPASS_UNIX = `"${ASKPASS_DEST}"`
const ASKPASS_ESC = ASKPASS_UNIX.replaceAll('"', '\\"')

async function ensureAskpass() {
  await mkdir(CONFIG_DIR, { recursive: true })
  // askpass wrapper + its GJS dialog must live side by side in the same dir.
  const src = join(__dirname, "..", "bin", "sudo-askpass.sh")
  const gjs = join(__dirname, "..", "bin", "sudo-askpass-gjs.js")
  const content = await readFile(src)
  const gjsContent = await readFile(gjs)
  await writeFile(ASKPASS_DEST, content)
  await chmod(ASKPASS_DEST, 0o755)
  await writeFile(GJS_DEST, gjsContent)
  await chmod(GJS_DEST, 0o755)
  return ASKPASS_DEST
}

async function ensurePlugin() {
  await mkdir(PLUGIN_DIR, { recursive: true })
  const src = join(__dirname, "..", "src", "index.js")
  const content = await readFile(src)
  await writeFile(PLUGIN_DEST, content)
  return PLUGIN_DEST
}

function shellRc(shell) {
  const map = {
    zsh: join(HOME, ".zshenv"),
    bash: join(HOME, ".bashrc"),
    fish: join(HOME, ".config", "fish", "config.fish"),
  }
  return map[shell] || null
}

function exportLine(shell) {
  if (shell === "fish") return `set -gx SUDO_ASKPASS ${ASKPASS_ESC}`
  return `export SUDO_ASKPASS=${ASKPASS_UNIX}`
}

async function ensureEnv() {
  if (platform() === "win32") return false
  const shell = process.env.SHELL?.split("/").pop()
  if (!shell) return false
  const rc = shellRc(shell)
  if (!rc) return false
  const line = exportLine(shell)
  if (existsSync(rc)) {
    const cur = await readFile(rc, "utf8")
    if (cur.includes("SUDO_ASKPASS")) return false // already configured
    await writeFile(rc, `${cur}\n# added by opencode-sudo-popup\n${line}\n`)
  } else {
    await mkdir(dirname(rc), { recursive: true })
    await writeFile(rc, `# added by opencode-sudo-popup\n${line}\n`)
  }
  return true
}

async function main() {
  const ask = await ensureAskpass()
  console.log(`[opencode-sudo-popup] askpass helper -> ${ask}`)
  const plugin = await ensurePlugin()
  console.log(`[opencode-sudo-popup] plugin -> ${plugin}`)
  const wired = await ensureEnv()
  if (wired) console.log("[opencode-sudo-popup] SUDO_ASKPASS exported to your shell rc")
}

main().catch((e) => {
  // Never fail the whole npm install because of a helper issue.
  console.error("[opencode-sudo-popup] setup warning:", e.message)
})
