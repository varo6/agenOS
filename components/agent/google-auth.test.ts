import { describe, expect, test } from "bun:test";
import {
  createGoogleAuth,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_CLIENT_SETUP_MESSAGE,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  renderLoopbackPage,
  type GoogleAuthDeps,
  type LoopbackResult,
  type LoopbackServer,
  type StartLoopbackServer,
} from "./google-auth";

const TOKEN_PATH = "/memoria/agenos/google/credentials.json";
const CONFIG_PATH = "/memoria/agenos/google/client.json";
const CLIENT_ID = "1234-abcd.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-secreto-de-prueba";
const NOW = 1_760_000_000_000;

/** El verificador PKCE que devuelve el randomString falso para 32 bytes. */
const VERIFIER = "verificador-de-prueba-32-bytes";
/** base64url(sha256(VERIFIER)), calculado a mano para no repetir la implementacion. */
const CHALLENGE = "M83sv9zgReLWdHM8MOYTKo_nShu7ZWbPrKI3jiBB1EA";
const STATE = "estado-de-prueba";

/** JWT falso cuyo payload es {"email":"alvaro@example.com","sub":"1234"}. */
const ID_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6ImFsdmFyb0BleGFtcGxlLmNvbSIsInN1YiI6IjEyMzQifQ.firma-falsa";

type FakeCall = { url: string; method: string; body: string; headers: Record<string, string> };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function createFetch(handler: (url: string, init: RequestInit | undefined) => Response): {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method ?? "GET"),
      body: typeof init?.body === "string" ? init.body : "",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return handler(String(input), init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Servidor loopback falso: nunca abre un puerto de verdad. */
function createLoopback(port = 45678) {
  let resolveCode: (result: LoopbackResult) => void = () => {};
  const codePromise = new Promise<LoopbackResult>((resolve) => {
    resolveCode = resolve;
  });
  const opened: number[] = [];
  const state = { closed: 0, servers: 0, renderPage: null as ((result: LoopbackResult) => unknown) | null };

  const start: StartLoopbackServer = async (renderPage) => {
    state.servers += 1;
    state.renderPage = renderPage;
    opened.push(port);
    const server: LoopbackServer = {
      port,
      close() {
        state.closed += 1;
      },
      waitForCode: () => codePromise,
    };
    return server;
  };

  return { start, state, resolve: (result: LoopbackResult) => resolveCode(result) };
}

function createAuth(overrides: Partial<GoogleAuthDeps> = {}, files: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(files));
  const writes: Array<{ path: string; contents: string }> = [];
  const removed: string[] = [];
  const openedUrls: string[] = [];

  const deps: GoogleAuthDeps = {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tokenPath: TOKEN_PATH,
    configPath: CONFIG_PATH,
    env: {},
    now: () => NOW,
    randomString: (bytes: number) => (bytes === 32 ? VERIFIER : STATE),
    readFile: (path: string) => store.get(path) ?? null,
    writeFile: (path: string, contents: string) => {
      writes.push({ path, contents });
      store.set(path, contents);
    },
    removeFile: (path: string) => {
      removed.push(path);
      store.delete(path);
    },
    openUrl: async (url: string) => {
      openedUrls.push(url);
      return { ok: true, message: "He abierto Chromium." };
    },
    fetchImpl: createFetch(() => jsonResponse({}, 500)).fetchImpl,
    ...overrides,
  };

  return { auth: createGoogleAuth(deps), store, writes, removed, openedUrls };
}

function storedCredentials(store: Map<string, string>): Record<string, unknown> {
  return JSON.parse(store.get(TOKEN_PATH) ?? "{}") as Record<string, unknown>;
}

function credentialsFile(credentials: Record<string, unknown>): Record<string, string> {
  return { [TOKEN_PATH]: JSON.stringify(credentials) };
}

// --------------------------------------------------------------------------------------
// Configuracion del cliente OAuth
// --------------------------------------------------------------------------------------

