#!/bin/bash
# SUDO_ASKPASS helper for opencode-sudo-popup — compact popup.
# Contract: print password to stdout on OK, exit non-zero on Cancel.
# Reads context from /tmp/opencode-sudo-reason (JSON from src/index.js,
# backward-compatible with the old flat-string file).

REASON_FILE="/tmp/opencode-sudo-reason"

# --- Backend: modern compact dialog via GJS + GTK4/libadwaita -----------------
# Prints password to stdout on OK, exit 1 on Cancel — same askpass contract.
GJS_DIALOG="$(dirname "$0")/sudo-askpass-gjs.js"
if command -v gjs >/dev/null 2>&1 && [[ -f "$GJS_DIALOG" ]]; then
  exec gjs "$GJS_DIALOG" 2>/dev/null
fi

# --- No GJS available ---------------------------------------------------------
echo "opencode-sudo-popup: gjs + GTK4/libadwaita not found; cannot show the sudo popup." >&2
echo "Install gjs and libadwaita (e.g. apt install gjs gir1.2-gtk-4.0 libadwaita-1-0)." >&2
exit 1