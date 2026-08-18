const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export const DEFAULT_TIME_ZONE = "Europe/Madrid";
const DEFAULT_MAIL_RESULTS = 10;
const MAX_MAIL_RESULTS = 25;
const DEFAULT_EVENT_RESULTS = 10;

const NEEDS_LOGIN_MESSAGE =
  "Google ha rechazado la sesion (ha caducado o se han retirado los permisos). Hay que volver a iniciar sesion en Google antes de seguir.";

export type GoogleAuthLike = {
  accessToken(): Promise<{ ok: boolean; token?: string; message: string }>;
};

export type GoogleApiDeps = {
  auth: GoogleAuthLike;
  fetchImpl?: typeof fetch;
  timeZone?: string;
};

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
};

export type GmailMessageDetail = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
  messageIdHeader: string;
  references: string;
};

export type CalendarEventSummary = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  allDay: boolean;
};

export type ListMessagesResult = { ok: boolean; message: string; needsLogin?: boolean; messages: GmailMessageSummary[] };
export type ReadMessageResult = { ok: boolean; message: string; needsLogin?: boolean; mail?: GmailMessageDetail };
export type SendMessageResult = { ok: boolean; message: string; needsLogin?: boolean; id?: string; threadId?: string; raw?: string };
export type ModifyMessageResult = { ok: boolean; message: string; needsLogin?: boolean };
export type ListEventsResult = { ok: boolean; message: string; needsLogin?: boolean; events: CalendarEventSummary[] };
export type CreateEventResult = { ok: boolean; message: string; needsLogin?: boolean; event?: CalendarEventSummary };
export type DeleteEventResult = { ok: boolean; message: string; needsLogin?: boolean };

export type GoogleApi = ReturnType<typeof createGoogleApi>;

type RequestOk<T> = { ok: true; status: number; data: T };
type RequestFail = { ok: false; status: number; message: string; needsLogin: boolean };
type RequestResult<T> = RequestOk<T> | RequestFail;

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
};

