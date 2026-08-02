#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE="$ROOT/runtime/bin/node"
if [ ! -x "$NODE" ]; then
  printf '%s\n' 'The bundle does not contain an executable Node runtime.' >&2
  exit 1
fi

INSTALL_ROOT=${BINAFLOW_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/binaflow}
if [ "${1:-}" = "--root" ]; then
  INSTALL_ROOT=${2:?--root requires a path}
  shift 2
fi
if [ "$#" -ne 0 ]; then
  printf 'Unknown installer arguments: %s\n' "$*" >&2
  exit 1
fi
case "$INSTALL_ROOT" in
  *"'"*) printf '%s\n' "Install paths containing a single quote are unsupported." >&2; exit 1 ;;
esac

mkdir -p "$INSTALL_ROOT"
INSTALL_ROOT=$(CDPATH= cd -- "$INSTALL_ROOT" && pwd)
LOCK="$INSTALL_ROOT/.install.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  printf '%s\n' 'Another Binaflow installation is already in progress.' >&2
  exit 1
fi
STAGING=
cleanup() {
  if [ -n "${STAGING:-}" ]; then rm -rf "$STAGING"; fi
  rm -rf "$LOCK"
}
trap cleanup EXIT INT TERM

VERSION=$(
  "$NODE" -e "const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync('$ROOT/manifest.json','utf8')); if (!/^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/.test(m.version)) process.exit(1); process.stdout.write(m.version)"
)
mkdir -p "$INSTALL_ROOT/versions" "$HOME/.local/bin"
STAGING=$(mktemp -d "$INSTALL_ROOT/.install.XXXXXX")

cp -a "$ROOT/." "$STAGING/"
TARGET="$INSTALL_ROOT/versions/$VERSION"
TARGET_TMP="$INSTALL_ROOT/versions/.${VERSION}.install.$$"
rm -rf "$TARGET_TMP"
mv "$STAGING" "$TARGET_TMP"

CURRENT_TARGET=$(readlink "$INSTALL_ROOT/current" 2>/dev/null || true)
if [ "$CURRENT_TARGET" != "versions/$VERSION" ] || [ ! -d "$TARGET" ]; then
  rm -rf "$TARGET"
  mv "$TARGET_TMP" "$TARGET"
else
  rm -rf "$TARGET_TMP"
fi

OLD_TARGET=$CURRENT_TARGET
if [ -n "$OLD_TARGET" ] && [ "$OLD_TARGET" != "versions/$VERSION" ]; then
  rm -f "$INSTALL_ROOT/.previous.tmp"
  ln -s "$OLD_TARGET" "$INSTALL_ROOT/.previous.tmp"
  mv -Tf "$INSTALL_ROOT/.previous.tmp" "$INSTALL_ROOT/previous"
fi
rm -f "$INSTALL_ROOT/.current.tmp"
ln -s "versions/$VERSION" "$INSTALL_ROOT/.current.tmp"
mv -Tf "$INSTALL_ROOT/.current.tmp" "$INSTALL_ROOT/current"

LAUNCHER_TMP="$HOME/.local/bin/.binaflow.tmp.$$"
{
  printf '%s\n' '#!/usr/bin/env sh' 'set -eu'
  printf '%s\n' "export BINAFLOW_INSTALL_ROOT='$INSTALL_ROOT'"
  printf '%s\n' 'exec "$BINAFLOW_INSTALL_ROOT/current/runtime/bin/node" "$BINAFLOW_INSTALL_ROOT/current/app/dist/src/cli/index.js" "$@"'
} > "$LAUNCHER_TMP"
chmod 755 "$LAUNCHER_TMP"
mv -f "$LAUNCHER_TMP" "$HOME/.local/bin/binaflow"
printf 'Installed Binaflow %s under %s\n' "$VERSION" "$INSTALL_ROOT"
printf '%s\n' 'Ensure $HOME/.local/bin is on PATH, then run: binaflow --help'
