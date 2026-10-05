# opencode-sudo-popup

A deterministic sudo approval gate for [OpenCode](https://opencode.ai) **V2**.

When opencode needs root, the plugin rewrites the command so it can only run
through a root-owned gate program. The gate pops up a native **Adwaita**
dialog showing exactly which command is about to run — click **Allow** and it
executes as root, click **Deny** (or don't answer) and it's blocked.

No password prompts, no interrupted workflow: every privileged command gets
one explicit approval — or none.

## How it works

1. The plugin hooks shell execution (`tool.execute.before`). When a command
   contains a real `sudo` occurrence, it rewrites

   ```
   sudo apt update   →   sudo /usr/local/bin/opencode-sudo-gate -- apt update
   ```

   and writes a reason file describing what the command will do.
2. `/etc/sudoers.d/` grants `NOPASSWD` for exactly one program:
   `/usr/local/bin/opencode-sudo-gate` (root-owned).
3. The gate builds the dialog from **argv** (ground truth — the reason file
   only contributes the decorative purpose, display hints and color
   scheme), then:
   - **Allow** → runs the command as root with a minimal environment
   - **Deny / Esc / window close / 60s timeout / no display / any error** →
     blocked (exit 1)

Plain `sudo` that slips past the rewrite (e.g. inside quotes) can't
authenticate in opencode's non-interactive shells, so it fails closed too.

## Requirements

- Linux with `sudo` (tested with sudo-rs)
- **OpenCode V2**
- GJS + GTK4 + libadwaita (native on GNOME) for the dialog
- `run0` (polkit) to install the root-owned files
- A session display (Wayland or X11)

## Install

```bash
git clone https://github.com/uvindusl/opencode-sudo-popup
cd opencode-sudo-popup
npm install             # postinstall → plugin into ~/.config/opencode/plugins/
npm run install-system  # ONE polkit prompt: root-owned gate + sudoers rule
```

Restart opencode after installing so the plugin is loaded at startup.

`npm run install-system` stages both files, then asks polkit (via `run0`) to:

- install the gate → `/usr/local/bin/opencode-sudo-gate` (root:root, 755)
- install the rule → `/etc/sudoers.d/opencode-sudo-gate` (root:root, 440)
- validate the rule with `visudo -c -f`
- prove it works with `sudo -n <gate> --selftest` (prints `ok`, no dialog)

## The dialog

- Shows the exact command (rebuilt from argv), the working directory, and a
  plain-language purpose ("Refreshing the system package list…",
  "Installing the system package "nginx"…").
- Follows your GNOME light/dark preference — the plugin captures it while
  still running as you (root has no dconf of its own).
- **Stray-input safe:** Enter is inert (no default response) and focus
  starts on the command label, not a button. Any response arriving within
  the first 750 ms is discarded and the dialog is re-shown — a keystroke
  that lands while the window is appearing can never approve or deny.
- Esc or Deny blocks; 60 seconds without an answer blocks.

## Security model

- `NOPASSWD` covers only the gate's absolute path — never `ALL`, never a
  pattern. Any other sudo still requires real authentication, which
  non-interactive opencode shells don't have → fails closed.
- The gate is root-owned under `/usr/local/bin`: the agent (running as your
  user) cannot edit the program that decides what runs as root.
- The dialog runs *inside* the root-authorized program (pkexec model) —
  clicking Allow **is** the authentication.
- The displayed command comes from argv, never from the user-writable
  reason file; reason-file content is allowlisted/validated before use.
- The child runs with a fixed secure `PATH`, `HOME/USER/LOGNAME=/root`, and
  an allowlist of locale variables only (`LANG`, `TERM`, `TZ`, …).
- Fail-closed everywhere: deny, close, timeout, missing display, spawn
  failure → blocked.

## Limitations

- Only `sudo` occurrences are rewritten; ones inside quotes or comments are
  deliberately skipped (a miss fails closed — plain sudo can't
  authenticate anyway).
- sudo flags other than `-u`/`--user` are consumed and ignored (the gate
  itself is the authentication); `-u user` is honored via `runuser`.
- The purpose line is a best-effort offline heuristic; the command itself
  is always exact.
- If `gjs` is missing, the gate can't show a dialog — everything is
  blocked rather than silently allowed.

## Development

```bash
# after editing src/index.js — reinstall the plugin (reloads on save):
node scripts/install.js

# after editing bin/opencode-sudo-gate:
npm run install-system      # one polkit prompt

# test the rewrite + reason file in isolation:
node --input-type=module -e "
const m = await import('./src/index.js');
let hook;
await m.default.setup({ tool: { hook: async (_n, cb) => { hook = cb; } } });
const event = { tool: 'shell', input: { command: 'sudo apt update' } };
await hook(event);
console.log(event.input.command);   // rewritten through the gate
console.log((await import('node:fs')).readFileSync('/tmp/opencode-sudo-reason', 'utf8'));
"
```

## License

MIT
