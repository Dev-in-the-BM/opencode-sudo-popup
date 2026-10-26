# Goals

## Product goals

- Require an explicit user decision before OpenCode executes a privileged command.
- Fail closed: denial, timeout, missing display, bridge failure, or other errors must never run the command.
- Prefer the GNOME Shell extension for approval requests, with a clear notification and an automatically opened approval menu.
- Preserve the standalone GTK/Adwaita approval window as a fallback when the extension cannot be reached or authenticated.
- Let users inspect OpenCode sessions and pending approvals from the GNOME panel.

## Security goals

- Keep the gate executable root-owned and restrict passwordless sudo to that executable only.
- Derive the executed command from argv, not user-writable metadata.
- Authenticate the extension bridge and validate the GNOME Shell peer before accepting decisions.
- Keep approval actions explicit and protect against accidental early input.
- Never disable a working fail-closed path until its replacement is verified end to end.

## Acceptance checks

- The extension loads and is `ACTIVE` on supported GNOME Shell versions.
- A new request produces a notification and opens the extension approval menu.
- Allow runs only the requested command; deny blocks it; the gate reports the resulting status correctly.
- Requests still fail closed if the extension is disabled or the bridge is unavailable.
- Session browsing remains read-only and does not interfere with approval handling.
