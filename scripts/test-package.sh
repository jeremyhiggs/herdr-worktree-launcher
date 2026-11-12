#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
[ "$#" -le 1 ] || {
  echo 'Usage: scripts/test-package.sh [DIRECTORY]' >&2
  exit 1
}
packages=$(CDPATH='' cd -- "${1:-$root/dist/packages}" && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/worktree-launcher-package-check.XXXXXX")
trap 'rm -rf "$scratch"' EXIT HUP INT TERM
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$packages" && sha256sum -c SHA256SUMS)
else
  (cd "$packages" && shasum -a 256 -c SHA256SUMS)
fi
case "$(uname -s)" in
Darwin) platform=darwin ;;
Linux) platform=linux ;;
*)
  echo 'Package smoke checks support Linux and macOS.' >&2
  exit 1
  ;;
esac
case "$(uname -m)" in
arm64 | aarch64) architecture=arm64 ;;
x86_64) architecture=amd64 ;;
*)
  echo 'Unsupported package architecture.' >&2
  exit 1
  ;;
esac
name="herdr-worktree-launcher-$platform-$architecture"
tar -xzf "$packages/$name.tar.gz" -C "$scratch"
"$scratch/$name/scripts/install-cli.sh" --prefix "$scratch/install"
pnpm --dir "$scratch/$name" run install:cli --prefix "$scratch/install"
PATH="$scratch/empty" "$scratch/install/bin/herdr-worktree-launcher" --help >/dev/null
tar -xzf "$packages/worktree-launcher-mod.tar.gz" -C "$scratch"
pnpm --dir "$scratch/worktree-launcher-mod" run install:mod --help
echo 'Package checksums, standalone CLI installation, and both package install scripts passed.'