describe("configuracion del cliente", () => {
  test("sin clientId el login pide configurar Google y no abre ningun servidor", async () => {
    const loopback = createLoopback();
    const { auth, openedUrls } = createAuth({ clientId: undefined, startLoopbackServer: loopback.start });

    const result = await auth.startLogin();

    expect(result.ok).toBe(false);
    expect(result.needsClientId).toBe(true);
    expect(result.message).toBe(GOOGLE_CLIENT_SETUP_MESSAGE);
    // El mensaje lo lee el usuario final, no quien monta la imagen: no puede
    // pedirle rutas, variables de entorno ni pasos en Google Cloud.
    expect(result.message).not.toContain("client.json");
    expect(result.message).not.toContain("AGENOS_GOOGLE_CLIENT_ID");
    expect(result.message).not.toContain("console.cloud.google.com");
    expect(result.message).toContain("navegador");
    expect(loopback.state.servers).toBe(0);
    expect(openedUrls).toEqual([]);
  });

  test("lee el clientId del client.json en formato installed de Google", async () => {
    const loopback = createLoopback();
    const { auth } = createAuth(
      { clientId: undefined, clientSecret: undefined, startLoopbackServer: loopback.start },
      { [CONFIG_PATH]: JSON.stringify({ installed: { client_id: "desde-fichero", client_secret: "secreto" } }) },
    );

    const result = await auth.startLogin();

    expect(result.ok).toBe(true);
    expect(new URL(result.authUrl ?? "").searchParams.get("client_id")).toBe("desde-fichero");
  });

  test("las variables de entorno valen si no hay clientId inyectado", async () => {
    const loopback = createLoopback();
    const { auth } = createAuth({
      clientId: undefined,
      clientSecret: undefined,
      env: { AGENOS_GOOGLE_CLIENT_ID: "  desde-entorno  ", AGENOS_GOOGLE_CLIENT_SECRET: "secreto-entorno" },
      startLoopbackServer: loopback.start,
    });

    const result = await auth.startLogin();

    expect(new URL(result.authUrl ?? "").searchParams.get("client_id")).toBe("desde-entorno");
  });

  test("status distingue sin configurar, sin sesion y con sesion", async () => {
    const sinConfigurar = await createAuth({ clientId: undefined }).auth.status();
    expect(sinConfigurar).toMatchObject({
      ok: false,
      configured: false,
      authenticated: false,
      account: null,
      expiresAt: null,
      message: GOOGLE_CLIENT_SETUP_MESSAGE,
    });

    const sinSesion = await createAuth().auth.status();
    expect(sinSesion).toMatchObject({ ok: false, configured: true, authenticated: false });
    expect(sinSesion.message).toContain("todavia no has iniciado sesion");

    const conSesion = await createAuth(
      {},
      credentialsFile({ accessToken: "ya29.token", expiry: NOW + 3_600_000, account: "alvaro@example.com" }),
    ).auth.status();
    expect(conSesion).toMatchObject({
      ok: true,
      configured: true,
      authenticated: true,
      account: "alvaro@example.com",
      expiresAt: new Date(NOW + 3_600_000).toISOString(),
    });
    expect(conSesion.message).toBe("Sesion de Google activa con la cuenta alvaro@example.com.");
  });
});

// --------------------------------------------------------------------------------------
// URL de consentimiento
// --------------------------------------------------------------------------------------

