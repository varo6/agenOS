# Real Agent Backend Integration

## OpenClaw Lifecycle

The ISO hook `build/live-build/config/hooks/normal/0900-install-openclaw.hook.chroot` installs the pinned `openclaw@2026.6.11` package. `agenos-openclaw-setup` runs idempotent configuration with `AGENOS_OPENCLAW_AUTO_INSTALL=1`. The worker service supervises `openclaw gateway` on `127.0.0.1:18789`, using token authentication from `~/.agenos/openclaw/openclaw.json`. In auto mode, the broker routes `/api/agent/tasks` to the gateway through `/v1/chat/completions`.

## Worker Mode Decision

The preferred mode is `openclaw-process` when all gates pass:

- Runs as non-root user `agenos`.
- Starts and stops under `agenos-openclaw.service`.
- Reads config from `/etc/agenos/openclaw.json` and `~/.agenos/openclaw/config.json`.
- Stores mutable state under `~/.agenos/openclaw`.
- Exposes task enqueue/status/progress without requiring shell access.
- Routes memory writes, outbound sends, browser actions, diagnostics, and service changes through the AgenOS broker.
- Fails closed to `local-simulated` when the real process is missing or unhealthy. This mode keeps
  the broker available but rejects task delegation explicitly; it never records work that no
  process can consume.

The fallbacks are not a separate product direction. They keep the same `WorkerAdapter` read API,
but availability is honest: the Bun adapter reports unhealthy unless a real planner is injected,
and `local-simulated` reports degraded/unavailable for execution.

## Selected Mode

Since 2026-07-02 the real OpenClaw worker is integrated and `openclaw-process` is the selected mode. The ISO installs the pinned `openclaw@2026.6.11` package via the `0900-install-openclaw.hook.chroot` hook, so the binary is present on first boot. The historical gate failure from 2026-05-16 (no packageable OpenClaw binary in the repo) no longer applies.

Mode resolution in `auto` (see `components/installer-ui/src/bun/agent/worker/index.ts`):

1. `openclaw-process` when the `openclaw` binary resolves — supervises `openclaw gateway` on `127.0.0.1:18789` and routes tasks through `/v1/chat/completions`.
2. `agenos-bun-worker` (bundled daemon) when OpenClaw is missing but the bundled worker exists.
3. `local-simulated` otherwise.

Selection and readiness are separate: finding the bundled Bun daemon does not make it usable by
itself. Without an injected model planner its health and enqueue calls fail with an actionable
reason. The simulated final fallback also returns an actionable error rather than an immortal
`queued` record.

Onboarding is automatic and opinionated: the Pi tool `openclaw_setup` (backed by `/api/agent/setup/*`) installs/configures the runtime without questions. The only user-supplied secrets are the Codex OAuth device login (`codex_login` / `/api/agent/auth/codex/start`) and, optionally, a Telegram bot token (`/api/agent/channels/telegram/*`).

## Broker Boundary

The broker on `127.0.0.1:4173` is the authority for policy, memory, outbound-send preparation, admin actions, and diagnostics. The worker receives tasks and reports progress; it does not execute arbitrary shell commands. Worker-only broker calls require a bearer token stored at `~/.agenos/broker/worker-token` with mode `0600`.

The public task API remains a broker facade. `POST /api/agent/tasks` enqueues work, `GET /api/agent/tasks/:taskId` returns status, and `GET /api/agent/tasks/:taskId/events` returns progress events. Worker tool calls use `/api/agent/worker/tool-call` and are rejected without the local `worker-token`.

For Bun-planned tasks, the remaining plan and next step are persisted. A confirmed tool is executed
once by the broker and `resolveConfirmation` continues from that index, including after recreating
the adapter. Duplicate confirm/deny requests return a conflict and never repeat the effect.
Unsupported tools fail before policy can create a meaningless confirmation.

## Confirmed Self-Improvement Loop

