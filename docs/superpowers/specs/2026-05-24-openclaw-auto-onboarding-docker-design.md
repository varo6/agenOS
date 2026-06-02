# OpenClaw Automatic Onboarding and VPS Backend Design

## Decision

AgenOS will make OpenClaw a first-class backend through an automatic-but-assisted setup flow.

The system should prepare everything it can without user secrets:

- Detect or install the OpenClaw runtime.
- Create AgenOS-owned config, state, log, and secret paths.
- Enable the OpenClaw Codex harness config when OpenClaw is available.
- Start and supervise the backend service.
- Detect missing Codex auth, Telegram credentials, model config, and gateway health.
- Surface the exact next action in the system UI.

The system must not silently invent or bypass interactive auth. Codex OAuth and Telegram bot setup stay user-driven, but the UI provides buttons and status for them. On a VPS, the same setup can run headless when required secrets are provided through environment variables or mounted secret files.

## Goals

- Boot AgenOS with the backend prepared automatically whenever possible.
- Keep the foreground Codex/Pi login flow working as it does today.
- Add OpenClaw Codex login awareness for the backend.
- Add Telegram as a supported setup target for the background agent.
- Let frontend and backend share a common setup state model.
- Reuse the same backend setup code in the ISO and in a lightweight Docker image for VPS deployment.
- Preserve AgenOS broker, policy, and memory as the system boundary.

## Non-Goals

- Fully automating Codex OAuth without user approval.
- Creating Telegram bots automatically through BotFather.
- Exposing OpenClaw directly to the network from the ISO.
- Replacing the current AgenOS foreground UI chat surface.
- Shipping WhatsApp or email as required channels in this phase.
- Giving OpenClaw arbitrary shell or filesystem authority.

## Current Context

AgenOS already has these pieces:

- `agenos-agent-api.service` as the local broker/API process.
- `agenos-openclaw.service` as the background worker service.
- Worker config from `/etc/agenos/openclaw.json` plus `~/.agenos/openclaw/config.json`.
- Worker state under `~/.agenos/openclaw`.
- A frontend backend tab with health, setup, policy, task, confirmation, and diagnostics surfaces.
- A fallback `agenos-bun-worker` and `local-simulated` mode.

The missing piece is a real OpenClaw lifecycle. The current `openclaw-process` adapter only detects a binary and reports that the process task API is not enabled.

## Architecture

```text
AgenOS boot / VPS container start
  -> agenos-openclaw-setup
      -> read system config, user config, env, mounted secrets
      -> detect OpenClaw binary/source install
      -> prepare config/state/secrets
      -> run health checks
      -> write setup-state.json
  -> agenos-openclaw.service
      -> openclaw gateway when real OpenClaw is ready
      -> agenos-bun-worker when OpenClaw is absent or gated off
      -> local-simulated only when no backend worker is usable

Frontend
  -> /api/agent/setup/status
  -> /api/agent/setup/run
  -> /api/agent/auth/codex/start
  -> /api/agent/channels/telegram/configure
  -> /api/agent/channels/telegram/test
  -> existing admin/task/confirmation/diagnostics APIs
```

OpenClaw is still a worker behind the AgenOS broker. It may talk to Telegram and Codex, but memory writes, outbound sends, browser actions, diagnostics, and admin changes remain broker-mediated and policy-checked.

## Setup Command

Add a packaged command:

```text
/usr/local/bin/agenos-openclaw-setup
```

The command is idempotent and safe to run on every boot.

It produces a state file:

```text
~/.agenos/openclaw/setup-state.json
```

The state contains:

- `schemaVersion`
- `phase`: `ready`, `needs_auth`, `needs_channel`, `degraded`, or `failed`
- `openclaw`: install path, version, health, gateway URL, and last error
- `codex`: configured flag, account/profile summary if available, login action availability
- `telegram`: enabled flag, token configured flag, bot identity if tested, last test result
- `actions`: stable action IDs the UI can render
- `updatedAt`
- `correlationId`

The command never writes raw secrets into `setup-state.json`.

## OpenClaw Runtime Gate

The real `openclaw-process` mode is selected only when all gates pass:

- Binary or source checkout is present.
- It can run as non-root user `agenos`.
- It can bind only to loopback in ISO mode.
- It can store mutable state under `~/.agenos/openclaw`.
- It can use OpenClaw config that enables the bundled Codex plugin.
- It can run `openclaw status`, `openclaw models status`, and `openclaw doctor` or equivalent health commands.
- It can route protected actions through the AgenOS broker.

If a gate fails, the setup state records the failed gate and the worker falls back to `agenos-bun-worker`.

## Codex Backend Auth

The foreground UI Codex login remains available through the existing AgenOS Pi/Codex harness.

The OpenClaw backend uses OpenClaw's own Codex auth flow:

```text
openclaw models auth login --provider openai-codex
```

The frontend exposes a "Connect backend Codex" action that starts this flow through the local broker and returns the device/browser instructions. If OpenClaw reports an already configured OpenAI/Codex auth profile, the UI shows it as connected without exposing token material.

OpenClaw Codex config should prefer canonical `openai/gpt-*` model refs and enable the bundled `codex` plugin. It should not create new `openai-codex/gpt-*` model refs.

## Telegram Channel

Telegram setup is automatic only after the user provides credentials.

Supported inputs:

- ISO/UI: paste a Telegram bot token into the frontend.
- VPS/Docker: set `OPENCLAW_TELEGRAM_BOT_TOKEN` or mount a secret file.

