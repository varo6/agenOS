import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalWorkerAuth } from "./local-auth";

describe("local worker auth", () => {
  test("creates a 0600 worker token and validates bearer requests", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-worker-auth-"));
    const auth = createLocalWorkerAuth({
      tokenPath: join(rootDir, "worker-token"),
      tokenFactory: () => "token_test",
    });

    expect(auth.ensureToken()).toBe("token_test");
    expect((statSync(join(rootDir, "worker-token")).mode & 0o777).toString(8)).toBe("600");
    expect(auth.authorizeWorkerRequest(new Request("http://127.0.0.1/api/agent/worker/tool-call", {
      headers: { Authorization: "Bearer token_test" },
    }))).toEqual({ ok: true });
    expect(auth.authorizeWorkerRequest(new Request("http://127.0.0.1/api/agent/worker/tool-call"))).toEqual({
      ok: false,
      status: 401,
      message: "Worker token missing or invalid.",
    });
  });
});
