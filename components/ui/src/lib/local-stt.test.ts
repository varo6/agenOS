import { afterEach, describe, expect, test } from "bun:test";

import {
  createLocalHttpSpeechController,
  getCachedLocalSttAvailability,
  probeLocalSttAvailability,
  resetLocalSttAvailabilityCache,
  type LocalSttMediaStream,
  type LocalSttRecorder,
} from "./local-stt";
import type { SpeechRecognitionError } from "./speech-recognition";

class FakeRecorder implements LocalSttRecorder {
  mimeType = "audio/webm";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  chunk: Blob | null = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") {
      return;
    }
    this.state = "inactive";
    if (this.chunk) {
      this.ondataavailable?.({ data: this.chunk });
    }
    this.onstop?.();
  }
}

function fakeStream(): LocalSttMediaStream & { stoppedTracks: number } {
  const stream = {
    stoppedTracks: 0,
    getTracks() {
      return [{
        stop: () => {
          stream.stoppedTracks += 1;
        },
      }];
    },
  };
  return stream;
}

type CapturedCallbacks = {
  results: string[];
  errors: SpeechRecognitionError[];
  ends: number;
};

function capture(): CapturedCallbacks & {
  onResult: (transcript: string) => void;
  onError: (error: SpeechRecognitionError) => void;
  onEnd: () => void;
} {
  const state = {
    results: [] as string[],
    errors: [] as SpeechRecognitionError[],
    ends: 0,
  };
  return {
    ...state,
    onResult: (transcript: string) => state.results.push(transcript),
    onError: (error: SpeechRecognitionError) => state.errors.push(error),
    onEnd: () => {
      state.ends += 1;
    },
    get results() {
      return state.results;
    },
    get errors() {
      return state.errors;
    },
    get ends() {
      return state.ends;
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 5));
  }
}

afterEach(() => {
  resetLocalSttAvailabilityCache();
});

describe("probeLocalSttAvailability", () => {
  test("caches a positive status response", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return jsonResponse({ ok: true, available: true });
    }) as typeof fetch;

    expect(await probeLocalSttAvailability(fetchFn)).toBe(true);
    expect(await probeLocalSttAvailability(fetchFn)).toBe(true);
    expect(calls).toBe(1);
    expect(getCachedLocalSttAvailability()).toBe(true);
  });

  test("returns false when the endpoint fails", async () => {
    const fetchFn = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;

    expect(await probeLocalSttAvailability(fetchFn)).toBe(false);
    expect(getCachedLocalSttAvailability()).toBe(false);
  });
});

