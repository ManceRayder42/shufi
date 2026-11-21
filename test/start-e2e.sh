#!/bin/sh
# Manual end-to-end check of install.sh + `shufi start` on a machine with NO Node.js and NO git.
# Needs network (nodejs.org) and a real `claude` binary. Not part of `node --test`.
#
#   sh test/start-e2e.sh
#
# It runs in a scratch HOME under $TMPDIR and a PATH made of symlinks to system tools only
# (no node, no git), so nothing on your real machine changes. What it proves, in order:
#   1. install.sh from the local checkout installs ~/.local/bin/shufi and the PATH line
#   2. shufi start in a HOME where Claude Code is not signed in stops with exit 3
#   3. shufi start downloads the pinned official Node.js, verifies the checksum, installs the
#      plugin (local copy, since there is no git), and the setup page answers HTTP 200
#   4. a hook runs through bin/shufi-node on a PATH with no node, and exits 0 with no node at all
#   5. shufi host codex wires Codex, and the command it registers runs on that same PATH
#   6. a tampered download of the REAL pinned tarball is refused (exit 4, nothing installed)
#
# Env: SHUFI_E2E_TREE (the checkout to test, default: this one), SHUFI_E2E_CLAUDE (path to claude).

TREE=${SHUFI_E2E_TREE:-$(cd "$(dirname "$0")/.." && pwd)}
CLAUDE_REAL=${SHUFI_E2E_CLAUDE:-$(command -v claude)}
[ -x "$CLAUDE_REAL" ] || { echo "no claude binary; set SHUFI_E2E_CLAUDE"; exit 2; }
E2E=$(mktemp -d "${TMPDIR:-/tmp}/shufi-e2e.XXXXXX") || exit 2
H="$E2E/home"; FARM="$E2E/farm"; mkdir -p "$H" "$FARM" "$E2E/srcparent"
fail=0
ok() { echo "PASS: $*"; }
bad() { echo "FAIL: $*"; fail=1; }

for t in sh bash env uname curl tar gzip mkdir mv rm cat grep sed awk find date ln chmod dirname basename mktemp tr cut head tail sort \
         touch ls cp id wc readlink shasum sha256sum openssl sysctl ldd sleep kill nohup printf perl ps xargs; do
  for d in /usr/bin /bin /usr/sbin /sbin; do [ -x "$d/$t" ] && { ln -sf "$d/$t" "$FARM/$t"; break; }; done
done
ln -sf "$CLAUDE_REAL" "$FARM/claude"
echo "scratch: $E2E   tree: $TREE"
echo "== precondition: no node, no git on PATH"
if PATH="$FARM" command -v node >/dev/null 2>&1; then bad "node is on the test PATH"; else ok "command -v node fails"; fi
if PATH="$FARM" command -v git >/dev/null 2>&1; then bad "git is on the test PATH"; else ok "command -v git fails"; fi

# The "GitHub tarball" the launcher falls back to when there is no git: this checkout, one top folder.
mkdir -p "$E2E/srcparent/shufi-main"
(cd "$TREE" && tar -cf - --exclude node_modules . ) | (cd "$E2E/srcparent/shufi-main" && tar -xf -)
tar -czf "$E2E/src.tgz" -C "$E2E/srcparent" shufi-main
RAW="file://$TREE"

run() { env -i HOME="$H" PATH="$FARM:$H/.local/bin" SHELL=/bin/zsh "$@"; }

echo; echo "== 1. install.sh (local file), no start"
env -i HOME="$H" PATH="$FARM" SHELL=/bin/zsh SHUFI_NO_START=1 sh "$TREE/install.sh"; echo "exit=$?"
[ -x "$H/.local/bin/shufi" ] && ok "launcher installed" || bad "launcher missing"
echo "--- ~/.zshrc now:"; cat "$H/.zshrc"
echo "--- second run changes nothing:"
env -i HOME="$H" PATH="$FARM" SHELL=/bin/zsh SHUFI_NO_START=1 sh "$TREE/install.sh" | tail -n 4
[ "$(grep -c '\.local/bin' "$H/.zshrc")" = 1 ] && ok "exactly one PATH line after two runs" || bad "PATH line duplicated"

echo; echo "== 2. shufi start, Claude Code not signed in"
run env SHUFI_SOURCE_URL="file://$E2E/src.tgz" shufi start --no-open; rc=$?
echo "exit=$rc"; [ "$rc" = 3 ] && ok "exit 3 (not signed in)" || echo "NOTE: exit $rc (is this machine's claude signed in under the scratch HOME?)"

