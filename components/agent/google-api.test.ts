import { describe, expect, test } from "bun:test";
import {
  buildRfc5322Message,
  createGoogleApi,
  decodeBase64Url,
  encodeMimeHeader,
  extractAddress,
  htmlToText,
  parseGmailMessage,
  toBase64Url,
  type GoogleAuthLike,
} from "./google-api";

// --------------------------------------------------------------------------------------
// Fixtures reales: los cuerpos vienen en base64url tal y como los devuelve Gmail.
// --------------------------------------------------------------------------------------

/** "Hola Álvaro,\r\n\r\n\r\nTe confirmo la cita del miércoles a las 9:30 en la oficina.\r\n\r\nUn saludo,\r\nMaría Ñíguez\r\n" */
const PLAIN_BODY_B64URL =
  "SG9sYSDDgWx2YXJvLA0KDQoNClRlIGNvbmZpcm1vIGxhIGNpdGEgZGVsIG1pw6lyY29sZXMgYSBsYXMgOTozMCBlbiBsYSBvZmljaW5hLg0KDQpVbiBzYWx1ZG8sDQpNYXLDrWEgw5HDrWd1ZXoNCg";

/** HTML con <style>, <script>, &nbsp; y acentos. Lleva "-" en el base64url. */
const HTML_BODY_B64URL =
  "PGh0bWw-PGhlYWQ-PHN0eWxlPnB7Y29sb3I6cmVkfTwvc3R5bGU-PC9oZWFkPjxib2R5PjxwPkhvbGEmbmJzcDvDgWx2YXJvPC9wPjxkaXY-QWRqdW50byBlbCA8Yj5pbmZvcm1lPC9iPiBkZWwgbWnDqXJjb2xlcy48L2Rpdj48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ-PC9ib2R5PjwvaHRtbD4";

const EXPECTED_PLAIN_BODY = [
  "Hola Álvaro,",
  "",
  "Te confirmo la cita del miércoles a las 9:30 en la oficina.",
  "",
  "Un saludo,",
  "María Ñíguez",
].join("\n");

const MULTIPART_MESSAGE = {
  id: "18f0aa11bb22cc33",
  threadId: "18f0aa11bb22cc00",
  snippet: "Hola &Aacute;lvaro, te confirmo la cita",
  labelIds: ["INBOX", "UNREAD"],
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "Delivered-To", value: "alvaro@example.com" },
      { name: "From", value: "María Ñíguez <maria@ejemplo.es>" },
      { name: "To", value: "Álvaro <alvaro@example.com>" },
      { name: "Cc", value: "oficina@ejemplo.es" },
      { name: "Subject", value: "Reunión del miércoles" },
      { name: "Date", value: "Tue, 12 Aug 2025 09:14:03 +0200" },
      { name: "Message-ID", value: "<CAF1@mail.ejemplo.es>" },
      { name: "References", value: "<CAF0@mail.ejemplo.es>" },
    ],
    parts: [
      // Adjunto de texto: findPart debe saltarlo porque tiene filename.
      {
        mimeType: "text/plain",
        filename: "nota-adjunta.txt",
        body: { data: toBase64Url("esto es un adjunto, no el cuerpo"), size: 32 },
      },
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: PLAIN_BODY_B64URL, size: 120 } },
          { mimeType: "text/html", body: { data: HTML_BODY_B64URL, size: 180 } },
        ],
      },
      {
        mimeType: "application/pdf",
        filename: "factura.pdf",
        body: { size: 4096 },
      },
    ],
  },
};

// --------------------------------------------------------------------------------------
// Dobles de fetch y de auth.
// --------------------------------------------------------------------------------------

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

const OK_AUTH: GoogleAuthLike = {
  async accessToken() {
    return { ok: true, token: "token-de-prueba", message: "Sesion de Google valida." };
  },
};

const NO_SESSION_AUTH: GoogleAuthLike = {
  async accessToken() {
    return { ok: false, message: "Todavia no has iniciado sesion en Google." };
  },
};

function lastJsonBody(calls: FakeCall[]): Record<string, unknown> {
  return JSON.parse(calls[calls.length - 1]?.body ?? "{}") as Record<string, unknown>;
}