describe("createLocalHttpSpeechController", () => {
  test("records, posts the audio, and reports the transcript", async () => {
    const callbacks = capture();
    const recorder = new FakeRecorder();
    const stream = fakeStream();
    const requests: { url: string; contentType: string }[] = [];

    const controller = createLocalHttpSpeechController(callbacks, {
      requestStream: async () => stream,
      createRecorder: () => recorder,
      maxDurationMs: 10,
      fetchFn: (async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(url),
          contentType: String((init?.headers as Record<string, string>)?.["content-type"]),
        });
        return jsonResponse({ ok: true, text: "abre fotos", durationMs: 100, engine: "whisper.cpp", model: "m" });
      }) as typeof fetch,
    });

    expect(controller.engine).toBe("local-http");
    expect(controller.start()).toBe(true);
    expect(controller.start()).toBe(false);

    await waitFor(() => callbacks.ends === 1);

    expect(callbacks.results).toEqual(["abre fotos"]);
    expect(callbacks.errors).toHaveLength(0);
    expect(stream.stoppedTracks).toBe(1);
    expect(requests[0]?.url).toBe("/api/speech/transcribe");
    expect(requests[0]?.contentType).toBe("audio/webm");

    expect(controller.start()).toBe(true);
    controller.dispose();
  });

  test("maps an empty transcript to a no-speech error", async () => {
    const callbacks = capture();
    const controller = createLocalHttpSpeechController(callbacks, {
      requestStream: async () => fakeStream(),
      createRecorder: () => new FakeRecorder(),
      maxDurationMs: 10,
      fetchFn: (async () => jsonResponse({ ok: true, text: "", durationMs: 90, engine: "whisper.cpp", model: "m" })) as typeof fetch,
    });

    controller.start();
    await waitFor(() => callbacks.ends === 1);

    expect(callbacks.errors[0]?.code).toBe("no-speech");
    expect(callbacks.errors[0]?.disableVoice).toBe(false);
  });

  test("disables voice when the backend reports 503", async () => {
    const callbacks = capture();
    const controller = createLocalHttpSpeechController(callbacks, {
      requestStream: async () => fakeStream(),
      createRecorder: () => new FakeRecorder(),
      maxDurationMs: 10,
      fetchFn: (async () => jsonResponse({ ok: false, message: "falta voxtype" }, 503)) as typeof fetch,
    });

    controller.start();
    await waitFor(() => callbacks.ends === 1);

    expect(callbacks.errors[0]?.code).toBe("local-stt-unavailable");
    expect(callbacks.errors[0]?.disableVoice).toBe(true);
  });

  test("maps microphone permission errors", async () => {
    const callbacks = capture();
    const denied = new Error("denied");
    denied.name = "NotAllowedError";

    const controller = createLocalHttpSpeechController(callbacks, {
      requestStream: async () => {
        throw denied;
      },
      createRecorder: () => new FakeRecorder(),
      fetchFn: (async () => jsonResponse({})) as typeof fetch,
    });

    controller.start();
    await waitFor(() => callbacks.ends === 1);

    expect(callbacks.errors[0]?.code).toBe("not-allowed");
    expect(callbacks.errors[0]?.disableVoice).toBe(true);
  });

  /*
   * stop() es cancelar, no "termina ya". El final normal de una frase lo decide
   * el VAD; lo que la persona pide al pulsar de nuevo es abortar, y abortar no
   * puede acabar mandandole texto a Pi.
   */
  test("stop() cancela: corta el grabador, suelta el micrófono y no transcribe", async () => {
    const callbacks = capture();
    const recorder = new FakeRecorder();
    const stream = fakeStream();
    let transcribeCalls = 0;

    const controller = createLocalHttpSpeechController(callbacks, {
      requestStream: async () => stream,
      createRecorder: () => recorder,
      maxDurationMs: 60_000,
      fetchFn: (async () => {
        transcribeCalls += 1;
        return jsonResponse({ ok: true, text: "hola", durationMs: 10, engine: "whisper.cpp", model: "m" });
      }) as typeof fetch,
    });

    controller.start();
    await waitFor(() => recorder.state === "recording");
    controller.stop();
    await waitFor(() => callbacks.ends === 1);

    expect(callbacks.results).toEqual([]);
    expect(transcribeCalls).toBe(0);
    expect(recorder.state).toBe("inactive");
    expect(stream.stoppedTracks).toBeGreaterThan(0);
  });

  test("tras cancelar se puede volver a grabar", async () => {
    const callbacks = capture();
    const recorders = [new FakeRecorder(), new FakeRecorder()];
    let index = 0;

    const controller = createLocalHttpSpeechController(callbacks, {
      requestStream: async () => fakeStream(),
      createRecorder: () => recorders[index++],
      maxDurationMs: 5,
      fetchFn: (async () => jsonResponse({ ok: true, text: "hola", durationMs: 10, engine: "whisper.cpp", model: "m" })) as typeof fetch,
    });

    controller.start();
    await waitFor(() => recorders[0].state === "recording");
    controller.stop();
    await waitFor(() => callbacks.ends === 1);

    expect(controller.start()).toBe(true);
    await waitFor(() => callbacks.results.length === 1);
    expect(callbacks.results).toEqual(["hola"]);
  });

  test("un 422 del servidor es falta de voz, no un fallo técnico", async () => {
    const callbacks = capture();
    const recorder = new FakeRecorder();

    const controller = createLocalHttpSpeechController(callbacks, {
      requestStream: async () => fakeStream(),
      createRecorder: () => recorder,
      maxDurationMs: 5,
      fetchFn: (async () => new Response(
        JSON.stringify({ ok: false, code: "no-speech", message: "No se detecto voz." }),
        { status: 422, headers: { "content-type": "application/json" } },
      )) as typeof fetch,
    });

    controller.start();
    await waitFor(() => callbacks.ends === 1);

    expect(callbacks.results).toEqual([]);
    expect(callbacks.errors[0]?.code).toBe("no-speech");
    expect(callbacks.errors[0]?.disableVoice).toBe(false);
  });
});
