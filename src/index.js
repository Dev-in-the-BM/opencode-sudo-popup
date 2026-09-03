import { writeFile, mkdir } from "node:fs/promises"

// Where the askpass helper (installed by the postinstall script) lives.
// SUDO_ASKPASS points here; this plugin only needs to know the shared
// temp-file path to communicate with it.
const REASON_FILE = "/tmp/opencode-sudo-reason"

// A sudo invocation can be disguised as other words (e.g. the string
// "sudo" inside a path, a comment, or a variable named "sudo"). Only
// treat it as real when "sudo" appears as a whole word at a command
// boundary (start of line, after ; || &&, a pipe, or whitespace).
const SUDO_RE = /(^|[;&|(\s]+)sudo(\s+[a-zA-Z-]|$)/

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

async function writeReason(cmd) {
  try {
    await mkdir("/tmp", { recursive: true })
    await writeFile(REASON_FILE, sudoTarget(cmd))
  } catch {
    // Best effort — the popup still works with a generic title.
  }
}

export default async () => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash") return
    const cmd = String(output.args?.command ?? "")
    if (!containsSudo(cmd)) return
    await writeReason(cmd)
  },
})
