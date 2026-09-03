#!/bin/bash
# SUDO_ASKPASS helper for opencode-sudo-popup — Why + What prompt.
# Contract: print password to stdout on OK, exit non-zero on Cancel.
# Reads context from /tmp/opencode-sudo-reason (JSON from src/index.js,
# backward-compatible with the old flat-string file).

REASON_FILE="/tmp/opencode-sudo-reason"
TITLE="Opencode — Administrator access required"
GENERIC_WHY="Opencode requested root to run the command below. Only approve if you expected a privileged step."

# --- Read reason file (JSON with flat-string fallback) ----------------------
content=""
if [[ -r "$REASON_FILE" ]]; then
  content=$(head -c 2048 "$REASON_FILE" 2>/dev/null | tr -d '\0')
fi
trimmed=$(printf '%s' "$content" | sed -e 's/^[[:space:]]*//')

raw_cmd=""; raw_purpose=""; stale=0
if [[ "$trimmed" == \{* ]]; then
  # Preferred: real JSON parse (python3 is ubiquitous on Linux, ~30ms).
  parsed=""
  if command -v python3 >/dev/null 2>&1; then
    parsed=$(python3 -c 'import json,sys
try:
  d=json.load(open(sys.argv[1],encoding="utf-8",errors="replace"))
  print(d.get("command","")+"\x1f"+d.get("purpose",""))
except Exception:
  sys.exit(1)' "$REASON_FILE" 2>/dev/null)
  fi
  if [[ -n "$parsed" ]]; then
    IFS=$'\x1f' read -r raw_cmd raw_purpose <<< "$parsed"
  else
    # Fallback: best-effort extraction for simple values (no embedded quotes).
    # Worst case this yields empty -> generic fallback below. Never blocks.
    raw_cmd=$(printf '%s' "$content" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    raw_purpose=$(printf '%s' "$content" | sed -n 's/.*"purpose"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    raw_cmd=$(printf '%s' "$raw_cmd" | sed -e 's/\\"/"/g' -e 's/\\\\/\\/g')
    raw_purpose=$(printf '%s' "$raw_purpose" | sed -e 's/\\"/"/g' -e 's/\\\\/\\/g')
  fi
elif [[ -n "$trimmed" ]]; then
  raw_cmd="$content"  # old flat-string file: whole content is the command
fi

# --- Staleness guard (write-then-immediate-use) ------------------------------
# Hook writes just before bash runs; askpass fires seconds later.
# If the file is older than 120s it belongs to a previous command:
# keep the command as evidence but distrust the purpose.
if [[ -r "$REASON_FILE" ]]; then
  mtime=0; now=$(date +%s 2>/dev/null || echo 0)
  if stat -c %Y "$REASON_FILE" >/dev/null 2>&1; then
    mtime=$(stat -c %Y "$REASON_FILE" 2>/dev/null || echo 0)
  else
    mtime=$(stat -f %m "$REASON_FILE" 2>/dev/null || echo 0)
  fi
  if (( now > 0 && mtime > 0 && now - mtime > 120 )); then
    stale=1
  fi
fi

# --- Sanitize + truncate ------------------------------------------------------
raw_cmd=$(printf '%s' "$raw_cmd" | tr '\n' ' ' | sed -e 's/[[:space:]][[:space:]]*/ /g' -e 's/^ //;s/ $//')
raw_purpose=$(printf '%s' "$raw_purpose" | tr '\n' ' ' | sed -e 's/[[:space:]][[:space:]]*/ /g' -e 's/^ //;s/ $//')

[[ -z "$raw_cmd" ]] && raw_cmd="(no command details available — generic sudo request)"
[[ -z "$raw_purpose" || "$stale" == "1" ]] && raw_purpose="$GENERIC_WHY"
(( stale == 1 )) && raw_purpose="$GENERIC_WHY (context may be outdated — verify in terminal)."

if (( ${#raw_cmd} > 300 )); then
  display_cmd="${raw_cmd:0:300}… (+$(( ${#raw_cmd} - 300 )) more chars, see terminal)"
else
  display_cmd="$raw_cmd"
fi
if (( ${#raw_purpose} > 240 )); then
  display_why="${raw_purpose:0:240}…"
else
  display_why="$raw_purpose"
fi

# Escape for Pango markup (zenity/yad --text). Order matters: & first.
esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
esc_cmd=$(esc "$display_cmd")
esc_why=$(esc "$display_why")

# --- Shared copy: Why and What are visually separated -------------------------
# Purpose is proportional text under its own bold header; command is an
# isolated <tt> block. Raw command text can never read as part of the sentence.
ZENITY_TEXT="<span size='large'><b>🔒 Opencode wants administrative access</b></span>

<b>Why this is needed</b>
<span>${esc_why}</span>

<b>Command that will run</b>
<tt>${esc_cmd}</tt>

<span size='small'>⚠ This grants <b>full root access</b> for this command only. Cancel if this looks unexpected.</span>

Enter your password to allow this once:"
YAD_TEXT="<span size='large'><b>🔒 Opencode wants administrative access</b></span>\n\n<b>Why this is needed</b>\n<span>${esc_why}</span>\n\n<b>Command that will run</b>\n<tt>${esc_cmd}</tt>\n\n<span size='small'>⚠ Grants <b>full root access</b> for this command only. Cancel if unexpected.</span>\n"
PLAIN_TEXT="Opencode wants administrative access.

Why this is needed:
  ${display_why}

Command that will run:
  ${display_cmd}

⚠ Grants full root access for this command only.
Enter your password to allow this once (Cancel if unexpected)."

# --- Backends (fastest/most native first) ---------------------------------
# Preferred: modern Adwaita dialog via GJS + GTK4/libadwaita (native on GNOME).
# Prints password to stdout on OK, exit 1 on Cancel — same askpass contract.
GJS_DIALOG="$(dirname "$0")/sudo-askpass-gjs.js"
if command -v gjs >/dev/null 2>&1 && [[ -f "$GJS_DIALOG" ]]; then
  exec gjs "$GJS_DIALOG" 2>/dev/null
fi

# NOTE: stock `zenity --password` silently IGNORES --text (it always shows
# the default "Type your password" prompt), so we use --entry --hide-text
# instead — same askpass contract (prints entry on OK/exit 0, nothing on
# Cancel/exit 1) but actually renders our Why+What body.
if command -v zenity >/dev/null 2>&1; then
  exec zenity --entry --hide-text \
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
  # qarma is a Qt zenity clone — same --password limitation, same workaround.
  exec qarma --entry --hide-text \
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
    printf 'Why this is needed:\n  %s\n' "$display_why"
    printf 'Command that will run:\n  \033[36m%s\033[0m\n' "$display_cmd"
    printf '\033[33m⚠ Grants full root access. Cancel (Ctrl+C) if unexpected.\033[0m\n'
    printf 'Password: '
  else
    printf '\n%s\nWhy this is needed:\n  %s\nCommand that will run:\n  %s\n' "$TITLE" "$display_why" "$display_cmd"
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
