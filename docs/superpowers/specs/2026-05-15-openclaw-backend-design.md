# AgenOS OpenClaw Backend Design

## Decision

AgenOS will use a hybrid agent architecture:

- The foreground system UI keeps the existing Pi/Codex harness for direct user interaction.
- A local OpenClaw Gateway runs as the background 24/7 worker.
- AgenOS owns the system boundary through a Tool Broker, Memory Store, and Policy Engine.

OpenClaw is the preferred backend fit because it is designed around a persistent gateway, multi-channel messaging, sessions, agents, CLI invocation, daemon installation, and multi-provider support including OpenAI/Codex-style auth. NanoClaw remains the fallback if OpenClaw proves too large or hard to constrain. Hermes remains an experimental alternative for later evaluation, not the base backend.

## Goals

- Start a background agent during live boot and installed sessions.
- Let the UI delegate long-running or external tasks to the background worker.
- Let the worker respond through channels such as Telegram, WhatsApp, email, or simulated local channels.
- Give both foreground and background agents access to the same personal memory.
- Keep system actions behind AgenOS-controlled tools and permission policy.
- Make the first slice testable in a VM and Live USB without requiring a full disk install.

## Non-Goals

- Replacing the Pi frontend harness in the first implementation.
- Giving OpenClaw unrestricted shell, filesystem, browser, or desktop access.
- Shipping WhatsApp as the first required channel.
- Solving the installer or Calamares flow in this phase.
- Building a final security sandbox before the functional slice exists.

## Architecture

```text
User
  -> AgenOS UI (Electron + Pi/Codex harness)
      -> AgenOS Agent Client
          -> AgenOS Tool Broker
          -> OpenClaw Gateway Adapter

OpenClaw Gateway (24/7 worker)
  -> channel adapters (local first, then Telegram/WhatsApp/email)
  -> AgenOS Tool Broker
  -> AgenOS Memory Store

AgenOS Tool Broker
  -> apps.list
  -> apps.open
  -> browser.open_url
  -> memory.read
  -> memory.write
  -> contacts.lookup
  -> tasks.enqueue
```

The UI may still use Pi for normal conversation. When the request requires a durable task, background delivery, external messaging, scheduling, or long execution, the UI calls the OpenClaw adapter instead of doing the work inline.

OpenClaw is not the authority for system permissions. It is a worker behind an AgenOS API.

## Components

### OpenClaw Gateway Package

OpenClaw is packaged into the live image under `/opt/agenos/openclaw` and launched by `agenos-openclaw.service`.

The service should bind only to localhost in the first slice. It should use an AgenOS-specific state directory:

```text
~/.agenos/openclaw/
```

### AgenOS Tool Broker

The broker is a small local HTTP service. It exposes deterministic system tools and checks policy before execution.

Initial routes:

- `GET /health`
- `GET /v1/apps`
- `POST /v1/apps/open`
- `POST /v1/browser/open-url`
- `GET /v1/memory/:namespace`
- `POST /v1/memory/:namespace`
- `POST /v1/tasks`

The first implementation can live inside the existing Bun API process if that reduces moving parts, but the API shape must be broker-owned so it can later become its own daemon.

### AgenOS Memory Store

Memory is stored under:

```text
~/.agenos/memory/
```

Initial files:

- `contacts.md`: human-editable contacts and relationship notes.
- `preferences.md`: user preferences and recurring facts.
- `facts.md`: general persistent facts the user explicitly wants saved.
- `events.ndjson`: append-only audit/event log.
- `policy.json`: permission defaults and allowed paths.

Markdown is used for human-editable memory. NDJSON is used for append-only logs. JSON is used for policy because the broker needs reliable parsing.

### AgenOS Policy Engine

Policy levels:

- `allow`: execute without confirmation.
- `confirm`: require foreground confirmation before execution.
- `deny`: block.

Default first-slice policy:

