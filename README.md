# opencode-sudo-popup

An [OpenCode V2](https://opencode.ai) plugin and optional GNOME Shell extension that require your approval before OpenCode runs a command through `sudo`.

The plugin routes recognized `sudo` commands through a root-owned gate. The gate shows the exact command and working directory in the GNOME extension when available, or in a standalone GTK4/libadwaita dialog otherwise. **Allow** runs the command as root; **Deny**, closing the dialog, timing out, or an error blocks it.

## Requirements

- Linux, OpenCode V2, and `sudo`
- Node.js for installation
- GJS, GTK4, libadwaita, and an active graphical session for approvals
- GNOME Shell 49+ and Python 3 with its SQLite module for the optional session extension

## Install

```bash
git clone https://github.com/uvindusl/opencode-sudo-popup
cd opencode-sudo-popup
npm install
sudo "$(command -v node)" scripts/install-system.js
```

Run the system installer from a terminal (not from OpenCode), using your normal `sudo` authentication. It installs the root-owned gate at `/usr/local/bin/opencode-sudo-gate`, creates its narrowly scoped sudoers rule, initializes permanent rules without overwriting existing ones, and runs a self-test. `npm install` installs the plugin in `~/.config/opencode/plugins/`; restart OpenCode after installation.

To install the optional GNOME extension:

```bash
npm run install-extension
gnome-extensions enable opencode-sudo-popup@uvindusl.github.io
```

It adds **Currently running** and **Recently used** session tabs (up to 20 displayed at a time, with scrolling), pending approval controls (**Deny**, **Allow once**, and, when available, **Allow session**), and a link to manage permanent rules. Session browsing is read-only. To package the extension, run `npm run pack-extension`.

## Security

- The sudoers rule permits passwordless execution of only the absolute gate path; it does not grant general passwordless sudo.
- The gate is installed root-owned. It derives the command to execute from its arguments, not the plugin's writable reason file.
- Approval requests use an authenticated local socket. The gate validates the GNOME Shell peer before trusting extension decisions; otherwise it falls back to the standalone dialog.
- Permanent allow/deny rules are managed by the root-owned gate. Deny rules take precedence over allow rules.
- The child command runs with a minimal, controlled environment. Missing UI, denial, timeout, or execution errors fail closed.

## Limitations

- Only recognized `sudo` command occurrences in OpenCode shell commands are rewritten. Occurrences inside quotes or comments are skipped; an unrewritten `sudo` still requires normal authentication and cannot silently pass through the gate.
- `sudo -u` / `--user` is honored; other sudo options are consumed because the gate handles authentication.
- The displayed purpose is a best-effort heuristic. Always review the exact command before allowing it.
- Without GJS/GTK/libadwaita or a usable display, approval cannot be shown and the command is blocked.

## Development

- After editing `src/index.js`, run `node scripts/install.js` and restart OpenCode.
- After editing `gnome-extension/`, run `node --check gnome-extension/extension.js`, then `npm run install-extension` and reload the extension.
- After editing `bin/opencode-sudo-gate`, rerun `sudo "$(command -v node)" scripts/install-system.js`.

## License

MIT
