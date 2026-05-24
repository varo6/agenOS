# OpenClaw Automatic Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first functional slice of automatic OpenClaw backend setup, backend Codex awareness, Telegram setup, and a reusable VPS Docker backend.

**Architecture:** Add a Bun setup service that owns redacted setup state under `~/.agenos/openclaw/setup-state.json`, exposes it through the existing local broker, and keeps OpenClaw behind the current worker/admin boundary. The frontend consumes the new setup endpoints for buttons and status. Systemd and Docker run the same setup command before starting the backend.

**Tech Stack:** Bun/TypeScript backend, React/Vitest frontend, systemd units, POSIX shell launchers, Docker.

---

### Task 1: Setup State And Service

**Files:**
- Create: `components/installer-ui/src/bun/agent/setup.ts`
- Test: `components/installer-ui/src/bun/agent/setup.test.ts`

- [ ] **Step 1: Write failing setup tests**

Create tests for missing OpenClaw fallback, Telegram secret redaction, and setup state persistence.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd components/installer-ui && bun test src/bun/agent/setup.test.ts`

Expected: fail because `./setup` does not exist.

- [ ] **Step 3: Implement setup service**

Add exported types and `createOpenClawSetupService()` with methods `status()`, `run()`, `startCodexLogin()`, `configureTelegram()`, `testTelegram()`, and `enableTelegram()`.

- [ ] **Step 4: Run setup tests and verify GREEN**

Run: `cd components/installer-ui && bun test src/bun/agent/setup.test.ts`

Expected: pass.

### Task 2: Backend Admin Integration And API Routes

**Files:**
- Modify: `components/installer-ui/src/bun/agent/admin.ts`
- Modify: `components/installer-ui/src/bun/server.ts`
- Modify: `components/installer-ui/src/bun/server.test.ts`

- [ ] **Step 1: Write failing API/admin tests**

Add tests for `GET /api/agent/setup/status`, `POST /api/agent/setup/run`, `POST /api/agent/auth/codex/start`, `POST /api/agent/channels/telegram/configure`, `POST /api/agent/channels/telegram/test`, `POST /api/agent/channels/telegram/enable`, and `admin/status` setup summaries.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd components/installer-ui && bun test src/bun/server.test.ts src/bun/agent/admin.test.ts`

Expected: fail with 404 or missing setup data.

- [ ] **Step 3: Wire setup service into admin and server**

Add a setup dependency to `InstallerApiDependencies`, instantiate the default service, route the new endpoints, and merge setup items into admin readiness.

- [ ] **Step 4: Run API/admin tests and verify GREEN**

Run: `cd components/installer-ui && bun test src/bun/server.test.ts src/bun/agent/admin.test.ts`

Expected: pass.

### Task 3: CLI And Systemd Startup

**Files:**
- Modify: `components/installer-ui/src/bun/cli.ts`
- Test: `components/installer-ui/src/bun/cli.test.ts`
- Add: `build/live-build/config/includes.chroot/usr/local/bin/agenos-openclaw-setup`
- Modify: `build/live-build/config/includes.chroot/etc/systemd/system/agenos-openclaw.service`

- [ ] **Step 1: Write failing CLI test**

Add `setup-openclaw` CLI test that verifies the command prints setup JSON and returns exit code 0 for a recoverable degraded state.

- [ ] **Step 2: Run CLI test and verify RED**

Run: `cd components/installer-ui && bun test src/bun/cli.test.ts`

Expected: fail because command is unsupported.

- [ ] **Step 3: Add CLI command and systemd hook**

Add `setup-openclaw` to the CLI, add `/usr/local/bin/agenos-openclaw-setup`, and set `ExecStartPre=/usr/local/bin/agenos-openclaw-setup` in `agenos-openclaw.service`.

- [ ] **Step 4: Run CLI and systemd validation**

Run: `cd components/installer-ui && bun test src/bun/cli.test.ts`

Run: `systemd-analyze verify build/live-build/config/includes.chroot/etc/systemd/system/agenos-openclaw.service`

Expected: tests pass and systemd verification reports no errors for this unit.

### Task 4: Frontend Client And Panels

**Files:**
- Modify: `components/ui/src/lib/system-types.ts`
- Modify: `components/ui/src/lib/agent-admin-client.ts`
- Modify: `components/ui/src/components/AgentBackendSetupPanel.tsx`
- Modify: `components/ui/src/components/AgentBackendSetupPanel.test.tsx`
- Modify: `components/ui/src/components/AgentOnboardingPanel.tsx`
- Modify: `components/ui/src/components/AgentOnboardingPanel.test.tsx`

- [ ] **Step 1: Write failing frontend tests**

Add tests showing backend Codex and Telegram setup actions render and call the new client methods.

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `cd components/ui && bun test src/components/AgentBackendSetupPanel.test.tsx src/components/AgentOnboardingPanel.test.tsx`

Expected: fail because the buttons and types are missing.

- [ ] **Step 3: Add client methods and UI actions**

Add setup types, client methods, buttons for rerun setup, backend Codex, configure/test/enable Telegram, and onboarding copy for setup items.

- [ ] **Step 4: Run frontend tests and verify GREEN**

Run: `cd components/ui && bun test src/components/AgentBackendSetupPanel.test.tsx src/components/AgentOnboardingPanel.test.tsx`

Expected: pass.

### Task 5: Docker Backend Image

**Files:**
- Add: `tools/openclaw-backend/Dockerfile`
- Add: `tools/openclaw-backend/entrypoint.sh`
- Add: `tools/openclaw-backend/README.md`
- Add: `.dockerignore` if absent or extend existing ignore rules

- [ ] **Step 1: Add Docker files**

Create a slim Bun-based image that installs package dependencies, copies the installer backend runtime, maps `/data`, runs setup, and starts the API backend.

- [ ] **Step 2: Build Docker image**

Run: `docker build -f tools/openclaw-backend/Dockerfile -t agenos/openclaw-backend:dev .`

Expected: image builds or reports a missing network/package dependency that is documented in the final result.

### Task 6: Focused Verification

**Files:**
- Verify only; no expected edits.

- [ ] **Step 1: Run backend tests**

Run: `cd components/installer-ui && bun test src/bun/agent/setup.test.ts src/bun/agent/admin.test.ts src/bun/server.test.ts src/bun/cli.test.ts`

Expected: pass.

- [ ] **Step 2: Run frontend tests**

Run: `cd components/ui && bun test src/components/AgentBackendSetupPanel.test.tsx src/components/AgentOnboardingPanel.test.tsx src/lib/agent-admin-client.test.js`

Expected: pass.

- [ ] **Step 3: Check status**

Run: `git status --short`

Expected: only intentional implementation files plus pre-existing unrelated dirty files are shown.
