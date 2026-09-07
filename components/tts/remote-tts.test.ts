import { describe, expect, test } from "bun:test";

import { DEFAULT_REMOTE_SERVICES_SETTINGS } from "../remote";
import type { PlayResult, WavPlayer } from "./player";
import { azureEndpoint, buildSsml, createAzureTtsService, escapeXml } from "./remote-tts";

const REMOTE = DEFAULT_REMOTE_SERVICES_SETTINGS.tts;

function fakePlayer(overrides: Partial<WavPlayer> = {}) {
  const played: Uint8Array[] = [];
  let stopped = 0;
  const player: WavPlayer = {
    available: () => true,
    reason: () => null,
    async play(wav) {
      played.push(wav);
      return { ok: true } as PlayResult;
    },
    stop() { stopped += 1; },
    isPlaying: () => false,
    ...overrides,
  };

  return { player, played, stops: () => stopped };
}

function serviceWith(fetchFn: typeof fetch, apiKey: string | null = "clave", player = fakePlayer()) {
  return {
    player,
    service: createAzureTtsService({ remote: REMOTE, apiKey, player: player.player, maxChars: 4000, fetchFn }),
  };
}

describe("SSML", () => {
  test("escapa lo que romperia el XML", () => {
    expect(escapeXml(`Tuercas & tornillos <b> "ya" 'no'`))
      .toBe("Tuercas &amp; tornillos &lt;b&gt; &quot;ya&quot; &apos;no&apos;");
  });

  test("el cuerpo lleva la voz y el idioma castellano", () => {
    const ssml = buildSsml("hola & adios", "es-ES-ElviraNeural");
    expect(ssml).toContain("xml:lang='es-ES'");
    expect(ssml).toContain("name='es-ES-ElviraNeural'");
    expect(ssml).toContain("hola &amp; adios");
    expect(ssml).not.toContain("hola & adios");
  });

  test("la url usa la region configurada", () => {
    expect(azureEndpoint("westeurope")).toBe("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
  });
});

describe("createAzureTtsService", () => {
  test("manda las tres cabeceras que Azure exige", async () => {
    let init: RequestInit | undefined;
    const { service } = serviceWith((async (_url: string, options: RequestInit) => {
      init = options;
      return new Response(new Uint8Array([82, 73, 70, 70]));
    }) as unknown as typeof fetch);

    await service.speak("hola");

    const headers = init?.headers as Record<string, string>;
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe("clave");
    expect(headers["Content-Type"]).toBe("application/ssml+xml");
    expect(headers["X-Microsoft-OutputFormat"]).toBe("riff-24khz-16bit-mono-pcm");
    expect(headers["User-Agent"]).toBeTruthy();
  });

  test("sin clave no esta disponible y no llama a Azure", async () => {
    let called = false;
    const { service } = serviceWith((async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch, null);

    expect(service.status().available).toBe(false);
    expect(await service.speak("hola")).toMatchObject({ ok: false, code: "unavailable" });
    expect(called).toBe(false);
  });

  test("el audio que devuelve Azure es el que llega al reproductor", async () => {
    const player = fakePlayer();
    const { service } = serviceWith((async () => (
      new Response(new Uint8Array([1, 2, 3, 4]))
    )) as unknown as typeof fetch, "clave", player);

    expect(await service.speak("hola")).toMatchObject({ ok: true, engine: "azure" });
    expect(Array.from(player.played[0])).toEqual([1, 2, 3, 4]);
  });

  test("una clave rechazada manda a revisar los ajustes", async () => {
    const { service } = serviceWith((async () => new Response("nope", { status: 401 })) as unknown as typeof fetch);
    expect(await service.speak("hola")).toMatchObject({ ok: false, code: "unavailable" });
  });

  test("el limite de peticiones es un fallo de sintesis, no de configuracion", async () => {
    const { service } = serviceWith((async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch);
    expect(await service.speak("hola")).toMatchObject({ ok: false, code: "synthesis-failed" });
  });

  test("no hace ninguna peticion si el texto se queda vacio al limpiarlo", async () => {
    let called = false;
    const { service } = serviceWith((async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch);

    expect(await service.speak("   ")).toMatchObject({ ok: true });
    expect(called).toBe(false);
  });

  test("parar aborta la peticion viva y corta la reproduccion", async () => {
    const player = fakePlayer();
    let aborted = false;
    // El fetch real rechaza cuando se aborta la senal; el falso tiene que
    // hacer lo mismo o el test no prueba nada.
    const { service } = serviceWith((async (_url: string, options: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      })
    )) as unknown as typeof fetch, "clave", player);

    const speaking = service.speak("una respuesta larga");
    service.stop();

    expect(await speaking).toMatchObject({ ok: false, code: "cancelled" });
    expect(aborted).toBe(true);
    expect(player.stops()).toBeGreaterThan(0);
  });

  test("si no hay reproductor lo dice en vez de fallar en silencio", async () => {
    const player = fakePlayer({ available: () => false, reason: () => "falta aplay" });
    const { service } = serviceWith((async () => new Response()) as unknown as typeof fetch, "clave", player);
    expect(service.status().available).toBe(false);
    expect(await service.speak("hola")).toMatchObject({ ok: false, code: "unavailable" });
  });
});
