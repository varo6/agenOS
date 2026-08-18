import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Gmail (leer/enviar/etiquetar) + Calendar + identidad basica para saber de que cuenta hablamos. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
  "profile",
] as const;

const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;

export type LoopbackResult = { code?: string; error?: string; state?: string };

export type LoopbackPage = { status: number; html: string };

export type LoopbackServer = {
  port: number;
  close(): void;
  waitForCode(): Promise<LoopbackResult>;
};

export type StartLoopbackServer = (renderPage: (result: LoopbackResult) => LoopbackPage) => Promise<LoopbackServer>;

export type GoogleAuthDeps = {
  clientId?: string;
  clientSecret?: string;
  tokenPath?: string;
  configPath?: string;
  /** Credencial de aplicacion instalada con la imagen; ver GOOGLE_SYSTEM_CLIENT_PATH. */
  systemConfigPath?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  openUrl?: (url: string) => Promise<{ ok: boolean; message: string }>;
  startLoopbackServer?: StartLoopbackServer;
  now?: () => number;
  randomString?: (bytes: number) => string;
  readFile?: (path: string) => string | null;
  writeFile?: (path: string, contents: string) => void;
  removeFile?: (path: string) => void;
};

export type GoogleAuthStatus = {
  ok: boolean;
  configured: boolean;
  authenticated: boolean;
  account: string | null;
  expiresAt: string | null;
  message: string;
};

export type GoogleStartLoginResult = {
  ok: boolean;
  needsClientId?: boolean;
  authUrl?: string;
  port?: number;
  message: string;
};

export type GoogleCompleteLoginResult = {
  ok: boolean;
  account?: string | null;
  timedOut?: boolean;
  message: string;
};

export type GoogleAccessTokenResult = {
  ok: boolean;
  token?: string;
  needsLogin?: boolean;
  message: string;
};

export type GoogleAuth = ReturnType<typeof createGoogleAuth>;

type StoredCredentials = {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiry: number;
  account?: string;
  scope?: string;
  tokenType?: string;
};

type PendingLogin = {
  verifier: string;
  state: string;
  redirectUri: string;
  authUrl: string;
  server: LoopbackServer;
  code: Promise<LoopbackResult>;
};

/**
 * Ruta de la credencial de aplicacion que se instala con la imagen. Es la que
 * hace que el usuario final solo vea la pantalla de Google: la aplicacion ya
 * esta registrada, el no tiene que registrar nada.
 */
export const GOOGLE_SYSTEM_CLIENT_PATH = "/etc/agenos/google-client.json";

// Este mensaje lo lee una persona mayor delante de la pantalla, no quien monta
// la imagen: no puede ser un tutorial de Google Cloud. Los pasos del integrador
// viven en docs/integracion/google.md.
export const GOOGLE_CLIENT_SETUP_MESSAGE = [
  "Esta version de AgenOS no trae configurada la conexion con Google, asi que todavia no puedo entrar en tu correo ni en tu calendario.",
  "No es algo que puedas arreglar tu desde aqui: quien haya preparado este equipo tiene que activarla.",
  "Mientras tanto puedo abrirte el correo en el navegador para que lo mires tu mismo.",
].join("\n");

