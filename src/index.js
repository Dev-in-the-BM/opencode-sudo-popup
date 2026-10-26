import { writeFile, mkdir } from "node:fs/promises"
import { execFile } from "node:child_process"

// Shared reason-file path: the plugin writes display context here for the
// root-owned approval gate. The gate derives the command itself from argv.
const REASON_FILE = "/tmp/opencode-sudo-reason"

// A sudo invocation can be disguised as other words (e.g. the string
// "sudo" inside a path, a comment, or a variable named "sudo"). Only
// treat it as real when "sudo" appears as a whole word at a command
// boundary (start of line, after ; || &&, a pipe, or whitespace).
const SUDO_RE = /(^|[;&|(\s]+)sudo(\s+[a-zA-Z\-./~]|$)/

// sudo option flags that consume an argument we should skip when trying
// to find the actual command being run.
const FLAG_WITH_ARG = new Set(["-C", "-D", "-h", "-p", "-u", "-U", "-g", "-T"])

function containsSudo(cmd) {
  if (!SUDO_RE.test(cmd)) return false
  // Ignore sudo occurrences inside comments: strip everything from an
  // unquoted # to end of line before re-checking.
  const withoutComment = cmd.replace(/(^|[^\\])#.*$/, "$1")
  return SUDO_RE.test(withoutComment)
}

// Find the actual sudo sub-command within a possibly multi-command line,
// so the popup shows something like "sudo apt update" rather than the
// full "echo hi | sudo tee /etc/x" incantation. Falls back to the whole
// line if sudo's target can't be isolated.
function sudoTarget(cmd) {
  // Split on shell separators and pick the segment(s) that contain sudo.
  const segments = cmd.split(/[;&|]+/).map((s) => s.trim()).filter(Boolean)
  const sudoSegs = segments.filter((s) => containsSudo(s))
  const target = sudoSegs.join(" && ") || segments[0] || cmd

  // Strip leading "sudo" and its option flags to reveal the real command.
  const tokens = target.trim().split(/\s+/)
  let i = 0
  if (tokens[i]?.toLowerCase() === "sudo") i++
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === "--") break
    if (t.startsWith("-") && t.length > 1) {
      // flag with inline arg like -u root stays as one token; else skip next
      if (FLAG_WITH_ARG.has(t) || FLAG_WITH_ARG.has(t.slice(0, 2))) i++
      i++
      continue
    }
    break
  }
  const rest = tokens.slice(i).join(" ")
  return rest ? `sudo ${rest}` : cmd
}

// --- Why inference (offline heuristics, zero deps) --------------------------
// Returns a single plain-language sentence describing WHAT the command does.
// Only uses tokens/paths actually present in the command — never invents
// user intent. Unknown commands fall through to the generic line.
function shortList(items, max = 3) {
  const clean = items.filter(Boolean).slice(0, 20)
  if (clean.length <= max) return clean.join(", ")
  return `${clean.slice(0, max).join(", ")} +${clean.length - max} more`
}

