#!/bin/bash
# opencode-sudo-popup — sudo wrapper.
#
# Intercepts `sudo` invocations so the desktop popup can show *which*
# command needs root before asking for the password — but only when the
# call comes from OpenCode (non-interactive, no TTY). When you run `sudo`
# yourself in an interactive terminal, it behaves like normal sudo and
# prompts for the password in the terminal as expected.
#
# Behaviour:
#   - Interactive terminal (TTY present): exec real sudo without -A.
#     Password is read from the terminal as usual.
#   - Non-interactive (e.g. OpenCode bash tool): write the command to the
#     shared reason file, then exec real sudo with -A (askpass) so the
#     SUDO_ASKPASS popup appears.
#
# Contract: prints nothing on success; the askpass helper prints the password
# to stdout. On Cancel, the askpass helper exits non-zero and sudo fails.
#
# Safety: the real sudo is invoked by absolute path (/usr/bin/sudo) to avoid
# recursive calls into this wrapper.

REASON_FILE="/tmp/opencode-sudo-reason"

# If stdin is a terminal, the user invoked sudo themselves — do not interfere.
if [ -t 0 ]; then
  exec /usr/bin/sudo "$@"
fi

# Non-interactive context (e.g. OpenCode): record the command so the
# askpass dialog can display it, then use askpass for the password.
printf '%s\n' "$*" > "$REASON_FILE" 2>/dev/null || true

exec /usr/bin/sudo -A "$@"