export function createGoogleAuth(deps: GoogleAuthDeps = {}) {
  const env = deps.env ?? process.env;
  const stateDir = expandHome(env.AGENOS_GOOGLE_STATE_DIR ?? join(homedir(), ".agenos", "google"));
  const tokenPath = expandHome(deps.tokenPath ?? join(stateDir, "credentials.json"));
  const configPath = expandHome(deps.configPath ?? join(stateDir, "client.json"));
  const systemConfigPath = expandHome(deps.systemConfigPath ?? env.AGENOS_GOOGLE_SYSTEM_CLIENT ?? GOOGLE_SYSTEM_CLIENT_PATH);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const randomString = deps.randomString ?? ((bytes: number) => randomBytes(bytes).toString("base64url"));
  const readFile = deps.readFile ?? defaultReadFile;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const removeFile = deps.removeFile ?? defaultRemoveFile;
  const openUrl = deps.openUrl ?? defaultOpenUrl;
  const startLoopbackServer = deps.startLoopbackServer ?? defaultStartLoopbackServer;

  let pending: PendingLogin | null = null;
  let cached: StoredCredentials | null | undefined;

  function readClientConfig(): { clientId: string | null; clientSecret: string | null } {
    // Se acepta tanto el formato propio {clientId, clientSecret} como el JSON
    // que descarga Google tal cual ({installed: {client_id, ...}}), para que
    // quien monte la imagen pueda copiar el fichero sin editarlo.
    type ClientFile = { clientId?: unknown; clientSecret?: unknown; installed?: { client_id?: unknown; client_secret?: unknown } };
    const fromUser = parseJson<ClientFile>(readFile(configPath));
    const fromSystem = parseJson<ClientFile>(readFile(systemConfigPath));
    const clientId = firstString(
      deps.clientId,
      env.AGENOS_GOOGLE_CLIENT_ID,
      fromUser?.clientId,
      fromUser?.installed?.client_id,
      fromSystem?.clientId,
      fromSystem?.installed?.client_id,
    ) ?? null;
    const clientSecret = firstString(
      deps.clientSecret,
      env.AGENOS_GOOGLE_CLIENT_SECRET,
      fromUser?.clientSecret,
      fromUser?.installed?.client_secret,
      fromSystem?.clientSecret,
      fromSystem?.installed?.client_secret,
    ) ?? null;
    return { clientId, clientSecret };
  }

  function loadCredentials(): StoredCredentials | null {
    if (cached !== undefined) {
      return cached;
    }
    const parsed = parseJson<Partial<StoredCredentials>>(readFile(tokenPath));
    if (!parsed || typeof parsed.accessToken !== "string" || !parsed.accessToken) {
      cached = null;
      return cached;
    }
    cached = {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      expiry: typeof parsed.expiry === "number" ? parsed.expiry : 0,
      account: typeof parsed.account === "string" ? parsed.account : undefined,
      scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
      tokenType: typeof parsed.tokenType === "string" ? parsed.tokenType : undefined,
    };
    return cached;
  }

  function saveCredentials(credentials: StoredCredentials): void {
    cached = credentials;
    writeFile(tokenPath, `${JSON.stringify(credentials, null, 2)}\n`);
  }

  function closePending(): void {
    if (!pending) {
      return;
    }
    try {
      pending.server.close();
    } catch {
      // cerrar el servidor loopback nunca debe tumbar el agente
    }
    pending = null;
  }

  async function status(): Promise<GoogleAuthStatus> {
    const { clientId } = readClientConfig();
    const credentials = loadCredentials();
    const configured = Boolean(clientId);
    const authenticated = Boolean(credentials?.accessToken);
    const expiresAt = credentials?.expiry ? new Date(credentials.expiry).toISOString() : null;
    let message: string;
    if (!configured) {
      message = GOOGLE_CLIENT_SETUP_MESSAGE;
    } else if (!authenticated) {
      message = "Google esta configurado pero todavia no has iniciado sesion. Puedo abrirte la pantalla de Google cuando quieras.";
    } else {
      const account = credentials?.account ? ` con la cuenta ${credentials.account}` : "";
      message = `Sesion de Google activa${account}.`;
    }
    return {
      ok: configured && authenticated,
      configured,
      authenticated,
      account: credentials?.account ?? null,
      expiresAt,
      message,
    };
  }

  async function startLogin(): Promise<GoogleStartLoginResult> {
    const { clientId } = readClientConfig();
    if (!clientId) {
      return { ok: false, needsClientId: true, message: GOOGLE_CLIENT_SETUP_MESSAGE };
    }

    closePending();

    const verifier = randomString(32);
    const state = randomString(16);
    const challenge = base64UrlSha256(verifier);

    let server: LoopbackServer;
    try {
      server = await startLoopbackServer(renderLoopbackPage);
    } catch (error) {
      return {
        ok: false,
        message: `No pude abrir el pequeno servidor local que hace falta para el inicio de sesion: ${describeError(error)}`,
      };
    }

    const redirectUri = `http://127.0.0.1:${server.port}`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;

    const code = Promise.resolve()
      .then(() => server.waitForCode())
      .catch((error) => ({ error: describeError(error) }) as LoopbackResult);

    pending = { verifier, state, redirectUri, authUrl, server, code };

    const opened = await openUrl(authUrl).catch((error) => ({ ok: false, message: describeError(error) }));
    const openedLine = opened.ok
      ? "He abierto la ventana de Google en el navegador."
      : `No he podido abrir el navegador solo (${opened.message}). Abre tu a mano esta direccion:`;

    return {
      ok: true,
      authUrl,
      port: server.port,
      message: [
        openedLine,
        authUrl,
        "Elige tu cuenta de Google, acepta los permisos de correo y calendario y espera a que la pagina diga que ya puedes volver a AgenOS.",
      ].join("\n"),
    };
  }

  async function waitForLogin(timeoutMs: number = DEFAULT_LOGIN_TIMEOUT_MS): Promise<GoogleCompleteLoginResult> {
    if (!pending) {
      return { ok: false, message: "No hay ningun inicio de sesion de Google en curso. Empieza con la accion login." };
    }
    const current = pending;

    const result = await raceTimeout(current.code, timeoutMs, { error: "__agenos_timeout__" } as LoopbackResult);
    if (result.error === "__agenos_timeout__") {
      return {
        ok: false,
        timedOut: true,
        message: [
          "Todavia no he recibido la respuesta de Google.",
          "La pagina de inicio de sesion sigue abierta en el navegador:",
          current.authUrl,
          "Cuando termines de aceptar los permisos, dimelo y lo compruebo.",
        ].join("\n"),
      };
    }

    closePending();

    if (result.error) {
      return { ok: false, message: `Google no autorizo el acceso: ${result.error}. Podemos volver a intentarlo cuando quieras.` };
    }
    if (result.state !== current.state) {
      return { ok: false, message: "La respuesta de Google no coincide con la peticion que hice, asi que la he descartado por seguridad. Vamos a repetir el inicio de sesion." };
    }
    if (!result.code) {
      return { ok: false, message: "Google no me devolvio el codigo de acceso. Vamos a repetir el inicio de sesion." };
    }

    const { clientId, clientSecret } = readClientConfig();
    if (!clientId) {
      return { ok: false, message: GOOGLE_CLIENT_SETUP_MESSAGE };
    }

    const form = new URLSearchParams({
      code: result.code,
      client_id: clientId,
      redirect_uri: current.redirectUri,
      grant_type: "authorization_code",
      code_verifier: current.verifier,
    });
    if (clientSecret) {
      form.set("client_secret", clientSecret);
    }

    const exchanged = await postToken(form);
    if (!exchanged.ok || !exchanged.payload) {
      return { ok: false, message: `No pude terminar el inicio de sesion con Google: ${exchanged.message}` };
    }

    const payload = exchanged.payload;
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) {
      return { ok: false, message: "Google no me dio un token de acceso valido. Vamos a repetir el inicio de sesion." };
    }
    const account = emailFromIdToken(payload.id_token) ?? null;
    saveCredentials({
      accessToken,
      refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
      expiry: now() + expiresInMs(payload.expires_in),
      account: account ?? undefined,
      scope: typeof payload.scope === "string" ? payload.scope : undefined,
      tokenType: typeof payload.token_type === "string" ? payload.token_type : undefined,
    });

    return {
      ok: true,
      account,
      message: account
        ? `Listo, ya tengo acceso a tu correo y tu calendario de Google con la cuenta ${account}.`
        : "Listo, ya tengo acceso a tu correo y tu calendario de Google.",
    };
  }

  async function completeLogin(): Promise<GoogleCompleteLoginResult> {
    return waitForLogin(DEFAULT_LOGIN_TIMEOUT_MS);
  }

  async function accessToken(): Promise<GoogleAccessTokenResult> {
    const credentials = loadCredentials();
    if (!credentials) {
      const { clientId } = readClientConfig();
      return {
        ok: false,
        needsLogin: true,
        message: clientId
          ? "Todavia no has iniciado sesion en Google. Hay que iniciar sesion antes de mirar el correo o el calendario."
          : GOOGLE_CLIENT_SETUP_MESSAGE,
      };
    }
    if (credentials.expiry - now() > REFRESH_MARGIN_MS) {
      return { ok: true, token: credentials.accessToken, message: "Sesion de Google valida." };
    }
    if (!credentials.refreshToken) {
      return {
        ok: false,
        needsLogin: true,
        message: "La sesion de Google ha caducado y no tengo permiso para renovarla sola. Hay que volver a iniciar sesion.",
      };
    }

    const { clientId, clientSecret } = readClientConfig();
    if (!clientId) {
      return { ok: false, needsLogin: true, message: GOOGLE_CLIENT_SETUP_MESSAGE };
    }
    const form = new URLSearchParams({
      client_id: clientId,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    });
    if (clientSecret) {
      form.set("client_secret", clientSecret);
    }

    const refreshed = await postToken(form);
    if (!refreshed.ok || !refreshed.payload || typeof refreshed.payload.access_token !== "string") {
      return {
        ok: false,
        needsLogin: true,
        message: `La sesion de Google ha caducado y no pude renovarla (${refreshed.message}). Hay que volver a iniciar sesion.`,
      };
    }

    const payload = refreshed.payload;
    const updated: StoredCredentials = {
      ...credentials,
      accessToken: payload.access_token as string,
      refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : credentials.refreshToken,
      expiry: now() + expiresInMs(payload.expires_in),
      account: emailFromIdToken(payload.id_token) ?? credentials.account,
    };
    saveCredentials(updated);
    return { ok: true, token: updated.accessToken, message: "Sesion de Google renovada." };
  }

  async function logout(): Promise<{ ok: boolean; message: string }> {
    closePending();
    cached = null;
    try {
      removeFile(tokenPath);
    } catch (error) {
      return { ok: false, message: `No pude borrar las credenciales guardadas: ${describeError(error)}` };
    }
    return { ok: true, message: "He cerrado la sesion de Google y he borrado las credenciales guardadas en este equipo." };
  }

  async function postToken(form: URLSearchParams): Promise<{ ok: boolean; message: string; payload?: Record<string, unknown> }> {
    let response: Response;
    try {
      response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
    } catch (error) {
      return { ok: false, message: `no pude conectar con Google (${describeError(error)})` };
    }
    const text = await response.text().catch(() => "");
    const payload = parseJson<Record<string, unknown>>(text) ?? undefined;
    if (!response.ok) {
      const detail =
        (typeof payload?.error_description === "string" && payload.error_description) ||
        (typeof payload?.error === "string" && payload.error) ||
        truncate(text, 200) ||
        `HTTP ${response.status}`;
      return { ok: false, message: detail };
    }
    if (!payload) {
      return { ok: false, message: "Google respondio algo que no entiendo" };
    }
    return { ok: true, message: "ok", payload };
  }

  return {
    tokenPath,
    configPath,
    scopes: [...GOOGLE_SCOPES],
    status,
    startLogin,
    completeLogin,
    waitForLogin,
    accessToken,
    logout,
  };
}

