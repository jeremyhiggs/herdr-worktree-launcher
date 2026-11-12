#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
for tool in git gitleaks go govulncheck; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool. Run mise install first." >&2; exit 1; }
done
gitleaks git --redact=100 --no-banner --log-opts=HEAD
govulncheck ./...