- `apps.list`: `allow`
- `apps.open`: `allow`
- `browser.open_url`: `allow`
- `memory.read`: `allow`
- `memory.write`: `confirm` unless the write is an explicit "remember this" instruction from the foreground UI
- `contacts.lookup`: `allow`
- outbound email/WhatsApp/Telegram sends: `confirm`
- arbitrary shell: `deny`
- filesystem writes outside `~/.agenos/memory`: `deny`

### UI Integration

The UI gets an `AgentClient` abstraction:

- `sendForegroundMessage()` continues to use Pi.
- `delegateBackgroundTask()` sends work to the OpenClaw adapter.
- `runSystemTool()` calls the Tool Broker.

The first UI change should be minimal: keep the current chat surface but add routing for commands such as:

- "abre Chrome con Netflix"
- "recuerda que Pablo Lopez es mi profesor y su correo es ..."
- "manda esto al trabajador de fondo"

### OpenClaw Adapter

The adapter translates AgenOS requests into OpenClaw Gateway or CLI calls.

Initial behavior:

- If OpenClaw is installed and healthy, submit the task.
- If OpenClaw is missing or unhealthy, return a structured error to the UI.
- For Live USB testing, support a `local-simulated` mode that records tasks to `~/.agenos/openclaw/outbox.ndjson` and returns a deterministic response.

This allows the first vertical slice to pass before real Telegram/WhatsApp credentials exist.

## Data Flow

### Open Browser From UI

```text
User: "abre Netflix en Chrome"
UI/Pi interprets the request
UI calls Tool Broker: POST /v1/browser/open-url
Policy allows browser.open_url
Broker opens browser in the app workspace
UI receives result
```

### Remember Contact

```text
User: "recuerda que Pablo Lopez es mi profesor y su correo es pablo@example.com"
UI/Pi identifies explicit memory write
UI calls Tool Broker: POST /v1/memory/contacts
Broker appends normalized entry to contacts.md and events.ndjson
Future UI and OpenClaw tasks read the same contact memory
```

### Delegate Background Task

```text
User: "prepara un email a Pablo y dejalo listo"
UI/Pi detects durable/external task
UI calls OpenClaw Adapter: POST /v1/tasks
Adapter submits task to OpenClaw or simulated outbox
OpenClaw calls Tool Broker for contacts.lookup and mail draft tools
Policy requires confirmation before sending
UI shows pending confirmation when needed
```

## Error Handling

- Every API response returns `{ ok: boolean, message?: string }` plus typed result data where needed.
- Tool denial returns HTTP `403` with the policy reason.
- Invalid tool arguments return HTTP `400`.
- Missing apps return HTTP `404`.
- Tool execution failures return HTTP `500` with a user-safe message and a detailed audit event.
- OpenClaw unavailable returns HTTP `503`.

## Testing

First slice tests:

- Unit tests for memory parsing and append behavior.
- Unit tests for policy decisions.
- Unit tests for URL validation and browser command construction.
- API tests for broker routes.
- UI client tests for Pi foreground, broker tool call, and background delegation.
- VM/Live USB smoke test:
  - boot ISO
  - verify `agenos-openclaw.service` or simulated adapter health
  - open browser URL from UI
  - write/read contact memory
  - enqueue background task

## References

- OpenClaw CLI and daemon/gateway behavior: https://openclaw.cc/en/cli/
- OpenClaw repository: https://github.com/openclaw/openclaw
- NanoClaw spec and fallback model: https://github.com/qwibitai/nanoclaw/blob/main/docs/SPEC.md
- NanoClaw container security model: https://docs.nanoclaw.dev/concepts/containers
- Hermes alternative: https://github.com/NousResearch/hermes-agent

## Approval State

Approved direction from chat:

- Use OpenClaw as the recommended backend worker.
- Keep Pi as the foreground frontend harness.
- Put AgenOS Tool Broker, Memory, and Policy between both agents and the system.
- Focus on functionality and Live USB/VM testability before installer polish.
