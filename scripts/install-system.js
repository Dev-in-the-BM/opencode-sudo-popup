import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir, userInfo } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const GATE_SRC = join(__dirname, "..", "bin", "opencode-sudo-gate")
const GATE_DEST = "/usr/local/bin/opencode-sudo-gate"
const SUDOERS_DEST = "/etc/sudoers.d/opencode-sudo-gate"
const VISUDO = "/usr/sbin/visudo"

function die(msg) {
  console.error(`[opencode-sudo-popup] ${msg}`)
  process.exit(1)
}

async function main() {
  const user = userInfo().username

  const sudoers = `# Managed by opencode-sudo-popup — approval gate for opencode.
# Allows ONLY the root-owned gate binary, passwordless. The gate itself
# pops up an Allow/Deny dialog for every command it is asked to run, so
# opencode can never execute privileged commands without your approval.
${user} ALL=(root) NOPASSWD: ${GATE_DEST}
`

  // Stage both files in a root-readable temp dir, then hand them to run0
  // in a single polkit authentication (one GUI dialog).
  const stage = await mkdtemp(join(tmpdir(), "opencode-sudo-gate-"))
  const stagedGate = join(stage, "opencode-sudo-gate")
  const stagedSudoers = join(stage, "opencode-sudo-gate.sudoers")
  await writeFile(stagedGate, await readFile(GATE_SRC))
  await writeFile(stagedSudoers, sudoers)

  const script = [
    `install -o root -g root -m 755 ${stagedGate} ${GATE_DEST}`,
    `install -o root -g root -m 440 ${stagedSudoers} ${SUDOERS_DEST}`,
    `${VISUDO} -c -f ${SUDOERS_DEST}`,
  ].join(" && ")

  console.log("[opencode-sudo-popup] installing gate + sudoers rule (one authentication prompt)…")
  const res = spawnSync("run0", ["/bin/sh", "-c", script], { stdio: "inherit", timeout: 120000 })
  await rm(stage, { recursive: true, force: true })

  if (res.error) die(`run0 failed to start: ${res.error.message}`)
  if (res.status !== 0) die(`install command failed with exit code ${res.status}`)

  // Prove passwordless execution works WITHOUT popping the dialog.
  const test = spawnSync("sudo", ["-n", GATE_DEST, "--selftest"], { encoding: "utf8", timeout: 30000 })
  if (test.status !== 0 || !String(test.stdout).includes("ok")) {
    die(
      `selftest failed (exit ${test.status}): ${String(test.stderr || test.stdout).trim()}\n` +
        `Rule file: ${SUDOERS_DEST} — check with: sudo -n -l`,
    )
  }

  console.log(`[opencode-sudo-popup] gate installed -> ${GATE_DEST}`)
  console.log(`[opencode-sudo-popup] sudoers rule  -> ${SUDOERS_DEST}`)
  console.log("[opencode-sudo-popup] selftest ok (passwordless, no popup)")
}

main().catch((e) => die(e.message))
