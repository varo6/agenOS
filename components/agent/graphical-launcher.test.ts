import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  launchGraphicalApplication,
  resolveExecutable,
  type CommandRunResult,
  type SpawnedGraphicalProcess,
} from "./graphical-launcher";

function commandResult(overrides: Partial<CommandRunResult> = {}): CommandRunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function fakeChild(pid = 123): {
  child: SpawnedGraphicalProcess;
  processEvents: EventEmitter;
  stderrEvents: EventEmitter;
} {
  const processEvents = new EventEmitter();
  const stderrEvents = new EventEmitter();
  const child = processEvents as unknown as SpawnedGraphicalProcess;
  Object.assign(child, {
    pid,
    stderr: stderrEvents,
    unref() {},
  });
  return { child, processEvents, stderrEvents };
}

describe("graphical launcher", () => {
  test("resolves commands with the launch environment PATH", () => {
    const binDir = mkdtempSync(join(tmpdir(), "agenos-path-"));
    const executable = join(binDir, "demo-app");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);

    expect(resolveExecutable(["demo-app"], { PATH: binDir })).toBe(executable);
    expect(resolveExecutable(["demo-app"], { PATH: "/missing" })).toBeUndefined();
  });

  test("moves and focuses only after a new Sway window maps", async () => {
    const calls: string[] = [];
    let treeReads = 0;
    const { child } = fakeChild(321);
    const result = await launchGraphicalApplication({
      command: "demo-app",
      args: ["--new-window"],
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      label: "Demo",
      workspace: 2,
      focus: true,
      windowTokens: ["demo"],
      commandExists: (command) => command === "swaymsg",
      spawnCommand: () => {
        calls.push("spawn");
        return child;
      },
      runCommand: async (_command, args) => {
        if (args[0] === "-t") {
          treeReads += 1;
          calls.push(`tree-${treeReads}`);
          return commandResult({
            stdout: treeReads === 1
              ? JSON.stringify({ nodes: [] })
              : JSON.stringify({ nodes: [{ id: 42, app_id: "demo", pid: 321 }] }),
          });
        }
        calls.push(args[0] ?? "");
        return commandResult();
      },
    });

    expect(result).toMatchObject({ ok: true, status: "mapped", windowId: 42 });
    expect(calls).toEqual([
      "tree-1",
      "spawn",
      "tree-2",
      '[con_id=42] move to workspace "2:app", fullscreen enable, focus',
    ]);
  });

  test("reports an early non-zero exit with captured stderr", async () => {
    const { child, processEvents, stderrEvents } = fakeChild();
    const resultPromise = launchGraphicalApplication({
      command: "broken-app",
      env: { DISPLAY: ":0" },
      label: "Broken",
      workspace: 2,
      focus: true,
      spawnCommand: () => {
        queueMicrotask(() => {
          stderrEvents.emit("data", "missing shared library\n");
          processEvents.emit("exit", 127, null);
        });
        return child;
      },
      coldStartMs: 5,
    });

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      status: "failed",
      exitCode: 127,
      stderr: "missing shared library",
    });
    expect((await resultPromise).message).toContain("código 127");
    expect((await resultPromise).message).toContain("missing shared library");
  });

  test("returns an actionable timeout when no Sway window appears", async () => {
    const progress: string[] = [];
    const result = await launchGraphicalApplication({
      command: "silent-app",
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      label: "Silent",
      workspace: 2,
      focus: true,
      commandExists: (command) => command === "swaymsg",
      spawnCommand: () => undefined,
      runCommand: async () => commandResult({ stdout: JSON.stringify({ nodes: [] }) }),
      windowTimeoutMs: 5,
      pollIntervalMs: 1,
      coldStartMs: 0,
      onProgress: (message) => progress.push(message),
    });

    expect(result).toMatchObject({ ok: false, status: "timed-out" });
    expect(result.message).toContain("no apareció ninguna ventana en Sway");
    expect(progress.some((message) => message.includes("sigo esperando"))).toBe(true);
  });
});
