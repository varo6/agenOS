import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";

import { createLocalTtsService } from "./local-tts";
import type { TtsPaths } from "./paths";
import type { TtsSettings } from "./config";

class FakeChild extends EventEmitter {
  readonly stdin = { end: (value: string) => { this.input = value; } };
  readonly stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  input = "";

  constructor() {
    super();
    this.stderr.setEncoding = () => {};
  }

  kill(signal: NodeJS.Signals) {
    this.killed = true;
    this.signalCode = signal;
    this.emit("exit", null, signal);
    return true;
  }
}

const settings: TtsSettings = {
  voice: "es",
  rate: 170,
  pitch: 40,
  amplitude: 120,
  maxChars: 100,
};

const paths: TtsPaths = {
  engine: "espeak-ng",
  binary: "/usr/bin/espeak-ng",
  missing: [],
};

describe("local TTS", () => {
  test("invoca espeak-ng como binario nativo y pasa el texto por stdin", async () => {
    const spawned: Array<{ command: string; args: string[]; child: FakeChild }> = [];
    const service = createLocalTtsService(settings, paths, {
      spawnFn: ((command: string, args: string[]) => {
        const child = new FakeChild();
        spawned.push({ command, args, child });
        return child;
      }) as never,
    });

    const resultPromise = service.speak("Pi responde con `codigo` y **markdown**.");
    expect(spawned).toHaveLength(1);
    expect(spawned[0].command).toBe("/usr/bin/espeak-ng");
    expect(spawned[0].args).toEqual([
      "-v", "es",
      "-s", "170",
      "-p", "40",
      "-a", "120",
      "--stdin",
    ]);
    expect(spawned[0].child.input).toBe("Pi responde con codigo y markdown .");

    spawned[0].child.exitCode = 0;
    spawned[0].child.emit("exit", 0, null);

    await expect(resultPromise).resolves.toEqual({ ok: true, engine: "espeak-ng", voice: "es" });
  });

  test("cancela la lectura anterior antes de hablar una respuesta nueva", async () => {
    const spawned: FakeChild[] = [];
    const service = createLocalTtsService(settings, paths, {
      spawnFn: (() => {
        const child = new FakeChild();
        spawned.push(child);
        return child;
      }) as never,
    });

    const first = service.speak("respuesta anterior");
    const second = service.speak("respuesta nueva");

    expect(spawned).toHaveLength(2);
    expect(spawned[0].killed).toBe(true);
    await expect(first).resolves.toMatchObject({ ok: false, code: "cancelled" });

    spawned[1].exitCode = 0;
    spawned[1].emit("exit", 0, null);
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  test("declara no disponible cuando falta el binario", async () => {
    const service = createLocalTtsService(settings, { ...paths, binary: null, missing: ["espeak-ng"] });

    expect(service.status()).toMatchObject({ available: false, reason: "TTS local no disponible: falta espeak-ng." });
    await expect(service.speak("hola")).resolves.toMatchObject({ ok: false, code: "unavailable" });
  });
});
