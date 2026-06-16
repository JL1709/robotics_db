#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5177}"
HOST="${HOST:-127.0.0.1}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but was not found."
  exit 1
fi

existing_pids="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"

if [[ -n "${existing_pids}" ]]; then
  echo "Port ${PORT} is already in use. Stopping process(es): ${existing_pids}"
  kill ${existing_pids} 2>/dev/null || true

  for _ in {1..20}; do
    if ! lsof -tiTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done

  stubborn_pids="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${stubborn_pids}" ]]; then
    echo "Process(es) still holding port ${PORT}. Force stopping: ${stubborn_pids}"
    kill -9 ${stubborn_pids} 2>/dev/null || true
  fi
fi

cd "${APP_DIR}"

echo "Starting Robotics Market Atlas"
echo "URL: http://${HOST}:${PORT}/"
echo "Press Ctrl+C to stop."

exec python3 -m http.server "${PORT}" --bind "${HOST}"