// --------------------------------------------------------------------------------------
// Funciones puras
// --------------------------------------------------------------------------------------

describe("parseGmailMessage", () => {
  test("saca cabeceras y el cuerpo text/plain de un multipart real", () => {
    const mail = parseGmailMessage(MULTIPART_MESSAGE, "ignorado");

    expect(mail.id).toBe("18f0aa11bb22cc33");
    expect(mail.threadId).toBe("18f0aa11bb22cc00");
    expect(mail.from).toBe("María Ñíguez <maria@ejemplo.es>");
    expect(mail.to).toBe("Álvaro <alvaro@example.com>");
    expect(mail.cc).toBe("oficina@ejemplo.es");
    expect(mail.subject).toBe("Reunión del miércoles");
    expect(mail.date).toBe("Tue, 12 Aug 2025 09:14:03 +0200");
    expect(mail.messageIdHeader).toBe("<CAF1@mail.ejemplo.es>");
    expect(mail.references).toBe("<CAF0@mail.ejemplo.es>");
    // CRLF normalizados, tres saltos colapsados a dos y sin espacios sobrantes.
    expect(mail.body).toBe(EXPECTED_PLAIN_BODY);
    expect(mail.body).not.toContain("adjunto, no el cuerpo");
    expect(mail.body).not.toContain("\r");
  });

  test("cae al text/html y lo convierte a texto cuando no hay text/plain", () => {
    const soloHtml = {
      ...MULTIPART_MESSAGE,
      payload: {
        mimeType: "multipart/alternative",
        headers: MULTIPART_MESSAGE.payload.headers,
        parts: [{ mimeType: "text/html", body: { data: HTML_BODY_B64URL, size: 180 } }],
      },
    };

    const mail = parseGmailMessage(soloHtml);

    expect(mail.body).toBe("Hola Álvaro\nAdjunto el informe del miércoles.");
  });

  test("usa el snippet y valores por defecto cuando el mensaje viene pelado", () => {
    const mail = parseGmailMessage({ snippet: "Cita a las 9 &amp; media" }, "id-de-reserva");

    expect(mail.id).toBe("id-de-reserva");
    expect(mail.threadId).toBe("");
    expect(mail.subject).toBe("(sin asunto)");
    expect(mail.body).toBe("Cita a las 9 & media");
  });

  test("decodifica el cuerpo cuando el payload no tiene partes", () => {
    const mail = parseGmailMessage({
      id: "plano",
      payload: { mimeType: "text/plain", headers: [], body: { data: PLAIN_BODY_B64URL } },
    });

    expect(mail.body).toBe(EXPECTED_PLAIN_BODY);
  });
});

describe("encodeMimeHeader", () => {
  test("codifica en RFC 2047 los asuntos con acentos", () => {
    expect(encodeMimeHeader("Reunión del miércoles")).toBe("=?UTF-8?B?UmV1bmnDs24gZGVsIG1pw6lyY29sZXM=?=");
  });

  test("deja tal cual los asuntos ASCII y la cadena vacia", () => {
    expect(encodeMimeHeader("Weekly sync 9:30")).toBe("Weekly sync 9:30");
    expect(encodeMimeHeader("")).toBe("");
  });
});

