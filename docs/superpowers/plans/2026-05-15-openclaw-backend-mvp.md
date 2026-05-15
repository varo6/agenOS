# OpenClaw Backend MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first AgenOS vertical slice where the UI keeps Pi for foreground chat, a background OpenClaw-compatible worker path exists, and both agents use AgenOS-owned tools, memory, and policy.

**Architecture:** Add an AgenOS Tool Broker API around apps, browser, memory, policy, and task delegation. Keep the first background path testable with a local simulated OpenClaw adapter, then package OpenClaw as a service once the broker contract is stable.

**Tech Stack:** Bun/TypeScript, React/Electron, existing Pi harness, Debian live-build, systemd, local HTTP APIs, Markdown/JSON/NDJSON memory files.

---

## File Structure

- Create `components/installer-ui/src/bun/agent/memory.ts`: memory file paths, read/write helpers, event log appends.
- Create `components/installer-ui/src/bun/agent/policy.ts`: policy types and allow/confirm/deny decisions.
- Create `components/installer-ui/src/bun/agent/apps.ts`: app discovery/open helpers reused from current shell behavior.
- Create `components/installer-ui/src/bun/agent/browser.ts`: validated browser URL opening.
- Create `components/installer-ui/src/bun/agent/tasks.ts`: simulated OpenClaw task queue and health surface.
- Modify `components/installer-ui/src/bun/server.ts`: expose `/api/agent/*` routes.
- Modify `components/ui/src/lib/system-types.ts`: add agent/broker types.
- Create `components/ui/src/lib/agent-client.ts`: frontend client for broker and background delegation.
- Modify `components/ui/src/App.tsx`: route selected commands to broker/delegation while keeping Pi chat.
- Create `build/live-build/config/includes.chroot/etc/systemd/system/agenos-openclaw.service`: disabled or simulated first service definition.
- Update `docs/architecture/live-system-slice.md`: document the new vertical slice.

---

### Task 1: Memory Store

**Files:**
- Create: `components/installer-ui/src/bun/agent/memory.ts`
- Test: `components/installer-ui/src/bun/agent/memory.test.ts`

- [ ] **Step 1: Write the failing memory tests**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "./memory";

