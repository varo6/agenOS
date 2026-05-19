import { afterEach, describe, expect, test } from "bun:test";
import { createAgentClient } from "./agent-client";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function setWindowLocation(url) {
  globalThis.window = {
    location: new URL(url),
  };
}

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }

  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    delete globalThis.window;
  }
});

describe("agent client", () => {
  test("reads contacts memory from an explicit broker base", async () => {
    const requests = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({
        namespace: "contacts",
        content: "Pablo Lopez: pablo@example.com\n",
      }), { status: 200 });
    };

    const client = createAgentClient({ baseUrl: "http://agent.test" });
    expect(await client.readMemory("contacts")).toEqual({
      namespace: "contacts",
      content: "Pablo Lopez: pablo@example.com\n",
    });
    expect(requests[0].url).toBe("http://agent.test/api/agent/memory/contacts");
  });

  test("writes memory with explicit UI intent", async () => {
    let payload = "";
    globalThis.fetch = async (_input, init) => {
      payload = String(init?.body ?? "");
      return new Response(JSON.stringify({
        ok: true,
        message: "Memoria guardada.",
      }), { status: 202 });
    };

    const client = createAgentClient({ baseUrl: "http://agent.test" });
    expect(await client.appendMemory("facts", "Pablo Lopez es mi profesor")).toEqual({
      ok: true,
      message: "Memoria guardada.",
    });
    expect(JSON.parse(payload)).toEqual({
      content: "Pablo Lopez es mi profesor",
      source: "ui",
      explicitUserIntent: true,
    });
  });

  test("delegates background tasks to the broker", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        ok: true,
        taskId: "task_test",
        message: "Tarea enviada al worker de fondo.",
      }), { status: 202 });
    };

    const client = createAgentClient({ baseUrl: "http://agent.test" });
    expect(await client.delegateBackgroundTask("prepara un email a Pablo")).toEqual({
      ok: true,
      taskId: "task_test",
      message: "Tarea enviada al worker de fondo.",
    });
    expect(requestedUrl).toBe("http://agent.test/api/agent/tasks");
  });

  test("opens apps through the broker", async () => {
    let requestedUrl = "";
    let payload = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      payload = String(init?.body ?? "");
      return new Response(JSON.stringify({
        ok: true,
        message: "Abriendo Chrome.",
      }), { status: 202 });
    };

    const client = createAgentClient({ baseUrl: "http://agent.test" });
    expect(await client.openApp("Chrome")).toEqual({
      ok: true,
      message: "Abriendo Chrome.",
    });
    expect(requestedUrl).toBe("http://agent.test/api/agent/apps/open");
    expect(JSON.parse(payload)).toEqual({ app: "Chrome" });
  });

  test("uses the real packaged broker from file and Vite dev origins", async () => {
    const requests = [];
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        namespace: "facts",
        content: "",
      }), { status: 200 });
    };

    setWindowLocation("file:///opt/agenos/system/dist/index.html");
    await createAgentClient().readMemory("facts");

    setWindowLocation("http://127.0.0.1:4174/");
    await createAgentClient().readMemory("facts");

    expect(requests).toEqual([
      "http://127.0.0.1:4173/api/agent/memory/facts",
      "http://127.0.0.1:4173/api/agent/memory/facts",
    ]);
  });
});
