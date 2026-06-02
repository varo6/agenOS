# AgenOS OpenClaw Backend Container

This image runs the AgenOS local broker/backend without booting the ISO. It is intended for VPS deployments where `/data` is a persistent Docker volume.

Build:

```bash
docker build -f tools/openclaw-backend/Dockerfile -t agenos/openclaw-backend:dev .
```

Run on loopback:

```bash
docker run --rm \
  -p 127.0.0.1:4173:4173 \
  -v agenos-openclaw:/data \
  -e OPENCLAW_TELEGRAM_BOT_TOKEN=123456:token \
  agenos/openclaw-backend:dev
```

The entrypoint runs `setup-openclaw` first and then starts the API server. Missing OpenClaw is reported as degraded setup state, so the broker stays usable while the real runtime is added or mounted in a derived image.

Do not publish port `4173` directly to the internet. Put it behind a reverse proxy with authentication if remote access is required.