The broker also owns Pi's learned-memory loop. Foreground harness traces, failed background tasks,
retries, denied confirmations, and tool outcomes become redacted append-only signals under
`~/.agenos/memory/learned/`. Deterministic distillation only proposes durable preferences,
repeated tool failures, and denied-action avoidances; it does not let model output rewrite prompts.

Every automatic proposal goes through the existing `memory.write` policy as source `system` and
therefore remains inactive until the user confirms it. Confirmed records have visible IDs,
confidence, source-signal IDs, expiry, and append-only correction/deletion history. The user can
audit and control them through `/api/agent/learning/*` or Pi's `learning_memory` tool.

For each request the broker ranks active, non-expired records by query overlap, kind, confidence,
and recency. At most 512 estimated tokens are emitted (256 by default). The foreground harness
appends that block to Pi's system prompt and recreates its session only when the selected context
changes; OpenClaw receives the same broker-selected block as system context. Trace metadata records
the selected item IDs and token count so injection is measurable without duplicating memory text.

## Protocol and State

Every persisted record and broker/worker envelope uses `schemaVersion: 1`, a `correlationId`, and an ISO timestamp. Reads go through migration helpers so future state changes can degrade cleanly instead of breaking boot.

## Protocol Contract

All broker/worker payloads and persisted records use `schemaVersion: 1`, `correlationId`, and ISO timestamps. Unknown future versions do not crash boot; they put the backend into degraded mode and surface the reason through `/api/agent/admin/status`.

## Worker Auth

Worker-only endpoints require a bearer token from `~/.agenos/broker/worker-token`. The token is generated by the broker with mode `0600` and passed to `agenos-openclaw.service` through an environment file or token path.

Runtime config is read from `/etc/agenos/openclaw.json` and `~/.agenos/openclaw/config.json`. The packaged default uses mode `auto`, stores state under `~/.agenos/openclaw`, and can report `needs_setup` when provider credentials are missing.

## Admin API

The foreground UI calls only local broker endpoints:

- `GET /api/agent/admin/status` returns readiness, worker health, config, heartbeat age, queue depth, degraded reason, and last error correlation ID.
- `GET /api/agent/admin/config` and `POST /api/agent/admin/config` read and, after confirmation,
  atomically persist the user config with mode `0600` and reload the broker's adapter immediately.
- `GET /api/agent/admin/policy` returns policy defaults and stable rule IDs.
- `POST /api/agent/admin/restart` requests confirmation and then calls the privileged helper's
  closed `restart-agent` action; helper/polkit failures are returned as errors.
- `POST /api/agent/admin/test-connection` probes the real OpenClaw gateway without exposing secrets;
  non-OpenClaw modes fail explicitly because they have no remote connection to test.
- `POST /api/agent/admin/export-diagnostics` exports a redacted status/config/log bundle.
- `GET /api/agent/confirmations`, `POST /api/agent/confirmations/:confirmationId/confirm`, and `POST /api/agent/confirmations/:confirmationId/deny` handle pending sensitive actions.

## Degraded Mode

AgenOS remains usable when provider auth, network, or the real worker is unavailable. Memory,
app/browser tools, admin status, diagnostics, and foreground conversation remain available.
`local-simulated` preserves task/status API compatibility for reads and legacy state, but new
delegations fail with `ok:false` because there is no executor.

The UI treats `local-simulated` as degraded rather than a broker-fatal condition. First-run
provider/auth gaps surface with safe actions to configure OpenClaw or keep working locally; no
background completion is claimed.

## Admin UI Decision

The admin interface is a tab in `components/ui`. A separate Electron app is rejected for this phase because it duplicates packaging and service lifecycle while the foreground UI already has access to the local broker.

## Out of Scope

- Real WhatsApp or email sends (Telegram is configurable through `/api/agent/channels/telegram/*`).
- Final sandboxing.

No longer out of scope:

- Local STT exists for foreground push-to-talk (whisper.cpp behind `/api/speech/*`; see `components/protocols/agent-api.md`).
- The shell helpers were rewritten in Rust (`tools/agenos-shell-rust`); the binaries are built during the ISO build and are not committed.
