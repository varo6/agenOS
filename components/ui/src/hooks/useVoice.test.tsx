import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useVoice, type UseVoiceOptions } from "./useVoice";
import type {
  SpeechRecognitionCallbacks,
  SpeechRecognitionController,
} from "../lib/speech-recognition";

type FakeMic = {
  createController: UseVoiceOptions["createController"];
  callbacks: () => SpeechRecognitionCallbacks;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

function createFakeMic(options: { supported?: boolean; startResult?: boolean } = {}): FakeMic {
  let captured: SpeechRecognitionCallbacks | null = null;
  const start = vi.fn(() => options.startResult ?? true);
  const stop = vi.fn();
  const dispose = vi.fn();

  const controller: SpeechRecognitionController = {
    supported: options.supported ?? true,
    engine: "local-http",
    start,
    stop,
    dispose,
  };

  return {
    createController: async (callbacks) => {
      captured = callbacks;
      return controller;
    },
    callbacks: () => {
      if (!captured) {
        throw new Error("El controlador todavía no se ha creado.");
      }
      return captured;
    },
    start,
    stop,
    dispose,
  };
}

function renderVoice(mic: FakeMic, overrides: Partial<UseVoiceOptions> = {}) {
  const onTranscript = vi.fn();

  const view = renderHook(
    (props: Partial<UseVoiceOptions>) =>
      useVoice({
        onTranscript,
        agentState: "idle",
        createController: mic.createController,
        ...overrides,
        ...props,
      }),
    { initialProps: {} },
  );

  return { ...view, onTranscript };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useVoice", () => {
  test("sin micrófono utilizable lo dice y no deja escuchar", async () => {
    const mic = createFakeMic({ supported: false });
    const { result } = renderVoice(mic);

    await waitFor(() => {
      expect(result.current.status.phase).toBe("unavailable");
    });
    expect(result.current.status.canListen).toBe(false);

    act(() => {
      result.current.start();
    });
    expect(mic.start).not.toHaveBeenCalled();
  });

  test("recorre escuchar, transcribir y entregar la transcripción", async () => {
    const mic = createFakeMic();
    const { result, onTranscript } = renderVoice(mic);

    await waitFor(() => {
      expect(result.current.status.phase).toBe("idle");
    });

    act(() => {
      result.current.start();
    });
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(result.current.status.phase).toBe("listening");
    expect(result.current.buttonLabel).toContain("Escuchando");

    act(() => {
      mic.callbacks().onPhase?.("transcribing");
    });
    expect(result.current.status.phase).toBe("transcribing");

    act(() => {
      mic.callbacks().onResult("abre el navegador");
    });
    expect(onTranscript).toHaveBeenCalledWith("abre el navegador");
    expect(result.current.status.phase).toBe("idle");
  });

  test("un fallo de captura se explica y permite reintentar", async () => {
    const mic = createFakeMic();
    const { result } = renderVoice(mic);

    await waitFor(() => {
      expect(result.current.status.phase).toBe("idle");
    });

    act(() => {
      mic.callbacks().onError({
        code: "no-speech",
        message: "No se detectó voz. Inténtalo otra vez.",
        disableVoice: false,
      });
    });

    expect(result.current.status.phase).toBe("error");
    expect(result.current.status.hint).toBe("No se detectó voz. Inténtalo otra vez.");
    expect(result.current.status.canListen).toBe(true);
  });

  test("un fallo que inutiliza el micrófono lo desactiva del todo", async () => {
    const mic = createFakeMic();
    const { result } = renderVoice(mic);

    await waitFor(() => {
      expect(result.current.status.phase).toBe("idle");
    });

    act(() => {
      mic.callbacks().onError({
        code: "not-allowed",
        message: "Sin permiso para el micrófono.",
        disableVoice: true,
      });
    });

    expect(result.current.status.phase).toBe("unavailable");
    expect(result.current.status.canListen).toBe(false);
  });

  test("refleja lo que hace el agente y confirma al terminar", async () => {
    const mic = createFakeMic();
    const { result, rerender } = renderVoice(mic);

    // Se espera al micrófono antes de congelar el reloj, para que la promesa
    // del controlador no resuelva fuera de act().
    await waitFor(() => {
      expect(result.current.status.phase).toBe("idle");
    });
    vi.useFakeTimers();

    rerender({ agentState: "thinking" });
    expect(result.current.status.phase).toBe("thinking");

    rerender({ agentState: "working", currentTool: "apps_open" });
    expect(result.current.status.phase).toBe("working");
    expect(result.current.status.title).toBe("Pi está abriendo una aplicación");

    rerender({ agentState: "idle" });
    expect(result.current.status.phase).toBe("done");

    // El "Listo" se desvanece solo en lugar de quedarse anclado.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.status.phase).toBe("idle");
  });

  test("sin conexión o sin cuenta explica por qué no puede escuchar", async () => {
    const mic = createFakeMic();
    const { result, rerender } = renderVoice(mic);

    await waitFor(() => {
      expect(result.current.status.phase).toBe("idle");
    });

    rerender({ blockedReason: "offline" });
    expect(result.current.status.phase).toBe("blocked");
    expect(result.current.status.canListen).toBe(false);

    act(() => {
      result.current.start();
    });
    expect(mic.start).not.toHaveBeenCalled();

    rerender({ blockedReason: "disconnected" });
    expect(result.current.status.hint).toContain("ChatGPT");
  });

  test("terminar la captura pasa a transcripción", async () => {
    const mic = createFakeMic();
    const { result } = renderVoice(mic);

    await waitFor(() => {
      expect(result.current.status.phase).toBe("idle");
    });

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.finish();
    });

    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(result.current.status.phase).toBe("transcribing");
  });

  test("libera el micrófono al desmontar", async () => {
    const mic = createFakeMic();
    const { result, unmount } = renderVoice(mic);

    await waitFor(() => {
      expect(result.current.status.phase).toBe("idle");
    });

    unmount();
    expect(mic.dispose).toHaveBeenCalledTimes(1);
  });
});
