# opencode-sudo-popup

Shows a **compact desktop popup** when opencode needs `sudo`, so you see exactly which command requires root *before* typing your password.

Unlike auto-approve or YOLO plugins, this one **does not** skip or review commands. It simply turns opencode's blind sudo password prompt into a clear dialog.

![Screenshot placeholder]

## What it looks like

A minimal, compact window — just the command opencode is about to execute and a password field:

```
┌─ Sudo required ────────────────┐
│  sudo apt install -y nginx     │
│                                │
│  Password  [ •••••••••••••• ]  │
│                        [Cancel][Authenticate] │
└────────────────────────────────┘
```

- The command is shown **monospace**, wrapped, and **selectable** (so you can copy it).
- Press **Enter** or click **Authenticate** to allow; **Cancel** denies and the command is aborted.

## Why

When opencode runs `sudo apt install foo`, you're asked for a password with no idea what it's for. This plugin bridges that gap by:

1. Catching the `sudo` command before it runs (via the `tool.execute.before` hook).
2. Writing a short summary of the *real* command to a temp file.
3. Pointing `SUDO_ASKPASS` at a helper that reads that file and pops up a GUI password dialog with the command to be run.

## Requirements

- Linux with `sudo`
- Display server (Wayland or X11)
- **Recommended:** GJS + GTK4 + libadwaita (native on GNOME) for the compact native dialog.
- Falls back automatically, in order: `zenity` → `yad` → `kdialog` → `qarma`, then a plain terminal password prompt if no GUI tool exists.

## Install

```bash
opencode plugin add opencode-sudo-popup
```

Or add to `opencode.json`:

```json
{
  "plugin": ["opencode-sudo-popup"]
}
```

The package's `postinstall` script automatically:

- Copies the askpass helper to `~/.config/opencode/sudo-askpass.sh` (executable).
- Adds `export SUDO_ASKPASS=...` to your shell rc file (`~/.zshenv`, `~/.bashrc`, or `~/.config/fish/config.fish` — only if not already set).

> Note: opencode may load your config shell with `sudo` (e.g. `sudo -A`). Ensure `SUDO_ASKPASS` is set in an environment that survives into the `sudo` process. `~/.zshenv` works for zsh. For bash, having it in `~/.bashrc` requires an interactive shell. In non-interactive/fish environments, consider an `alias sudo='sudo -A'` in that shell.

## Usage

Just use opencode normally. Any time it needs root, the compact dialog appears showing the command to be run. Type your password to allow it once, or Cancel to deny.

## Backends

The helper prefers a native **GJS + GTK4 + libadwaita** dialog (`Adw.Window` with a `PasswordEntryRow` and monospace command label), which is a tiny single-screen window. It degrades gracefully to `zenity` → `yad` → `kdialog` → `qarma` → terminal if GJS/GTK4 are unavailable.

The plugin writes JSON (`{command, purpose, ts}`) to the shared reason file; the GJS helper reads it directly with `Gio`, and the shell fallbacks parse it with `python3` (both fall back to old flat-string files). A 120-second staleness guard distrusts outdated purpose text while still showing the command.

## What it catches

It only matches `sudo` used as an actual command (whole word at a command boundary) — so it won't false-positive on a file path like `./some/sudo/file` or a `#`-comment mentioning sudo. It also strips sudo flags (`-u`, `-p`, etc.) and shell separators so the dialog shows the *real* command that needs root (e.g. `sudo apt update`).

## Development

```bash
git clone https://github.com/uvindusl/opencode-sudo-popup
cd opencode-sudo-popup
npm install
# postinstall wires the askpass helper into ~/.config/opencode.
# To test the command-detection logic in isolation:
node --input-type=module -e "
import('./src/index.js').then(async m => {
  const p = await m.default();
  await p['tool.execute.before']({tool:'bash'}, {args:{command:'sudo apt update'}});
});
cat /tmp/opencode-sudo-reason
"
```

## License

MIT