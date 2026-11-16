#!/bin/sh
# Start the personal workspace and sample hospital together on macOS.
set -eu
launcher_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/zsh "$launcher_dir/Start Noticioner.command" "$@"
