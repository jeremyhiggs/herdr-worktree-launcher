#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
for tool in go node git wt zsh; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing $tool. Install Git and zsh, then run mise install first." >&2
    exit 1
  }
done
go test -race -count=1 ./...
node --test tests/worktree-launcher-*.test.mjs