describe("startLogin", () => {
  test("construye la URL de consentimiento con PKCE S256, scopes y loopback", async () => {
    const loopback = createLoopback(45678);
    const { auth, openedUrls } = createAuth({ startLoopbackServer: loopback.start });

    const result = await auth.startLogin();

    expect(result.ok).toBe(true);
    expect(result.port).toBe(45678);

    const url = new URL(result.authUrl ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: "http://127.0.0.1:45678",
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: STATE,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar openid email profile",
    );
    expect(url.searchParams.get("code_challenge")).not.toBe(VERIFIER);

    expect(openedUrls).toEqual([result.authUrl]);
    expect(result.message).toContain("He abierto la ventana de Google en el navegador.");
    expect(result.message).toContain(result.authUrl ?? "");
  });

  test("si no puede abrir el navegador pide abrir la URL a mano", async () => {
    const loopback = createLoopback();
    const { auth } = createAuth({
      startLoopbackServer: loopback.start,
      openUrl: async () => ({ ok: false, message: "no hay sesion grafica" }),
    });

    const result = await auth.startLogin();

    expect(result.ok).toBe(true);
    expect(result.message).toContain("No he podido abrir el navegador solo (no hay sesion grafica)");
    expect(result.message).toContain("Abre tu a mano esta direccion:");
  });

  test("si el servidor loopback no arranca lo cuenta sin lanzar excepciones", async () => {
    const { auth } = createAuth({
      startLoopbackServer: async () => {
        throw new Error("EADDRINUSE");
      },
    });

    const result = await auth.startLogin();

    expect(result.ok).toBe(false);
    expect(result.authUrl).toBeUndefined();
    expect(result.message).toContain("No pude abrir el pequeno servidor local");
    expect(result.message).toContain("EADDRINUSE");
  });

  test("un segundo startLogin cierra el servidor del intento anterior", async () => {
    const loopback = createLoopback();
    const { auth } = createAuth({ startLoopbackServer: loopback.start });

    await auth.startLogin();
    expect(loopback.state.closed).toBe(0);

    await auth.startLogin();
    expect(loopback.state.servers).toBe(2);
    expect(loopback.state.closed).toBe(1);
  });

  test("el servidor loopback recibe el renderizador de la pagina de vuelta", async () => {
    const loopback = createLoopback();
    const { auth } = createAuth({ startLoopbackServer: loopback.start });

    await auth.startLogin();

    expect(loopback.state.renderPage).toBe(renderLoopbackPage);
  });
});

// --------------------------------------------------------------------------------------
// Canje del codigo
// --------------------------------------------------------------------------------------

