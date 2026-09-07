import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { createWavPlayer } from "./player";
import type { TtsPaths } from "./paths";

const PATHS: TtsPaths = { engine: "espeak-ng", binary: "/usr/bin/espeak-ng", player: "/usr/bin/aplay", missing: [] };

/** Proceso de mentira con el stdin y el stderr que espera el reproductor. */
function fakeProcess() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const written: Buffer[] = [];
  child.stdin = Object.assign(new EventEmitter(), {
    end(chunk: Buffer) { written.push(chunk); },
  });
  child.stderr = Object.assign(new EventEmitter(), {
    setEncoding() {},
  });
  child.kill = function kill(signal: string) {
    (this as Record<string, unknown>).killed = true;
    this.emit("exit", null, signal);
    return true;
  };
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;

  return { child, written };
}

describe("createWavPlayer", () => {
  test("manda el WAV por stdin y deja que aplay lea la cabecera", async () => {
    const { child, written } = fakeProcess();
    let args: string[] = [];
    const player = createWavPlayer({
      paths: PATHS,
      spawnFn: ((_command: string, spawnArgs: string[]) => {
        args = spawnArgs;
        queueMicrotask(() => child.emit("exit", 0, null));
        return child;
      }) as never,
    });

    expect(await player.play(new Uint8Array([82, 73, 70, 70]))).toEqual({ ok: true });
    // Sin `-r` ni `-f`: la cabecera RIFF ya dice frecuencia y formato.
    expect(args).toEqual(["-q", "-"]);
    expect(Array.from(written[0])).toEqual([82, 73, 70, 70]);
  });

  test("sin aplay lo dice en vez de fallar en silencio", async () => {
    const player = createWavPlayer({ paths: { ...PATHS, player: null } });
    expect(player.available()).toBe(false);
    expect(await player.play(new Uint8Array([1]))).toMatchObject({ ok: false, code: "unavailable" });
  });

  test("una salida distinta de cero es un fallo", async () => {
    const { child } = fakeProcess();
    const player = createWavPlayer({
      paths: PATHS,
      spawnFn: (() => {
        queueMicrotask(() => {
          child.stderr.emit("data", "device busy");
          child.emit("exit", 1, null);
        });
        return child;
      }) as never,
    });

    expect(await player.play(new Uint8Array([1]))).toMatchObject({
      ok: false, code: "synthesis-failed", message: "device busy",
    });
  });

  test("parar la lectura no es un error de sintesis", async () => {
    const { child } = fakeProcess();
    const player = createWavPlayer({
      paths: PATHS,
      spawnFn: (() => child) as never,
    });

    const playing = player.play(new Uint8Array([1]));
    player.stop();
    expect(await playing).toMatchObject({ ok: false, code: "cancelled" });
  });

  test("un audio vacio no arranca ningun proceso", async () => {
    let spawned = false;
    const player = createWavPlayer({
      paths: PATHS,
      spawnFn: (() => { spawned = true; return fakeProcess().child; }) as never,
    });

    expect(await player.play(new Uint8Array())).toEqual({ ok: true });
    expect(spawned).toBe(false);
  });
});
