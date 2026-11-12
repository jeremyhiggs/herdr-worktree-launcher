#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
for tool in go node biome shellcheck actionlint; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing $tool. Run mise install first." >&2
    exit 1
  }
done
"$root/scripts/format.sh" --check
go vet ./...
biome lint .
for file in mods/worktree-launcher/*.js scripts/*.mjs scripts/fixtures/*.js tests/*.mjs; do
  node --check "$file"
done
shellcheck scripts/*.sh
actionlint