describe("waitForLogin", () => {
  test("canjea el codigo, guarda las credenciales y cierra el servidor", async () => {
    const loopback = createLoopback(45678);
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({
        access_token: "ya29.token-nuevo",
        refresh_token: "1//refresco-nuevo",
        expires_in: 3599,
        scope: GOOGLE_SCOPES.join(" "),
        token_type: "Bearer",
        id_token: ID_TOKEN,
      }),
    );
    const { auth, store, writes } = createAuth({ startLoopbackServer: loopback.start, fetchImpl });

    await auth.startLogin();
    loopback.resolve({ code: "4/codigo-de-google", state: STATE });
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(true);
    expect(result.account).toBe("alvaro@example.com");
    expect(result.message).toBe(
      "Listo, ya tengo acceso a tu correo y tu calendario de Google con la cuenta alvaro@example.com.",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(calls[0]?.body ?? "").entries())).toEqual({
      code: "4/codigo-de-google",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: "http://127.0.0.1:45678",
      grant_type: "authorization_code",
      code_verifier: VERIFIER,
    });

    expect(writes.map((write) => write.path)).toEqual([TOKEN_PATH]);
    expect(storedCredentials(store)).toEqual({
      accessToken: "ya29.token-nuevo",
      refreshToken: "1//refresco-nuevo",
      expiry: NOW + 3_599_000,
      account: "alvaro@example.com",
      scope: GOOGLE_SCOPES.join(" "),
      tokenType: "Bearer",
    });
    expect(loopback.state.closed).toBe(1);
  });

  test("sin client_secret no manda el campo en el formulario", async () => {
    const loopback = createLoopback();
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ access_token: "ya29.x", expires_in: 60 }));
    const { auth } = createAuth({ clientSecret: undefined, startLoopbackServer: loopback.start, fetchImpl });

    await auth.startLogin();
    loopback.resolve({ code: "4/codigo", state: STATE });
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(true);
    expect(result.account).toBeNull();
    expect(result.message).toBe("Listo, ya tengo acceso a tu correo y tu calendario de Google.");
    expect(new URLSearchParams(calls[0]?.body ?? "").has("client_secret")).toBe(false);
  });

  test("un state que no coincide se descarta sin llamar a Google", async () => {
    const loopback = createLoopback();
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ access_token: "no-deberia-usarse" }));
    const { auth, writes } = createAuth({ startLoopbackServer: loopback.start, fetchImpl });

    await auth.startLogin();
    loopback.resolve({ code: "4/codigo-inyectado", state: "estado-de-otro" });
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("no coincide con la peticion que hice");
    expect(result.message).toContain("la he descartado por seguridad");
    expect(calls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(loopback.state.closed).toBe(1);
  });

  test("un error de Google en la vuelta se cuenta tal cual", async () => {
    const loopback = createLoopback();
    const { auth } = createAuth({ startLoopbackServer: loopback.start });

    await auth.startLogin();
    loopback.resolve({ error: "access_denied", state: STATE });
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "Google no autorizo el acceso: access_denied. Podemos volver a intentarlo cuando quieras.",
    );
  });

  test("una vuelta sin codigo pide repetir el inicio de sesion", async () => {
    const loopback = createLoopback();
    const { auth } = createAuth({ startLoopbackServer: loopback.start });

    await auth.startLogin();
    loopback.resolve({ state: STATE });
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Google no me devolvio el codigo de acceso. Vamos a repetir el inicio de sesion.");
  });

  test("si Google rechaza el canje se explica el motivo", async () => {
    const loopback = createLoopback();
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "Bad Request" }, 400),
    );
    const { auth, writes } = createAuth({ startLoopbackServer: loopback.start, fetchImpl });

    await auth.startLogin();
    loopback.resolve({ code: "4/caducado", state: STATE });
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("No pude terminar el inicio de sesion con Google: Bad Request");
    expect(writes).toEqual([]);
  });

  test("un canje sin access_token no guarda nada", async () => {
    const loopback = createLoopback();
    const { fetchImpl } = createFetch(() => jsonResponse({ expires_in: 3599 }));
    const { auth, writes } = createAuth({ startLoopbackServer: loopback.start, fetchImpl });

    await auth.startLogin();
    loopback.resolve({ code: "4/vacio", state: STATE });
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Google no me dio un token de acceso valido. Vamos a repetir el inicio de sesion.");
    expect(writes).toEqual([]);
  });

  test("sin login en curso avisa de que hay que empezar por login", async () => {
    const { auth } = createAuth();

    expect(await auth.waitForLogin(1_000)).toEqual({
      ok: false,
      message: "No hay ningun inicio de sesion de Google en curso. Empieza con la accion login.",
    });
  });

  test("si Google tarda devuelve timedOut y deja la pagina abierta para reintentar", async () => {
    const loopback = createLoopback();
    const { fetchImpl } = createFetch(() => jsonResponse({ access_token: "ya29.tarde", expires_in: 3599 }));
    const { auth } = createAuth({ startLoopbackServer: loopback.start, fetchImpl });

    const started = await auth.startLogin();
    const timedOut = await auth.waitForLogin(20);

    expect(timedOut.ok).toBe(false);
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.message).toContain("Todavia no he recibido la respuesta de Google.");
    expect(timedOut.message).toContain(started.authUrl ?? "");
    // El servidor sigue vivo: el usuario aun puede terminar en el navegador.
    expect(loopback.state.closed).toBe(0);

    loopback.resolve({ code: "4/tarde-pero-llega", state: STATE });
    const completado = await auth.completeLogin();

    expect(completado.ok).toBe(true);
    expect(loopback.state.closed).toBe(1);
  });

  test("si el servidor loopback revienta se trata como un fallo de Google", async () => {
    const { auth } = createAuth({
      startLoopbackServer: async () => ({
        port: 1234,
        close() {},
        waitForCode: () => Promise.reject(new Error("el socket se cayo")),
      }),
    });

    await auth.startLogin();
    const result = await auth.waitForLogin(1_000);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "Google no autorizo el acceso: el socket se cayo. Podemos volver a intentarlo cuando quieras.",
    );
  });
});

