# opencode-sudo-popup

When opencode runs tasks with `sudo`, it often halts mid-work to ask you to run a privileged command manually. This plugin lets opencode request root itself through a native desktop popup — showing exactly which command is about to run — so your workflow isn't interrupted.

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
- Installs the plugin itself to `~/.config/opencode/plugin/sudo-reason.js` (OpenCode V1) and `~/.config/opencode/plugins/sudo-reason.js` (OpenCode V2).
- Adds `export SUDO_ASKPASS=...` to your shell rc file (`~/.zshenv`, `~/.bashrc`, or `~/.config/fish/config.fish` — only if not already set).

> Restart opencode after installing so the plugin is loaded at startup.

> V2 note: the plugin is built for the OpenCode V2 plugin API (`@opencode/plugin`, `Plugin.define`) and keeps a V1 `server()` export for legacy hosts. Because `postinstall` drops it straight into the discovered plugin directory, no `plugins` entry is needed in `opencode.json`. To load it as a package instead, add `"plugins": ["opencode-sudo-popup"]`.

> Note: opencode may load your config shell with `sudo` (e.g. `sudo -A`). Ensure `SUDO_ASKPASS` is set in an environment that survives into the `sudo` process. `~/.zshenv` works for zsh. For bash, having it in `~/.bashrc` requires an interactive shell. In non-interactive/fish environments, consider an `alias sudo='sudo -A'` in that shell.

## Usage

Just use opencode normally. Any time it needs root, the compact dialog appears showing the command to be run. Type your password to allow it once, or Cancel to deny.

## Backend

The helper uses a native **GJS + GTK4 + libadwaita** dialog (`Adw.Window` with a `PasswordEntryRow` and monospace command label) — a tiny single-screen window. This is the only backend; it prints a clear error if `gjs` is unavailable.

The plugin writes JSON (`{command, purpose, ts}`) to the shared reason file; the GJS helper reads it with `Gio` (with fallback to old flat-string files).

## What it catches

It only matches `sudo` used as an actual command (whole word at a command boundary) — so it won't false-positive on a file path like `./some/sudo/file` or a `#`-comment mentioning sudo. It also strips sudo flags (`-u`, `-p`, etc.) and shell separators so the dialog shows the *real* command that needs root (e.g. `sudo apt update`).

## Development

```bash
git clone https://github.com/uvindusl/opencode-sudo-popup
cd opencode-sudo-popup
npm install
# postinstall wires the askpass helper into ~/.config/opencode.
# To test the command-detection logic in isolation (V2 + V1 hooks):
node --input-type=module -e "
import('./src/index.js').then(async (m) => {
  const p = m.default;
  // OpenCode V2 hook
  await p.setup({ tool: { hook: async (name, cb) => { await cb({ tool: 'bash', input: { command: 'sudo apt update' } }); return { dispose() {} } } } });
  // OpenCode V1 hook
  const hooks = await p.server();
  await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'sudo apt update' } });
});
cat /tmp/opencode-sudo-reason
"
```

## License

MIT
