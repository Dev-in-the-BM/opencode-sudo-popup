#!/bin/bash
# SUDO_ASKPASS helper for opencode-sudo-popup — modern branded prompt.
# Contract: print password to stdout on OK, exit non-zero on Cancel.
# Reads command context from /tmp/opencode-sudo-reason (written by src/index.js).

REASON_FILE="/tmp/opencode-sudo-reason"
TITLE="Opencode — Administrator access required"

# --- Read + sanitize command ---------------------------------------------
raw_cmd=""
if [[ -r "$REASON_FILE" ]]; then
  # head limits I/O; tr collapses newlines; squeeze spaces; trim ends.
  raw_cmd=$(head -c 800 "$REASON_FILE" 2>/dev/null | tr '\n' ' ' | sed -e 's/[[:space:]][[:space:]]*/ /g' -e 's/^ //;s/ $//')
fi
[[ -z "$raw_cmd" ]] && raw_cmd="(no command details available — generic sudo request)"

# Truncate for display: keep 300 chars, note remainder so nothing is hidden silently.
if (( ${#raw_cmd} > 300 )); then
  display_cmd="${raw_cmd:0:300}… (+$(( ${#raw_cmd} - 300 )) more chars, see terminal)"
else
  display_cmd="$raw_cmd"
fi

# Escape for Pango markup (zenity/yad --text). Order matters: & first.
esc_cmd=$(printf '%s' "$display_cmd" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')

# --- Shared copy ----------------------------------------------------------
# Title is constant (never truncated by WM). Body carries the evidence.
# No hardcoded colors -> dark-mode / HC themes inherit correctly.
ZENITY_TEXT="<span size='large'><b>Opencode wants administrative access</b></span>
<span>An AI-assisted action requested root privileges. Review before authenticating:</span>

<tt>${esc_cmd}</tt>

<span size='small'>⚠ This grants <b>full root access</b> for this command only. Cancel if this looks unexpected.</span>

Enter your password to allow this once:"
YAD_TEXT="<span size='large'><b>🔒 Opencode wants administrative access</b></span>\n\n<span>An AI-assisted action requested root privileges. Review before authenticating:</span>\n\n<tt>${esc_cmd}</tt>\n\n<span size='small' foreground='#888888'>⚠ Grants <b>full root access</b> for this command only. Cancel if unexpected.</span>\n"
PLAIN_TEXT="Opencode wants administrative access.

An AI-assisted action requested root privileges:

  Command: ${display_cmd}

⚠ Grants full root access for this command only.
Enter your password to allow this once (Cancel if unexpected)."

# --- Backends (fastest/most native first) ---------------------------------
if command -v zenity >/dev/null 2>&1; then
  exec zenity --password \
    --title="$TITLE" \
    --text="$ZENITY_TEXT" \
    --window-icon=dialog-password \
    --width=480 --modal \
    --ok-label="Authenticate" --cancel-label="Cancel" 2>/dev/null

elif command -v yad >/dev/null 2>&1; then
  # yad --entry prints the typed text on OK (exit 0), nothing on Cancel (exit 1) — ideal for askpass.
  exec yad --entry --hide-text \
    --title="$TITLE" \
    --window-icon=dialog-password \
    --image=dialog-password \
    --text="$YAD_TEXT" \
    --entry-label="Password:" \
    --width=480 --center --fixed --borders=16 --modal \
    --button="Cancel:1" --button="Authenticate:0" 2>/dev/null

elif command -v kdialog >/dev/null 2>&1; then
  # kdialog --password has no rich text; plain text + icon + fixed title is the best it offers.
  exec kdialog --title "$TITLE" --icon dialog-password \
    --password "$PLAIN_TEXT" 2>/dev/null

elif command -v qarma >/dev/null 2>&1; then
  # qarma is a Qt zenity clone — same flags.
  exec qarma --password \
    --title="$TITLE" \
    --text="$ZENITY_TEXT" \
    --window-icon=dialog-password \
    --width=480 --modal \
    --ok-label="Authenticate" --cancel-label="Cancel" 2>/dev/null
fi

# --- TTY fallback (no GUI) ------------------------------------------------
# Prompts -> stderr, password -> stdout only (so sudo -A reads a clean line).
{
  if [[ -t 2 ]] && command -v tput >/dev/null 2>&1 && (( $(tput colors 2>/dev/null || echo 0) >= 8 )); then
    printf '\n\033[1m🔒 %s\033[0m\n' "$TITLE"
    printf 'Opencode wants to run:\n  \033[36m%s\033[0m\n' "$display_cmd"
    printf '\033[33m⚠ Grants full root access. Cancel (Ctrl+C) if unexpected.\033[0m\n'
    printf 'Password: '
  else
    printf '\n%s\nOpencode wants to run:\n  %s\n' "$TITLE" "$display_cmd"
    printf 'WARNING: grants full root access. Cancel (Ctrl+C) if unexpected.\nPassword: '
  fi
} >&2

# sudo invokes askpass non-interactively; read from /dev/tty when stdin isn't a tty.
# If /dev/tty can't be opened (no controlling terminal), keep stdin as-is.
# (Brace group so the failed-open message itself is silenced.)
if [[ ! -t 0 ]]; then
  { exec < /dev/tty; } 2>/dev/null || true
fi
IFS= read -r -s password || exit 1
printf '\n' >&2
[[ -z "$password" ]] && exit 1
printf '%s\n' "$password"
