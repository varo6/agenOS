FROM oven/bun:1.3.14-debian AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOME=/data \
    AGENOS_OPENCLAW_SYSTEM_CONFIG=/app/config/openclaw.json \
    AGENOS_OPENCLAW_USER_CONFIG=/data/openclaw/config.json \
    AGENOS_OPENCLAW_STATE_DIR=/data/openclaw \
    AGENOS_WORKER_TOKEN_PATH=/data/broker/worker-token

RUN mkdir -p /app/config /data/openclaw /data/memory /data/broker /data/secrets

COPY components/installer-ui/package.json components/installer-ui/bun.lock ./components/installer-ui/
WORKDIR /app/components/installer-ui
RUN bun install --frozen-lockfile --production

WORKDIR /app
COPY components/installer-ui/src ./components/installer-ui/src
COPY components/agent ./components/agent
COPY components/ui/src/lib/pi-types.ts ./components/ui/src/lib/pi-types.ts
COPY build/live-build/config/includes.chroot/etc/agenos/openclaw.json ./config/openclaw.json
COPY tools/openclaw-backend/entrypoint.sh /usr/local/bin/agenos-openclaw-backend

RUN chmod 0755 /usr/local/bin/agenos-openclaw-backend

VOLUME ["/data"]
EXPOSE 4173

ENTRYPOINT ["/usr/local/bin/agenos-openclaw-backend"]
