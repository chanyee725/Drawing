#!/usr/bin/env bash
# Update Drawing on this machine from its latest GitHub release bundle (drawing-<ver>.tgz).
#
#   update.sh              download the latest release, unpack it, restart running servers
#   update.sh --tag v1.2.3 use that release instead of the latest
#   update.sh --no-restart unpack only
#
# Uses gh (already logged in) for the download. Unpacks into ~/.dispatch/drawing/<ver>/ and points
# ~/.dispatch/drawing/current at it. Older versions are kept; delete them by hand when you like.
set -euo pipefail

repo="chanyee725/Drawing"
base="${DRAWING_HOME:-$HOME/.dispatch/drawing}"
tag=""
restart=true
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="${2:?--tag needs a value}"; shift 2 ;;
    --no-restart) restart=false; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

command -v gh >/dev/null || { echo "gh is not installed (https://cli.github.com)" >&2; exit 1; }
command -v node >/dev/null || { echo "node is not installed" >&2; exit 1; }

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }

step "1. Find the release"
[ -n "$tag" ] || tag="$(gh release view --repo "$repo" --json tagName --jq .tagName)"
ok "$repo $tag"

step "2. Download"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/dl" "$work/x"
gh release download "$tag" --repo "$repo" --pattern 'drawing-*.tgz' --dir "$work/dl"
files=("$work"/dl/drawing-*.tgz)
[ ${#files[@]} -eq 1 ] && [ -f "${files[0]}" ] || { echo "release $tag has no single drawing-<ver>.tgz asset" >&2; exit 1; }
bundle="${files[0]}"
ok "$(basename "$bundle")"

step "3. Unpack"
# The download is untrusted data: refuse absolute paths and '..' before extracting, into an empty dir.
if tar -tzf "$bundle" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "bundle has unsafe paths; not unpacking" >&2
  exit 1
fi
tar -xzf "$bundle" -C "$work/x"
dirs=("$work"/x/drawing-*)
[ ${#dirs[@]} -eq 1 ] && [ -f "${dirs[0]}/server/index.js" ] && [ -f "${dirs[0]}/plugin/.claude-plugin/plugin.json" ] \
  || { echo "bundle layout is not drawing-<ver>/{server,plugin}" >&2; exit 1; }
ver="$(basename "${dirs[0]}")"
mkdir -p "$base"
rm -rf "$base/$ver"
mv "${dirs[0]}" "$base/$ver"
ln -sfn "$base/$ver" "$base/current"
ok "$base/$ver (current)"

if $restart; then
  step "4. Restart running servers"
  found=0
  for f in "$HOME"/.dispatch/servers/*.json; do
    [ -f "$f" ] || continue
    eval "$(node -e '
      const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const alive = (() => { try { process.kill(e.pid, 0); return true; } catch (x) { return x.code === "EPERM"; } })();
      const p = String(e.path || "").replace(/^~/, process.env.HOME);
      console.log(`port=${e.port || ""}; path=${JSON.stringify(p)}; alive=${alive}`);
    ' "$f")"
    [ "$alive" = true ] && [ -d "$path" ] || continue
    found=$((found + 1))
    DISPATCH_PORT="$port" "$base/current/plugin/skills/dispatch/scripts/restart.sh" "$path" | sed 's/^/    /'
  done
  [ "$found" -gt 0 ] && ok "restarted $found server(s); cut-off turns resume on their own" || ok "no running servers"
fi

step "Done"
echo "Plugin folder: $base/current/plugin"
echo "If the plugin is not installed from this folder yet, in Claude Code run:"
echo "  /plugin marketplace add $base/current/plugin"
echo "  /plugin install dispatch@dispatch"
echo "(already installed: /plugin marketplace update dispatch, then /plugin update dispatch@dispatch)"
