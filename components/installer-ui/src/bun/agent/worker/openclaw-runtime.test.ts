import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  OPENCLAW_GATEWAY_TOKEN_KEY,
  createOpenClawRuntime,
} from "./openclaw-runtime";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenos-openclaw-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createFile(path: string): string {
  writeFileSync(path, "#!/bin/sh\n");
  return path;
}

function response(status: number, body = ""): Response {
  return new Response(body, { status });
}

function fetchFake(implementation: () => Promise<Response>): typeof fetch {
  return implementation as unknown as typeof fetch;
}

describe("OpenClaw runtime", () => {
  test("resolveBinary treats an explicit binary path as strict", () => {
    const root = temporaryDirectory();
    const pathBinary = createFile(join(root, "openclaw"));
    const runtime = createOpenClawRuntime({
      binaryPath: join(root, "missing-openclaw"),
      env: { PATH: root },
    });

    expect(existsSync(pathBinary)).toBe(true);
    expect(runtime.resolveBinary()).toBeNull();
  });

  test("resolveBinary honors AGENOS_OPENCLAW_BIN", () => {
    const root = temporaryDirectory();
    const binary = createFile(join(root, "configured-openclaw"));
    const runtime = createOpenClawRuntime({ env: { AGENOS_OPENCLAW_BIN: binary, PATH: "" } });

    expect(runtime.resolveBinary()).toBe(binary);
  });

  test("resolveBinary finds openclaw on PATH", () => {
    const root = temporaryDirectory();
    const binary = createFile(join(root, "openclaw"));
    const runtime = createOpenClawRuntime({ env: { PATH: root } });

    expect(runtime.resolveBinary()).toBe(binary);
  });

  test("ensureConfig creates idempotent config and mirrors its token", () => {
    const stateDir = temporaryDirectory();
    const runtime = createOpenClawRuntime({
      stateDir,
      gatewayPort: 19001,
      randomToken: () => "stable-token",
      env: {},
    });

    const first = runtime.ensureConfig();
    const second = runtime.ensureConfig();
    const config = JSON.parse(readFileSync(runtime.configPath, "utf8"));

    expect(first.gatewayToken).toBe("stable-token");
    expect(second.gatewayToken).toBe(first.gatewayToken);
    expect(config).toMatchObject({
      gateway: { port: 19001, bind: "127.0.0.1", auth: { token: "stable-token" } },
      agents: { defaults: { workspace: join(stateDir, "state", "workspace") } },
    });
    expect(readFileSync(runtime.secretsPath, "utf8")).toContain(
      `${OPENCLAW_GATEWAY_TOKEN_KEY}=stable-token`,
    );
  });

  test("ensureConfig renames corrupt JSON and regenerates config", () => {
    const stateDir = temporaryDirectory();
    const runtime = createOpenClawRuntime({ stateDir, randomToken: () => "new-token", env: {} });
    writeFileSync(runtime.configPath, "{not-json");

    runtime.ensureConfig();

    expect(readFileSync(`${runtime.configPath}.invalid`, "utf8")).toBe("{not-json");
    expect(JSON.parse(readFileSync(runtime.configPath, "utf8"))).toMatchObject({
      gateway: { auth: { token: "new-token" } },
    });
  });

  test("gatewayToken reads config and falls back to secrets.env", () => {
    const configState = temporaryDirectory();
    const configRuntime = createOpenClawRuntime({ stateDir: configState, env: {} });
    writeFileSync(configRuntime.configPath, JSON.stringify({ gateway: { auth: { token: "config-token" } } }));
    expect(configRuntime.gatewayToken()).toBe("config-token");

    const secretState = temporaryDirectory();
    const secretRuntime = createOpenClawRuntime({ stateDir: secretState, env: {} });
    writeFileSync(secretRuntime.secretsPath, `${OPENCLAW_GATEWAY_TOKEN_KEY}=secret-token\n`);
    expect(secretRuntime.gatewayToken()).toBe("secret-token");
  });

  test("probeGateway reports healthy, rejected-token, and unreachable states", async () => {
    const healthy = createOpenClawRuntime({
      stateDir: temporaryDirectory(),
      env: {},
      fetchImpl: fetchFake(async () => response(200)),
    });
    expect(await healthy.probeGateway()).toEqual({ ok: true, reachable: true, message: null });

    const unauthorized = createOpenClawRuntime({
      stateDir: temporaryDirectory(),
      env: {},
      fetchImpl: fetchFake(async () => response(401)),
    });
    expect(await unauthorized.probeGateway()).toMatchObject({
      ok: false,
      reachable: true,
      message: expect.stringContaining("token"),
    });

    const unreachable = createOpenClawRuntime({
      stateDir: temporaryDirectory(),
      env: {},
      fetchImpl: fetchFake(async () => {
        throw new Error("connection refused");
      }),
    });
    expect(await unreachable.probeGateway()).toMatchObject({
      ok: false,
      reachable: false,
      message: expect.stringContaining("connection refused"),
    });
  });

  test("chat returns OpenAI-style content and reports HTTP failures", async () => {
    const stateDir = temporaryDirectory();
    const successful = createOpenClawRuntime({
      stateDir,
      env: {},
      randomToken: () => "chat-token",
      fetchImpl: fetchFake(async () => response(200, JSON.stringify({ choices: [{ message: { content: "hola" } }] }))),
    });
    successful.ensureConfig();
    expect(await successful.chat("saluda")).toEqual({ ok: true, content: "hola", message: null });

    const failing = createOpenClawRuntime({
      stateDir,
      env: {},
      fetchImpl: fetchFake(async () => response(503, "unavailable")),
    });
    expect(await failing.chat("saluda")).toMatchObject({
      ok: false,
      content: null,
      message: expect.stringContaining("HTTP 503"),
    });
  });

  test("chat fails without a configured gateway token", async () => {
    const runtime = createOpenClawRuntime({ stateDir: temporaryDirectory(), env: {} });

    expect(await runtime.chat("hola")).toMatchObject({
      ok: false,
      content: null,
      message: expect.stringContaining("token"),
    });
  });

  test("installRuntime returns immediately when the binary is resolvable", async () => {
    const root = temporaryDirectory();
    const binary = createFile(join(root, "openclaw"));
    const execImpl = mock(async () => ({ ok: true, stdout: "", stderr: "" }));
    const runtime = createOpenClawRuntime({ env: { AGENOS_OPENCLAW_BIN: binary, PATH: "" }, execImpl });

    expect(await runtime.installRuntime()).toMatchObject({ ok: true });
    expect(execImpl).not.toHaveBeenCalled();
  });

  test("installRuntime explains when npm is unavailable", async () => {
    const runtime = createOpenClawRuntime({
      binaryPath: join(temporaryDirectory(), "missing-openclaw"),
      env: { PATH: "" },
    });

    expect(await runtime.installRuntime()).toMatchObject({
      ok: false,
      message: expect.stringContaining("npm"),
    });
  });

  test("installRuntime succeeds when npm creates the configured binary", async () => {
    const root = temporaryDirectory();
    const npm = createFile(join(root, "npm"));
    const binary = join(root, "installed-openclaw");
    const execImpl = mock(async (command: string) => {
      expect(command).toBe(npm);
      createFile(binary);
      return { ok: true, stdout: "", stderr: "" };
    });
    const runtime = createOpenClawRuntime({
      env: { PATH: root, AGENOS_OPENCLAW_BIN: binary },
      execImpl,
    });

    expect(await runtime.installRuntime()).toMatchObject({ ok: true });
    expect(execImpl).toHaveBeenCalledTimes(1);
  });

  test("startGateway spawns with gateway arguments and OpenClaw paths, then stops the child", async () => {
    const root = temporaryDirectory();
    const binary = createFile(join(root, "openclaw"));
    const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof mock> };
    child.kill = mock(() => true);
    const spawnImpl = mock((_command: string, _args: string[], _env: Record<string, string>) => child as unknown as ChildProcess);
    const runtime = createOpenClawRuntime({
      stateDir: join(root, "runtime"),
      gatewayPort: 19002,
      binaryPath: binary,
      env: { PATH: root },
      fetchImpl: fetchFake(async () => {
        throw new Error("down");
      }),
      spawnImpl,
    });

    const supervisor = runtime.startGateway();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl.mock.calls[0]?.[1]).toEqual(["gateway", "--port", "19002"]);
    expect(spawnImpl.mock.calls[0]?.[2]).toMatchObject({
      OPENCLAW_CONFIG_PATH: runtime.configPath,
      OPENCLAW_STATE_DIR: join(runtime.stateDir, "state"),
    });

    supervisor.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("startGateway does not spawn when the gateway is already healthy", async () => {
    const root = temporaryDirectory();
    const binary = createFile(join(root, "openclaw"));
    const spawnImpl = mock(() => new EventEmitter() as unknown as ChildProcess);
    const runtime = createOpenClawRuntime({
      stateDir: join(root, "runtime"),
      binaryPath: binary,
      env: {},
      fetchImpl: fetchFake(async () => response(200)),
      spawnImpl,
    });

    const supervisor = runtime.startGateway();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spawnImpl).not.toHaveBeenCalled();
    supervisor.stop();
  });
});