export function createGoogleApi(deps: GoogleApiDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeZone = deps.timeZone ?? DEFAULT_TIME_ZONE;

  async function request<T>(url: string, init?: RequestInit): Promise<RequestResult<T>> {
    let token: string | undefined;
    try {
      const auth = await deps.auth.accessToken();
      if (!auth.ok || !auth.token) {
        return { ok: false, status: 0, message: auth.message || NEEDS_LOGIN_MESSAGE, needsLogin: true };
      }
      token = auth.token;
    } catch (error) {
      return { ok: false, status: 0, message: `No pude comprobar la sesion de Google: ${describeError(error)}`, needsLogin: true };
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      return { ok: false, status: 0, message: `No pude conectar con Google: ${describeError(error)}`, needsLogin: false };
    }

    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
    }

    if (response.status === 401) {
      return { ok: false, status: 401, message: NEEDS_LOGIN_MESSAGE, needsLogin: true };
    }
    if (response.ok === false) {
      return {
        ok: false,
        status: response.status,
        message: `Google devolvio un error (${response.status}): ${extractGoogleError(text)}`,
        needsLogin: false,
      };
    }
    if (!text) {
      return { ok: true, status: response.status, data: {} as T };
    }
    const parsed = parseJson<T>(text);
    if (parsed === null) {
      return { ok: false, status: response.status, message: "Google respondio algo que no pude entender.", needsLogin: false };
    }
    return { ok: true, status: response.status, data: parsed };
  }

  async function listMessages(input: { query?: string; maxResults?: number } = {}): Promise<ListMessagesResult> {
    const query = input.query?.trim() || "in:inbox";
    const maxResults = clamp(input.maxResults ?? DEFAULT_MAIL_RESULTS, 1, MAX_MAIL_RESULTS);
    const listUrl = `${GMAIL_BASE}/messages?${new URLSearchParams({ q: query, maxResults: String(maxResults) }).toString()}`;
    const list = await request<{ messages?: Array<{ id?: string; threadId?: string }> }>(listUrl);
    if (list.ok === false) {
      return { ok: false, message: list.message, needsLogin: list.needsLogin, messages: [] };
    }
    const ids = (list.data.messages ?? []).map((item) => item.id).filter(isNonEmptyString).slice(0, maxResults);
    if (ids.length === 0) {
      return { ok: true, message: `No hay correos que coincidan con "${query}".`, messages: [] };
    }

    const messages: GmailMessageSummary[] = [];
    for (const id of ids) {
      const params = new URLSearchParams({ format: "metadata" });
      for (const header of ["From", "To", "Subject", "Date"]) {
        params.append("metadataHeaders", header);
      }
      const detail = await request<GmailMessage>(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}?${params.toString()}`);
      if (detail.ok === false) {
        if (detail.needsLogin) {
          return { ok: false, message: detail.message, needsLogin: true, messages: [] };
        }
        continue;
      }
      const headers = detail.data.payload?.headers ?? [];
      messages.push({
        id: detail.data.id ?? id,
        threadId: detail.data.threadId ?? "",
        from: headerValue(headers, "From"),
        to: headerValue(headers, "To"),
        subject: headerValue(headers, "Subject") || "(sin asunto)",
        date: headerValue(headers, "Date"),
        snippet: decodeEntities(detail.data.snippet ?? ""),
        unread: (detail.data.labelIds ?? []).includes("UNREAD"),
      });
    }

    return {
      ok: true,
      message: messages.length === 1 ? "He encontrado 1 correo." : `He encontrado ${messages.length} correos.`,
      messages,
    };
  }

  async function readMessage(id: string): Promise<ReadMessageResult> {
    const trimmed = String(id ?? "").trim();
    if (!trimmed) {
      return { ok: false, message: "Necesito el identificador del correo que quieres leer." };
    }
    const result = await request<GmailMessage>(`${GMAIL_BASE}/messages/${encodeURIComponent(trimmed)}?format=full`);
    if (result.ok === false) {
      return { ok: false, message: result.message, needsLogin: result.needsLogin };
    }
    const mail = parseGmailMessage(result.data, trimmed);
    return { ok: true, message: `Correo de ${mail.from || "remitente desconocido"} con asunto "${mail.subject}".`, mail };
  }

  async function sendMessage(input: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
  }): Promise<SendMessageResult> {
    const to = String(input.to ?? "").trim();
    if (!to) {
      return { ok: false, message: "Necesito la direccion de correo del destinatario." };
    }
    const raw = buildRfc5322Message({
      to,
      subject: String(input.subject ?? "").trim(),
      body: String(input.body ?? ""),
      cc: input.cc?.trim() || undefined,
      bcc: input.bcc?.trim() || undefined,
      inReplyTo: input.inReplyTo?.trim() || undefined,
      references: input.references?.trim() || undefined,
    });
    const payload: Record<string, unknown> = { raw: toBase64Url(raw) };
    if (input.threadId) {
      payload.threadId = input.threadId;
    }
    const result = await request<{ id?: string; threadId?: string }>(`${GMAIL_BASE}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (result.ok === false) {
      return { ok: false, message: `No pude enviar el correo. ${result.message}`, needsLogin: result.needsLogin };
    }
    return {
      ok: true,
      message: `Correo enviado a ${to}.`,
      id: result.data.id,
      threadId: result.data.threadId,
      raw,
    };
  }

  async function replyToMessage(input: { id: string; body: string }): Promise<SendMessageResult> {
    const original = await readMessage(input.id);
    if (!original.ok || !original.mail) {
      return { ok: false, message: `No pude leer el correo al que quieres responder. ${original.message}`, needsLogin: original.needsLogin };
    }
    const mail = original.mail;
    const to = extractAddress(mail.from);
    if (!to) {
      return { ok: false, message: "El correo original no tiene un remitente al que pueda responder." };
    }
    const subject = /^re:/i.test(mail.subject.trim()) ? mail.subject.trim() : `Re: ${mail.subject.trim()}`;
    const references = [mail.references, mail.messageIdHeader].filter(isNonEmptyString).join(" ").trim();
    const sent = await sendMessage({
      to,
      subject,
      body: String(input.body ?? ""),
      inReplyTo: mail.messageIdHeader || undefined,
      references: references || undefined,
      threadId: mail.threadId || undefined,
    });
    if (sent.ok === false) {
      return sent;
    }
    return { ...sent, message: `Respuesta enviada a ${to}.` };
  }

  async function modify(id: string, body: Record<string, unknown>, okMessage: string): Promise<ModifyMessageResult> {
    const trimmed = String(id ?? "").trim();
    if (!trimmed) {
      return { ok: false, message: "Necesito el identificador del correo." };
    }
    const result = await request<unknown>(`${GMAIL_BASE}/messages/${encodeURIComponent(trimmed)}/modify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (result.ok === false) {
      return { ok: false, message: result.message, needsLogin: result.needsLogin };
    }
    return { ok: true, message: okMessage };
  }

  async function markAsRead(id: string): Promise<ModifyMessageResult> {
    return modify(id, { removeLabelIds: ["UNREAD"] }, "He marcado el correo como leido.");
  }

  async function archive(id: string): Promise<ModifyMessageResult> {
    return modify(id, { removeLabelIds: ["INBOX"] }, "He archivado el correo.");
  }

  async function listEvents(input: { from?: string; to?: string; maxResults?: number } = {}): Promise<ListEventsResult> {
    const timeMin = toIsoOrNull(input.from) ?? new Date(Date.now()).toISOString();
    const timeMax = toIsoOrNull(input.to);
    const params = new URLSearchParams({
      timeMin,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(clamp(input.maxResults ?? DEFAULT_EVENT_RESULTS, 1, 50)),
    });
    if (timeMax) {
      params.set("timeMax", timeMax);
    }
    const result = await request<{ items?: unknown[] }>(`${CALENDAR_BASE}/calendars/primary/events?${params.toString()}`);
    if (result.ok === false) {
      return { ok: false, message: result.message, needsLogin: result.needsLogin, events: [] };
    }
    const events = (result.data.items ?? []).map(parseCalendarEvent);
    return {
      ok: true,
      message: events.length === 1 ? "Hay 1 cita." : `Hay ${events.length} citas.`,
      events,
    };
  }

  async function createEvent(input: {
    summary: string;
    start: string;
    end?: string;
    description?: string;
    location?: string;
    allDay?: boolean;
  }): Promise<CreateEventResult> {
    const summary = String(input.summary ?? "").trim();
    if (!summary) {
      return { ok: false, message: "Necesito saber de que es la cita." };
    }
    const startDate = parseDate(input.start);
    if (!startDate) {
      return { ok: false, message: "No entendi la fecha y hora de inicio de la cita." };
    }

    const allDay = Boolean(input.allDay);
    const endDate = parseDate(input.end) ?? new Date(startDate.getTime() + (allDay ? 24 : 1) * 3600 * 1000);

    const body: Record<string, unknown> = {
      summary,
      start: allDay ? { date: toDateOnly(startDate) } : { dateTime: startDate.toISOString(), timeZone },
      end: allDay ? { date: toDateOnly(endDate) } : { dateTime: endDate.toISOString(), timeZone },
    };
    if (input.description?.trim()) {
      body.description = input.description.trim();
    }
    if (input.location?.trim()) {
      body.location = input.location.trim();
    }

    const result = await request<Record<string, unknown>>(`${CALENDAR_BASE}/calendars/primary/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (result.ok === false) {
      return { ok: false, message: `No pude crear la cita. ${result.message}`, needsLogin: result.needsLogin };
    }
    return { ok: true, message: `Cita "${summary}" apuntada en tu calendario.`, event: parseCalendarEvent(result.data) };
  }

  async function deleteEvent(id: string): Promise<DeleteEventResult> {
    const trimmed = String(id ?? "").trim();
    if (!trimmed) {
      return { ok: false, message: "Necesito el identificador de la cita que quieres borrar." };
    }
    const result = await request<unknown>(`${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(trimmed)}`, {
      method: "DELETE",
    });
    if (result.ok === false) {
      return { ok: false, message: `No pude borrar la cita. ${result.message}`, needsLogin: result.needsLogin };
    }
    return { ok: true, message: "He borrado la cita del calendario." };
  }

  return {
    timeZone,
    listMessages,
    readMessage,
    sendMessage,
    replyToMessage,
    markAsRead,
    archive,
    listEvents,
    createEvent,
    deleteEvent,
  };
}

export function parseGmailMessage(message: GmailMessage, fallbackId = ""): GmailMessageDetail {
  const headers = message.payload?.headers ?? [];
  return {
    id: message.id ?? fallbackId,
    threadId: message.threadId ?? "",
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    cc: headerValue(headers, "Cc"),
    subject: headerValue(headers, "Subject") || "(sin asunto)",
    date: headerValue(headers, "Date"),
    body: extractBody(message),
    messageIdHeader: headerValue(headers, "Message-ID") || headerValue(headers, "Message-Id"),
    references: headerValue(headers, "References"),
  };
}

function extractBody(message: GmailMessage): string {
  const payload = message.payload;
  if (!payload) {
    return decodeEntities(message.snippet ?? "");
  }
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) {
    return normalizeText(decodeBase64Url(plain.body.data));
  }
  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    return normalizeText(htmlToText(decodeBase64Url(html.body.data)));
  }
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    return normalizeText(payload.mimeType === "text/html" ? htmlToText(decoded) : decoded);
  }
  return decodeEntities(message.snippet ?? "");
}

