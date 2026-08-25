#!/usr/bin/env bash
#
# XAUUSD Command Center — one-command launcher (macOS / Linux)
#
#     ./start.sh
#
# Creates .env if missing, generates AUTH_SECRET if blank, brings the stack up,
# waits for it to answer, and opens the browser.
#
# Safe to re-run. It never overwrites an existing secret, and the database lives
# in a Docker volume that survives rebuilds.
#
#     ./start.sh stop      stop the stack, keep the data
#     ./start.sh logs      follow the web logs
#     ./start.sh rebuild   force a clean image rebuild
#     ./start.sh reset     DESTROY the database and start fresh

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/login"

say()  { printf '  %s\n' "$1"; }
step() { printf '\n  \033[36m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m%s\033[0m\n' "$1"; }
warn() { printf '  \033[33m%s\033[0m\n' "$1"; }
err()  { printf '  \033[31m%s\033[0m\n' "$1"; }

printf '\n  \033[1mXAUUSD COMMAND CENTER\033[0m\n'
printf '  ---------------------\n'

# -------------------------------------------------------------------- docker
if ! command -v docker >/dev/null 2>&1; then
  err 'Docker is not installed.'
  warn 'macOS:  brew install --cask docker'
  warn 'Linux:  https://docs.docker.com/engine/install/'
  exit 1
fi

# `docker info` fails when the engine is installed but not started — by far the
# most common reason this script stops.
if ! docker info >/dev/null 2>&1; then
  err 'Docker is installed but not running.'
  warn 'Start Docker Desktop (or the docker daemon) and re-run this.'
  exit 1
fi

# ---------------------------------------------------------------- subcommands
case "${1:-}" in
  stop)
    step 'Stopping (your data is kept)'
    docker compose down
    ok 'Stopped. Run ./start.sh to bring it back.'
    exit 0
    ;;
  logs)
    exec docker compose logs -f web
    ;;
  reset)
    printf '\n'
    err 'This DELETES the database: every trade, journal entry and imported candle.'
    printf '  Type DELETE to confirm: '
    read -r answer
    [ "$answer" = 'DELETE' ] || { warn 'Cancelled.'; exit 0; }
    docker compose down -v
    warn 'Database destroyed. Starting fresh...'
    ;;
esac

# ----------------------------------------------------------------------- env
if [ ! -f .env ]; then
  step 'First run — creating .env'
  cp .env.example .env
  ok 'Created .env from .env.example'
fi

# A blank AUTH_SECRET means sessions cannot be signed and every login fails, so
# fill it rather than letting the app start and then reject the first sign-in.
if grep -qE '^AUTH_SECRET=""?[[:space:]]*$' .env; then
  step 'Generating AUTH_SECRET'
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 48)"
  else
    secret="$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  # BSD and GNU sed disagree about -i, so write through a temp file instead.
  awk -v s="$secret" '/^AUTH_SECRET=/ { print "AUTH_SECRET=\"" s "\""; next } { print }' \
      .env > .env.tmp && mv .env.tmp .env
  ok 'Generated a 96-character secret and wrote it to .env'
  say 'Keep .env out of git — it is already gitignored.'
fi

# --------------------------------------------------------------------- start
step 'Starting the stack'
say 'First run builds the image and takes a few minutes. Later runs are seconds.'

[ "${1:-}" = 'rebuild' ] && docker compose build --no-cache
docker compose up --build -d

# --------------------------------------------------------------------- ready
step 'Waiting for the app to answer'
ready=false
for attempt in $(seq 1 90); do
  if curl -fsS -o /dev/null --max-time 3 "$URL" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 2
  [ $((attempt % 10)) -eq 0 ] && say "still starting... ($((attempt * 2))s)"
done

printf '\n'
if [ "$ready" != true ]; then
  err 'The app did not answer in 3 minutes.'
  warn 'Check what went wrong:  ./start.sh logs'
  exit 1
fi

ok 'RUNNING'
printf '\n      \033[1m%s\033[0m\n\n' "$URL"
say 'First visit offers account creation. After that it is sign-in only.'
printf '\n'
warn 'The dashboard will say DATA UNAVAILABLE until you either import a CSV'
warn '(Settings -> Data) or add API keys to .env. That is the app working'
warn 'correctly — it will not invent a gold price to look populated.'
printf '\n'
say 'Stop it with:  ./start.sh stop'
printf '\n'

# Open the browser where we can; never fail the script if we cannot.
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
fi
