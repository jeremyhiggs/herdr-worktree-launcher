#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
"$root/scripts/lint.sh"
"$root/scripts/security.sh"
"$root/scripts/test.sh"
"$root/scripts/build-cli.sh"
