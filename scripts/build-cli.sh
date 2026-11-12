#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
output="$root/dist/herdr-worktree-launcher"
while [ "$#" -gt 0 ]; do
  case "$1" in
  --output)
    [ "$#" -ge 2 ] || {
      echo '--output requires a path' >&2
      exit 1
    }
    output=$2
    shift 2
    ;;
  --help)
    echo 'Usage: scripts/build-cli.sh [--output FILE] (GOOS and GOARCH select another platform)'
    exit 0
    ;;
  *)
    echo "Unknown build argument: $1" >&2
    exit 1
    ;;
  esac
done
command -v go >/dev/null 2>&1 || {
  echo 'Building the CLI requires Go. The installed executable needs no Go or Node runtime.' >&2
  exit 1
}
mkdir -p "$(dirname -- "$output")"
case "$output" in /*) ;; *) output="$PWD/$output" ;; esac
cd "$root"
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "$output" ./cmd/herdr-worktree-launcher