function pkgsAfter(tokens, verb) {
  const idx = tokens.findIndex((t) => t === verb)
  if (idx < 0) return []
  return tokens
    .slice(idx + 1)
    .filter((t) => t && !t.startsWith("-") && t !== "&&" && !/^[;&|]+$/.test(t))
    .map((t) => t.replace(/^["']|["']$/g, "").replace(/[,;]+$/, ""))
    .filter(Boolean)
}

function findSysPath(cmd) {
  const m = cmd.match(/(^|[\s"'=])(\/(etc|usr|opt|var|srv)(\/\S*)?)/)
  if (!m) return ""
  return m[2].replace(/["'`,;:]+$/, "").slice(0, 80)
}

function inferPurpose(target, fullCmd = "") {
  const cmd = target
    .replace(/^sudo\s+/, "")
    .replace(/^\/(usr\/bin|bin|usr\/sbin|sbin)\//, "")
    .trim()
  const low = ` ${cmd} `.toLowerCase().slice(0, 500)

  // sudo -u somebody (not full root) — surface it so the warning stays honest.
  const runAs = (fullCmd || target).match(/sudo\s+(?:-[a-zA-Z]*u\s+(\S+)|--user[=\s]+(\S+))/)
  const asUser = runAs?.[1]?.replace(/["']/g, "") ?? runAs?.[2]?.replace(/["']/g, "") ?? ""
  const prefix =
    asUser && !/^(root|0)$/.test(asUser) ? `Running as user “${asUser.slice(0, 32)}”: ` : ""
  const withPrefix = (s) => `${prefix}${s}`.slice(0, 240)

  // apt / apt-get
  if (/^(apt-get|apt)\s+update\b/.test(cmd))
    return withPrefix("Refreshing the system package list (nothing is installed or removed).")
  if (/^(apt-get|apt)\s+(upgrade|full-upgrade|dist-upgrade)\b/.test(cmd))
    return withPrefix("Upgrading installed system packages to newer versions.")
  {
    const m = cmd.match(/^(apt-get|apt)\s+(install|remove|purge|autoremove)\b/)
    if (m) {
      const pkgs = pkgsAfter(cmd.split(/\s+/), m[2])
      const verb = m[2] === "install" ? "Installing" : "Removing"
      if (!pkgs.length) return withPrefix(`${verb} system software.`)
      return withPrefix(`${verb} the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs)}”.`)
    }
  }
  // dnf / yum / zypper / apk / pacman / snap
  {
    const m = cmd.match(/^(dnf|yum|zypper)\s+(install|remove)\b/)
    if (m) {
      const pkgs = pkgsAfter(cmd.split(/\s+/), m[2])
      return withPrefix(
        m[2] === "install"
          ? `Installing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`
          : `Removing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`,
      )
    }
  }
  if (/^apk\s+add\b/.test(cmd)) {
    const pkgs = pkgsAfter(cmd.split(/\s+/), "add")
    return withPrefix(`Installing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`)
  }
  if (/^pacman\b/.test(cmd)) {
    if (/\s-S\w*u/.test(` ${cmd}`) && !pkgsAfter(cmd.split(/\s+/), "-S").length)
      return withPrefix("Upgrading installed system packages to newer versions.")
    const pkgs = cmd.split(/\s+/).filter((t) => t && !t.startsWith("-") && t !== "pacman" && t !== "-S")
    if (/\s-S/.test(` ${cmd}`))
      return withPrefix(`Installing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`)
  }
  if (/^snap\s+install\b/.test(cmd)) {
    const pkgs = pkgsAfter(cmd.split(/\s+/), "install")
    return withPrefix(`Installing the Snap package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`)
  }
  // language package managers run with sudo = system-wide install
  if (/^(pip3?|npm|gem|cargo)\b/.test(cmd))
    return withPrefix("Installing software system-wide (affects all users).")

  // systemctl / service
  {
    const m = cmd.match(/^systemctl\s+(start|stop|restart|reload|enable|disable|daemon-reload)\s+([A-Za-z0-9@_:.-]+)/)
    if (m) {
      const verbMap = { start: "Starting", stop: "Stopping", restart: "Restarting", reload: "Reloading", enable: "Enabling", disable: "Disabling", "daemon-reload": "Reloading system service definitions" }
      return withPrefix(`${verbMap[m[1]]} the system service “${m[2].slice(0, 64)}”.`)
    }
    const s = cmd.match(/^service\s+([A-Za-z0-9@_.-]+)\s+(start|stop|restart|reload)/)
    if (s) return withPrefix(`Restarting the system service “${s[1].slice(0, 64)}”.`)
  }
  // writing a system file (tee or redirect caught from the full line)
  {
    const hay = `${cmd} ${fullCmd}`
    if (/\btee\b/.test(hay) || /=>?\s*\/(etc|usr|opt|var|srv)\//.test(hay) || />\s*\/(etc|usr)\//.test(fullCmd)) {
      const p = findSysPath(hay)
      if (p) return withPrefix(`Writing a system configuration file at “${p}”.`)
      return withPrefix("Writing a system configuration file (outside your home directory).")
    }
  }
  // permissions / ownership
  if (/^(chmod|chown)\b/.test(cmd)) {
    const p = findSysPath(cmd) || cmd.split(/\s+/).slice(-1)[0]?.slice(0, 80)
    const what = cmd.startsWith("chmod") ? "permissions" : "ownership"
    return withPrefix(`Changing ${what} of “${p}”.`)
  }
  // system dirs / file install
  if (/^mkdir\b/.test(cmd)) {
    const p = findSysPath(cmd)
    if (p) return withPrefix(`Creating a system directory at “${p}”.`)
  }
  if (/^(cp|mv|ln|install)\b/.test(cmd) && /\s\/(etc|usr|opt|var|srv)\//.test(` ${cmd}`)) {
    const p = findSysPath(cmd)
    return withPrefix(`Installing a file to “${p || "a system directory"}”.`)
  }
  if (/^make\s+install\b/.test(cmd)) return withPrefix("Installing compiled software system-wide (make install).")
  // docker = de facto root
  if (/^docker\b/.test(cmd))
    return withPrefix("Managing Docker containers or images (equivalent to root via the Docker socket).")
  // firewall / users / mounts
  if (/^(ufw|iptables|firewall-cmd)\b/.test(cmd)) return withPrefix("Changing firewall rules.")
  if (/^(useradd|usermod|userdel|groupadd|passwd|chsh)\b/.test(cmd))
    return withPrefix("Creating or modifying a system user or group.")
  if (/^(mount|umount)\b/.test(cmd)) return withPrefix("Mounting or unmounting a filesystem.")

  // Fallback — states only what is known, never guesses.
  return "Opencode requested root to run the command below. Only approve if you expected a privileged step."
}

// GNOME color scheme, read while still running as the user (the gate runs as
// root, whose dconf is empty — so root GTK would otherwise always show a light
// dialog). Allowlisted; the gate validates again before applying it.
const COLOR_SCHEMES = new Set([
  "default",
  "prefer-light",
  "prefer-dark",
  "force-light",
  "force-dark",
])

function detectColorScheme() {
  return new Promise((resolve) => {
    execFile(
      "gsettings",
      ["get", "org.gnome.desktop.interface", "color-scheme"],
      { timeout: 1000 },
      (err, stdout) => {
        if (err) return resolve("")
        const v = String(stdout).trim().replace(/^['"]|['"]$/g, "")
        resolve(COLOR_SCHEMES.has(v) ? v : "")
      },
    )
  })
}

// Ubuntu's libadwaita derives its Yaru accent from accent-color (root
// defaults to orange, hence the orange above). Capture the user's value;
// the gate writes it into root's own dconf before Adw initializes.
const ACCENT_COLORS = new Set([
  "blue",
  "teal",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "slate",
])

function detectAccentColor() {
  return new Promise((resolve) => {
    execFile(
      "gsettings",
      ["get", "org.gnome.desktop.interface", "accent-color"],
      { timeout: 1000 },
      (err, stdout) => {
        if (err) return resolve("")
        const v = String(stdout).trim().replace(/^['"]|['"]$/g, "")
        resolve(ACCENT_COLORS.has(v) ? v : "")
      },
    )
  })
}

function detectGtkTheme() {
  return new Promise((resolve) => {
    execFile(
      "gsettings",
      ["get", "org.gnome.desktop.interface", "gtk-theme"],
      { timeout: 1000 },
      (err, stdout) => {
        if (err) return resolve("")
        const v = String(stdout).trim().replace(/^['"]|['"]$/g, "")
        resolve(/^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "")
      },
    )
  })
}

async function writeReason(cmd, batch = [], sessionID = "") {
  try {
    await mkdir("/tmp", { recursive: true })
    const target = sudoTarget(cmd).replace(/\s+/g, " ").trim().slice(0, 800)
    const purpose = inferPurpose(target, cmd)
    // Session display hints so the gate (running as root under sudo) knows
    // which of the user's screens to show the popup on. Validated again on
    // the gate side; decorative only — never used to decide what runs.
    const env = {}
    for (const key of ["WAYLAND_DISPLAY", "DISPLAY", "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE"]) {
      const v = process.env[key]
      if (v && typeof v === "string" && v.length <= 128) env[key] = v
    }
    const colorScheme = await detectColorScheme()
    if (colorScheme) env.COLOR_SCHEME = colorScheme
    // Desktop GTK theme name (e.g. Yaru-blue-dark). Ubuntu's libadwaita
    // derives its Yaru accent + styling from this; the gate applies it via
    // Gtk.Settings (same path every desktop app uses). NOTE: never via the
    // GTK_THEME env var — that bypasses libadwaita and renders unstyled.
    const gtkTheme = await detectGtkTheme()
    if (gtkTheme) env.GTK_THEME = gtkTheme
    const accentColor = await detectAccentColor()
    if (accentColor) env.ACCENT_COLOR = accentColor
    // Session key: "Allow for this session" is scoped to this OpenCode
    // session. HOME lets the gate discover the user's opencode.json(c)
    // files (the gate runs as root, whose HOME is /root). Both allowlisted.
    if (typeof sessionID === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(sessionID))
      env.SESSION_KEY = sessionID
    const home = process.env.HOME
    if (typeof home === "string" && /^\/home\/[A-Za-z0-9._-]{1,64}$/.test(home)) env.HOME = home
    await writeFile(
      REASON_FILE,
      JSON.stringify({ v: 3, command: target, purpose, ts: Math.floor(Date.now() / 1000), env, batch }),
    )
  } catch {
    // Best effort — the popup still works with a generic title.
  }
}

// Commands that reference the reason file are probes/self-tests: never let
// them overwrite the very reason they are trying to inspect.
const REASON_RE = /opencode-sudo-reason/

// The installed gate — the ONLY program sudo will run without a password.
// Every real `sudo` occurrence in a shell command is rewritten into an
// invocation of this gate, which pops up Allow/Deny before executing.
const GATE_PATH = "/usr/local/bin/opencode-sudo-gate"

// Quote-aware scan for real `sudo` command occurrences. Returns the start
// index of each `sudo` word that sits at a command boundary (start of line,
// or after ; & | ( or whitespace) OUTSIDE of quotes and comments, and is
// followed by whitespace + at least one argument. Text inside quotes or
// after a comment marker is data, not a command, and is never rewritten —
// a missed match fails closed (plain sudo can't authenticate without a TTY).
function findSudo(cmd) {
  const hits = []
  let i = 0
  let quote = null
  const boundary = (ch) => ch === undefined || /[;&|(\s]/.test(ch)
  while (i < cmd.length) {
    const ch = cmd[i]
    if (quote) {
      if (ch === "\\") {
        if (quote !== "'") i++ // backslash escapes inside " and `, literal inside '
      } else if (ch === quote) {
        quote = null
      }
      i++
      continue
    }
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      i++
      continue
    }
    if (ch === "#" && (i === 0 || /[\s;&|]/.test(cmd[i - 1]))) {
      while (i < cmd.length && cmd[i] !== "\n") i++
      continue
    }
    if (
      cmd.startsWith("sudo", i) &&
      boundary(i === 0 ? undefined : cmd[i - 1]) &&
      i + 4 < cmd.length &&
      /[\s]/.test(cmd[i + 4])
    ) {
      // skip whitespace; must be followed by an argument
      let j = i + 4
      while (j < cmd.length && /\s/.test(cmd[j])) j++
      if (j < cmd.length && !/\s/.test(cmd[j])) hits.push(i)
      i += 4
      continue
    }
    i++
  }
  return hits
}

// 12 hex chars, one per sudo occurrence. The gate learns its own xid from
// argv and its siblings from the reason file's batch list, so one shared
// window can cover every sudo in the line (and later arrivals can claim
// their pre-seeded row).
function makeXid() {
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// The shell segment ([;&|]-delimited chunk) containing this sudo hit —
// used to build per-occurrence display text for the batch list. Cheap and
// display-only: the gate always shows its own argv as ground truth.
function segmentContaining(cmd, hit) {
  let start = 0
  for (let i = 0; i < cmd.length; i++) {
    if (/[;&|]/.test(cmd[i])) {
      if (hit >= start && hit < i) return cmd.slice(start, i)
      start = i + 1
    }
  }
  return cmd.slice(start)
}

// Rewrite eligible `sudo` words to route through the gate:
//   `sudo apt update` → `sudo /usr/local/bin/opencode-sudo-gate --xid=<hex> -- apt update`
// Occurrences already followed by the gate path are left alone (idempotent).
// Returns { out, batch } — batch lists every occurrence's xid + display text
// so the reason file can pre-seed sibling rows in the shared queue window.
function routeThroughGate(cmd) {
  const eligible = findSudo(cmd).filter((s) => {
    let j = s + 4
    while (j < cmd.length && /\s/.test(cmd[j])) j++
    return !cmd.startsWith(GATE_PATH, j)
  })
  if (!eligible.length) return null
  let out = ""
  let prev = 0
  const batch = []
  for (const s of eligible) {
    const xid = makeXid()
    out += cmd.slice(prev, s + 4) + ` ${GATE_PATH} --xid=${xid} --`
    prev = s + 4
    const seg = segmentContaining(cmd, s)
    const text = sudoTarget(seg).replace(/\s+/g, " ").trim().slice(0, 800)
    batch.push({ xid, command: text, purpose: inferPurpose(text, seg).slice(0, 300) })
  }
  out += cmd.slice(prev)
  return { out, batch }
}

// V2 plugin definition: `{ id, setup }`. This deliberately does NOT import
// `Plugin` from `@opencode/plugin` — that package is only an identity helper
// (`define` just returns its argument), and this file is installed as a bare
// global file at ~/.config/opencode/plugins/, where no node_modules exists to
// resolve an import from. The plain object shape is exactly what the loader
// expects.
export default {
  id: "opencode-sudo-popup",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "shell") return
      const cmd = String(event.input?.command ?? "")
      if (REASON_RE.test(cmd)) return
      if (!findSudo(cmd).length) return
      const routed = routeThroughGate(cmd)
      if (routed === null) return
      await writeReason(cmd, routed.batch, event.sessionID ?? "")
      event.input.command = routed.out
    })
    // The approval window has no inactivity timeout (deciding is up to the
    // user), so give sudo commands a long shell timeout — otherwise the tool
    // call could be killed while the user is still reading the dialog.
    await ctx.shell.hook("create.before", (event) => {
      if (REASON_RE.test(event.command)) return
      if (!findSudo(event.command).length) return
      if (event.timeout > 0) event.timeout = Math.max(event.timeout, 1_800_000)
    })
  },
}
