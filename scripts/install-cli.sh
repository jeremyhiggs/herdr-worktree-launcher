#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
prefix="$HOME/.local"
binary=
update=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix) [ "$#" -ge 2 ] || { echo '--prefix requires a directory' >&2; exit 1; }; prefix=$2; shift 2 ;;
    --binary) [ "$#" -ge 2 ] || { echo '--binary requires a file' >&2; exit 1; }; binary=$2; shift 2 ;;
    --update) update=true; shift ;;
    --help) echo 'Usage: scripts/install-cli.sh [--prefix DIRECTORY] [--binary FILE] [--update]'; exit 0 ;;
    *) echo "Unknown installation argument: $1" >&2; exit 1 ;;
  esac
done
[ -n "$prefix" ] || { echo '--prefix requires a nonempty directory' >&2; exit 1; }
destination="$prefix/bin/herdr-worktree-launcher"
if [ -d "$destination" ]; then echo "Refusing to replace a directory: $destination" >&2; exit 1; fi
if { [ -e "$destination" ] || [ -L "$destination" ]; } && [ "$update" != true ]; then
  echo "$destination already exists. Use --update to replace this command." >&2; exit 1
fi
if [ -z "$binary" ]; then
  "$root/scripts/build-cli.sh"
  binary="$root/dist/herdr-worktree-launcher"
fi
[ -f "$binary" ] && [ -x "$binary" ] || { echo "Not an executable file: $binary" >&2; exit 1; }
mkdir -p "$prefix/bin"
temporary=$(mktemp "$destination.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
cp "$binary" "$temporary"
chmod 755 "$temporary"
mv -f "$temporary" "$destination"
echo "Installed $destination"
echo "Ensure $prefix/bin is on PATH. Run herdr-worktree-launcher --help"
