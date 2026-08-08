import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { createLocalUiAuth, UI_SESSION_COOKIE } from "./ui-auth";

describe("local UI authentication", () => {
  test("creates a mode-0600 token and accepts only bearer or session-cookie credentials", () => {
    const tokenPath = join(mkdtempSync(join(tmpdir(), "agenos-ui-auth-")), "ui-token");
    const auth = createLocalUiAuth({ tokenPath, tokenFactory: () => "ui_secret" });

    expect(auth.authorizeUiRequest(new Request("http://127.0.0.1/api/agent/shell/exec"))).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(auth.authorizeUiRequest(new Request("http://127.0.0.1/api/agent/shell/exec", {
      headers: { Authorization: "Bearer ui_secret" },
    }))).toEqual({ ok: true });
    expect(auth.authorizeUiRequest(new Request("http://127.0.0.1/api/agent/shell/exec", {
      headers: { Cookie: `${UI_SESSION_COOKIE}=ui_secret` },
    }))).toEqual({ ok: true });
    expect((statSync(tokenPath).mode & 0o777).toString(8)).toBe("600");
  });

  test("issues an HttpOnly strict same-site session cookie", () => {
    const tokenPath = join(mkdtempSync(join(tmpdir(), "agenos-ui-cookie-")), "ui-token");
    const auth = createLocalUiAuth({ tokenPath, tokenFactory: () => "ui_cookie_secret" });
    const response = auth.attachSession(new Response("shell"));

    expect(response.headers.get("set-cookie")).toBe(
      `${UI_SESSION_COOKIE}=ui_cookie_secret; HttpOnly; SameSite=Strict; Path=/`,
    );
  });
});