describe("buildRfc5322Message", () => {
  test("emite las cabeceras exactas de una respuesta con hilo", () => {
    const raw = buildRfc5322Message({
      to: "maria@ejemplo.es",
      cc: "oficina@ejemplo.es",
      bcc: "archivo@ejemplo.es",
      subject: "Re: Reunión del miércoles",
      body: "Perfecto, nos vemos el miércoles.",
      inReplyTo: "<CAF1@mail.ejemplo.es>",
      references: "<CAF0@mail.ejemplo.es> <CAF1@mail.ejemplo.es>",
    });

    const [headerBlock, bodyBlock] = raw.split("\r\n\r\n");
    expect(headerBlock?.split("\r\n")).toEqual([
      "To: maria@ejemplo.es",
      "Cc: oficina@ejemplo.es",
      "Bcc: archivo@ejemplo.es",
      "Subject: =?UTF-8?B?UmU6IFJldW5pw7NuIGRlbCBtacOpcmNvbGVz?=",
      "In-Reply-To: <CAF1@mail.ejemplo.es>",
      "References: <CAF0@mail.ejemplo.es> <CAF1@mail.ejemplo.es>",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ]);
    expect(Buffer.from(String(bodyBlock).trim(), "base64").toString("utf8")).toBe(
      "Perfecto, nos vemos el miércoles.",
    );
  });

  test("omite las cabeceras opcionales que no se pasan", () => {
    const raw = buildRfc5322Message({ to: "a@b.es", subject: "Hola", body: "Texto" });
    const headerBlock = raw.split("\r\n\r\n")[0] ?? "";

    expect(headerBlock.split("\r\n")).toEqual([
      "To: a@b.es",
      "Subject: Hola",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ]);
    expect(headerBlock).not.toContain("In-Reply-To");
    expect(headerBlock).not.toContain("References");
  });

  test("pasa el cuerpo a CRLF y corta el base64 a 76 columnas", () => {
    const raw = buildRfc5322Message({
      to: "a@b.es",
      subject: "Largo",
      body: `${"linea muy larga que obliga a partir el base64 en varias lineas. ".repeat(6)}\nfin`,
    });
    const bodyLines = (raw.split("\r\n\r\n")[1] ?? "").trim().split("\r\n");

    expect(bodyLines.length).toBeGreaterThan(1);
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
    expect(Buffer.from(bodyLines.join(""), "base64").toString("utf8")).toContain("\r\nfin");
  });
});

describe("helpers de codificacion y texto", () => {
  test("decodeBase64Url entiende - y _ y devuelve utf8", () => {
    expect(decodeBase64Url("w6HDqcOtw7PDuiB-fiDDv8O_")).toBe("áéíóú ~~ ÿÿ");
  });

  test("decodeBase64Url tolera saltos de linea y entradas rotas", () => {
    expect(decodeBase64Url("SG9sYQ\n==")).toBe("Hola");
    expect(decodeBase64Url("")).toBe("");
  });

  test("toBase64Url y decodeBase64Url son inversos", () => {
    const original = "Señor Ñoño ✉ áéíóú ~~ ÿÿ";
    expect(toBase64Url(original)).not.toContain("+");
    expect(toBase64Url(original)).not.toContain("/");
    expect(decodeBase64Url(toBase64Url(original))).toBe(original);
  });

  test("htmlToText quita estilos, scripts y entidades", () => {
    const text = htmlToText(
      '<style>a{}</style><script>var x = 1 < 2;</script><h1>Hola</h1><p>Uno &amp; dos</p>' +
        "<ul><li>Tres</li></ul>Cuatro<br>Cinco&nbsp;seis &lt;fin&gt; &quot;ya&quot; &#39;va&#39;",
    );

    expect(text).toBe('Hola\nUno & dos\nTres\nCuatro\nCinco seis <fin> "ya" \'va\'');
  });

  test("extractAddress saca la direccion de un From con nombre", () => {
    expect(extractAddress("María Ñíguez <maria@ejemplo.es>")).toBe("maria@ejemplo.es");
    expect(extractAddress("  suelto@ejemplo.es  ")).toBe("suelto@ejemplo.es");
    expect(extractAddress("")).toBe("");
  });
});

// --------------------------------------------------------------------------------------
// Gmail sobre fetch falso
// --------------------------------------------------------------------------------------

