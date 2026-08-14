# AI Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build five AgenOS workspaces that can be focused from the top UI bar and targeted by Pi app-launch tools.

**Architecture:** Add a focused backend workspace service that validates workspace numbers and wraps `swaymsg`. Wire that service into app/browser tools, HTTP routes, Pi custom tool schemas, and the React shell top bar.

**Tech Stack:** Bun, TypeScript, React, Vitest, Sway via `swaymsg`.

---

## File Structure

- Create `components/agent/workspaces.ts`: shared workspace model, validation, Sway focus/list helpers, app defaults.
- Create `components/installer-ui/src/bun/agent/workspaces.ts`: re-export for Bun API imports.
- Create `components/installer-ui/src/bun/agent/workspaces.test.ts`: unit tests for validation, focus, defaults, no-Sway behavior.
- Modify `components/agent/browser-launcher.ts`: accept workspace/focus options instead of hard-coding `2:app`.
- Modify `components/installer-ui/src/bun/agent/browser.test.ts`: verify browser launcher receives workspace intent.
- Modify `components/agent/apps.ts`: accept `{ app, workspace, focus }`, choose defaults, focus before launch.
- Modify `components/installer-ui/src/bun/agent/apps.test.ts`: test workspace defaults and explicit focus behavior.
- Modify `components/installer-ui/src/bun/pi-harness.ts`: extend `apps_open` schema and pass workspace options.
- Modify `components/ui/src/lib/system-types.ts`: add workspace response/request types.
- Modify `components/ui/src/lib/agent-client.ts` and `.test.js`: add `listWorkspaces()` and `focusWorkspace()`.
- Modify `components/installer-ui/src/bun/server.ts` and `.test.ts`: add workspace routes and dependency injection.
- Modify `components/installer-ui/src/bun/agent/policy-rules.ts` and `.test.ts`: mark `workspaces.focus` low-risk.
- Modify `components/agent/pi-system-context.md`: document workspace targeting for Pi.
- Modify `components/ui/src/App.tsx` and `.test.tsx`: add top system bar, fetch/focus workspaces, show active state.

## Task 1: Workspace Service

**Files:**
- Create: `components/agent/workspaces.ts`
- Create: `components/installer-ui/src/bun/agent/workspaces.ts`
- Test: `components/installer-ui/src/bun/agent/workspaces.test.ts`

- [ ] **Step 1: Write failing workspace service tests**

```ts
import { describe, expect, test } from "bun:test";
import { createWorkspaceService, normalizeWorkspaceNumber, resolveDefaultWorkspaceForApp } from "./workspaces";

describe("workspace service", () => {
  test("validates workspace numbers from numeric input", () => {
    expect(normalizeWorkspaceNumber(1)).toBe(1);
    expect(normalizeWorkspaceNumber("5")).toBe(5);
    expect(() => normalizeWorkspaceNumber(0)).toThrow("Workspace invalido.");
    expect(() => normalizeWorkspaceNumber(6)).toThrow("Workspace invalido.");
  });

  test("focuses a Sway workspace by known name", async () => {
    const calls: Array<[string, string[]]> = [];
    const service = createWorkspaceService({
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      commandExists: (command) => command === "swaymsg",
      spawnCommand: (command, args) => calls.push([command, args]),
    });

    await expect(service.focusWorkspace({ workspace: 3 })).resolves.toMatchObject({
      ok: true,
      activeWorkspace: 3,
    });
    expect(calls).toEqual([["swaymsg", ["workspace", "3:web"]]]);
  });

  test("returns a structured failure outside Sway", async () => {
    const service = createWorkspaceService({ env: {}, commandExists: () => true });
    await expect(service.focusWorkspace({ workspace: 2 })).resolves.toEqual({
      ok: false,
      message: "No hay una sesion Sway disponible para cambiar de workspace.",
      workspaces: service.listWorkspaces().workspaces,
    });
  });

  test("resolves app defaults", () => {
    expect(resolveDefaultWorkspaceForApp("terminal")).toBe(5);
    expect(resolveDefaultWorkspaceForApp("browser")).toBe(2);
    expect(resolveDefaultWorkspaceForApp("org.videolan.VLC")).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/installer-ui && bun test src/bun/agent/workspaces.test.ts`