The broker writes secrets to:

```text
~/.agenos/openclaw/secrets.env
```

with mode `0600`.

The UI provides actions:

- `telegram.configure`: store or replace the bot token.
- `telegram.test`: call the OpenClaw or Telegram health path and show bot identity.
- `telegram.enable`: enable the channel in AgenOS/OpenClaw config after a successful test.

The UI text should instruct the user to create a bot with BotFather and paste the token. It should not attempt to automate BotFather.

Outbound Telegram sends remain `confirm` by default unless the operator explicitly changes the policy defaults.

## Admin API Changes

Add setup-focused endpoints to the existing local broker:

- `GET /api/agent/setup/status`
- `POST /api/agent/setup/run`
- `POST /api/agent/auth/codex/start`
- `POST /api/agent/channels/telegram/configure`
- `POST /api/agent/channels/telegram/test`
- `POST /api/agent/channels/telegram/enable`

Existing endpoints remain:

- `GET /api/agent/admin/status`
- `POST /api/agent/admin/test-connection`
- `POST /api/agent/admin/restart`
- diagnostics, confirmations, policy, and task APIs.

`admin/status` should include a summarized setup state so the current onboarding panel can stay simple.

## Frontend Changes

The first screen should be able to guide a user from fresh boot to usable backend:

1. Backend service detected.
2. OpenClaw prepared or fallback selected.
3. Backend Codex auth connected or action shown.
4. Telegram disabled, pending setup, or connected.
5. Final "ready" state when worker, auth, and selected channels are healthy.

The frontend should show explicit buttons for actions that need user input:

- Connect frontend Codex.
- Connect backend Codex.
- Configure Telegram.
- Test Telegram.
- Rerun setup.
- Restart backend.
- Export diagnostics.

The UI should not block the foreground chat when Telegram is missing. Telegram is a channel setup item, not a global fatal error.

## Docker Backend

Add a lightweight backend image for VPS use:

```text
tools/openclaw-backend/Dockerfile
```

The image contains:

- OpenClaw runtime or source install.
- AgenOS broker/worker runtime needed for backend APIs.
- `agenos-openclaw-setup`.
- An entrypoint that runs setup and then starts the backend.

Runtime layout:

```text
/data/openclaw
/data/memory
/data/broker
/data/secrets
```

Recommended run shape:

```text
docker run --rm \
  -p 127.0.0.1:4173:4173 \
  -v agenos-openclaw:/data \
  -e OPENCLAW_TELEGRAM_BOT_TOKEN=... \
  agenos/openclaw-backend:dev
```

The image should bind to loopback by default. Public VPS exposure requires a reverse proxy and explicit operator configuration.

The ISO does not need to run Docker. It reuses the same setup code directly under systemd.

## Error Handling

- Missing OpenClaw binary: `degraded`, fallback to `agenos-bun-worker`.
- Missing Codex auth: `needs_auth`, show backend Codex login action.
- Missing Telegram token: `needs_channel` only if Telegram is enabled or requested.
- Invalid Telegram token: keep token redacted, show test failure, do not enable channel.
- OpenClaw doctor failure: `degraded`, include correlation ID and diagnostics action.
- Setup command crash: service remains recoverable through fallback worker.

Every setup action returns a structured result:

```json
{
  "ok": false,
  "phase": "needs_auth",
  "message": "Backend Codex login is required.",
  "actions": ["codex.login", "diagnostics.export"],
  "correlationId": "corr_example"
}
```

## Testing

Focused tests:

- Setup state parser and redaction.
- Idempotent setup command with missing OpenClaw.
- Setup command with fake OpenClaw CLI outputs.
- Codex login action result parsing.
- Telegram token configure/test redaction.
- Admin status maps setup state into UI setup items.
- Frontend onboarding renders backend Codex and Telegram actions.
- Docker entrypoint runs setup before backend start.

Integration checks:

- `bun test` for backend setup/admin modules.
- UI tests for onboarding panel and backend setup panel.
- `systemd-analyze verify` for changed service units.
- Docker build for `tools/openclaw-backend/Dockerfile`.
- Smoke script that runs setup with fake credentials and validates redaction.

Full ISO build remains the final packaging gate, not a requirement after each small edit.

## Rollout Plan

1. Add setup state types and parser.
2. Add `agenos-openclaw-setup` command in Bun.
3. Extend admin/setup API.
4. Update `openclaw-process` adapter to use setup state and bounded OpenClaw commands.
5. Add Telegram setup support.
6. Update frontend onboarding/backend panels.
7. Add systemd pre-start setup hook.
8. Add Docker backend image and README.
9. Add smoke tests and diagnostics coverage.

## References

- OpenClaw first-run setup recommends `openclaw onboard --install-daemon` and health commands such as `openclaw status`, `openclaw models status`, and `openclaw doctor`: https://docs.openclaw.ai/help/faq-first-run
- OpenClaw Codex harness docs require the bundled `codex` plugin, Codex auth through `openclaw models auth login --provider openai-codex`, and canonical `openai/gpt-*` model refs: https://docs.openclaw.ai/plugins/codex-harness

## Approval State

Approved direction from chat on 2026-05-24:

- Prefer automatic setup.
- Keep user-driven steps for necessary secrets and OAuth.
- Include Telegram as a first setup target.
- Provide frontend buttons for interactive steps.
- Build a lightweight Docker backend for VPS reuse.
