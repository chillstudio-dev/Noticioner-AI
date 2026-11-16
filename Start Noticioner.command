#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

site_url="http://127.0.0.1:3000"
doctor_url="http://127.0.0.1:3109/doctor"
identity_url="http://127.0.0.1:4111/"
site_pid=""
demo_pid=""

cleanup() {
  local pid
  trap - EXIT INT TERM
  for pid in "$site_pid" "$demo_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$site_pid" "$demo_pid"; do
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! command -v curl >/dev/null 2>&1 || ! command -v lsof >/dev/null 2>&1; then
  echo "This launcher needs curl and lsof, which are included with macOS." >&2
  exit 1
fi

node_bin="${NOTICIONER_NODE:-}"
if [[ -z "$node_bin" ]]; then node_bin="$(command -v node || true)"; fi
if [[ -z "$node_bin" && -x /opt/homebrew/bin/node ]]; then
  node_bin="/opt/homebrew/bin/node"
fi
if [[ -z "$node_bin" && -x /usr/local/bin/node ]]; then
  node_bin="/usr/local/bin/node"
fi
if [[ -z "$node_bin" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  node_bin="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ -z "$node_bin" ]]; then
  echo "Install Node.js 24.8+ or set NOTICIONER_NODE to its executable path." >&2
  exit 1
fi
if ! "$node_bin" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 24 || (major === 24 && minor >= 8) ? 0 : 1)'; then
  echo "Noticioner needs Node.js 24.8+. Set NOTICIONER_NODE to a supported executable." >&2
  exit 1
fi
# Finder may omit Homebrew from PATH. npm and child scripts need the same Node.
export PATH="$(dirname "$node_bin"):$PATH"
export NOTICIONER_NODE="$node_bin"

brew_bin="$(command -v brew || true)"
if [[ -z "$brew_bin" && -x /opt/homebrew/bin/brew ]]; then
  brew_bin="/opt/homebrew/bin/brew"
fi
if [[ -z "$brew_bin" && -x /usr/local/bin/brew ]]; then
  brew_bin="/usr/local/bin/brew"
fi
if [[ -n "$brew_bin" ]]; then
  postgres_prefix="$("$brew_bin" --prefix postgresql@18 2>/dev/null || true)"
  if [[ ! -x "$postgres_prefix/bin/pg_ctl" || ! -x "$postgres_prefix/bin/initdb" ]]; then
    echo "Installing the signed PostgreSQL 18 runtime for the local doctor demo..."
    "$brew_bin" install postgresql@18
  fi
  export NOTICIONER_POSTGRES_BIN_DIR="$("$brew_bin" --prefix postgresql@18)/bin"
fi

if [[ ! -d node_modules/tsx ]]; then
  echo "Installing project dependencies..."
  npm ci
fi

if [[ ! -f .next/BUILD_ID ]]; then
  echo "Building Noticioner..."
  "$node_bin" node_modules/next/dist/bin/next build --webpack
fi

site_ready() {
  local body
  body="$(curl -fsS --max-time 2 "$site_url" 2>/dev/null)" || return 1
  [[ "$body" == *"Noticioner AI"* ]]
}
doctor_ready() {
  local body
  body="$(curl -fsS --max-time 2 "$doctor_url" 2>/dev/null)" || return 1
  [[ "$body" == *"Doctor portal"* ]]
}
identity_ready() {
  curl -sS --max-time 1 -o /dev/null "$identity_url" 2>/dev/null
}

if site_ready; then
  echo "Noticioner site is already running at $site_url"
elif lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 is occupied by a different service. Stop it, then run this launcher again." >&2
  exit 1
else
  echo "Starting Noticioner site at $site_url..."
  "$node_bin" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000 &
  site_pid=$!
fi

if doctor_ready && identity_ready; then
  echo "Doctor demonstration is already running at $doctor_url"
elif lsof -nP -iTCP:3109 -sTCP:LISTEN >/dev/null 2>&1 || lsof -nP -iTCP:4111 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "A service is already using the doctor demo ports 3109 or 4111. Check it before starting another demo." >&2
  exit 1
else
  echo "Starting the synthetic doctor login workspace..."
  ./scripts/demo-start.sh &
  demo_pid=$!
fi

site_is_up=0
doctor_is_up=0
for attempt in {1..300}; do
  if [[ "$site_is_up" -eq 0 ]] && site_ready; then site_is_up=1; fi
  if [[ "$doctor_is_up" -eq 0 ]] && doctor_ready && identity_ready; then doctor_is_up=1; fi

  if [[ "$site_is_up" -eq 1 && "$doctor_is_up" -eq 1 ]]; then break; fi

  if [[ -n "$site_pid" ]] && ! kill -0 "$site_pid" 2>/dev/null; then
    wait "$site_pid" || true
    echo "The site stopped during startup. Check the error above." >&2
    exit 1
  fi
  if [[ -n "$demo_pid" ]] && ! kill -0 "$demo_pid" 2>/dev/null; then
    wait "$demo_pid" || true
    echo "The doctor workspace stopped during startup. Check the error above." >&2
    exit 1
  fi
  sleep 2
done

if [[ "$site_is_up" -ne 1 || "$doctor_is_up" -ne 1 ]]; then
  echo "Startup timed out. Check the service output above, then run this launcher again." >&2
  exit 1
fi

echo "Both workspaces are ready."
if [[ "${NOTICIONER_OPEN_BROWSER:-1}" != "0" ]]; then
  echo "Opening browser tabs..."
  open "$site_url"
  open "$doctor_url"
fi
echo "Noticioner is at $site_url; doctor sign-in is at $doctor_url."
echo "Sample accounts and the synthetic demo password/code are shown in DEMO_SERVER.md."
echo "Leave this Terminal window open while services started by this launcher are in use. Press Control-C to stop them."

if [[ -n "$site_pid" || -n "$demo_pid" ]]; then wait; fi
