import { describe, expect, test } from "bun:test";

import { loadPreferredFrontend } from "./frontend-loader";

describe("loadPreferredFrontend", () => {
  test("waits for the broker before loading its authenticated frontend", async () => {
    const loaded: string[] = [];
    let healthChecks = 0;

    const result = await loadPreferredFrontend({
      brokerBaseUrl: "http://127.0.0.1:4173",
      localIndexPath: "/opt/agenos/system/dist/index.html",
      fetchImpl: (async () => new Response(null, { status: ++healthChecks === 3 ? 200 : 503 })) as typeof fetch,
      loadUrl: async (url) => { loaded.push(url); },
      loadFile: async (path) => { loaded.push(path); },
      sleep: async () => {},
    });

    expect(result).toBe("broker");
    expect(healthChecks).toBe(3);
    expect(loaded).toEqual(["http://127.0.0.1:4173/"]);
  });

  test("loads the packaged frontend when the broker stays unavailable", async () => {
    const loaded: string[] = [];

    const result = await loadPreferredFrontend({
      brokerBaseUrl: "http://127.0.0.1:4173",
      localIndexPath: "/opt/agenos/system/dist/index.html",
      fetchImpl: (async () => { throw new Error("connection refused"); }) as typeof fetch,
      loadUrl: async (url) => { loaded.push(url); },
      loadFile: async (path) => { loaded.push(path); },
      attempts: 2,
      sleep: async () => {},
    });

    expect(result).toBe("local");
    expect(loaded).toEqual(["/opt/agenos/system/dist/index.html"]);
  });

  test("falls back locally when the broker root cannot be loaded", async () => {
    const loaded: string[] = [];

    const result = await loadPreferredFrontend({
      brokerBaseUrl: "http://127.0.0.1:4173",
      localIndexPath: "/opt/agenos/system/dist/index.html",
      fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch,
      loadUrl: async (url) => {
        loaded.push(url);
        throw new Error("frontend route failed");
      },
      loadFile: async (path) => { loaded.push(path); },
      sleep: async () => {},
    });

    expect(result).toBe("local");
    expect(loaded).toEqual([
      "http://127.0.0.1:4173/",
      "/opt/agenos/system/dist/index.html",
    ]);
  });
});