Expected: FAIL because `./workspaces` does not exist.

- [ ] **Step 3: Implement minimal workspace service**

Create `components/agent/workspaces.ts` with:

```ts
export type WorkspaceNumber = 1 | 2 | 3 | 4 | 5;
export type WorkspaceSource = "ui" | "openclaw" | "system";
export type WorkspaceDefinition = { number: WorkspaceNumber; name: string; label: string };
export type WorkspaceFocusRequest = { workspace: unknown; source?: WorkspaceSource };
export type WorkspaceListResponse = { ok: true; workspaces: WorkspaceDefinition[]; activeWorkspace?: WorkspaceNumber };
export type WorkspaceFocusResponse = { ok: boolean; message?: string; workspaces: WorkspaceDefinition[]; activeWorkspace?: WorkspaceNumber };

export const WORKSPACES: WorkspaceDefinition[] = [
  { number: 1, name: "1:agent", label: "Agent" },
  { number: 2, name: "2:app", label: "Apps" },
  { number: 3, name: "3:web", label: "Web" },
  { number: 4, name: "4:media", label: "Media" },
  { number: 5, name: "5:work", label: "Work" },
];
```

Implement `normalizeWorkspaceNumber`, `workspaceNameFor`, `resolveDefaultWorkspaceForApp`, and `createWorkspaceService`.

Create `components/installer-ui/src/bun/agent/workspaces.ts`:

```ts
export * from "../../../../agent/workspaces";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/installer-ui && bun test src/bun/agent/workspaces.test.ts`

Expected: PASS.

## Task 2: App and Browser Workspace Targeting

**Files:**
- Modify: `components/agent/browser-launcher.ts`
- Modify: `components/agent/apps.ts`
- Test: `components/installer-ui/src/bun/agent/browser.test.ts`
- Test: `components/installer-ui/src/bun/agent/apps.test.ts`

- [ ] **Step 1: Write failing app/browser tests**

Add browser test:

```ts
test("passes workspace focus options to Chromium launcher", async () => {
  const calls: Array<[string, string[]]> = [];
  const result = launchBrowserUrl("example.com", {
    env: { WAYLAND_DISPLAY: "wayland-1", SWAYSOCK: "/tmp/sway.sock" },
    workspace: 3,
    focus: true,
    commandExists: (command) => command === "chromium" || command === "swaymsg",
    spawnCommand: (command, args) => calls.push([command, args]),
  });

  expect(result.url).toBe("https://example.com/");
  expect(calls[0]).toEqual(["swaymsg", ["workspace", "3:web"]]);
  expect(calls[1]?.[0]).toBe("chromium");
});
```

Add app tests:

```ts
test("focuses explicit workspace before opening apps", async () => {
  const calls: Array<[string, string[]]> = [];
  const tool = createAppTool({
    env: { SWAYSOCK: "/tmp/sway.sock" },
    commandExists: (command) => command === "foot" || command === "swaymsg",
    spawnCommand: (command, args) => calls.push([command, args]),
  });

  await expect(tool.openApp({ app: "terminal", workspace: 5, focus: true })).resolves.toMatchObject({ ok: true });
  expect(calls[0]).toEqual(["swaymsg", ["workspace", "5:work"]]);
  expect(calls[1]).toEqual(["foot", []]);
});

test("uses app default workspace when none is provided", async () => {
  const calls: Array<[string, string[]]> = [];
  const tool = createAppTool({
    env: { SWAYSOCK: "/tmp/sway.sock" },
    commandExists: (command) => command === "foot" || command === "swaymsg",
    spawnCommand: (command, args) => calls.push([command, args]),
  });

  await tool.openApp("terminal");
  expect(calls[0]).toEqual(["swaymsg", ["workspace", "5:work"]]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd components/installer-ui && bun test src/bun/agent/browser.test.ts src/bun/agent/apps.test.ts`

