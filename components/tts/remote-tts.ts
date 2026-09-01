import type { RemoteTtsSettings } from "../remote";
import { normalizeText } from "./local-tts";
import type { LocalTtsResult, LocalTtsService } from "./local-tts";
import type { WavPlayer } from "./player";

/**
 * TTS remoto contra Azure AI Speech.
 *
 * Es el unico proveedor grande con voces castellanas nativas, medio millon de
 * caracteres gratis al mes de forma recurrente y salida WAV directa. Groq, que
 * es quien pone el dictado, no sirve para hablar: sus voces solo hacen ingles y
 * arabe.
 *
 * Se pide WAV y no mp3 a proposito: asi el audio se reproduce con `aplay`, que
 * ya esta en la imagen, y no hace falta arrastrar ningun descodificador.
 */

const MISSING_KEY_REASON =
  "Voz en la nube no disponible: falta la clave de Azure Speech. Anadela en el panel de servicios remotos.";

export type AzureTtsOptions = {
  remote: RemoteTtsSettings;
  apiKey: string | null;
  player: WavPlayer;
  /** Mismo tope de caracteres que el TTS local. */
  maxChars: number;
  fetchFn?: typeof fetch;
  logger?: (message: string) => void;
};

/**
 * El cuerpo de la peticion es SSML, o sea XML. Una respuesta con un `&` o un
 * `<` sin escapar produciria un 400 y dejaria a la persona sin voz.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSsml(text: string, voice: string): string {
  return `<speak version='1.0' xml:lang='es-ES'><voice xml:lang='es-ES' name='${voice}'>${escapeXml(text)}</voice></speak>`;
}

export function azureEndpoint(region: string): string {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export function createAzureTtsService(options: AzureTtsOptions): LocalTtsService {
  const { remote, player } = options;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const log = options.logger ?? (() => {});
  const apiKey = options.apiKey?.trim() || null;

  /** Permite abortar la sintesis mientras aun esta en la red. */
  let pending: AbortController | null = null;

  function status() {
    if (!apiKey) {
      return { available: false, reason: MISSING_KEY_REASON, engine: "azure" as const, voice: remote.voice };
    }
    if (!player.available()) {
      return { available: false, reason: player.reason(), engine: "azure" as const, voice: remote.voice };
    }

    return { available: true, reason: null, engine: "azure" as const, voice: remote.voice };
  }

  function stop(): void {
    pending?.abort();
    pending = null;
    player.stop();
  }

  function describeFailure(status: number, detail: string): LocalTtsResult {
    const suffix = detail ? ` ${detail}` : "";

    // Una clave mala es un problema de configuracion, no de sintesis: se marca
    // como `unavailable` para que la interfaz mande a arreglarla.
    if (status === 401 || status === 403) {
      return {
        ok: false,
        code: "unavailable",
        message: `Azure rechaza la clave (${status}). Revisala en el panel de servicios remotos.${suffix}`,
      };
    }
    if (status === 429) {
      return {
        ok: false,
        code: "synthesis-failed",
        message: `Azure ha limitado las peticiones de voz.${suffix}`,
      };
    }

    return { ok: false, code: "synthesis-failed", message: `Azure devolvio ${status}.${suffix}` };
  }

  async function speak(text: string): Promise<LocalTtsResult> {
    const current = status();
    if (current.available === false) {
      return { ok: false, code: "unavailable", message: current.reason ?? MISSING_KEY_REASON };
    }

    const normalized = normalizeText(text, options.maxChars);
    if (!normalized) {
      return { ok: true, engine: "azure", voice: remote.voice };
    }

    // Una lectura nueva cancela la anterior, igual que en el TTS local.
    stop();

    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), remote.timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(azureEndpoint(remote.region), {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey ?? "",
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": remote.outputFormat,
          // Azure rechaza las peticiones sin User-Agent.
          "User-Agent": "agenos-tts",
        },
        body: buildSsml(normalized, remote.voice),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return { ok: false, code: "cancelled", message: "Lectura cancelada." };
      }

      return {
        ok: false,
        code: "synthesis-failed",
        message: `No se pudo hablar con Azure: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      clearTimeout(timeout);
      if (pending === controller) {
        pending = null;
      }
    }

    if (response.ok === false) {
      const detail = await response.text().catch(() => "");
      const failure = describeFailure(response.status, detail.trim().slice(0, 200));
      if (failure.ok === false) {
        log(failure.message);
      }
      return failure;
    }

    const audio = new Uint8Array(await response.arrayBuffer());
    const played = await player.play(audio);
    if (played.ok === false) {
      return { ok: false, code: played.code, message: played.message };
    }

    return { ok: true, engine: "azure", voice: remote.voice };
  }

  return {
    status,
    speak,
    stop,
    isSpeaking: () => pending !== null || player.isPlaying(),
  };
}
