export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function corsHeaders(headers?: unknown): Headers {
  const result = new Headers(headers as ConstructorParameters<typeof Headers>[0]);
  result.set("Access-Control-Allow-Origin", "*");
  result.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  result.set("Access-Control-Allow-Headers", "content-type");
  return result;
}

export function json(payload: unknown, init: ResponseInit = {}): Response {
  const headers = corsHeaders(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

export function options(allow: string[]): Response {
  const headers = corsHeaders({
    Allow: allow.join(", "),
  });
  return new Response(null, {
    status: 204,
    headers,
  });
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
