#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
case "${1:-}" in
--check) check=true ;;
'') check=false ;;
*)
  echo 'Usage: scripts/format.sh [--check]' >&2
  exit 1
  ;;
esac
[ "$#" -le 1 ] || {
  echo 'Usage: scripts/format.sh [--check]' >&2
  exit 1
}
for tool in gofmt biome shfmt; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing $tool. Run mise install first." >&2
    exit 1
  }
done
if [ "$check" = true ]; then
  biome format .
  shfmt -d -i 2 scripts/*.sh
  unformatted=$(gofmt -l version.go cmd)
  if [ -n "$unformatted" ]; then
    printf 'Run scripts/format.sh on:\n%s\n' "$unformatted" >&2
    exit 1
  fi
else
  biome format --write .
  shfmt -w -i 2 scripts/*.sh
  gofmt -w version.go cmd
fi
