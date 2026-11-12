#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
output="$root/dist/packages"
while [ "$#" -gt 0 ]; do
  case "$1" in
  --output)
    [ "$#" -ge 2 ] && [ -n "$2" ] || {
      echo '--output requires a directory' >&2
      exit 1
    }
    output=$2
    shift 2
    ;;
  --help)
    echo 'Usage: scripts/package.sh [--output DIRECTORY]'
    exit 0
    ;;
  *)
    echo "Unknown packaging argument: $1" >&2
    exit 1
    ;;
  esac
done
case "$output" in /*) ;; *) output="$PWD/$output" ;; esac
mkdir -p "$output"
staging=$(mktemp -d "${TMPDIR:-/tmp}/worktree-launcher-package.XXXXXX")
trap 'rm -rf "$staging"' EXIT HUP INT TERM
package_manifest() {
  node -e '
const fs = require("node:fs");
const source = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const script = process.argv[3];
const manifest = { name: source.name, private: true, type: "module", packageManager: source.packageManager, engines: source.engines, scripts: { [script]: source.scripts[script] } };
fs.writeFileSync(process.argv[2], JSON.stringify(manifest, null, 2) + "\n");
' "$root/package.json" "$1/package.json" "$2"
}
for target in darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do
  name="herdr-worktree-launcher-${target%/*}-${target#*/}"
  mkdir -p "$staging/$name/scripts"
  GOOS="${target%/*}" GOARCH="${target#*/}" "$root/scripts/build-cli.sh" --output "$staging/$name/herdr-worktree-launcher"
  cp "$root/scripts/install-cli.sh" "$staging/$name/scripts/"
  package_manifest "$staging/$name" install:cli
  cp "$root/docs/packages.md" "$staging/$name/README.md"
  cp "$root/cmd/herdr-worktree-launcher/help.txt" "$staging/$name/USAGE.txt"
  cp "$root/LICENSE" "$staging/$name/"
  archive="$name.tar.gz"
  tar -czf "$output/$archive" -C "$staging" "$name"
  set -- "$@" "$archive"
done
name=worktree-launcher-mod
mkdir -p "$staging/$name/mods/worktree-launcher" "$staging/$name/scripts"
for file in main.js model.js cli.js config.js journal.js mod.json config.example.json keys.json README.md; do
  cp "$root/mods/worktree-launcher/$file" "$staging/$name/mods/worktree-launcher/"
done
cp "$root/scripts/install-mod.mjs" "$staging/$name/scripts/"
package_manifest "$staging/$name" install:mod
cp "$root/docs/packages.md" "$staging/$name/README.md"
cp "$root/LICENSE" "$staging/$name/"
archive="$name.tar.gz"
tar -czf "$output/$archive" -C "$staging" "$name"
set -- "$@" "$archive"
cd "$output"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$@" >SHA256SUMS
else
  shasum -a 256 "$@" >SHA256SUMS
fi
printf 'Packages and SHA256SUMS: %s\n' "$output"
