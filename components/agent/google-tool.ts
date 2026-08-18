import type { GoogleApi, CalendarEventSummary, GmailMessageSummary } from "./google-api";
import type { GoogleAuth } from "./google-auth";

type ToolUpdateCallback = (update: {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
}) => void;

type PiCustomToolLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
};

export type GoogleSendConfirmations = {
  confirm(confirmationId: string): Promise<{ ok: boolean; message: string }>;
  deny(confirmationId: string): { ok: boolean; message: string } | Promise<{ ok: boolean; message: string }>;
};

export type GoogleToolServices = {
  pending?: GoogleSendConfirmations;
  auth: Pick<GoogleAuth, "status" | "startLogin" | "waitForLogin" | "logout">;
  api: Pick<
    GoogleApi,
    "listMessages" | "readMessage" | "sendMessage" | "replyToMessage" | "markAsRead" | "listEvents" | "createEvent" | "deleteEvent"
  >;
};

const GOOGLE_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "status",
        "login",
        "mail_list",
        "mail_read",
        "mail_send",
        "mail_reply",
        "mail_mark_read",
        "calendar_list",
        "calendar_add",
        "calendar_delete",
        "confirm_send",
        "deny_send",
        "logout",
      ],
      description: "mail_list lista correos, mail_read lee uno entero, mail_send envía uno nuevo, mail_reply responde a uno existente, calendar_list muestra las citas y calendar_add crea una.",
    },
    id: { type: "string", description: "Identificador del correo o de la cita, tomado de una lista previa." },
    confirmationId: { type: "string", description: "Identificador que devuelve el broker cuando un envío queda pendiente de confirmación. Obligatorio en confirm_send y deny_send." },
    query: { type: "string", description: "Búsqueda de Gmail, por ejemplo is:unread o from:marta. Por defecto la bandeja de entrada." },
    to: { type: "string", description: "Destinatario del correo en mail_send." },
    subject: { type: "string", description: "Asunto del correo en mail_send." },
    body: { type: "string", description: "Texto del correo en mail_send y mail_reply." },
    summary: { type: "string", description: "De qué es la cita en calendar_add." },
    start: { type: "string", description: "Inicio de la cita en ISO, por ejemplo 2026-08-25T10:00:00." },
    end: { type: "string", description: "Fin de la cita en ISO. Si falta, dura una hora." },
    location: { type: "string", description: "Lugar de la cita." },
    description: { type: "string", description: "Detalles de la cita." },
    allDay: { type: "boolean", description: "La cita ocupa todo el día." },
    from: { type: "string", description: "Fecha desde la que listar citas en calendar_list." },
    to_date: { type: "string", description: "Fecha hasta la que listar citas en calendar_list." },
    maxResults: { type: "number", description: "Cuántos resultados devolver." },
  },
  required: ["action"],
  additionalProperties: false,
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function result(ok: boolean, text: string, details?: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    details: details ?? { ok, message: text },
  };
}

