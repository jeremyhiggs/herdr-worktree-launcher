#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
for tool in go gofmt node shellcheck actionlint; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool. Run mise install first." >&2; exit 1; }
done
unformatted=$(gofmt -l cmd)
if [ -n "$unformatted" ]; then
  printf 'Run gofmt on:\n%s\n' "$unformatted" >&2
  exit 1
fi
go vet ./...
for file in mods/worktree-launcher/*.js scripts/*.mjs scripts/fixtures/*.js tests/*.mjs; do
  node --check "$file"
done
shellcheck scripts/*.sh
actionlint
