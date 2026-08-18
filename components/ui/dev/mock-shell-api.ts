import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { createPiHarness, PiHarnessError } from "./pi-harness";

const piHarness = createPiHarness();

function createDevPreflight() {
  const isLiveSession = process.env.AGENOS_UI_DEV_LIVE_SESSION === "1";

  return {
    firmware: "UEFI" as const,
    isLiveSession,
    totalRamBytes: 17_179_869_184,
    installableDiskBytes: 1_500_312_748_032,
    checks: [
      {
        id: "memory",
        label: "Memoria disponible",
        status: "ok" as const,
        detail: "Hay RAM suficiente para el slice vertical y para lanzar el instalador si hace falta.",
      },
      {
        id: "firmware",
        label: "Modo de firmware",
        status: "ok" as const,
        detail: "La sesión de desarrollo simula un arranque en UEFI.",
      },
      {
        id: "live",
        label: "Sesión live",
        status: isLiveSession ? "ok" as const : "error" as const,
        detail: isLiveSession
          ? "El entorno local expone también el acceso discreto al instalador."
          : "El entorno local mantiene la shell del sistema aislada del instalador.",
      },
    ],
  };
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function sendPiError(response: ServerResponse, error: unknown): void {
  const status = error instanceof PiHarnessError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Error del harness de desarrollo.";

  sendJson(response, status, {
    ok: false,
    message,
  });
}

async function handleDevApi(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";

  if (url.pathname !== "/health" && !url.pathname.startsWith("/api/")) {
    return false;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/installer/preflight") {
    sendJson(response, 200, createDevPreflight());
    return true;
  }

  if (method === "POST" && url.pathname === "/api/system/maintenance") {
    const payload = await readJsonBody(request);
    const action =
      payload && typeof payload === "object" && "action" in payload ? String(payload.action ?? "") : "";

    sendJson(response, 202, {
      ok: true,
      message: `Modo local: acción '${action || "desconocida"}' simulada.`,
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/installer/switch-mode") {
    const payload = await readJsonBody(request);
    const mode = payload && typeof payload === "object" && "mode" in payload ? String(payload.mode ?? "") : "";

    if (mode !== "installer" && mode !== "system") {
      sendJson(response, 400, {
        ok: false,
        message: "El modo debe ser installer o system.",
      });
      return true;
    }

    sendJson(response, 202, {
      ok: true,
      message: `Modo local: cambio a '${mode}' simulado.`,
    });
    return true;
  }

  if (url.pathname === "/api/pi/status" && method === "GET") {
    try {
      sendJson(response, 200, piHarness.getStatus());
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/auth/start" && method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const method =
        payload && typeof payload === "object" && "method" in payload ? String(payload.method ?? "device") : "device";
      if (method !== "device" && method !== "browser") {
        sendJson(response, 400, {
          ok: false,
          message: "El metodo de login debe ser device o browser.",
        });
        return true;
      }

      sendJson(response, 200, await piHarness.startAuth(method));
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/auth/cancel" && method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const attemptId =
        payload && typeof payload === "object" && "attemptId" in payload && typeof payload.attemptId === "string"
          ? payload.attemptId
          : undefined;
      piHarness.cancelAuth(attemptId);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  const attemptMatch = url.pathname.match(/^\/api\/pi\/auth\/attempt\/([^/]+)$/);
  if (attemptMatch && method === "GET") {
    try {
      sendJson(response, 200, piHarness.getAuthAttempt(decodeURIComponent(attemptMatch[1] ?? "")));
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  const manualAttemptMatch = url.pathname.match(/^\/api\/pi\/auth\/attempt\/([^/]+)\/manual-code$/);
  if (manualAttemptMatch && method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const input =
        payload && typeof payload === "object" && "input" in payload ? String(payload.input ?? "") : "";

      sendJson(response, 202, piHarness.submitManualCode(decodeURIComponent(manualAttemptMatch[1] ?? ""), input));
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/auth/logout" && method === "POST") {
    try {
      piHarness.logout();
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/chat" && method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const message =
        payload && typeof payload === "object" && "message" in payload ? String(payload.message ?? "") : "";
      const source =
        payload && typeof payload === "object" && "source" in payload ? String(payload.source ?? "") : "";

      if (source !== "text" && source !== "voice") {
        sendJson(response, 400, {
          ok: false,
          message: "El origen debe ser text o voice.",
        });
        return true;
      }

      sendJson(response, 200, await piHarness.chat({ message, source }));
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/conversation/new" && method === "POST") {
    try {
      piHarness.startNewConversation();
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/turns" && method === "GET") {
    try {
      const limit = Number(url.searchParams.get("limit") ?? "20");
      sendJson(response, 200, piHarness.listTurns(Number.isFinite(limit) ? limit : undefined));
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/turns" && method === "POST") {
    try {
      const payload = await readJsonBody(request);
      const message =
        payload && typeof payload === "object" && "message" in payload ? String(payload.message ?? "") : "";
      const source =
        payload && typeof payload === "object" && "source" in payload ? String(payload.source ?? "") : "";

      if (source !== "text" && source !== "voice") {
        sendJson(response, 400, {
          ok: false,
          message: "El origen debe ser text o voice.",
        });
        return true;
      }

      sendJson(response, 202, piHarness.startChat({ message, source }));
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  if (url.pathname === "/api/pi/turns/latest" && method === "GET") {
    try {
      sendJson(response, 200, piHarness.getLatestTurn());
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  const turnMatch = url.pathname.match(/^\/api\/pi\/turns\/([^/]+)$/);
  if (turnMatch && method === "GET") {
    try {
      sendJson(response, 200, piHarness.getTurn(decodeURIComponent(turnMatch[1] ?? "")));
    } catch (error) {
      sendPiError(response, error);
    }
    return true;
  }

  sendJson(response, 404, {
    ok: false,
    message: `Ruta mock no implementada: ${method} ${url.pathname}`,
  });
  return true;
}

export function createMockShellApiPlugin(): Plugin {
  return {
    name: "agenos-ui-mock-shell-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handleDevApi(request, response)
          .then((handled) => {
            if (!handled) {
              next();
            }
          })
          .catch(next);
      });
    },
  };
}
