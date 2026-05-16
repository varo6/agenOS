import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type LocalAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

export type LocalWorkerAuthOptions = {
  tokenPath: string;
  tokenFactory?: () => string;
};

export function createLocalWorkerAuth(options: LocalWorkerAuthOptions) {
  const tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("hex"));

  function ensureToken(): string {
    try {
      const existing = readFileSync(options.tokenPath, "utf8").trim();
      if (existing) {
        chmodSync(options.tokenPath, 0o600);
        return existing;
      }
    } catch {
      // Missing token is created below.
    }

    const token = tokenFactory();
    mkdirSync(dirname(options.tokenPath), { recursive: true });
    writeFileSync(options.tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(options.tokenPath, 0o600);
    return token;
  }

  function authorizeWorkerRequest(request: Request): LocalAuthResult {
    const url = new URL(request.url);
    if (!isLocalWorkerHost(url.hostname)) {
      return { ok: false, status: 403, message: "Worker requests must be local." };
    }

    const expected = ensureToken();
    const authorization = request.headers.get("authorization");
    if (authorization !== `Bearer ${expected}`) {
      return { ok: false, status: 401, message: "Worker token missing or invalid." };
    }

    return { ok: true };
  }

  return { ensureToken, authorizeWorkerRequest };
}

function isLocalWorkerHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}