function formatMailList(messages: GmailMessageSummary[]): string {
  if (messages.length === 0) {
    return "No hay correos que coincidan.";
  }
  return messages
    .map((mail, index) => {
      const marker = mail.unread ? "· sin leer" : "";
      return [
        `${index + 1}. De ${mail.from || "remitente desconocido"} ${marker}`.trim(),
        `   Asunto: ${mail.subject || "(sin asunto)"}`,
        `   Fecha: ${mail.date || "desconocida"}`,
        mail.snippet ? `   ${mail.snippet}` : "",
        `   id: ${mail.id}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function formatEvents(events: CalendarEventSummary[]): string {
  if (events.length === 0) {
    return "No hay citas en ese periodo.";
  }
  return events
    .map((event, index) => {
      const when = event.allDay ? `${event.start} (todo el día)` : `${event.start} → ${event.end}`;
      return [
        `${index + 1}. ${event.summary || "(sin título)"}`,
        `   Cuándo: ${when}`,
        event.location ? `   Dónde: ${event.location}` : "",
        `   id: ${event.id}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

// Cuando falta la sesion, el tool no puede limitarse a fallar: tiene que
// decirle al modelo cual es el siguiente paso, o el agente se queda parado
// delante del usuario sin saber pedir el inicio de sesion.
const LOGIN_HINT =
  "No hay sesión de Google iniciada. Llama a este mismo tool con action \"login\" y dale al usuario la dirección que te devuelva para que entre con su cuenta.";

export function createGoogleModelTool(services: GoogleToolServices): PiCustomToolLike {
  const { auth, api } = services;

  function needsLogin(outcome: { needsLogin?: boolean }): boolean {
    return outcome.needsLogin === true;
  }

  return {
    name: "google_workspace",
    label: "Correo y calendario de Google",
    description: "Lee y envía el correo de Gmail del usuario y gestiona las citas de su Google Calendar.",
    promptSnippet: "google_workspace: lee y envía el correo real del usuario y gestiona su calendario de Google.",
    promptGuidelines: [
      "Cuando el usuario hable de su correo, sus mails, su calendario o sus citas, usa este tool. No abras Gmail ni Google Calendar en el navegador para algo que puedas hacer aquí.",
      "Si el tool te dice que no hay sesión, llama a action \"login\" y dile al usuario, con sus palabras, que abra la dirección devuelta y entre con su cuenta de Google. Cuando te confirme que ha terminado, repite la acción original.",
      "Para responder a un correo usa mail_reply con el id del correo original: así la respuesta se queda en la misma conversación.",
      "Antes de enviar o responder, léele al usuario a quién va dirigido y el texto completo, y espera su sí.",
      "El broker devuelve los envíos como pendientes con un confirmationId y una pregunta: trasládasela tal cual al usuario y no confirmes nunca en el mismo turno. Cuando diga que sí, llama con action \"confirm_send\" y ese confirmationId; si dice que no, con \"deny_send\".",
      "Nunca inventes el contenido de un correo ni de una cita: si no lo has leído con mail_read o calendar_list, no lo sabes.",
      "Nunca digas que has enviado un correo o creado una cita si el tool no te ha devuelto ok.",
      "Para fechas relativas (mañana, el martes) calcula la fecha concreta en ISO antes de llamar.",
    ],
    parameters: GOOGLE_TOOL_PARAMETERS,
    async execute(_toolCallId, params, _signal, onUpdate) {
      const action = asText(params.action);

      try {
        switch (action) {
          case "confirm_send":
          case "deny_send": {
            const confirmationId = asText(params.confirmationId).trim();
            if (!confirmationId) {
              return result(false, "Necesito el confirmationId del envío pendiente.");
            }
            if (!services.pending) {
              return result(false, "Este entorno no puede confirmar envíos pendientes.");
            }
            const outcome = action === "confirm_send"
              ? await services.pending.confirm(confirmationId)
              : await services.pending.deny(confirmationId);
            return result(outcome.ok, outcome.message, outcome);
          }

          case "status": {
            const status = await auth.status();
            return result(status.ok, status.message, status);
          }

          case "login": {
            const started = await auth.startLogin();
            if (!started.ok) {
              return result(false, started.message, started);
            }
            onUpdate?.({
              content: [{ type: "text", text: "Esperando a que el usuario complete el inicio de sesión en Google…" }],
              details: started,
            });
            const completed = await auth.waitForLogin();
            const text = completed.ok
              ? `${completed.message} La cuenta conectada es ${completed.account ?? "desconocida"}.`
              : `${started.message}\n\n${completed.message}`;
            return result(completed.ok, text, { ...started, ...completed });
          }

          case "logout": {
            const outcome = await auth.logout();
            return result(outcome.ok, outcome.message, outcome);
          }

          case "mail_list": {
            const outcome = await api.listMessages({
              ...(asText(params.query).trim() ? { query: asText(params.query) } : {}),
              ...(typeof params.maxResults === "number" ? { maxResults: params.maxResults } : {}),
            });
            if (!outcome.ok) {
              return result(false, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
            }
            return result(true, formatMailList(outcome.messages), outcome);
          }

          case "mail_read": {
            const id = asText(params.id).trim();
            if (!id) {
              return result(false, "Necesito el id del correo; sácalo de un mail_list.");
            }
            const outcome = await api.readMessage(id);
            if (!outcome.ok || !outcome.mail) {
              return result(false, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
            }
            const mail = outcome.mail;
            const text = [
              `De: ${mail.from}`,
              `Para: ${mail.to}`,
              mail.cc ? `Cc: ${mail.cc}` : "",
              `Fecha: ${mail.date}`,
              `Asunto: ${mail.subject}`,
              "",
              mail.body,
            ]
              .filter(Boolean)
              .join("\n");
            return result(true, text, outcome);
          }

          case "mail_send": {
            const to = asText(params.to).trim();
            const body = asText(params.body);
            if (!to) {
              return result(false, "Necesito el destinatario del correo.");
            }
            if (!body.trim()) {
              return result(false, "Necesito el texto del correo.");
            }
            const outcome = await api.sendMessage({
              to,
              subject: asText(params.subject),
              body,
            });
            return result(outcome.ok, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
          }

          case "mail_reply": {
            const id = asText(params.id).trim();
            const body = asText(params.body);
            if (!id) {
              return result(false, "Necesito el id del correo al que respondo; sácalo de un mail_list.");
            }
            if (!body.trim()) {
              return result(false, "Necesito el texto de la respuesta.");
            }
            const outcome = await api.replyToMessage({ id, body });
            return result(outcome.ok, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
          }

          case "mail_mark_read": {
            const id = asText(params.id).trim();
            if (!id) {
              return result(false, "Necesito el id del correo que quieres marcar como leído.");
            }
            const outcome = await api.markAsRead(id);
            return result(outcome.ok, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
          }

          case "calendar_list": {
            const outcome = await api.listEvents({
              ...(asText(params.from).trim() ? { from: asText(params.from) } : {}),
              ...(asText(params.to_date).trim() ? { to: asText(params.to_date) } : {}),
              ...(typeof params.maxResults === "number" ? { maxResults: params.maxResults } : {}),
            });
            if (!outcome.ok) {
              return result(false, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
            }
            return result(true, formatEvents(outcome.events), outcome);
          }

          case "calendar_add": {
            const summary = asText(params.summary).trim();
            const start = asText(params.start).trim();
            if (!summary) {
              return result(false, "Necesito saber de qué es la cita.");
            }
            if (!start) {
              return result(false, "Necesito la fecha y hora de inicio de la cita.");
            }
            const outcome = await api.createEvent({
              summary,
              start,
              ...(asText(params.end).trim() ? { end: asText(params.end) } : {}),
              ...(asText(params.description).trim() ? { description: asText(params.description) } : {}),
              ...(asText(params.location).trim() ? { location: asText(params.location) } : {}),
              ...(typeof params.allDay === "boolean" ? { allDay: params.allDay } : {}),
            });
            return result(outcome.ok, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
          }

          case "calendar_delete": {
            const id = asText(params.id).trim();
            if (!id) {
              return result(false, "Necesito el id de la cita que quieres borrar.");
            }
            const outcome = await api.deleteEvent(id);
            return result(outcome.ok, needsLogin(outcome) ? LOGIN_HINT : outcome.message, outcome);
          }

          default:
            return result(false, `No conozco la acción «${action}» de google_workspace.`);
        }
      } catch (error) {
        return result(false, error instanceof Error ? error.message : "No pude hablar con Google.");
      }
    },
  };
}