function findPart(part: GmailPart | undefined, mimeType: string): GmailPart | null {
  if (!part) {
    return null;
  }
  if (part.mimeType === mimeType && part.body?.data && !part.filename) {
    return part;
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) {
      return found;
    }
  }
  return null;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Codifica el asunto segun RFC 2047 solo si lleva acentos u otros caracteres no ASCII. */
export function encodeMimeHeader(value: string): string {
  if (!value) {
    return "";
  }
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildRfc5322Message(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers: string[] = [`To: ${input.to}`];
  if (input.cc) {
    headers.push(`Cc: ${input.cc}`);
  }
  if (input.bcc) {
    headers.push(`Bcc: ${input.bcc}`);
  }
  headers.push(`Subject: ${encodeMimeHeader(input.subject)}`);
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${input.inReplyTo}`);
  }
  if (input.references) {
    headers.push(`References: ${input.references}`);
  }
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: base64");

  const encodedBody = wrap(Buffer.from(input.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"), 76);
  return `${headers.join("\r\n")}\r\n\r\n${encodedBody}\r\n`;
}

function wrap(value: string, width: number): string {
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += width) {
    lines.push(value.slice(index, index + width));
  }
  return lines.join("\r\n");
}

export function extractAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value ?? "");
  if (angled?.[1]) {
    return angled[1].trim();
  }
  return (value ?? "").trim();
}

function parseCalendarEvent(raw: unknown): CalendarEventSummary {
  const event = (raw ?? {}) as {
    id?: string;
    summary?: string;
    location?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  };
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  return {
    id: event.id ?? "",
    summary: event.summary ?? "(sin titulo)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    location: event.location ?? "",
    allDay,
  };
}

function headerValue(headers: GmailHeader[], name: string): string {
  const lowered = name.toLowerCase();
  for (const header of headers) {
    if (typeof header?.name === "string" && header.name.toLowerCase() === lowered) {
      return typeof header.value === "string" ? header.value : "";
    }
  }
  return "";
}

function extractGoogleError(text: string): string {
  const parsed = parseJson<{ error?: unknown; error_description?: unknown }>(text);
  const error = parsed?.error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (typeof parsed?.error_description === "string") {
    return parsed.error_description;
  }
  if (typeof error === "string") {
    return error;
  }
  return text ? truncate(text, 300) : "sin detalles";
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

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoOrNull(value: unknown): string | null {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clamp(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}
