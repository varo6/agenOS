import { afterEach, describe, expect, test } from "bun:test";

import {
  createSpeechRecognitionController,
  isSpeechRecognitionSupported,
} from "./speech-recognition";

const originalWindow = globalThis.window;

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];

  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  lang = "";
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string }; length: number }> }) => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  start() {
    this.startCalls += 1;
    this.onstart?.();
  }

  stop() {
    this.stopCalls += 1;
  }

  abort() {
    this.abortCalls += 1;
  }

  emitResult(transcript: string) {
    this.onresult?.({
      results: {
        0: {
          isFinal: true,
          0: { transcript },
          length: 1,
        },
        length: 1,
      },
    });
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }

  emitEnd() {
    this.onend?.();
  }
}

function setSpeechWindow() {
  FakeSpeechRecognition.instances = [];
  globalThis.window = {
    navigator: {
      language: "es-MX",
    },
    SpeechRecognition: FakeSpeechRecognition as never,
  } as Window & typeof globalThis;
}

afterEach(() => {
  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    delete globalThis.window;
  }
});

describe("speech-recognition", () => {
  test("detects browser support", () => {
    setSpeechWindow();
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  test("prefers the native AgenOS speech bridge", async () => {
    globalThis.window = {
      agenosSpeech: {
        isAvailable: () => true,
        transcribeOnce: async () => ({
          transcript: "enciende las luces",
          engine: "whisper.cpp",
          language: "es",
          model: "/opt/agenos/system/whisper.cpp/models/ggml-base.bin",
        }),
      },
    } as Window & typeof globalThis;

    const transcripts: string[] = [];
    let ended = 0;

    const controller = createSpeechRecognitionController({
      onResult: (transcript) => {
        transcripts.push(transcript);
      },
      onError: () => {},
      onEnd: () => {
        ended += 1;
      },
    });

    expect(controller.supported).toBe(true);
    expect(controller.engine).toBe("native");
    expect(controller.start()).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transcripts).toEqual(["enciende las luces"]);
    expect(ended).toBe(1);
  });

  test("maps result, error and end events", () => {
    setSpeechWindow();

    const transcripts: string[] = [];
    const errors: Array<{ code: string; disableVoice: boolean }> = [];
    let ended = 0;

    const controller = createSpeechRecognitionController({
      onResult: (transcript) => {
        transcripts.push(transcript);
      },
      onError: (error) => {
        errors.push({
          code: error.code,
          disableVoice: error.disableVoice,
        });
      },
      onEnd: () => {
        ended += 1;
      },
    });

    expect(controller.supported).toBe(true);
    expect(controller.engine).toBe("browser");
    expect(controller.start()).toBe(true);

    const instance = FakeSpeechRecognition.instances[0];
    expect(instance).toBeDefined();
    expect(instance.continuous).toBe(false);
    expect(instance.interimResults).toBe(false);
    expect(instance.maxAlternatives).toBe(1);
    expect(instance.lang).toBe("es-MX");

    instance?.emitResult("hola agenos");
    instance?.emitError("not-allowed");
    instance?.emitEnd();

    expect(transcripts).toEqual(["hola agenos"]);
    expect(errors).toEqual([{
      code: "not-allowed",
      disableVoice: true,
    }]);
    expect(ended).toBe(1);
  });
});
