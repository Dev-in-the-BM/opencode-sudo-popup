# Claude Code Notes

## Project overview

This repository provides an OpenCode sudo-approval gate and an optional GNOME Shell extension. The root-owned gate is the security boundary; the extension is an approval UI, not an execution authority.

## Important files

- `src/index.js` — OpenCode plugin hooks and sudo command rewriting.
- `bin/opencode-sudo-gate` — root-owned approval gate, rules, queue, bridge, and GTK fallback.
- `gnome-extension/extension.js` — panel indicator, sessions, approval UI, notifications, and bridge server.
- `gnome-extension/metadata.json` — GNOME extension identity and supported Shell versions.
- `scripts/install-system.js` — privileged installation and self-test for the gate.
- `scripts/install-extension.js` — per-user GNOME extension installation.
- `scripts/pack-extension.js` — extension archive packaging.

## Development rules

- Preserve fail-closed behavior: no command may execute without an authenticated explicit allow decision.
- Do not trust command text, verdicts, or executable paths supplied by user-writable files; inspect the existing validation and ownership checks before changing the protocol.
- Keep the GTK/Adwaita presenter as fallback unless a replacement has been tested end to end.
- After editing `gnome-extension/`, run `node --check gnome-extension/extension.js`, reinstall with `npm run install-extension`, then reload the extension.
- After editing `bin/opencode-sudo-gate`, run relevant syntax/self-tests and reinstall the root-owned copy through the documented polkit path: `run0`.
- For bridge changes, verify both Allow and Deny, and verify behavior when the extension is unavailable.
- Do not broadly stage unrelated user changes; review `git status` and diffs before committing.

## Project documentation

See `README.md` for installation and security details, `goals.md` for acceptance criteria, and `progress.md` for current verified status and follow-up work.