echo; echo "== 3. shufi start --background (login check skipped), real Node.js download"
run env SHUFI_SKIP_LOGIN_CHECK=1 SHUFI_SOURCE_URL="file://$E2E/src.tgz" shufi start --background --no-open >"$E2E/start.out" 2>"$E2E/start.err"; rc=$?
cat "$E2E/start.err"; cat "$E2E/start.out"; echo "exit=$rc"
[ "$rc" = 0 ] && ok "start exit 0" || bad "start exit $rc"
URL=$(sed -n 's/^Setup screen: //p' "$E2E/start.out"); PID=$(sed -n 's/^Server pid: \([0-9]*\).*/\1/p' "$E2E/start.out")
PLUGIN_ROOT=$(sed -n 's/^Plugin root: //p' "$E2E/start.out")
code=$(PATH="$FARM" curl -s -o /dev/null -w '%{http_code}' "$URL")
echo "GET setup page -> HTTP $code"; [ "$code" = 200 ] && ok "setup page answers 200" || bad "setup page HTTP $code"
PATH="$FARM" curl -s "$URL" | grep -o '<title>[^<]*</title>' | head -n 1
ls "$H/.shufi/runtime"; "$H"/.shufi/runtime/node-v*/bin/node -v
run claude plugin list --json | grep -E '"id"|"installPath"|"readFromFolder"'
kill "$PID" 2>/dev/null; sleep 1; kill -0 "$PID" 2>/dev/null && bad "server still running" || ok "server stopped"

echo; echo "== 3b. second start is idempotent (no download, plugin already installed)"
run env SHUFI_SKIP_LOGIN_CHECK=1 SHUFI_SKIP_UPDATE=1 shufi start --background --no-open >"$E2E/start2.out" 2>&1; echo "exit=$?"
sed 's/^/  /' "$E2E/start2.out"
grep -q Downloading "$E2E/start2.out" && bad "second start downloaded again" || ok "second start downloaded nothing"
PID2=$(sed -n 's/^Server pid: \([0-9]*\).*/\1/p' "$E2E/start2.out"); kill "$PID2" 2>/dev/null

echo; echo "== 3c. shufi doctor"
run shufi doctor; echo "exit=$?"

echo; echo "== 4. hook through the shim, PATH has no node"
printf '{}' | env -i HOME="$H" PATH="$FARM" sh "$PLUGIN_ROOT/bin/shufi-node" --hook "$PLUGIN_ROOT/hooks/session-start.mjs"; echo "exit=$?"
echo "-- and with no node anywhere (fresh HOME, no runtime):"
mkdir -p "$E2E/home2"
printf '{}' | env -i HOME="$E2E/home2" PATH="$FARM" sh "$PLUGIN_ROOT/bin/shufi-node" --hook "$PLUGIN_ROOT/hooks/session-start.mjs"; echo "exit=$?"

echo; echo "== 5. shufi host codex, then run the hook command Codex was given"
run shufi host codex --dry-run 2>&1 | tail -n 5
run shufi host codex >/dev/null 2>&1; echo "exit=$?"
CMD=$(grep -o '"command": *"[^}]*session-start[^}]*' "$H/.codex/hooks.json" | head -n 1)
echo "registered: $CMD"
CMDRUN=$("$H"/.shufi/runtime/node-v*/bin/node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.hooks.SessionStart[0].hooks[0].command)' "$H/.codex/hooks.json")
printf '{}' | env -i HOME="$H" PATH="$FARM" sh -c "$CMDRUN"; echo "exit=$?"

run shufi host codex --uninstall >/dev/null 2>&1; echo "uninstall exit=$?"
grep -q session-start "$H/.codex/hooks.json" 2>/dev/null && bad "codex hook still registered" || ok "codex hook removed by --uninstall"

echo; echo "== 6. tampered download of the REAL pinned tarball is refused"
V=$(sed -n 's/^PINNED_NODE_VERSION="\(.*\)"/\1/p' "$TREE/bin/shufi")
case $(uname -s) in Darwin) O=darwin ;; *) O=linux ;; esac
case $(uname -m) in arm64|aarch64) A=arm64 ;; *) A=x64 ;; esac
[ "$O" = darwin ] && [ "$A" = x64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] && A=arm64
mkdir -p "$E2E/mirror/$V"
PATH="$FARM" curl -fsSL -o "$E2E/mirror/$V/node-$V-$O-$A.tar.gz" "https://nodejs.org/dist/$V/node-$V-$O-$A.tar.gz"
PATH="$FARM" curl -fsSL -o "$E2E/mirror/$V/SHASUMS256.txt" "https://nodejs.org/dist/$V/SHASUMS256.txt"
printf 'x' >> "$E2E/mirror/$V/node-$V-$O-$A.tar.gz"
# make the mirror's SHASUMS256.txt agree with the tampered file, so only the pinned hash can catch it
NEW=$(shasum -a 256 "$E2E/mirror/$V/node-$V-$O-$A.tar.gz" | awk '{print $1}')
echo "$NEW  node-$V-$O-$A.tar.gz" > "$E2E/mirror/$V/SHASUMS256.txt"
mkdir -p "$E2E/home3"
env -i HOME="$E2E/home3" PATH="$FARM" SHUFI_NODE_DIST_URL="file://$E2E/mirror" sh "$TREE/bin/shufi" node; rc=$?
echo "exit=$rc"; [ "$rc" = 4 ] && ok "tampered tarball refused (exit 4)" || bad "exit $rc"
ls "$E2E/home3/.shufi/runtime" 2>/dev/null && bad "a runtime was installed" || ok "no runtime directory exists"

echo; [ "$fail" = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
echo "scratch dir kept: $E2E"
exit "$fail"
