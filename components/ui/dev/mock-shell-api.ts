import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

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
