#!/bin/bash
# SUDO_ASKPASS helper for opencode-sudo-popup.
# Shows a desktop GUI password dialog showing what command needs sudo,
# falling back to other dialogs / a plain terminal prompt if no GUI tool exists.

reason="opencode needs sudo access"
if [[ -r /tmp/opencode-sudo-reason ]]; then
  cmd=$(head -c 400 /tmp/opencode-sudo-reason | tr '\n' ' ')
  [[ -n "$cmd" ]] && reason="Opencode needs SUDO for: $cmd"
fi

# Priority order: zenity (GNOME), yad, kdialog (KDE), qarma (LXQt),
# then a plain terminal password prompt as last resort.
if command -v zenity >/dev/null 2>&1; then
  exec zenity --password --title="$reason" 2>/dev/null
elif command -v yad >/dev/null 2>&1; then
  exec yad --entry --hide-text --image=dialog-password --title="$reason" \
    --text="Enter your password" 2>/dev/null
elif command -v kdialog >/dev/null 2>&1; then
  exec kdialog --password "$reason" 2>/dev/null
elif command -v qarma >/dev/null 2>&1; then
  exec qarma --password --title="$reason" 2>/dev/null
fi

# No GUI dialog available — fall back to a terminal prompt.
# sudo -A wraps this and reads the line as the password.
if [[ -t 0 ]]; then
  printf '%s\n' "SUDO password required:"
  read -r -s password
  printf '%s\n' "$password"
else
  # Not a tty (sudo calls -A non-interactively); ask on /dev/tty.
  exec < /dev/tty
  printf '%s\n' "SUDO password required:"
  read -r -s password
  printf '%s\n' "$password"
fi
