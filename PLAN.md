# Permanent command rules manager

## Goal

Provide a GNOME UI to view, add, and delete permanent allow/deny command rules without letting the user-session extension write trusted policy files.

## Design

- Add a **Manage permanent rules…** entry to the extension panel menu.
- Use the GNOME extension Preferences window as the full manager, with separate allow and deny lists and add/delete controls.
- Keep `/etc/opencode-sudo-gate/rules.json` as the authoritative root-owned policy file.
- Add a narrow management mode to the root-owned gate for listing, adding, and deleting validated rules. Invoke it through `pkexec`; never accept arbitrary file paths or rule objects from the UI.
- Preserve the current decision semantics: any matching deny still wins over allow; persistent rules remain a fast path; all failures to change policy are reported and do not relax policy.

## Work plan

1. [x] Implement gate management actions in `bin/opencode-sudo-gate`: read-only listing, bounded/validated rule additions, stale-safe deletion, root-owned-file checks, and Polkit-only rule changes.
2. [x] Implement an Adw Preferences manager that lists rules, validates additions, deletes rules, and reports authorization or management errors.
3. [x] Add the panel menu action and include the preferences module in the extension package.
4. [x] Update user documentation; syntax checks, packaging, read-only listing, and unprivileged mutation rejection pass. The privileged system gate install and interactive Polkit flow remain to be verified on the user's machine.

## Acceptance checks

- Users can list existing always-allow and always-deny rules.
- Users can add and delete a command-pattern rule through an authenticated privileged action.
- Invalid arguments and malformed patterns cannot alter rules; the management command cannot run as an unprivileged process.
- Rule precedence and fail-closed behavior remain unchanged.
- The panel entry opens the manager, and the extension installs with its preferences module.
