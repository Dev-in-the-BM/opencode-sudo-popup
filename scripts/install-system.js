import { copyFileSync, chmodSync, chownSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const GATE_SRC = join(__dirname, "..", "bin", "opencode-sudo-gate")
const GATE_DEST = "/usr/local/bin/opencode-sudo-gate"
const SUDOERS_DEST = "/etc/sudoers.d/opencode-sudo-gate"
const RULES_DIR = "/etc/opencode-sudo-gate"
const RULES_FILE = `${RULES_DIR}/rules.json`
const VISUDO = "/usr/sbin/visudo"
const DCONF_PROFILE_DEST = "/etc/dconf/profile/opencode-sudo-gate"
const DCONF_DB_DIR = "/etc/dconf/db/opencode-gate.d"
const DCONF_DB_FILE = `${DCONF_DB_DIR}/00-theme`
const ACCENTS = new Set(["blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "slate"])

function die(msg) {
  console.error(`[opencode-sudo-popup] ${msg}`)
  process.exit(1)
}

// The real, non-root user this install is FOR. The gate runs children with
// a minimal env (no SUDO_USER), so fall back to the script file's owner —
// the repo checkout belongs to the human running opencode.
function targetUser() {
  if (process.env.SUDO_USER && process.env.SUDO_USER !== "root") return process.env.SUDO_USER
  try {
    const uid = statSync(SELF).uid
    for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
      const [name, , u] = line.split(":")
      if (name && u && Number(u) === uid) return name
    }
  } catch {
    // fall through
  }
  return null
}

// Runs as root: `sudo <node> scripts/install-system.js` (the plugin rewrites
// that sudo through the approval gate). Nested sudo/spawn tricks cannot work
// — only the top-level command text is rewritten — so everything here just
// performs the install directly and verifies the passwordless rule as the
// real user via runuser + `sudo -n`.
function main() {
  if (process.getuid() !== 0) {
    die(
      "must run as root — use: sudo $(command -v node) scripts/install-system.js\n" +
        "(the approval gate rewrites that command; run0/pkexec bypass the gate)",
    )
  }
  const user = targetUser()
  if (!user || user === "root") die("could not determine the target user (SUDO_USER missing, file not user-owned)")

  const sudoers = `# Managed by opencode-sudo-popup — approval gate for opencode.
# Allows ONLY the root-owned gate binary, passwordless. The gate itself
# pops up an approval window for every command it is asked to run, so
# opencode can never execute privileged commands without your approval.
${user} ALL=(root) NOPASSWD: ${GATE_DEST}
`

  // 1. Gate binary — root-owned so the gated agent can never edit it.
  copyFileSync(GATE_SRC, GATE_DEST)
  chownSync(GATE_DEST, 0, 0)
  chmodSync(GATE_DEST, 0o755)

  // 2. sudoers rule — root-owned, non-writable (mode 440).
  writeFileSync(SUDOERS_DEST, sudoers)
  chownSync(SUDOERS_DEST, 0, 0)
  chmodSync(SUDOERS_DEST, 0o440)
  const v = spawnSync(VISUDO, ["-c", "-f", SUDOERS_DEST], { encoding: "utf8" })
  if (v.status !== 0) die(`visudo rejected the rule:\n${v.stderr || v.stdout}`)
  console.log(`[opencode-sudo-popup] sudoers rule parsed OK -> ${SUDOERS_DEST}`)

  // 3. Persistent rules store (root-owned). Never clobber existing rules.
  mkdirSync(RULES_DIR, { recursive: true, mode: 0o755 })
  chownSync(RULES_DIR, 0, 0)
  chmodSync(RULES_DIR, 0o755)
  if (!existsSync(RULES_FILE)) {
    writeFileSync(RULES_FILE, "[]\n")
    console.log(`[opencode-sudo-popup] created empty rules file -> ${RULES_FILE}`)
  }
  chownSync(RULES_FILE, 0, 0)
  chmodSync(RULES_FILE, 0o644) // readable for --rules; only root can write

  // 4. Theme bridge for the dialog: Ubuntu's libadwaita derives its Yaru
  //    accent from accent-color, but the gate runs as root (empty dconf, no
  //    session bus) and would always render orange. Bake the user's current
  //    accent into a dedicated, root-owned dconf database + profile that
  //    ONLY the gate uses (DCONF_PROFILE=opencode-sudo-gate) — zero effect
  //    on any other process. Re-run this installer after changing the
  //    desktop accent to refresh it.
  try {
    let home = ""
    for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
      const [name, , , , , h] = line.split(":")
      if (name === user && h) {
        home = h
        break
      }
    }
    const g = spawnSync("gsettings", ["get", "org.gnome.desktop.interface", "accent-color"], {
      encoding: "utf8",
      timeout: 10000,
      // No session bus as root — dconf reads the user's db file directly.
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: `${home}/.config` },
    })
    const accent = String(g.stdout || "").trim().replace(/^['"]|['"]$/g, "")
    if (g.status === 0 && ACCENTS.has(accent)) {
      mkdirSync(DCONF_DB_DIR, { recursive: true, mode: 0o755 })
      writeFileSync(DCONF_DB_FILE, `[org/gnome/desktop/interface]\naccent-color='${accent}'\n`)
      writeFileSync(DCONF_PROFILE_DEST, `user-db:user\nsystem-db:opencode-gate\n`)
      for (const f of [DCONF_DB_FILE, DCONF_PROFILE_DEST]) {
        chownSync(f, 0, 0)
        chmodSync(f, 0o644)
      }
      const u = spawnSync("dconf", ["update"], { encoding: "utf8", timeout: 30000 })
      if (u.status !== 0) throw new Error(String(u.stderr || u.stdout).trim())
      console.log(`[opencode-sudo-popup] dialog accent baked in -> ${accent} (re-run after changing desktop theme)`)
    } else {
      console.log("[opencode-sudo-popup] could not read user accent-color; dialog falls back to default styling")
    }
  } catch (e) {
    console.log(`[opencode-sudo-popup] theme bridge skipped (${e.message}); dialog falls back to default styling`)
  }

  // 5. Prove the invoking user can run the gate passwordless WITHOUT any
  //    dialog (selftest never opens a window).
  const test = spawnSync(
    "runuser",
    ["-u", user, "--", "sudo", "-n", GATE_DEST, "--selftest"],
    { encoding: "utf8", timeout: 30000 },
  )
  if (test.status !== 0 || !String(test.stdout).includes("ok")) {
    die(
      `selftest failed (exit ${test.status}): ${String(test.stderr || test.stdout).trim()}\n` +
        `Rule file: ${SUDOERS_DEST} — check with: sudo -n -l`,
    )
  }

  console.log(`[opencode-sudo-popup] gate installed -> ${GATE_DEST}`)
  console.log("[opencode-sudo-popup] selftest ok (passwordless, no popup)")
}

main()
