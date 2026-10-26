# Progress

## Current status

- The GNOME Shell extension is installed and active on GNOME Shell 50.1.
- It shows OpenCode sessions and pending privileged-command approvals in its panel menu.
- New approval requests raise a generic GNOME notification and open the approval menu.
- The root-owned gate prefers the extension over its standalone GTK/Adwaita presenter and falls back to that presenter if the extension bridge is unavailable.
- The extension bridge uses an abstract Unix socket. It authenticates the root peer on the Shell side; the gate validates that the peer is the active GNOME Shell process before trusting a decision.
- Fixed gate input handling to decode socket `Uint8Array` data before parsing JSON. This was causing extension decisions to be discarded and approved commands to fail closed.

## Verified

- `node --check gnome-extension/extension.js` passes.
- `gjs -m bin/opencode-sudo-gate --rules` runs successfully.
- `git diff --check` passes.
- The system installer completed; the installed gate matches the repository version and `--selftest` returned `ok`.
- A harmless `sudo true` request completed successfully through the extension approval flow.
- GNOME reports `opencode-sudo-popup@uvindusl.github.io` as `ACTIVE`.

## Latest commit

- `b5ee662` — `Add GNOME approval extension popup`

## Follow-up

- Exercise approval and denial with representative real commands and confirm the fail-closed fallback still works when the extension is unavailable.
- Keep the standalone presenter as fallback unless a replacement is implemented and verified; do not disable it prematurely.
- Reinstall the root-owned gate with the documented polkit (`run0`) path after changing `bin/opencode-sudo-gate`.
- Reinstall/reload the extension after changing files under `gnome-extension/`.