Expected: FAIL because options and object payload are unsupported.

- [ ] **Step 3: Implement browser/app support**

Add to `BrowserLauncherOptions`:

```ts
workspace?: unknown;
focus?: boolean;
```

Replace the hard-coded `focusExternalWorkspace` with workspace service usage:

```ts
if (options.focus !== false) {
  createWorkspaceService({ commandExists, spawnCommand, env }).focusWorkspaceSync({
    workspace: options.workspace ?? 2,
    source: "system",
  });
}
```

Add an `AppOpenInput` union to `components/agent/apps.ts`:

```ts
export type AppOpenInput = string | { app?: unknown; workspace?: unknown; focus?: unknown };
```

Parse it in `openApp`, resolve workspace with `input.workspace ?? resolveDefaultWorkspaceForApp(app.appId)`, and focus before launch when `focus !== false`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd components/installer-ui && bun test src/bun/agent/browser.test.ts src/bun/agent/apps.test.ts`

Expected: PASS.

## Task 3: API Routes, Policy, and Pi Tool Schema

**Files:**
- Modify: `components/installer-ui/src/bun/server.ts`
- Modify: `components/installer-ui/src/bun/server.test.ts`
- Modify: `components/installer-ui/src/bun/agent/policy-rules.ts`
- Modify: `components/installer-ui/src/bun/agent/policy.test.ts`
- Modify: `components/installer-ui/src/bun/pi-harness.ts`
- Modify: `components/ui/src/lib/system-types.ts`

- [ ] **Step 1: Write failing API/policy/tool tests**

Add server tests:

```ts
test("agent workspace routes list and focus known workspaces", async () => {
  const focused: unknown[] = [];
  const workspaceService = {
    listWorkspaces: () => ({ ok: true, activeWorkspace: 1, workspaces: [{ number: 1, name: "1:agent", label: "Agent" }] }),
    focusWorkspace: async (input: unknown) => {
      focused.push(input);
      return { ok: true, activeWorkspace: 2, workspaces: [{ number: 2, name: "2:app", label: "Apps" }] };
    },
  };
  const handler = createInstallerApiHandler({ workspaceService: workspaceService as never });

  expect(await jsonPayload(await handler.fetch(new Request("http://localhost/api/agent/workspaces")))).toMatchObject({ activeWorkspace: 1 });
  const response = await handler.fetch(new Request("http://localhost/api/agent/workspaces/focus", {
    method: "POST",
    body: JSON.stringify({ workspace: 2, source: "ui" }),
  }));
  expect(response.status).toBe(202);
  expect(focused).toEqual([{ workspace: 2, source: "ui" }]);
});
```

Add policy test assertion:

```ts
expect(decidePolicy({ tool: "workspaces.focus", source: "openclaw" }).decision).toBe("allow");
```

Add Pi harness test assertion that `apps_open` schema includes `workspace` and `focus`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd components/installer-ui && bun test src/bun/server.test.ts src/bun/agent/policy.test.ts ../ui/dev/pi-harness.test.ts`

Expected: FAIL because workspace routes and schema are missing.

- [ ] **Step 3: Implement API/policy/schema**

Add workspace service dependency in `server.ts`, route `GET /api/agent/workspaces`, route `POST /api/agent/workspaces/focus`, and use `decidePolicy({ tool: "workspaces.focus", source })`.

Add `"workspaces.focus"` to `LOW_RISK_TOOLS`.

Extend `OPEN_APP_TOOL_PARAMETERS` with:

```ts
workspace: { type: "number", description: "Workspace 1..5 donde abrir la app." },
focus: { type: "boolean", description: "Cambiar el foco del usuario al workspace. Por defecto true." },
```

Pass `appTool.openApp({ app, workspace, focus })`.

