#!/bin/sh
set -eu

export HOME="${HOME:-/data}"
export AGENOS_OPENCLAW_SYSTEM_CONFIG="${AGENOS_OPENCLAW_SYSTEM_CONFIG:-/app/config/openclaw.json}"
export AGENOS_OPENCLAW_USER_CONFIG="${AGENOS_OPENCLAW_USER_CONFIG:-/data/openclaw/config.json}"
export AGENOS_OPENCLAW_STATE_DIR="${AGENOS_OPENCLAW_STATE_DIR:-/data/openclaw}"
export AGENOS_WORKER_TOKEN_PATH="${AGENOS_WORKER_TOKEN_PATH:-/data/broker/worker-token}"

mkdir -p "$AGENOS_OPENCLAW_STATE_DIR" /data/memory /data/broker /data/secrets

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

cd /app/components/installer-ui
bun src/bun/cli.ts setup-openclaw
exec bun src/bun/cli.ts api