export function renderLoopbackPage(result: LoopbackResult): LoopbackPage {
  const success = Boolean(result.code) && !result.error;
  const title = success ? "Ya puedes volver a AgenOS" : "No se pudo completar el inicio de sesion";
  const detail = success
    ? "Tu cuenta de Google ya esta conectada. Cierra esta pestana y sigue hablando con AgenOS."
    : `Google respondio: ${escapeHtml(result.error ?? "sin codigo de acceso")}. Vuelve a AgenOS y pidele que lo intente otra vez.`;
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #101418; color: #f5f7fa; margin: 0;
             display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      main { max-width: 32rem; padding: 2.5rem; text-align: center; }
      h1 { font-size: 2rem; margin-bottom: 1rem; }
      p { font-size: 1.25rem; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${detail}</p>
    </main>
  </body>
</html>
`;
  return { status: success ? 200 : 400, html };
}

const defaultStartLoopbackServer: StartLoopbackServer = async (renderPage) => {
  let resolveCode: (result: LoopbackResult) => void = () => {};
  const codePromise = new Promise<LoopbackResult>((resolve) => {
    resolveCode = resolve;
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request: Request) {
      const url = new URL(request.url);
      const code = url.searchParams.get("code") ?? undefined;
      const error = url.searchParams.get("error") ?? undefined;
      const state = url.searchParams.get("state") ?? undefined;
      if (!code && !error) {
        return new Response("AgenOS", { status: 404 });
      }
      const result: LoopbackResult = { code, error, state };
      resolveCode(result);
      const page = renderPage(result);
      return new Response(page.html, {
        status: page.status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  if (typeof server.port !== "number") {
    void server.stop(true);
    throw new Error("No pude reservar un puerto local para completar el inicio de sesion de Google.");
  }

  return {
    port: server.port,
    close() {
      void server.stop(true);
    },
    waitForCode() {
      return codePromise;
    },
  };
};

async function defaultOpenUrl(url: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { launchBrowserUrl } = await import("./browser-launcher");
    const response = await launchBrowserUrl(url, { focus: true });
    return { ok: Boolean(response.ok), message: response.message ?? "" };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultWriteFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, path);
}

function defaultRemoveFile(path: string): void {
  rmSync(path, { force: true });
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") {
    return null;
  }
  const [, payload] = idToken.split(".");
  if (!payload) {
    return null;
  }
  try {
    const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = parseJson<{ email?: unknown }>(decoded);
    return typeof parsed?.email === "string" ? parsed.email : null;
  } catch {
    return null;
  }
}

function expiresInMs(expiresIn: unknown): number {
  const seconds = typeof expiresIn === "number" ? expiresIn : Number.parseInt(String(expiresIn ?? ""), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600 * 1000;
}

async function raceTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutValue: T): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}