describe("createGoogleApi / Gmail", () => {
  test("listMessages pide la lista y luego los metadatos de cada correo", async () => {
    const { fetchImpl, calls } = createFetch((url) => {
      if (url.includes("/messages?")) {
        return jsonResponse({ messages: [{ id: "m1" }, { id: "m2" }, { id: "" }] });
      }
      if (url.includes("/messages/m1")) {
        return jsonResponse({
          id: "m1",
          threadId: "t1",
          snippet: "Uno &amp; dos",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            headers: [
              { name: "From", value: "maria@ejemplo.es" },
              { name: "To", value: "alvaro@example.com" },
              { name: "Subject", value: "Reunión" },
              { name: "Date", value: "Tue, 12 Aug 2025 09:14:03 +0200" },
            ],
          },
        });
      }
      return jsonResponse({ id: "m2", threadId: "t2", snippet: "", labelIds: ["INBOX"], payload: { headers: [] } });
    });

    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });
    const result = await api.listMessages();

    expect(result.ok).toBe(true);
    expect(result.message).toBe("He encontrado 2 correos.");
    expect(result.messages).toEqual([
      {
        id: "m1",
        threadId: "t1",
        from: "maria@ejemplo.es",
        to: "alvaro@example.com",
        subject: "Reunión",
        date: "Tue, 12 Aug 2025 09:14:03 +0200",
        snippet: "Uno & dos",
        unread: true,
      },
      { id: "m2", threadId: "t2", from: "", to: "", subject: "(sin asunto)", date: "", snippet: "", unread: false },
    ]);
    expect(calls[0]?.url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox&maxResults=10",
    );
    expect(calls[0]?.headers.authorization).toBe("Bearer token-de-prueba");
    expect(calls[1]?.url).toContain("format=metadata");
    expect(calls[1]?.url).toContain("metadataHeaders=From");
    expect(calls[1]?.url).toContain("metadataHeaders=Date");
    expect(calls).toHaveLength(3);
  });

  test("listMessages respeta la consulta y recorta maxResults al maximo", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ messages: [] }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.listMessages({ query: "  is:unread  ", maxResults: 99 });

    expect(calls[0]?.url).toContain("q=is%3Aunread");
    expect(calls[0]?.url).toContain("maxResults=25");
    expect(result).toEqual({ ok: true, message: 'No hay correos que coincidan con "is:unread".', messages: [] });
  });

  test("readMessage devuelve el correo parseado y exige identificador", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse(MULTIPART_MESSAGE));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.readMessage(" 18f0aa11bb22cc33 ");

    expect(calls[0]?.url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/18f0aa11bb22cc33?format=full",
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Correo de María Ñíguez <maria@ejemplo.es> con asunto "Reunión del miércoles".');
    expect(result.mail?.body).toBe(EXPECTED_PLAIN_BODY);

    const vacio = await api.readMessage("   ");
    expect(vacio).toEqual({ ok: false, message: "Necesito el identificador del correo que quieres leer." });
    expect(calls).toHaveLength(1);
  });

  test("sendMessage manda el raw en base64url con las cabeceras esperadas", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ id: "enviado-1", threadId: "hilo-1" }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.sendMessage({
      to: "  maria@ejemplo.es ",
      subject: "Reunión del miércoles",
      body: "Voy a las 9:30.",
      cc: "  oficina@ejemplo.es  ",
      threadId: "hilo-1",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Correo enviado a maria@ejemplo.es.");
    expect(result.id).toBe("enviado-1");
    expect(calls[0]?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(calls[0]?.method).toBe("POST");

    const payload = lastJsonBody(calls);
    expect(payload.threadId).toBe("hilo-1");
    const raw = decodeBase64Url(String(payload.raw));
    expect(raw).toContain("To: maria@ejemplo.es\r\n");
    expect(raw).toContain("Cc: oficina@ejemplo.es\r\n");
    expect(raw).toContain("Subject: =?UTF-8?B?UmV1bmnDs24gZGVsIG1pw6lyY29sZXM=?=\r\n");
  });

  test("sendMessage se niega sin destinatario", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    expect(await api.sendMessage({ to: "   ", subject: "x", body: "y" })).toEqual({
      ok: false,
      message: "Necesito la direccion de correo del destinatario.",
    });
    expect(calls).toHaveLength(0);
  });

  test("replyToMessage mantiene el hilo, el Re: y las referencias", async () => {
    const { fetchImpl, calls } = createFetch((url) => {
      if (url.includes("/messages/send")) {
        return jsonResponse({ id: "respuesta-1", threadId: "18f0aa11bb22cc00" });
      }
      return jsonResponse(MULTIPART_MESSAGE);
    });
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.replyToMessage({ id: "18f0aa11bb22cc33", body: "Nos vemos el miércoles." });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Respuesta enviada a maria@ejemplo.es.");

    const payload = lastJsonBody(calls);
    expect(payload.threadId).toBe("18f0aa11bb22cc00");
    const raw = decodeBase64Url(String(payload.raw));
    expect(raw).toContain("To: maria@ejemplo.es\r\n");
    expect(raw).toContain("Subject: =?UTF-8?B?UmU6IFJldW5pw7NuIGRlbCBtacOpcmNvbGVz?=\r\n");
    expect(raw).toContain("In-Reply-To: <CAF1@mail.ejemplo.es>\r\n");
    expect(raw).toContain("References: <CAF0@mail.ejemplo.es> <CAF1@mail.ejemplo.es>\r\n");
  });

  test("replyToMessage no duplica el Re: de un asunto que ya lo lleva", async () => {
    const yaRespondido = {
      ...MULTIPART_MESSAGE,
      payload: {
        ...MULTIPART_MESSAGE.payload,
        headers: MULTIPART_MESSAGE.payload.headers.map((header) =>
          header.name === "Subject" ? { name: "Subject", value: "RE: Reunión del miércoles" } : header,
        ),
      },
    };
    const { fetchImpl, calls } = createFetch((url) =>
      url.includes("/messages/send") ? jsonResponse({ id: "r", threadId: "t" }) : jsonResponse(yaRespondido),
    );
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    await api.replyToMessage({ id: "x", body: "vale" });

    const raw = decodeBase64Url(String(lastJsonBody(calls).raw));
    expect(raw).toContain("Subject: =?UTF-8?B?UkU6IFJldW5pw7NuIGRlbCBtacOpcmNvbGVz?=\r\n");
  });

  test("replyToMessage avisa cuando no puede leer el original", async () => {
    const { fetchImpl } = createFetch(() => new Response("nope", { status: 404 }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.replyToMessage({ id: "no-existe", body: "hola" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("No pude leer el correo al que quieres responder.");
    expect(result.message).toContain("(404)");
  });

  test("markAsRead y archive usan modify con las etiquetas correctas", async () => {
    const { fetchImpl, calls } = createFetch(() => new Response("", { status: 204 }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    expect(await api.markAsRead("m1")).toEqual({ ok: true, message: "He marcado el correo como leido." });
    expect(await api.archive("m1")).toEqual({ ok: true, message: "He archivado el correo." });

    expect(calls[0]?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ removeLabelIds: ["UNREAD"] });
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ removeLabelIds: ["INBOX"] });
  });
});

// --------------------------------------------------------------------------------------
// Calendar sobre fetch falso
// --------------------------------------------------------------------------------------

describe("createGoogleApi / Calendar", () => {
  test("listEvents pide la ventana temporal y parsea citas normales y de dia entero", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({
        items: [
          {
            id: "ev1",
            summary: "Reunión",
            location: "Oficina",
            start: { dateTime: "2025-08-20T09:30:00+02:00" },
            end: { dateTime: "2025-08-20T10:30:00+02:00" },
          },
          { id: "ev2", start: { date: "2025-08-21" }, end: { date: "2025-08-22" } },
        ],
      }),
    );
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.listEvents({ from: "2025-08-20T00:00:00Z", to: "2025-08-22T00:00:00Z", maxResults: 5 });

    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(url.searchParams.get("timeMin")).toBe("2025-08-20T00:00:00.000Z");
    expect(url.searchParams.get("timeMax")).toBe("2025-08-22T00:00:00.000Z");
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("orderBy")).toBe("startTime");
    expect(url.searchParams.get("maxResults")).toBe("5");

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Hay 2 citas.");
    expect(result.events).toEqual([
      {
        id: "ev1",
        summary: "Reunión",
        start: "2025-08-20T09:30:00+02:00",
        end: "2025-08-20T10:30:00+02:00",
        location: "Oficina",
        allDay: false,
      },
      { id: "ev2", summary: "(sin titulo)", start: "2025-08-21", end: "2025-08-22", location: "", allDay: true },
    ]);
  });

  test("listEvents sin fechas usa ahora como timeMin y no manda timeMax", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ items: [] }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.listEvents();

    const url = new URL(calls[0]?.url ?? "");
    expect(url.searchParams.get("timeMax")).toBeNull();
    expect(Number.isNaN(Date.parse(url.searchParams.get("timeMin") ?? ""))).toBe(false);
    expect(result.message).toBe("Hay 0 citas.");
  });

  test("createEvent con end explicito manda las dos horas y la zona horaria", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({
        id: "ev-nuevo",
        summary: "Dentista",
        location: "Calle Mayor 1",
        start: { dateTime: "2025-08-20T09:30:00Z" },
        end: { dateTime: "2025-08-20T10:00:00Z" },
      }),
    );
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl, timeZone: "Europe/Madrid" });

    const result = await api.createEvent({
      summary: "  Dentista  ",
      start: "2025-08-20T09:30:00Z",
      end: "2025-08-20T10:00:00Z",
      description: "  llevar la cartilla  ",
      location: "  Calle Mayor 1  ",
    });

    expect(calls[0]?.method).toBe("POST");
    expect(lastJsonBody(calls)).toEqual({
      summary: "Dentista",
      start: { dateTime: "2025-08-20T09:30:00.000Z", timeZone: "Europe/Madrid" },
      end: { dateTime: "2025-08-20T10:00:00.000Z", timeZone: "Europe/Madrid" },
      description: "llevar la cartilla",
      location: "Calle Mayor 1",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Cita "Dentista" apuntada en tu calendario.');
    expect(result.event?.id).toBe("ev-nuevo");
  });

  test("createEvent sin end le da una hora de duracion", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ id: "ev" }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    await api.createEvent({ summary: "Café", start: "2025-08-20T09:30:00Z" });

    const body = lastJsonBody(calls) as { start: { dateTime: string }; end: { dateTime: string } };
    expect(body.start.dateTime).toBe("2025-08-20T09:30:00.000Z");
    expect(body.end.dateTime).toBe("2025-08-20T10:30:00.000Z");
    expect(Object.keys(body)).toEqual(["summary", "start", "end"]);
  });

  test("createEvent de dia entero usa fechas sueltas y cierra al dia siguiente", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ id: "ev" }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    await api.createEvent({ summary: "Vacaciones", start: "2025-08-20T00:00:00Z", allDay: true });

    expect(lastJsonBody(calls)).toEqual({
      summary: "Vacaciones",
      start: { date: "2025-08-20" },
      end: { date: "2025-08-21" },
    });
  });

  test("createEvent valida el titulo y la fecha antes de llamar a Google", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    expect(await api.createEvent({ summary: "   ", start: "2025-08-20T09:30:00Z" })).toEqual({
      ok: false,
      message: "Necesito saber de que es la cita.",
    });
    expect(await api.createEvent({ summary: "Cita", start: "el jueves que viene" })).toEqual({
      ok: false,
      message: "No entendi la fecha y hora de inicio de la cita.",
    });
    expect(calls).toHaveLength(0);
  });

  test("deleteEvent borra por id y exige identificador", async () => {
    const { fetchImpl, calls } = createFetch(() => new Response("", { status: 204 }));
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    expect(await api.deleteEvent("ev 1")).toEqual({ ok: true, message: "He borrado la cita del calendario." });
    expect(calls[0]?.url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/ev%201");
    expect(calls[0]?.method).toBe("DELETE");

    expect(await api.deleteEvent("  ")).toEqual({
      ok: false,
      message: "Necesito el identificador de la cita que quieres borrar.",
    });
  });
});

