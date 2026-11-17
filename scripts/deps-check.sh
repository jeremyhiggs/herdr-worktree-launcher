#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
for tool in pnpm go govulncheck; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing $tool. Run mise install first." >&2
    exit 1
  }
done
pnpm audit --audit-level moderate
govulncheck ./...