describe("agent memory store", () => {
  test("creates default memory files and reads empty namespaces", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-memory-"));
    const store = createMemoryStore({ rootDir: root, now: () => new Date("2026-05-15T00:00:00.000Z") });

    expect(store.read("contacts")).toEqual({ namespace: "contacts", content: "" });
    expect(readFileSync(join(root, "contacts.md"), "utf8")).toBe("");
    expect(readFileSync(join(root, "preferences.md"), "utf8")).toBe("");
    expect(readFileSync(join(root, "facts.md"), "utf8")).toBe("");
  });

  test("appends explicit contact memory and logs an event", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-memory-"));
    const store = createMemoryStore({ rootDir: root, now: () => new Date("2026-05-15T10:11:12.000Z") });

    const result = store.append("contacts", "Pablo Lopez es mi profesor. Email: pablo@example.com", "ui");

    expect(result.ok).toBe(true);
    expect(store.read("contacts").content).toContain("Pablo Lopez es mi profesor");
    const event = JSON.parse(readFileSync(join(root, "events.ndjson"), "utf8").trim());
    expect(event).toMatchObject({
      timestamp: "2026-05-15T10:11:12.000Z",
      namespace: "contacts",
      source: "ui",
      action: "memory.append",
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd components/installer-ui && bun test src/bun/agent/memory.test.ts`

Expected: FAIL because `components/installer-ui/src/bun/agent/memory.ts` does not exist.

- [ ] **Step 3: Implement the memory store**

```ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type MemoryNamespace = "contacts" | "preferences" | "facts";

export type MemoryStoreOptions = {
  rootDir?: string;
  now?: () => Date;
};

const DEFAULT_FILES: Record<MemoryNamespace, string> = {
  contacts: "contacts.md",
  preferences: "preferences.md",
  facts: "facts.md",
};

function defaultRootDir(): string {
  return join(homedir(), ".agenos", "memory");
}

function ensureMemoryFiles(rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  for (const fileName of Object.values(DEFAULT_FILES)) {
    const path = join(rootDir, fileName);
    try {
      readFileSync(path, "utf8");
    } catch {
      writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
    }
  }
}

export function isMemoryNamespace(value: unknown): value is MemoryNamespace {
  return value === "contacts" || value === "preferences" || value === "facts";
}

export function createMemoryStore(options: MemoryStoreOptions = {}) {
  const rootDir = options.rootDir ?? defaultRootDir();
  const now = options.now ?? (() => new Date());
  ensureMemoryFiles(rootDir);

  function pathFor(namespace: MemoryNamespace): string {
    return join(rootDir, DEFAULT_FILES[namespace]);
  }

  return {
    read(namespace: MemoryNamespace) {
      return {
        namespace,
        content: readFileSync(pathFor(namespace), "utf8"),
      };
    },
    append(namespace: MemoryNamespace, content: string, source: "ui" | "openclaw" | "system") {
      const trimmed = content.trim();
      if (!trimmed) {
        return { ok: false, message: "La memoria no puede estar vacia." };
      }

      appendFileSync(pathFor(namespace), `${trimmed}\n`, { encoding: "utf8" });
      appendFileSync(
        join(rootDir, "events.ndjson"),
        `${JSON.stringify({
          timestamp: now().toISOString(),
          namespace,
          source,
          action: "memory.append",
        })}\n`,
        { encoding: "utf8" },
      );
      return { ok: true, message: "Memoria guardada." };
    },
  };
}
```

- [ ] **Step 4: Run the memory test**

Run: `cd components/installer-ui && bun test src/bun/agent/memory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/installer-ui/src/bun/agent/memory.ts components/installer-ui/src/bun/agent/memory.test.ts
git commit -m "feat: add agenos memory store"
```

---

### Task 2: Policy Engine

**Files:**
- Create: `components/installer-ui/src/bun/agent/policy.ts`
- Test: `components/installer-ui/src/bun/agent/policy.test.ts`

- [ ] **Step 1: Write the failing policy tests**

```ts
import { describe, expect, test } from "bun:test";
import { decidePolicy } from "./policy";

describe("agent policy", () => {
  test("allows low-risk app and browser tools", () => {
    expect(decidePolicy({ tool: "apps.open", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "browser.open_url", source: "ui" }).decision).toBe("allow");
  });

  test("allows explicit UI memory writes but asks OpenClaw to confirm memory writes", () => {
    expect(decidePolicy({ tool: "memory.write", source: "ui", explicitUserIntent: true }).decision).toBe("allow");
    expect(decidePolicy({ tool: "memory.write", source: "openclaw", explicitUserIntent: false }).decision).toBe("confirm");
  });

  test("requires confirmation for outbound sends and denies shell", () => {
    expect(decidePolicy({ tool: "mail.send", source: "openclaw" }).decision).toBe("confirm");
    expect(decidePolicy({ tool: "shell.exec", source: "openclaw" })).toEqual({
      decision: "deny",
      reason: "La ejecucion shell arbitraria no esta permitida en este MVP.",
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd components/installer-ui && bun test src/bun/agent/policy.test.ts`

Expected: FAIL because `policy.ts` does not exist.

- [ ] **Step 3: Implement policy decisions**

```ts
export type AgentSource = "ui" | "openclaw" | "system";
export type PolicyDecision = "allow" | "confirm" | "deny";

export type PolicyRequest = {
  tool: string;
  source: AgentSource;
  explicitUserIntent?: boolean;
};

export type PolicyResult = {
  decision: PolicyDecision;
  reason?: string;
};

const ALLOW_TOOLS = new Set([
  "apps.list",
  "apps.open",
  "browser.open_url",
  "memory.read",
  "contacts.lookup",
  "tasks.enqueue",
]);

const CONFIRM_TOOLS = new Set([
  "mail.send",
  "telegram.send",
  "whatsapp.send",
]);

export function decidePolicy(request: PolicyRequest): PolicyResult {
  if (request.tool === "shell.exec") {
    return {
      decision: "deny",
      reason: "La ejecucion shell arbitraria no esta permitida en este MVP.",
    };
  }

  if (request.tool === "memory.write") {
    return request.source === "ui" && request.explicitUserIntent
      ? { decision: "allow" }
      : { decision: "confirm", reason: "Guardar memoria requiere confirmacion." };
  }

  if (CONFIRM_TOOLS.has(request.tool)) {
    return { decision: "confirm", reason: "Enviar mensajes externos requiere confirmacion." };
  }

  if (ALLOW_TOOLS.has(request.tool)) {
    return { decision: "allow" };
  }

  return {
    decision: "deny",
    reason: `Tool no permitida: ${request.tool}`,
  };
}
```

- [ ] **Step 4: Run the policy test**

Run: `cd components/installer-ui && bun test src/bun/agent/policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/installer-ui/src/bun/agent/policy.ts components/installer-ui/src/bun/agent/policy.test.ts
git commit -m "feat: add agenos agent policy"
```

---

### Task 3: Browser And App Tools

**Files:**
- Create: `components/installer-ui/src/bun/agent/browser.ts`
- Create: `components/installer-ui/src/bun/agent/apps.ts`
- Test: `components/installer-ui/src/bun/agent/browser.test.ts`
- Test: `components/installer-ui/src/bun/agent/apps.test.ts`

- [ ] **Step 1: Write browser validation tests**

```ts
import { describe, expect, test } from "bun:test";
import { createBrowserTool, normalizeBrowserUrl } from "./browser";

describe("browser tool", () => {
  test("adds https to plain domains", () => {
    expect(normalizeBrowserUrl("netflix.com")).toBe("https://netflix.com/");
  });

  test("keeps valid http urls", () => {
    expect(normalizeBrowserUrl("https://example.com/watch")).toBe("https://example.com/watch");
  });

  test("rejects non-http protocols", () => {
    expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow("Solo se permiten URLs http o https.");
  });

  test("opens normalized urls through xdg-open", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createBrowserTool({
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openUrl("netflix.com")).resolves.toEqual({
      ok: true,
      message: "Abriendo https://netflix.com/.",
    });
    expect(calls).toEqual([["xdg-open", ["https://netflix.com/"]]]);
  });
});
```

- [ ] **Step 2: Write desktop exec sanitization tests**

```ts
import { describe, expect, test } from "bun:test";
import { sanitizeDesktopExec } from "./apps";

describe("app tool", () => {
  test("removes desktop field codes", () => {
    expect(sanitizeDesktopExec("chromium %U")).toEqual(["chromium"]);
  });

  test("preserves quoted arguments", () => {
    expect(sanitizeDesktopExec('chromium --new-window "https://netflix.com"')).toEqual([
      "chromium",
      "--new-window",
      "https://netflix.com",
    ]);
  });

  test("rejects empty exec lines", () => {
    expect(() => sanitizeDesktopExec("%U")).toThrow("El Exec del .desktop no contiene ningun comando ejecutable.");
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run: `cd components/installer-ui && bun test src/bun/agent/browser.test.ts src/bun/agent/apps.test.ts`

Expected: FAIL because `browser.ts` and `apps.ts` do not exist.

- [ ] **Step 4: Implement browser URL normalization**

```ts
import { spawn } from "node:child_process";

export function normalizeBrowserUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("La URL es obligatoria.");
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http o https.");
  }

  return url.toString();
}

export type BrowserToolOptions = {
  spawnCommand?: (command: string, args: string[]) => void;
};

export function createBrowserTool(options: BrowserToolOptions = {}) {
  const spawnCommand = options.spawnCommand ?? ((command: string, args: string[]) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  });

  return {
    async openUrl(input: string) {
      const url = normalizeBrowserUrl(input);
      spawnCommand("xdg-open", [url]);
      return {
        ok: true,
        message: `Abriendo ${url}.`,
      };
    },
  };
}
```

- [ ] **Step 5: Implement app exec sanitization**

```ts
const DESKTOP_FIELD_CODE_RE = /%[fFuUdDnNickvm]/g;

export function sanitizeDesktopExec(execLine: string): string[] {
  const protectedPercent = execLine.replaceAll("%%", "__PERCENT__");
  const cleaned = protectedPercent
    .replace(DESKTOP_FIELD_CODE_RE, "")
    .replaceAll("__PERCENT__", "%")
    .trim();

  const command = cleaned.match(/"([^"]*)"|'([^']*)'|\S+/g)
    ?.map((part) => part.replace(/^["']|["']$/g, ""))
    .filter(Boolean) ?? [];

  if (command.length === 0) {
    throw new Error("El Exec del .desktop no contiene ningun comando ejecutable.");
  }

  return command;
}
```

- [ ] **Step 6: Run the tool tests**

Run: `cd components/installer-ui && bun test src/bun/agent/browser.test.ts src/bun/agent/apps.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/installer-ui/src/bun/agent/browser.ts components/installer-ui/src/bun/agent/apps.ts components/installer-ui/src/bun/agent/browser.test.ts components/installer-ui/src/bun/agent/apps.test.ts
git commit -m "feat: add agenos browser and app tools"
```

---

### Task 4: Simulated OpenClaw Task Queue

**Files:**
- Create: `components/installer-ui/src/bun/agent/tasks.ts`
- Test: `components/installer-ui/src/bun/agent/tasks.test.ts`

- [ ] **Step 1: Write failing task queue tests**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskQueue } from "./tasks";

describe("agent task queue", () => {
  test("enqueues a simulated OpenClaw task", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-tasks-"));
    const queue = createTaskQueue({ rootDir: root, now: () => new Date("2026-05-15T12:00:00.000Z") });

    const result = queue.enqueue({ message: "prepara un email a Pablo", source: "ui" });

    expect(result.ok).toBe(true);
    expect(result.taskId).toMatch(/^task_/);
    const outbox = readFileSync(join(root, "outbox.ndjson"), "utf8").trim();
    expect(JSON.parse(outbox)).toMatchObject({
      timestamp: "2026-05-15T12:00:00.000Z",
      source: "ui",
      message: "prepara un email a Pablo",
      status: "queued",
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd components/installer-ui && bun test src/bun/agent/tasks.test.ts`

Expected: FAIL because `tasks.ts` does not exist.

- [ ] **Step 3: Implement the simulated queue**

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TaskQueueOptions = {
  rootDir?: string;
  now?: () => Date;
};

export type EnqueueTaskInput = {
  message: string;
  source: "ui" | "openclaw" | "system";
};

function defaultRootDir(): string {
  return join(homedir(), ".agenos", "openclaw");
}

export function createTaskQueue(options: TaskQueueOptions = {}) {
  const rootDir = options.rootDir ?? defaultRootDir();
  const now = options.now ?? (() => new Date());
  mkdirSync(rootDir, { recursive: true });

  return {
    health() {
      return { ok: true, mode: "local-simulated" as const };
    },
    enqueue(input: EnqueueTaskInput) {
      const message = input.message.trim();
      if (!message) {
        return { ok: false, message: "La tarea no puede estar vacia." };
      }

      const taskId = `task_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      appendFileSync(
        join(rootDir, "outbox.ndjson"),
        `${JSON.stringify({
          taskId,
          timestamp: now().toISOString(),
          source: input.source,
          message,
          status: "queued",
        })}\n`,
        { encoding: "utf8" },
      );

      return { ok: true, taskId, message: "Tarea enviada al worker de fondo." };
    },
  };
}
```

- [ ] **Step 4: Run the task queue test**

Run: `cd components/installer-ui && bun test src/bun/agent/tasks.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/installer-ui/src/bun/agent/tasks.ts components/installer-ui/src/bun/agent/tasks.test.ts
git commit -m "feat: add simulated openclaw task queue"
```

---

### Task 5: Broker HTTP API

**Files:**
- Modify: `components/installer-ui/src/bun/server.ts`
- Test: `components/installer-ui/src/bun/server.test.ts`

- [ ] **Step 1: Add failing API tests**

Append these tests to `components/installer-ui/src/bun/server.test.ts`:

```ts
test("agent memory routes read and append contacts", async () => {
  const memory = {
    read: () => ({ namespace: "contacts", content: "Pablo Lopez: pablo@example.com\n" }),
    append: () => ({ ok: true, message: "Memoria guardada." }),
  };
  const handler = createInstallerApiHandler({ memoryStore: memory as never });

  const readResponse = await handler.fetch(new Request("http://localhost/api/agent/memory/contacts"));
  expect(readResponse.status).toBe(200);
  expect(await jsonPayload(readResponse)).toEqual({
    namespace: "contacts",
    content: "Pablo Lopez: pablo@example.com\n",
  });

  const writeResponse = await handler.fetch(new Request("http://localhost/api/agent/memory/contacts", {
    method: "POST",
    body: JSON.stringify({ content: "Pablo Lopez es mi profesor", source: "ui", explicitUserIntent: true }),
  }));
  expect(writeResponse.status).toBe(202);
});

test("agent task route enqueues background work", async () => {
  const taskQueue = {
    enqueue: () => ({ ok: true, taskId: "task_test", message: "Tarea enviada al worker de fondo." }),
    health: () => ({ ok: true, mode: "local-simulated" }),
  };
  const handler = createInstallerApiHandler({ taskQueue: taskQueue as never });

  const response = await handler.fetch(new Request("http://localhost/api/agent/tasks", {
    method: "POST",
    body: JSON.stringify({ message: "prepara un email a Pablo", source: "ui" }),
  }));

  expect(response.status).toBe(202);
  expect(await jsonPayload(response)).toEqual({
    ok: true,
    taskId: "task_test",
    message: "Tarea enviada al worker de fondo.",
  });
});
```

- [ ] **Step 2: Run the failing API tests**

Run: `cd components/installer-ui && bun test src/bun/server.test.ts`

Expected: FAIL because `createInstallerApiHandler` does not accept `memoryStore`, `taskQueue`, or `browserTool`, and `/api/agent/*` routes do not exist.

- [ ] **Step 3: Wire broker dependencies**

Modify `components/installer-ui/src/bun/server.ts` imports and dependency types:

```ts
import { createMemoryStore } from "./agent/memory";
import { decidePolicy } from "./agent/policy";
import { createTaskQueue } from "./agent/tasks";
import { createBrowserTool } from "./agent/browser";
```

Extend `InstallerApiDependencies`:

```ts
  memoryStore: ReturnType<typeof createMemoryStore>;
  taskQueue: ReturnType<typeof createTaskQueue>;
  browserTool: ReturnType<typeof createBrowserTool>;
```

Set defaults:

```ts
    memoryStore: dependencies.memoryStore ?? createMemoryStore(),
    taskQueue: dependencies.taskQueue ?? createTaskQueue(),
    browserTool: dependencies.browserTool ?? createBrowserTool(),
```

- [ ] **Step 4: Add `/api/agent/memory/:namespace` routes**

Inside `fetch`, before frontend fallback:

```ts
        const memoryMatch = url.pathname.match(/^\/api\/agent\/memory\/([^/]+)$/);
        if (memoryMatch) {
          const namespace = decodeURIComponent(memoryMatch[1] ?? "");
          if (namespace !== "contacts" && namespace !== "preferences" && namespace !== "facts") {
            return json({ ok: false, message: "Namespace de memoria invalido." }, { status: 400 });
          }

          if (request.method === "GET") {
            return json(deps.memoryStore.read(namespace));
          }

          if (request.method === "POST") {
            const payload = await readJsonBody(request) as {
              content?: unknown;
              source?: unknown;
              explicitUserIntent?: unknown;
            };
            const source = payload.source === "openclaw" || payload.source === "system" ? payload.source : "ui";
            const policy = decidePolicy({
              tool: "memory.write",
              source,
              explicitUserIntent: payload.explicitUserIntent === true,
            });
            if (policy.decision === "deny") {
              return json({ ok: false, message: policy.reason }, { status: 403 });
            }
            if (policy.decision === "confirm") {
              return json({ ok: false, message: policy.reason }, { status: 409 });
            }

            const response = deps.memoryStore.append(
              namespace,
              typeof payload.content === "string" ? payload.content : "",
              source,
            );
            return json(response, { status: response.ok ? 202 : 400 });
          }

          return methodNotAllowed(["GET", "POST", "OPTIONS"]);
        }
```

- [ ] **Step 5: Add `/api/agent/tasks` and health routes**

```ts
        if (url.pathname === "/api/agent/worker/health") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(deps.taskQueue.health());
        }

        if (url.pathname === "/api/agent/tasks") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { message?: unknown; source?: unknown };
          const policy = decidePolicy({ tool: "tasks.enqueue", source: "ui" });
          if (policy.decision !== "allow") {
            return json({ ok: false, message: policy.reason }, { status: 403 });
          }
          const response = deps.taskQueue.enqueue({
            message: typeof payload.message === "string" ? payload.message : "",
            source: payload.source === "openclaw" || payload.source === "system" ? payload.source : "ui",
          });
          return json(response, { status: response.ok ? 202 : 400 });
        }
```

- [ ] **Step 6: Add `/api/agent/browser/open-url` route**

```ts
        if (url.pathname === "/api/agent/browser/open-url") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { url?: unknown };
          const policy = decidePolicy({ tool: "browser.open_url", source: "ui" });
          if (policy.decision !== "allow") {
            return json({ ok: false, message: policy.reason }, { status: 403 });
          }

          const response = await deps.browserTool.openUrl(typeof payload.url === "string" ? payload.url : "");
          return json(response, { status: response.ok ? 202 : 400 });
        }
```

- [ ] **Step 7: Add the browser route API test**

Append this test to `components/installer-ui/src/bun/server.test.ts`:

```ts
test("agent browser route opens normalized urls", async () => {
  const opened: string[] = [];
  const browserTool = {
    openUrl: async (url: string) => {
      opened.push(url);
      return { ok: true, message: "Abriendo https://netflix.com/." };
    },
  };
  const handler = createInstallerApiHandler({ browserTool: browserTool as never });

  const response = await handler.fetch(new Request("http://localhost/api/agent/browser/open-url", {
    method: "POST",
    body: JSON.stringify({ url: "netflix.com" }),
  }));

  expect(response.status).toBe(202);
  expect(opened).toEqual(["netflix.com"]);
});
```

- [ ] **Step 8: Run server tests**

Run: `cd components/installer-ui && bun test src/bun/server.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add components/installer-ui/src/bun/server.ts components/installer-ui/src/bun/server.test.ts
git commit -m "feat: expose agenos agent broker api"
```

---

### Task 6: UI Agent Client

**Files:**
- Modify: `components/ui/src/lib/system-types.ts`
- Create: `components/ui/src/lib/agent-client.ts`
- Test: `components/ui/src/lib/agent-client.test.js`

- [ ] **Step 1: Write failing client tests**

```js
import { afterEach, describe, expect, test } from "bun:test";
import { createAgentClient } from "./agent-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("agent client", () => {
  test("reads contacts memory", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      namespace: "contacts",
      content: "Pablo Lopez: pablo@example.com\n",
    }));

    const client = createAgentClient();
    expect(await client.readMemory("contacts")).toEqual({
      namespace: "contacts",
      content: "Pablo Lopez: pablo@example.com\n",
    });
  });

  test("delegates background tasks", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      taskId: "task_test",
      message: "Tarea enviada al worker de fondo.",
    }), { status: 202 });

    const client = createAgentClient();
    expect(await client.delegateBackgroundTask("prepara un email a Pablo")).toEqual({
      ok: true,
      taskId: "task_test",
      message: "Tarea enviada al worker de fondo.",
    });
  });
});
```

- [ ] **Step 2: Run the failing client test**

Run: `cd components/ui && bun test src/lib/agent-client.test.js`

Expected: FAIL because `agent-client.ts` does not exist.

- [ ] **Step 3: Add shared UI types**

Append to `components/ui/src/lib/system-types.ts`:

```ts
export type AgentMemoryNamespace = "contacts" | "preferences" | "facts";

export type AgentMemoryResponse = {
  namespace: AgentMemoryNamespace;
  content: string;
};

export type AgentTaskResponse = {
  ok: boolean;
  taskId?: string;
  message?: string;
};
```

- [ ] **Step 4: Implement `agent-client.ts`**

```ts
import type { AgentMemoryNamespace, AgentMemoryResponse, AgentTaskResponse } from "./system-types";

function resolveHttpBase(): string {
  const location = globalThis.window?.location;
  if (location && (location.protocol === "http:" || location.protocol === "https:")) {
    return location.origin;
  }

  return "http://127.0.0.1:4173";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, `${resolveHttpBase()}/`).toString(), init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(payload?.message ?? `${response.status} ${response.statusText}`);
  }

  return payload as T;
}

export function createAgentClient() {
  return {
    readMemory(namespace: AgentMemoryNamespace): Promise<AgentMemoryResponse> {
      return requestJson<AgentMemoryResponse>(`/api/agent/memory/${encodeURIComponent(namespace)}`);
    },
    appendMemory(namespace: AgentMemoryNamespace, content: string): Promise<AgentTaskResponse> {
      return requestJson<AgentTaskResponse>(`/api/agent/memory/${encodeURIComponent(namespace)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source: "ui", explicitUserIntent: true }),
      });
    },
    delegateBackgroundTask(message: string): Promise<AgentTaskResponse> {
      return requestJson<AgentTaskResponse>("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, source: "ui" }),
      });
    },
  };
}
```

- [ ] **Step 5: Run UI lib tests**

Run: `cd components/ui && bun test src/lib/agent-client.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/ui/src/lib/system-types.ts components/ui/src/lib/agent-client.ts components/ui/src/lib/agent-client.test.js
git commit -m "feat: add frontend agent client"
```

---

### Task 7: Minimal UI Routing

**Files:**
- Modify: `components/ui/src/App.tsx`
- Test: `components/ui/src/lib/agent-command.test.js`
- Create: `components/ui/src/lib/agent-command.ts`

- [ ] **Step 1: Write command routing tests**

```js
import { describe, expect, test } from "bun:test";
import { classifyAgentCommand } from "./agent-command";

describe("agent command classifier", () => {
  test("detects explicit memory writes", () => {
    expect(classifyAgentCommand("recuerda que Pablo Lopez es mi profesor")).toEqual({
      kind: "memory",
      namespace: "facts",
      content: "Pablo Lopez es mi profesor",
    });
  });

  test("detects background delegation", () => {
    expect(classifyAgentCommand("manda esto al trabajador de fondo: prepara un email")).toEqual({
      kind: "background",
      message: "prepara un email",
    });
  });

  test("falls back to foreground chat", () => {
    expect(classifyAgentCommand("hola")).toEqual({ kind: "foreground" });
  });
});
```

- [ ] **Step 2: Run the failing classifier test**

Run: `cd components/ui && bun test src/lib/agent-command.test.js`

Expected: FAIL because `agent-command.ts` does not exist.

- [ ] **Step 3: Implement the classifier**

```ts
export type AgentCommand =
  | { kind: "foreground" }
  | { kind: "memory"; namespace: "facts"; content: string }
  | { kind: "background"; message: string };

export function classifyAgentCommand(input: string): AgentCommand {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("recuerda que ")) {
    return {
      kind: "memory",
      namespace: "facts",
      content: trimmed.slice("recuerda que ".length).trim(),
    };
  }

  const backgroundPrefix = "manda esto al trabajador de fondo:";
  if (lower.startsWith(backgroundPrefix)) {
    return {
      kind: "background",
      message: trimmed.slice(backgroundPrefix.length).trim(),
    };
  }

  return { kind: "foreground" };
}
```

- [ ] **Step 4: Run the classifier test**

Run: `cd components/ui && bun test src/lib/agent-command.test.js`

Expected: PASS.

- [ ] **Step 5: Wire `App.tsx`**

In `components/ui/src/App.tsx`, import:

```ts
import { createAgentClient } from "./lib/agent-client";
import { classifyAgentCommand } from "./lib/agent-command";
```

Create the client near `piClient`:

```ts
const agentClient = createAgentClient();
```

Inside `sendPrompt`, before the auth-state check, add:

```ts
    const command = classifyAgentCommand(trimmed);
    if (command.kind === "memory") {
      setChatState("processing");
      setGlobalError(null);
      setLastInput(trimmed);
      try {
        const response = await agentClient.appendMemory(command.namespace, command.content);
        setLastReply(response.message ?? "Memoria guardada.");
        setChatState("idle");
      } catch (error) {
        setChatState("error");
        setGlobalError(describeClientError(error));
      }
      return;
    }

    if (command.kind === "background") {
      setChatState("processing");
      setGlobalError(null);
      setLastInput(trimmed);
      try {
        const response = await agentClient.delegateBackgroundTask(command.message);
        setLastReply(response.message ?? `Tarea enviada: ${response.taskId ?? "sin id"}`);
        setChatState("idle");
      } catch (error) {
        setChatState("error");
        setGlobalError(describeClientError(error));
      }
      return;
    }
```

- [ ] **Step 6: Run UI tests and build**

Run:

```bash
cd components/ui
bun test src/lib dev
bun run build
```

Expected: PASS for tests and successful Vite/Electron build.

- [ ] **Step 7: Commit**

```bash
git add components/ui/src/App.tsx components/ui/src/lib/agent-command.ts components/ui/src/lib/agent-command.test.js
git commit -m "feat: route ui commands to agent broker"
```

---

### Task 8: Systemd And Live Image Hook

**Files:**
- Create: `build/live-build/config/includes.chroot/etc/systemd/system/agenos-openclaw.service`
- Modify: `build/live-build/config/package-lists/live.list.chroot`
- Modify: `docs/architecture/live-system-slice.md`

- [ ] **Step 1: Add the simulated OpenClaw service file**

```ini
[Unit]
Description=AgenOS OpenClaw Background Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=AGENOS_OPENCLAW_MODE=local-simulated
ExecStart=/bin/sh -lc 'mkdir -p "$HOME/.agenos/openclaw" && tail -F "$HOME/.agenos/openclaw/outbox.ndjson"'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=graphical.target
```

- [ ] **Step 2: Ensure runtime dependencies are available**

Open `build/live-build/config/package-lists/live.list.chroot` and ensure these packages exist:

```text
nodejs
npm
```

If they are absent, add them on separate lines. Do not remove existing packages.

- [ ] **Step 3: Document the slice**

Append to `docs/architecture/live-system-slice.md`:

```md
## Agentic Backend MVP

The next slice keeps Pi as the foreground UI harness and adds an AgenOS-owned broker API under `/api/agent/*`.

Implemented behavior for the MVP:

- local memory under `~/.agenos/memory`
- policy decisions for memory, apps, browser, tasks, and outbound sends
- simulated OpenClaw outbox under `~/.agenos/openclaw/outbox.ndjson`
- `agenos-openclaw.service` as a Live USB visible worker process in simulated mode

This intentionally validates the 24/7 worker boundary before real WhatsApp, Telegram, or email credentials are required.
```

- [ ] **Step 4: Run relevant checks**

Run:

```bash
cd components/installer-ui
bun run typecheck:bun
bun test src/bun src/shared
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add build/live-build/config/includes.chroot/etc/systemd/system/agenos-openclaw.service build/live-build/config/package-lists/live.list.chroot docs/architecture/live-system-slice.md
git commit -m "feat: add simulated openclaw live worker"
```

---

### Task 9: Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run UI verification**

Run:

```bash
cd components/ui
bun test src/lib dev
bun run build
```

Expected: PASS.

- [ ] **Step 2: Run installer API verification**

Run:

```bash
cd components/installer-ui
bun run typecheck
bun run test
```

Expected: PASS.

- [ ] **Step 3: Build the ISO**

Run:

```bash
make build
```

Expected: ISO generated in `dist/`.

- [ ] **Step 4: Boot the Live ISO in VM**

Run:

```bash
make vm-live
```

Expected: Live session boots into AgenOS shell/installer flow.

- [ ] **Step 5: Smoke test the agentic slice**

Inside the VM:

```bash
systemctl status agenos-openclaw.service --no-pager
curl http://127.0.0.1:4173/api/agent/worker/health
```

Expected:

```json
{"ok":true,"mode":"local-simulated"}
```

From the UI, test:

```text
recuerda que Pablo Lopez es mi profesor
manda esto al trabajador de fondo: prepara un email a Pablo
```

Expected:

- memory response says memory was saved
- background task response says the task was sent
- `~/.agenos/memory/facts.md` contains the memory
- `~/.agenos/openclaw/outbox.ndjson` contains the queued task

- [ ] **Step 6: Commit final docs if verification required updates**

```bash
git status --short
git add docs/architecture/live-system-slice.md
git commit -m "docs: document agentic backend verification"
```

Only run this commit if Step 5 required documentation updates.

---

## Future Plans After MVP

Create separate Superpowers plans for these after this MVP is merged:

- Real OpenClaw packaging and daemon integration.
- Telegram channel adapter.
- WhatsApp channel adapter.
- Email draft/send adapter with confirmation workflow.
- Shared confirmation UI for background actions.
- Hardened sandboxing and OpenClaw permission confinement.