// --------------------------------------------------------------------------------------
// Errores de transporte y de sesion
// --------------------------------------------------------------------------------------

describe("createGoogleApi / errores", () => {
  test("un 401 de Google se traduce en needsLogin", async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: { code: 401, message: "Invalid Credentials" } }, 401),
    );
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const listado = await api.listMessages();
    expect(listado.ok).toBe(false);
    expect(listado.needsLogin).toBe(true);
    expect(listado.messages).toEqual([]);
    expect(listado.message).toContain("Google ha rechazado la sesion");

    const citas = await api.listEvents();
    expect(citas.needsLogin).toBe(true);

    const enviado = await api.sendMessage({ to: "a@b.es", subject: "s", body: "b" });
    expect(enviado.needsLogin).toBe(true);
    expect(enviado.message).toContain("No pude enviar el correo.");
  });

  test("un 401 al pedir metadatos corta el listado entero", async () => {
    const { fetchImpl } = createFetch((url) =>
      url.includes("/messages?") ? jsonResponse({ messages: [{ id: "m1" }] }) : jsonResponse({}, 401),
    );
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.listMessages();

    expect(result).toEqual({
      ok: false,
      needsLogin: true,
      messages: [],
      message:
        "Google ha rechazado la sesion (ha caducado o se han retirado los permisos). Hay que volver a iniciar sesion en Google antes de seguir.",
    });
  });

  test("un error de metadatos que no es 401 solo se salta ese correo", async () => {
    const { fetchImpl } = createFetch((url) => {
      if (url.includes("/messages?")) {
        return jsonResponse({ messages: [{ id: "m1" }, { id: "m2" }] });
      }
      if (url.includes("/messages/m1")) {
        return jsonResponse({ error: { message: "Backend error" } }, 500);
      }
      return jsonResponse({ id: "m2", payload: { headers: [{ name: "Subject", value: "Va" }] } });
    });
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.listMessages();

    expect(result.ok).toBe(true);
    expect(result.message).toBe("He encontrado 1 correo.");
    expect(result.messages.map((mail) => mail.subject)).toEqual(["Va"]);
  });

  test("sin sesion no se llega a llamar a Google", async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
    const api = createGoogleApi({ auth: NO_SESSION_AUTH, fetchImpl });

    const result = await api.listMessages();

    expect(result.ok).toBe(false);
    expect(result.needsLogin).toBe(true);
    expect(result.message).toBe("Todavia no has iniciado sesion en Google.");
    expect(calls).toHaveLength(0);
  });

  test("un error HTTP normal se cuenta con el detalle de Google", async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: { code: 403, message: "Daily Limit Exceeded" } }, 403),
    );
    const api = createGoogleApi({ auth: OK_AUTH, fetchImpl });

    const result = await api.listEvents();

    expect(result.ok).toBe(false);
    expect(result.needsLogin).toBe(false);
    expect(result.message).toBe("Google devolvio un error (403): Daily Limit Exceeded");
  });

  test("una respuesta ilegible y una caida de red se explican en castellano", async () => {
    const roto = createFetch(() => new Response("<html>vaya</html>", { status: 200 }));
    const apiRoto = createGoogleApi({ auth: OK_AUTH, fetchImpl: roto.fetchImpl });
    expect((await apiRoto.readMessage("m1")).message).toBe("Google respondio algo que no pude entender.");

    const caido = (async () => {
      throw new Error("ENOTFOUND gmail.googleapis.com");
    }) as unknown as typeof fetch;
    const apiCaido = createGoogleApi({ auth: OK_AUTH, fetchImpl: caido });
    const result = await apiCaido.readMessage("m1");
    expect(result.ok).toBe(false);
    expect(result.needsLogin).toBe(false);
    expect(result.message).toBe("No pude conectar con Google: ENOTFOUND gmail.googleapis.com");
  });

  test("si la comprobacion de sesion revienta se pide volver a entrar", async () => {
    const api = createGoogleApi({
      auth: {
        async accessToken() {
          throw new Error("disco lleno");
        },
      },
      fetchImpl: createFetch(() => jsonResponse({})).fetchImpl,
    });

    const result = await api.readMessage("m1");

    expect(result.needsLogin).toBe(true);
    expect(result.message).toBe("No pude comprobar la sesion de Google: disco lleno");
  });

  test("la zona horaria por defecto es Europe/Madrid", () => {
    expect(createGoogleApi({ auth: OK_AUTH }).timeZone).toBe("Europe/Madrid");
    expect(createGoogleApi({ auth: OK_AUTH, timeZone: "Atlantic/Canary" }).timeZone).toBe("Atlantic/Canary");
  });
});
