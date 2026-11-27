#!/bin/sh
# Container entry: start the optional model server, then the engine, and stay alive.
#   WEBSCOUT_MODEL unset  -> engine only (extractive path, no GPU use)
#   WEBSCOUT_MODEL=<id>   -> model server on the GPU first; the engine then uses it
set -u

MODEL_PORT="${WEBSCOUT_MODEL_PORT:-8000}"

if [ -n "${WEBSCOUT_MODEL:-}" ]; then
  python3 /app/model_server.py &
  MODEL_PID=$!
  # Wait for the weights to load. Startup budget is the grader's 10 minutes (assumed).
  i=0
  while [ "$i" -lt 540 ]; do
    if python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${MODEL_PORT}/health',timeout=2).status==200 else 1)" 2>/dev/null; then
      export WEBSCOUT_LLM_URL="http://127.0.0.1:${MODEL_PORT}/v1"
      break
    fi
    kill -0 "$MODEL_PID" 2>/dev/null || break   # model server died: run without it
    i=$((i + 1))
    sleep 1
  done
fi

node /app/dist-server/engine-server.mjs &
ENGINE=$!

trap 'kill "$ENGINE" 2>/dev/null; [ -n "${MODEL_PID:-}" ] && kill "$MODEL_PID" 2>/dev/null; exit 0' INT TERM
wait "$ENGINE"
# If the engine ever exits, keep the container up so app.py can restart it on demand.
exec tail -f /dev/null
