import type { ImprovementsBridge } from "./improvements-bridge";
import type {
  ImprovementCaptureJobResponse,
  ImprovementCaptureResponse,
  SavedReply,
} from "../../../agent/improvements-types";

const AGENT_API_BASE_DEFAULT = "http://127.0.0.1:4173";
const REQUEST_TIMEOUT_MS = 8_000;

type ErrorPayload = {
  message?: unknown;
};

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ImprovementsClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
};

function isViteDevOrigin(location: Location): boolean {
  return (
    (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    && location.port === "4174"
  );
}

function resolveHttpBase(options: ImprovementsClientOptions = {}): string {
  if (options.baseUrl) {
    return options.baseUrl;
  }

  const location = globalThis.window?.location;
  if (location && (location.protocol === "http:" || location.protocol === "https:") && !isViteDevOrigin(location)) {
    return location.origin;
  }

  return AGENT_API_BASE_DEFAULT;
}

async function requestJson<T>(
  doFetch: FetchImpl,
  baseUrl: string,
  path: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(new URL(path, `${baseUrl}/`).toString(), {
      ...init,
      signal: init?.signal ?? controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as T | ErrorPayload : undefined;

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("La solicitud al broker excedio el tiempo limite.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/**
 * Cliente de las mejoras del usuario.
 *
 * Solo manda el identificador del turno: el contenido de la mejora lo saca el
 * broker del historial del harness, para que no dependa de lo que diga esta
 * pantalla. El POST es un acuse inmediato y el GET permite seguir el trabajo.
 */
export function createImprovementsClient(options: ImprovementsClientOptions = {}) {
  const baseUrl = resolveHttpBase(options);
  const bridge: ImprovementsBridge | undefined = !options.baseUrl && !options.fetchImpl ? globalThis.window?.agenosImprovements : undefined;
  // Se resuelve en cada llamada y no al crear el cliente para no congelar el
  // `fetch` global del entorno.
  const doFetch: FetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  return {
    listSavedReplies(query = "", offset = 0): Promise<SavedReply[]> {
      if (bridge?.isAvailable()) return bridge.listSavedReplies(query, offset);
      return requestJson(doFetch, baseUrl, `/api/agent/saved-replies?${new URLSearchParams({ query, offset: String(offset) })}`);
    },
    forgetSavedReply(turnId: string): Promise<{ ok: boolean }> {
      if (bridge?.isAvailable()) return bridge.forgetSavedReply(turnId);
      return requestJson(doFetch, baseUrl, `/api/agent/saved-replies/${encodeURIComponent(turnId)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ explicitUserIntent: true }),
      });
    },
    captureTurn(turnId: string): Promise<ImprovementCaptureResponse> {
      if (bridge?.isAvailable()) return bridge.captureTurn(turnId);
      return requestJson<ImprovementCaptureResponse>(doFetch, baseUrl, "/api/agent/improvements/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId }),
      });
    },
    getCaptureJob(jobId: string): Promise<ImprovementCaptureJobResponse> {
      if (bridge?.isAvailable()) return bridge.getCaptureJob(jobId);
      return requestJson<ImprovementCaptureJobResponse>(
        doFetch,
        baseUrl,
        `/api/agent/improvements/capture/${encodeURIComponent(jobId)}`,
      );
    },
  };
}
