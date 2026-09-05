# why opencode-sudo-popup plugin

This is a tool that i built for me because sometime when do my development task with opencode sometime it need some new packages stuff. so the agent telling me to run those commands and stop the agents task. to prevent this i just buit this plugin when the agent need sudo access it can just access it by popup menu and also it shows what is the command that agent run. I think this plugin is usefull for someone that use opencode like me so i thought to publish this thing as a plugin to opencode. 

A minimal, compact window — just the command opencode is about to execute and a password field:

## Requirements

- Linux with `sudo`
- Display server (Wayland or X11)
- **Required:** GJS + GTK4 + libadwaita (native on GNOME) for the compact native dialog. Without `gjs` the popup cannot be shown.

## Install

Clone + install + restart opencode:

```bash
git clone https://github.com/uvindusl/opencode-sudo-popup
cd opencode-sudo-popup
npm install
```

The `postinstall` script automatically:

- Copies the askpass helper + GJS dialog to `~/.config/opencode/`.
- Installs the plugin itself to `~/.config/opencode/plugin/sudo-reason.js`.
- Adds `export SUDO_ASKPASS=...` to your shell rc file (`~/.zshenv`, `~/.bashrc`, or `~/.config/fish/config.fish` — only if not already set).

> Restart opencode after installing so the plugin is loaded at startup.

> Note: opencode may load your config shell with `sudo` (e.g. `sudo -A`). Ensure `SUDO_ASKPASS` is set in an environment that survives into the `sudo` process. `~/.zshenv` works for zsh. For bash, having it in `~/.bashrc` requires an interactive shell. In non-interactive/fish environments, consider an `alias sudo='sudo -A'` in that shell.

## Usage

Just use opencode normally. Any time it needs root, the compact dialog appears showing the command to be run. Type your password to allow it once, or Cancel to deny.

## Backend

The helper uses a native **GJS + GTK4 + libadwaita** dialog (`Adw.Window` with a `PasswordEntryRow` and monospace command label) — a tiny single-screen window. This is the only backend; it prints a clear error if `gjs` is unavailable.

The plugin writes JSON (`{command, purpose, ts}`) to the shared reason file; the GJS helper reads it with `Gio` (with fallback to old flat-string files). A 120-second staleness guard distrusts outdated purpose text while still showing the command.

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
