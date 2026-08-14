export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

export function options(allow: string[]): Response {
  const headers = new Headers({
    Allow: allow.join(", "),
  });
  return new Response(null, {
    status: 204,
    headers,
  });
}

const TRUSTED_UI_ORIGINS = new Set([
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

export function rejectUntrustedBrowserOrigin(request: Request): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  const origin = request.headers.get("origin");
  if (fetchSite === "cross-site" || (origin && !TRUSTED_UI_ORIGINS.has(origin))) {
    return json({
      ok: false,
      message: "Origen web no autorizado para la API local de AgenOS.",
    }, { status: 403 });
  }
  return null;
}

export function methodNotAllowed(allow: string[]): Response {
  return json(
    {
      ok: false,
      message: `Método no soportado. Usa ${allow.join(", ")}.`,
    },
    {
      status: 405,
      headers: {
        Allow: allow.join(", "),
      },
    },
  );
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "El body debe ser JSON válido.");
  }
}
