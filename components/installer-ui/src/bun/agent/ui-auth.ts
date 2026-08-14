import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const UI_SESSION_COOKIE = "agenos_ui_session";

export type UiAuthorizationResult =
  | { ok: true }
  | { ok: false; status: 401; message: string };

export type LocalUiAuthOptions = {
  tokenPath: string;
  tokenFactory?: () => string;
};

function secureEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) {
      continue;
    }
    return entry.slice(separator + 1).trim();
  }
  return undefined;
}

export function createLocalUiAuth(options: LocalUiAuthOptions) {
  const tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
  let cachedToken: string | undefined;

  function token(): string {
    if (cachedToken) {
      return cachedToken;
    }

    mkdirSync(dirname(options.tokenPath), { recursive: true, mode: 0o700 });
    if (existsSync(options.tokenPath)) {
      const stored = readFileSync(options.tokenPath, "utf8").trim();
      if (stored) {
        chmodSync(options.tokenPath, 0o600);
        cachedToken = stored;
        return cachedToken;
      }
    }

    cachedToken = tokenFactory();
    writeFileSync(options.tokenPath, `${cachedToken}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(options.tokenPath, 0o600);
    return cachedToken;
  }

  function presentedToken(request: Request): string | undefined {
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer ")) {
      return authorization.slice("Bearer ".length).trim();
    }
    return cookieValue(request, UI_SESSION_COOKIE);
  }

  return {
    authorizeUiRequest(request: Request): UiAuthorizationResult {
      const presented = presentedToken(request);
      if (!presented || !secureEquals(presented, token())) {
        return {
          ok: false,
          status: 401,
          message: "La API local requiere una sesion autenticada de AgenOS.",
        };
      }
      return { ok: true };
    },
    attachSession(response: Response): Response {
      const headers = new Headers(response.headers);
      headers.append(
        "Set-Cookie",
        `${UI_SESSION_COOKIE}=${token()}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    authorizationHeader(): string {
      return `Bearer ${token()}`;
    },
  };
}
