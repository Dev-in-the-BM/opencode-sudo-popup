# opencode-sudo-popup

Shows a **desktop GUI popup** when opencode needs `sudo`, so you know exactly which command requires root *before* typing your password.

Unlike auto-approve or YOLO plugins, this one **does not** skip or review commands. It simply turns opencode's blind sudo password prompt into a clear, contextual dialog.

![Screenshot placeholder]

## Why

When opencode runs `sudo apt install foo`, you're asked for a password with no idea what it's for. This plugin bridges that gap by:

1. Catching the `sudo` command before it runs (via the `tool.execute.before` hook).
2. Writing a short summary of the *real* command to a temp file.
3. Pointing `SUDO_ASKPASS` at a helper that reads that file and pops up a GUI password dialog titled with the command.

## Requirements

- Linux with `sudo`
- A GUI auth dialog — any of: `zenity` (GNOME), `yad`, `kdialog` (KDE), `qarma` (LXQt). If none exist, it falls back to a plain terminal password prompt.

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

Just use opencode normally. Any time it needs root, a dialog appears:

```
┌──────────────────────────────────────────────┐
│  Opencode needs SUDO for: sudo apt update    │
│                                              │
│  [ --------------------------- ]             │
│  [             OK              ]             │
└──────────────────────────────────────────────┘
```

## What it catches

It only matches `sudo` used as an actual command (whole word at a command boundary) — so it won't false-positive on a file path like `./some/sudo/file` or a `#`-comment mentioning sudo. It also strips sudo flags (`-u`, `-p`, etc.) and shell separators so the dialog shows the *real* command that needs root (e.g. `sudo apt update`).

## Development

```bash
git clone https://github.com/<you>/opencode-sudo-popup
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
