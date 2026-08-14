import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { createOpenClawSetupService, parseCodexLoginOutput } from "./setup";
import type { OpenClawRuntime } from "./worker/openclaw-runtime";

function fakeRuntime(overrides: Partial<OpenClawRuntime> = {}): OpenClawRuntime {
  return {
    gatewayUrl: "http://127.0.0.1:18789",
    configPath: "/fake/openclaw.json",
    resolveBinary: mock(() => "/fake/openclaw"),
    installRuntime: mock(async () => ({ ok: true, message: "installed" })),
    ensureConfig: mock(() => ({ configPath: "/fake/openclaw.json", gatewayToken: "token" })),
    version: mock(async () => "openclaw 2026.6.11"),
    probeGateway: mock(async () => ({ ok: true, reachable: true, message: null })),
    ...overrides,
  } as unknown as OpenClawRuntime;
}

class FakeLoginChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function asChildProcess(child: FakeLoginChild): ChildProcess {
  return child as unknown as ChildProcess;
}

describe("OpenClaw setup service", () => {
  test("records degraded setup state when OpenClaw is missing", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      openClawBinaryPath: join(rootDir, "missing-openclaw"),
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: {},
      now: () => new Date("2026-05-24T12:00:00.000Z"),
      correlationIdFactory: () => "corr_setup_missing",
    });

    const result = await service.run();

    expect(result).toMatchObject({
      ok: false,
      phase: "degraded",
      correlationId: "corr_setup_missing",
      openclaw: {
        installed: false,
        healthy: false,
      },
      codex: {
        configured: false,
        loginAvailable: false,
      },
      telegram: {
        enabled: false,
        tokenConfigured: false,
      },
    });
    expect(result.actions).toContain("setup.rerun");
    expect(result.actions).toContain("diagnostics.export");
    expect(existsSync(join(rootDir, "setup-state.json"))).toBe(true);
  });

  test("stores Telegram token in secrets file but redacts setup state", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      openClawBinaryPath: join(rootDir, "missing-openclaw"),
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: {},
      now: () => new Date("2026-05-24T12:00:00.000Z"),
      correlationIdFactory: () => "corr_telegram_configure",
    });

    const response = await service.configureTelegram("123456:telegram-secret");
    const state = await service.status();
    const rawState = readFileSync(join(rootDir, "setup-state.json"), "utf8");
    const secrets = readFileSync(join(rootDir, "secrets.env"), "utf8");

    expect(response).toMatchObject({
      ok: false,
      phase: "degraded",
      telegram: { tokenConfigured: true },
    });
    expect(state.telegram.tokenConfigured).toBe(true);
    expect(secrets).toContain("OPENCLAW_TELEGRAM_BOT_TOKEN=123456:telegram-secret");
    expect(rawState).not.toContain("telegram-secret");
  });

  test("tests Telegram from environment without exposing the token", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      openClawBinaryPath: join(rootDir, "missing-openclaw"),
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: { OPENCLAW_TELEGRAM_BOT_TOKEN: "123456:telegram-secret" },
      now: () => new Date("2026-05-24T12:00:00.000Z"),
      correlationIdFactory: () => "corr_telegram_test",
      telegramProbe: async (token) => ({
        ok: token.startsWith("123456:"),
        botUsername: "agenos_test_bot",
        message: "Telegram bot reachable.",
      }),
    });

    const response = await service.testTelegram();
    const rawState = readFileSync(join(rootDir, "setup-state.json"), "utf8");

    expect(response).toMatchObject({
      ok: false,
      phase: "degraded",
      telegram: {
        tokenConfigured: true,
        botUsername: "agenos_test_bot",
        lastTestOk: true,
      },
    });
    expect(rawState).not.toContain("telegram-secret");
  });

  test("run reports runtime version, gateway URL, and healthy probe state", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const runtime = fakeRuntime();
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: { OPENCLAW_CODEX_AUTH_CONFIGURED: "1" },
      runtime,
    });

    const result = await service.run();

    expect(result.openclaw).toMatchObject({
      installed: true,
      healthy: true,
      version: "openclaw 2026.6.11",
      gatewayUrl: "http://127.0.0.1:18789",
    });
    expect(runtime.ensureConfig).toHaveBeenCalledTimes(1);
  });

  test("run reports an installed runtime as unhealthy when its gateway probe fails", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const runtime = fakeRuntime({
      probeGateway: mock(async () => ({ ok: false, reachable: false, message: "gateway down" })),
    });
    const service = createOpenClawSetupService({ stateDir: rootDir, env: {}, runtime });

    const result = await service.run();

    expect(result.openclaw).toMatchObject({ installed: true, healthy: false });
  });

  test("auto-install runs only when the binary is missing and the flag is enabled", async () => {
    const enabledRoot = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    let installed = false;
    const enabledRuntime = fakeRuntime({
      resolveBinary: mock(() => (installed ? "/fake/openclaw" : null)),
      installRuntime: mock(async () => {
        installed = true;
        return { ok: true, message: "installed" };
      }),
    });
    await createOpenClawSetupService({
      stateDir: enabledRoot,
      openClawBinaryPath: join(enabledRoot, "missing-openclaw"),
      env: { AGENOS_OPENCLAW_AUTO_INSTALL: "1" },
      runtime: enabledRuntime,
    }).run();
    expect(enabledRuntime.installRuntime).toHaveBeenCalledTimes(1);
    expect(enabledRuntime.ensureConfig).toHaveBeenCalledTimes(1);

    const disabledRoot = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const disabledRuntime = fakeRuntime({ resolveBinary: mock(() => null) });
    await createOpenClawSetupService({
      stateDir: disabledRoot,
      openClawBinaryPath: join(disabledRoot, "missing-openclaw"),
      env: {},
      runtime: disabledRuntime,
    }).run();
    expect(disabledRuntime.installRuntime).not.toHaveBeenCalled();

    const presentRoot = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const presentRuntime = fakeRuntime();
    await createOpenClawSetupService({
      stateDir: presentRoot,
      env: { AGENOS_OPENCLAW_AUTO_INSTALL: "1" },
      runtime: presentRuntime,
    }).run();
    expect(presentRuntime.installRuntime).not.toHaveBeenCalled();
  });

  test("startCodexLogin spawns the login flow and relays URL and user code", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const child = new FakeLoginChild();
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: {},
      runtime: fakeRuntime(),
      codexLoginSpawn: (command, args) => {
        spawnCalls.push({ command, args });
        return asChildProcess(child);
      },
      codexLoginWaitMs: 2_000,
    });

    setTimeout(() => {
      child.stdout.emit(
        "data",
        Buffer.from("Abre https://auth.openai.com/codex/device e introduce el codigo ABCD-1234\n"),
      );
    }, 10);

    const state = await service.startCodexLogin();

    expect(spawnCalls).toEqual([
      { command: "/fake/openclaw", args: ["models", "auth", "login", "--provider", "openai-codex"] },
    ]);
    expect(state.codex.login).toMatchObject({
      status: "pending",
      url: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    });

    child.emit("exit", 0);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));

    const after = await service.codexLoginStatus();
    expect(after.codex.configured).toBe(true);
    expect(after.codex.login.status).toBe("success");
    expect(after.phase).toBe("ready");
    expect(readFileSync(join(rootDir, "secrets.env"), "utf8")).toContain("OPENCLAW_CODEX_AUTH_CONFIGURED=1");
  });

  test("startCodexLogin reports a failed login process", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const child = new FakeLoginChild();
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: {},
      runtime: fakeRuntime(),
      codexLoginSpawn: () => asChildProcess(child),
      codexLoginWaitMs: 2_000,
    });

    setTimeout(() => {
      child.stderr.emit("data", Buffer.from("device auth rejected\n"));
      child.emit("exit", 1);
    }, 10);

    const state = await service.startCodexLogin();

    expect(state.codex.configured).toBe(false);
    expect(state.codex.login.status).toBe("error");
    expect(state.codex.login.error).toContain("device auth rejected");
  });

  test("startCodexLogin fails cleanly when no login binary exists", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: {},
      runtime: fakeRuntime({ resolveBinary: mock(() => null) }),
      codexLoginWaitMs: 100,
    });

    const state = await service.startCodexLogin();

    expect(state.codex.login.status).toBe("error");
    expect(state.codex.login.error).toContain("No openclaw or codex binary");
  });

  test("parseCodexLoginOutput extracts the auth URL and last user code", () => {
    const parsed = parseCodexLoginOutput(
      "[1mCodex login[0m\nVisit https://auth.openai.com/codex/device to continue\nYour code: WXYZ-9876\n",
    );
    expect(parsed).toEqual({ url: "https://auth.openai.com/codex/device", userCode: "WXYZ-9876" });
  });
});
