#!/bin/sh
# Shufi installer for macOS and Linux (arm64 and x64).
#
#   curl -fsSL https://raw.githubusercontent.com/ManceRayder42/shufi/master/install.sh | sh
#
# What it does, and all of it:
#   1. Puts the `shufi` launcher (bin/shufi) in ~/.local/bin, creating that folder if needed.
#   2. If ~/.local/bin is not on your PATH, appends one export line to your shell's startup
#      file (never twice) and tells you which file.
#   3. Runs `shufi start`, which installs whatever is missing (Node.js, Claude Code, the
#      Shufi plugin) and opens the setup screen. Skip this with --no-start or SHUFI_NO_START=1.
# No sudo. Nothing else on the machine is touched here.
#
# Environment: SHUFI_RAW_BASE (where bin/shufi is fetched from when this script is piped).
# Run from a checkout (`sh install.sh`) it installs that checkout's bin/shufi instead.

main() {
  RAW_BASE="${SHUFI_RAW_BASE:-https://raw.githubusercontent.com/ManceRayder42/shufi/master}"
  no_start="${SHUFI_NO_START:-}"
  for a in "$@"; do
    case $a in
      --no-start) no_start=1 ;;
      -h | --help) sed -n '2,15p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) printf 'install.sh: unknown option %s\n' "$a" >&2; exit 2 ;;
    esac
  done

  case $(uname -s) in
    Darwin | Linux) ;;
    *) printf 'install.sh: %s is not supported. Use macOS or Linux (on Windows, WSL).\n' "$(uname -s)" >&2; exit 1 ;;
  esac
  if [ -z "${HOME:-}" ] || [ ! -d "$HOME" ]; then
    printf 'install.sh: HOME is not set to a folder.\n' >&2
    exit 1
  fi

  BIN_DIR="$HOME/.local/bin"
  changed=""

  # A checkout next to this script wins; when piped from curl, $0 is just "sh".
  here=""
  if [ "$(basename "$0")" = install.sh ]; then
    d=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
    if [ -n "$d" ] && [ -f "$d/bin/shufi" ]; then here=$d; fi
  fi

  if [ ! -d "$BIN_DIR" ]; then
    mkdir -p "$BIN_DIR" || { printf 'install.sh: cannot create %s\n' "$BIN_DIR" >&2; exit 1; }
    changed="$changed
  created $BIN_DIR"
  fi

  tmp="$BIN_DIR/.shufi.$$"
  if [ -n "$here" ]; then
    cp "$here/bin/shufi" "$tmp" || { printf 'install.sh: cannot copy %s/bin/shufi\n' "$here" >&2; exit 1; }
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$tmp" "$RAW_BASE/bin/shufi" || { rm -f "$tmp"; printf 'install.sh: download failed: %s/bin/shufi\n' "$RAW_BASE" >&2; exit 1; }
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$tmp" "$RAW_BASE/bin/shufi" || { rm -f "$tmp"; printf 'install.sh: download failed: %s/bin/shufi\n' "$RAW_BASE" >&2; exit 1; }
  else
    printf 'install.sh: need curl or wget.\n' >&2
    exit 1
  fi
  if ! sh -n "$tmp" 2>/dev/null || ! grep -q '^# shufi: the Shufi launcher' "$tmp"; then
    rm -f "$tmp"
    printf 'install.sh: what was fetched is not the Shufi launcher; nothing installed.\n' >&2
    exit 1
  fi
  chmod 755 "$tmp"
  mv "$tmp" "$BIN_DIR/shufi" || { rm -f "$tmp"; printf 'install.sh: cannot write %s/shufi\n' "$BIN_DIR" >&2; exit 1; }
  changed="$changed
  wrote $BIN_DIR/shufi"

  # PATH: only when ~/.local/bin is missing from it, and only once.
  case ":$PATH:" in
    *":$BIN_DIR:"*) path_note="$BIN_DIR is already on your PATH; no shell startup file was changed." ;;
    *)
      shell_name=$(basename "${SHELL:-/bin/sh}")
      line='export PATH="$HOME/.local/bin:$PATH"'
      case $shell_name in
        zsh) rc="$HOME/.zshrc" ;;
        bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
        fish) rc="$HOME/.config/fish/config.fish"; line='fish_add_path -g "$HOME/.local/bin"' ;;
        *) rc="$HOME/.profile" ;;
      esac
      if [ -f "$rc" ] && grep -q '\.local/bin' "$rc"; then
        path_note="$rc already mentions ~/.local/bin; left it alone. New terminal windows will find shufi."
      else
        mkdir -p "$(dirname "$rc")"
        printf '\n# Added by the Shufi installer\n%s\n' "$line" >>"$rc" || { printf 'install.sh: cannot write %s\n' "$rc" >&2; exit 1; }
        path_note="added ~/.local/bin to your PATH in $rc. New terminal windows will find shufi."
        changed="$changed
  appended one PATH line to $rc"
      fi
      ;;
  esac

  printf '\nShufi launcher installed.\nChanged:%s\n%s\n' "$changed" "$path_note"

  if [ -n "$no_start" ]; then
    printf '\nNext: %s/shufi start\n' "$BIN_DIR"
    exit 0
  fi
  printf '\nStarting setup (shufi start)...\n\n'
  if [ ! -t 0 ]; then exec 0</dev/null; fi
  exec "$BIN_DIR/shufi" start
}

main "$@"
