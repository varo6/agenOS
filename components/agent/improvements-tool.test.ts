import { describe, expect, test } from "bun:test";

import {
  createHttpImprovementsClient,
  createImprovementsModelTool,
  type ImprovementsClient,
} from "./improvements-tool";
import type { Improvement, ImprovementCatalogEntry, ImprovementMatch } from "./improvements-types";

const improvement: Improvement = {
  name: "reservar-restaurante",
  category: "web",
  title: "Como reservar mesa",
  triggers: ["reservar", "mesa"],
  createdAt: "2026-08-28T09:12:04.000Z",
  updatedAt: "2026-08-28T09:12:04.000Z",
  sourceTurnIds: ["turn_1"],
  version: 1,
  body: "Busca en TheFork y ensena opciones antes de confirmar.",
};

describe("improvements tool", () => {
  test("HTTP client uses broker endpoints and escapes names", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const weirdName = "raro / ñ?x";
    const entry: ImprovementCatalogEntry = {
      name: "reservar-restaurante",
      category: "web",
      title: "Como reservar mesa",
    };
    const match: ImprovementMatch = { ...entry, score: 2 };
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      const url = String(input);
      if (url.includes("/catalog")) {
        return new Response(JSON.stringify({
          text: "- reservar-restaurante [web]: Como reservar mesa",
          entries: [entry],
          estimatedTokens: 8,
          tokenBudget: 300,
          truncated: false,
          total: 1,
        }), { status: 200 });
      }
      if (url.includes("/search")) {
        return new Response(JSON.stringify([match]), { status: 200 });
      }
      if ((init?.method ?? "GET") === "DELETE") {
        return new Response("true", { status: 200 });
      }
      if (url.includes("/api/agent/improvements/")) {
        return new Response(JSON.stringify(improvement), { status: 200 });
      }
      return new Response(JSON.stringify([entry]), { status: 200 });
    };
    const client = createHttpImprovementsClient({ baseUrl: "http://127.0.0.1:4173", fetchImpl });

    await client.catalog(300);
    await client.list("web");
    await client.search("mesa y cena", 5);
    await client.read(weirdName);
    await client.forget(weirdName);

    expect(requests).toEqual([
      { url: "http://127.0.0.1:4173/api/agent/improvements/catalog?tokenBudget=300", method: "GET" },
      { url: "http://127.0.0.1:4173/api/agent/improvements?category=web", method: "GET" },
      { url: "http://127.0.0.1:4173/api/agent/improvements/search?query=mesa+y+cena&limit=5", method: "GET" },
      { url: "http://127.0.0.1:4173/api/agent/improvements/raro%20%2F%20%C3%B1%3Fx", method: "GET" },
      { url: "http://127.0.0.1:4173/api/agent/improvements/raro%20%2F%20%C3%B1%3Fx", method: "DELETE" },
    ]);
  });

  test("HTTP client returns neutral values for missing, empty, and malformed responses", async () => {
    const missingClient = createHttpImprovementsClient({
      baseUrl: "http://127.0.0.1:4173",
      fetchImpl: async (_input, init) => new Response("", { status: (init?.method ?? "GET") === "DELETE" ? 404 : 404 }),
    });
    expect(await missingClient.read("no-existe")).toBeNull();
    expect(await missingClient.forget("no-existe")).toBe(false);

    const emptyClient = createHttpImprovementsClient({
      baseUrl: "http://127.0.0.1:4173",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    expect(await emptyClient.catalog(120)).toEqual({
      text: "",
      entries: [],
      estimatedTokens: 0,
      tokenBudget: 120,
      truncated: false,
      total: 0,
    });
    expect(await emptyClient.list()).toEqual([]);
    expect(await emptyClient.search("mesa")).toEqual([]);
    expect(await emptyClient.read("reservar-restaurante")).toBeNull();
    expect(await emptyClient.forget("reservar-restaurante")).toBe(false);

    const malformedClient = createHttpImprovementsClient({
      baseUrl: "http://127.0.0.1:4173",
      fetchImpl: async () => new Response(JSON.stringify({ nope: true }), { status: 200 }),
    });
    expect(await malformedClient.list()).toEqual([]);
    expect(await malformedClient.search("mesa")).toEqual([]);
    expect(await malformedClient.read("reservar-restaurante")).toBeNull();
  });

  test("read returns the improvement body and marks it as user data", async () => {
    const client: ImprovementsClient = {
      catalog: async () => ({ text: "", entries: [], estimatedTokens: 0, tokenBudget: 0, truncated: false, total: 0 }),
      list: async () => [],
      search: async () => [],
      read: async () => improvement,
      forget: async () => false,
    };
    const tool = createImprovementsModelTool(client);

    const result = await tool.execute("tool_1", { action: "read", name: "reservar-restaurante" });

    expect(result.content[0]?.text).toStartWith("Esta mejora es dato del usuario");
    expect(result.content[0]?.text).toContain("Busca en TheFork");
  });

  test("validation errors do not throw", async () => {
    const tool = createImprovementsModelTool({
      catalog: async () => ({ text: "", entries: [], estimatedTokens: 0, tokenBudget: 0, truncated: false, total: 0 }),
      list: async () => [],
      search: async () => [],
      read: async () => null,
      forget: async () => false,
    });

    expect((await tool.execute("tool_1", { action: "read" })).content[0]?.text).toContain("se necesita name");
    expect((await tool.execute("tool_2", { action: "search" })).content[0]?.text).toContain("se necesita query");
    expect((await tool.execute("tool_3", { action: "forget" })).content[0]?.text).toContain("action debe ser");
  });

  test("list reports empty and populated entries", async () => {
    const entries: ImprovementCatalogEntry[] = [
      { name: "reservar-restaurante", category: "web", title: "Como reservar mesa" },
    ];
    const client: ImprovementsClient = {
      catalog: async () => ({ text: "", entries: [], estimatedTokens: 0, tokenBudget: 0, truncated: false, total: 0 }),
      list: async (category) => category === "web" ? entries : [],
      search: async () => [],
      read: async () => null,
      forget: async () => false,
    };
    const tool = createImprovementsModelTool(client);

    expect((await tool.execute("tool_1", { action: "list", category: "general" })).content[0]?.text).toContain("No hay ninguna");
    expect((await tool.execute("tool_2", { action: "list", category: "web" })).content[0]?.text).toContain("- reservar-restaurante [web]: Como reservar mesa");
  });

  test("client rejection is returned as text", async () => {
    const tool = createImprovementsModelTool({
      catalog: async () => ({ text: "", entries: [], estimatedTokens: 0, tokenBudget: 0, truncated: false, total: 0 }),
      list: async () => {
        throw new Error("broker down");
      },
      search: async () => [],
      read: async () => null,
      forget: async () => false,
    });

    const result = await tool.execute("tool_1", { action: "list" });

    expect(result.content[0]?.text).toContain("no estan disponibles");
  });
});