// --------------------------------------------------------------------------------------
// accessToken y logout
// --------------------------------------------------------------------------------------

describe("accessToken", () => {
  test("sin credenciales pide iniciar sesion", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
    const { auth } = createAuth({ fetchImpl });

    const result = await auth.accessToken();

    expect(result).toEqual({
      ok: false,
      needsLogin: true,
      message: "Todavia no has iniciado sesion en Google. Hay que iniciar sesion antes de mirar el correo o el calendario.",
    });
    expect(calls).toHaveLength(0);
  });

  test("sin credenciales y sin clientId manda el instructivo de configuracion", async () => {
    const { auth } = createAuth({ clientId: undefined });

    expect(await auth.accessToken()).toEqual({
      ok: false,
      needsLogin: true,
      message: GOOGLE_CLIENT_SETUP_MESSAGE,
    });
  });

  test("un token todavia fresco se devuelve sin tocar la red", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
    const { auth } = createAuth(
      { fetchImpl },
      credentialsFile({ accessToken: "ya29.fresco", refreshToken: "1//r", expiry: NOW + 120_000 }),
    );

    expect(await auth.accessToken()).toEqual({
      ok: true,
      token: "ya29.fresco",
      message: "Sesion de Google valida.",
    });
    expect(calls).toHaveLength(0);
  });

  test("un token caducado se renueva y se persiste el nuevo", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ access_token: "ya29.renovado", expires_in: 3599, token_type: "Bearer" }),
    );
    const { auth, store, writes } = createAuth(
      { fetchImpl },
      credentialsFile({
        accessToken: "ya29.viejo",
        refreshToken: "1//refresco",
        expiry: NOW - 1_000,
        account: "alvaro@example.com",
        scope: "gmail",
        tokenType: "Bearer",
      }),
    );

    const result = await auth.accessToken();

    expect(result).toEqual({ ok: true, token: "ya29.renovado", message: "Sesion de Google renovada." });
    expect(Object.fromEntries(new URLSearchParams(calls[0]?.body ?? "").entries())).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: "1//refresco",
      grant_type: "refresh_token",
    });
    expect(writes).toHaveLength(1);
    expect(storedCredentials(store)).toEqual({
      accessToken: "ya29.renovado",
      refreshToken: "1//refresco",
      expiry: NOW + 3_599_000,
      account: "alvaro@example.com",
      scope: "gmail",
      tokenType: "Bearer",
    });

    // La segunda llamada ya usa la copia en memoria renovada.
    expect(await auth.accessToken()).toMatchObject({ ok: true, token: "ya29.renovado" });
    expect(calls).toHaveLength(1);
  });

  test("un token a punto de caducar se renueva por el margen de seguridad", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ access_token: "ya29.por-el-margen" }));
    const { auth } = createAuth(
      { fetchImpl },
      credentialsFile({ accessToken: "ya29.casi", refreshToken: "1//r", expiry: NOW + 30_000 }),
    );

    expect(await auth.accessToken()).toMatchObject({ ok: true, token: "ya29.por-el-margen" });
    expect(calls).toHaveLength(1);
  });

  test("caducado y sin refresh token hay que volver a entrar", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
    const { auth } = createAuth({ fetchImpl }, credentialsFile({ accessToken: "ya29.viejo", expiry: NOW - 1 }));

    expect(await auth.accessToken()).toEqual({
      ok: false,
      needsLogin: true,
      message: "La sesion de Google ha caducado y no tengo permiso para renovarla sola. Hay que volver a iniciar sesion.",
    });
    expect(calls).toHaveLength(0);
  });

  test("si el refresco falla se pide login con el motivo", async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400),
    );
    const { auth, writes } = createAuth(
      { fetchImpl },
      credentialsFile({ accessToken: "ya29.viejo", refreshToken: "1//revocado", expiry: NOW - 1 }),
    );

    const result = await auth.accessToken();

    expect(result.ok).toBe(false);
    expect(result.needsLogin).toBe(true);
    expect(result.message).toBe(
      "La sesion de Google ha caducado y no pude renovarla (Token has been expired or revoked.). Hay que volver a iniciar sesion.",
    );
    expect(writes).toEqual([]);
  });

  test("si la red se cae durante el refresco tambien se pide login", async () => {
    const fetchImpl = (async () => {
      throw new Error("ENETUNREACH");
    }) as unknown as typeof fetch;
    const { auth } = createAuth(
      { fetchImpl },
      credentialsFile({ accessToken: "ya29.viejo", refreshToken: "1//r", expiry: NOW - 1 }),
    );

    const result = await auth.accessToken();

    expect(result.needsLogin).toBe(true);
    expect(result.message).toContain("no pude conectar con Google (ENETUNREACH)");
  });

  test("un fichero de credenciales corrupto se trata como sesion inexistente", async () => {
    const { auth } = createAuth({}, { [TOKEN_PATH]: "{no es json" });

    expect(await auth.accessToken()).toMatchObject({ ok: false, needsLogin: true });
    expect(await auth.status()).toMatchObject({ authenticated: false });
  });
});

