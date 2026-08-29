import { afterEach, describe, expect, test } from "bun:test";

import { createImprovementsClient } from "./improvements-client";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
});

type CapturedRequest = {
  url: string;
  init: RequestInit | undefined;
};

function createFetch(response: () => Response) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return response();
  };

  return { fetchImpl, requests };
}

describe("createImprovementsClient", () => {
  test("encola la captura de un turno en el broker", async () => {
    const { fetchImpl, requests } = createFetch(() =>
      new Response(JSON.stringify({
        ok: true,
        jobId: "job_k3m1",
        status: "queued",
        message: "Lo tendre en cuenta.",
      }), { status: 202 }),
    );

    const client = createImprovementsClient({ baseUrl: "http://agent.test", fetchImpl });

    expect(await client.captureTurn("turn_k3m1")).toEqual({
      ok: true,
      jobId: "job_k3m1",
      status: "queued",
      message: "Lo tendre en cuenta.",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://agent.test/api/agent/improvements/capture");
    expect(requests[0].init?.method).toBe("POST");
    // Solo el identificador: el contenido de la mejora lo saca el broker del
    // historial, no la pantalla.
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ turnId: "turn_k3m1" });
  });

  test("usa el origen de la pagina cuando no se le da base", async () => {
    globalThis.window = { location: new URL("http://192.168.1.40:4173") } as Window & typeof globalThis;

    const { fetchImpl, requests } = createFetch(() =>
      new Response(JSON.stringify({ ok: true, jobId: "job_1", status: "queued", message: "" }), { status: 202 }),
    );

    const client = createImprovementsClient({ fetchImpl });
    await client.captureTurn("turn_1");

    expect(requests[0].url).toBe("http://192.168.1.40:4173/api/agent/improvements/capture");
  });

  test("propaga el mensaje del broker cuando la captura falla", async () => {
    const { fetchImpl } = createFetch(() =>
      new Response(JSON.stringify({ message: "No encuentro ese turno." }), { status: 404 }),
    );

    const client = createImprovementsClient({ baseUrl: "http://agent.test", fetchImpl });

    await expect(client.captureTurn("turn_perdido")).rejects.toThrow("No encuentro ese turno.");
  });

  test("sin mensaje en el cuerpo, el error dice al menos el estado HTTP", async () => {
    const { fetchImpl } = createFetch(() => new Response("", { status: 503 }));

    const client = createImprovementsClient({ baseUrl: "http://agent.test", fetchImpl });

    await expect(client.captureTurn("turn_1")).rejects.toThrow("503");
  });
});