Add workspace types to `system-types.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd components/installer-ui && bun test src/bun/server.test.ts src/bun/agent/policy.test.ts ../ui/dev/pi-harness.test.ts`

Expected: PASS.

## Task 4: UI Client and Top System Bar

**Files:**
- Modify: `components/ui/src/lib/agent-client.ts`
- Modify: `components/ui/src/lib/agent-client.test.js`
- Modify: `components/ui/src/App.tsx`
- Modify: `components/ui/src/App.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add agent client test:

```js
test("focuses workspaces through the broker", async () => {
  let requestedUrl = "";
  let payload = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    payload = String(init?.body ?? "");
    return new Response(JSON.stringify({ ok: true, activeWorkspace: 2, workspaces: [] }), { status: 202 });
  };

  const client = createAgentClient({ baseUrl: "http://agent.test" });
  expect(await client.focusWorkspace(2)).toMatchObject({ ok: true, activeWorkspace: 2 });
  expect(requestedUrl).toBe("http://agent.test/api/agent/workspaces/focus");
  expect(JSON.parse(payload)).toEqual({ workspace: 2, source: "ui" });
});
```

Add App test:

```ts
test("shows the workspace system bar and focuses workspace clicks", async () => {
  mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
  mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
  mocks.agentClient.listWorkspaces.mockResolvedValue({
    ok: true,
    activeWorkspace: 1,
    workspaces: [
      { number: 1, name: "1:agent", label: "Agent" },
      { number: 2, name: "2:app", label: "Apps" },
      { number: 3, name: "3:web", label: "Web" },
      { number: 4, name: "4:media", label: "Media" },
      { number: 5, name: "5:work", label: "Work" },
    ],
  });
  mocks.agentClient.focusWorkspace.mockResolvedValue({
    ok: true,
    activeWorkspace: 2,
    workspaces: [],
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Workspace 2 Apps" }));

  await waitFor(() => expect(mocks.agentClient.focusWorkspace).toHaveBeenCalledWith(2));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd components/ui && bun test src/lib/agent-client.test.js && bun run test:renderer -- src/App.test.tsx`

Expected: FAIL because methods and UI do not exist.

- [ ] **Step 3: Implement UI client/bar**

Add `listWorkspaces` and `focusWorkspace` to `createAgentClient`.

In `App.tsx`, add workspace state:

```ts
const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
const [activeWorkspace, setActiveWorkspace] = useState<AgentWorkspaceNumber>(1);
```

Fetch workspaces on load. Render a fixed `top-0` system bar with numbered buttons. Clicking a number optimistically sets `activeWorkspace`, calls `agentClient.focusWorkspace(number)`, and reconciles returned active workspace.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd components/ui && bun test src/lib/agent-client.test.js && bun run test:renderer -- src/App.test.tsx`

Expected: PASS.

## Task 5: System Prompt, Full Verification, and Commit

**Files:**
- Modify: `components/agent/pi-system-context.md`
- Verify: all touched packages

- [ ] **Step 1: Update Pi context**

Add:

```md
- You can target AgenOS workspaces when opening apps. Workspaces are numbered 1..5: 1 agent, 2 apps, 3 web, 4 media, 5 work.
- When the user asks for an app in a specific workspace, call `apps_open` with `workspace` and `focus`.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
cd components/installer-ui && bun run test:bun && bun run typecheck:bun
cd ../ui && bun test src/lib dev && bun run test:renderer && bun run build
```

Expected: all pass.

- [ ] **Step 3: Review diff**

Run: `git diff --stat && git diff --check`

Expected: no whitespace errors; diff only covers workspace feature files plus spec/plan/ignore.

- [ ] **Step 4: Commit**

Run:

```bash
git add .gitignore docs/superpowers/specs/2026-05-31-workspaces-ia-design.md docs/superpowers/plans/2026-06-02-ai-workspaces-implementation.md components/agent components/installer-ui/src/bun components/ui/src
git commit -m "feat: add ai controlled workspaces"
```