describe("logout", () => {
  test("borra las credenciales del disco y deja la sesion sin token", async () => {
    const loopback = createLoopback();
    const { auth, store, removed } = createAuth(
      { startLoopbackServer: loopback.start },
      credentialsFile({ accessToken: "ya29.token", refreshToken: "1//r", expiry: NOW + 3_600_000 }),
    );

    await auth.startLogin();
    expect(await auth.accessToken()).toMatchObject({ ok: true });

    const result = await auth.logout();

    expect(result).toEqual({
      ok: true,
      message: "He cerrado la sesion de Google y he borrado las credenciales guardadas en este equipo.",
    });
    expect(removed).toEqual([TOKEN_PATH]);
    expect(store.has(TOKEN_PATH)).toBe(false);
    expect(loopback.state.closed).toBe(1);
    expect(await auth.accessToken()).toMatchObject({ ok: false, needsLogin: true });
    expect(await auth.status()).toMatchObject({ authenticated: false, account: null });
  });

  test("si no se puede borrar el fichero se avisa sin lanzar excepciones", async () => {
    const { auth } = createAuth({
      removeFile: () => {
        throw new Error("EACCES");
      },
    });

    expect(await auth.logout()).toEqual({
      ok: false,
      message: "No pude borrar las credenciales guardadas: EACCES",
    });
  });
});

// --------------------------------------------------------------------------------------
// Pagina de vuelta del loopback
// --------------------------------------------------------------------------------------

describe("renderLoopbackPage", () => {
  test("con codigo devuelve 200 y el mensaje de vuelta a AgenOS", () => {
    const page = renderLoopbackPage({ code: "4/codigo", state: STATE });

    expect(page.status).toBe(200);
    expect(page.html).toContain("Ya puedes volver a AgenOS");
    expect(page.html).toContain('<html lang="es">');
  });

  test("con error devuelve 400 y escapa el HTML que venga de Google", () => {
    const page = renderLoopbackPage({ error: '<img src=x onerror="alert(1)">' });

    expect(page.status).toBe(400);
    expect(page.html).toContain("No se pudo completar el inicio de sesion");
    expect(page.html).not.toContain("<img src=x");
    expect(page.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("sin codigo ni error tambien es un fallo", () => {
    const page = renderLoopbackPage({});

    expect(page.status).toBe(400);
    expect(page.html).toContain("sin codigo de acceso");
  });
});

describe("createGoogleAuth", () => {
  test("expone las rutas y los scopes que va a pedir", () => {
    const { auth } = createAuth();

    expect(auth.tokenPath).toBe(TOKEN_PATH);
    expect(auth.configPath).toBe(CONFIG_PATH);
    expect(auth.scopes).toEqual([...GOOGLE_SCOPES]);
  });
});
