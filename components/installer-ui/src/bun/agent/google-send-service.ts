import type { createConfirmationStore } from "./confirmations";
import type { createToolRunner } from "./tool-runner";

export type GoogleSendOutcome = {
  ok: boolean;
  status: "completed" | "confirmation_required" | "denied" | "cancelled" | "failed";
  message: string;
  confirmationId?: string;
  needsLogin?: boolean;
};

export type GoogleSendServiceOptions = {
  toolRunner: ReturnType<typeof createToolRunner>;
  confirmations: ReturnType<typeof createConfirmationStore>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// La pregunta se construye con los datos reales del envio para que el usuario
// oiga a quien va y con que asunto, no un "¿confirmas?" a ciegas.
export function describeGoogleSend(action: string, input: unknown): string {
  const record = asRecord(input);
  const payload = asRecord(record.input);
  switch (action) {
    case "sendMessage": {
      const to = asText(payload.to) || "el destinatario indicado";
      const subject = asText(payload.subject);
      return `Voy a enviar un correo a ${to}${subject ? ` con el asunto «${subject}»` : ""}. ¿Lo envío?`;
    }
    case "replyToMessage":
      return "Voy a enviar la respuesta a ese correo. ¿La envío?";
    case "createEvent": {
      const summary = asText(payload.summary) || "la cita";
      const start = asText(payload.start);
      return `Voy a apuntar «${summary}»${start ? ` el ${start}` : ""} en tu calendario. ¿Lo hago?`;
    }
    case "deleteEvent":
      return "Voy a borrar esa cita de tu calendario. Esto no se puede deshacer. ¿La borro?";
    default:
      return "Voy a hacer este cambio en tu cuenta de Google. ¿Sigo?";
  }
}

function resultFrom(output: unknown, fallback: string): GoogleSendOutcome {
  const record = asRecord(output);
  const ok = record.ok !== false;
  return {
    ok,
    status: ok ? "completed" : "failed",
    message: asText(record.message) || fallback,
    ...(record.needsLogin === true ? { needsLogin: true } : {}),
    ...(record as Record<string, unknown>),
  } as GoogleSendOutcome;
}

export function createGoogleSendService(options: GoogleSendServiceOptions) {
  return {
    async request(action: string, payload: unknown): Promise<GoogleSendOutcome> {
      const input = { action, input: payload };
      const result = await options.toolRunner.run({
        source: "ui",
        tool: "google.send",
        input,
        explicitUserIntent: true,
      });

      if (result.decision === "confirm") {
        return {
          ok: false,
          status: "confirmation_required",
          ...(result.confirmationId ? { confirmationId: result.confirmationId } : {}),
          message: describeGoogleSend(action, input),
        };
      }
      if (result.decision === "deny") {
        return {
          ok: false,
          status: "denied",
          message: result.message ?? "El broker no permitió esa acción; no se envió nada.",
        };
      }
      return resultFrom(result.output, result.message ?? "Hecho.");
    },

    async confirm(confirmationId: string): Promise<GoogleSendOutcome> {
      const pending = options.confirmations.get(confirmationId);
      if (!pending || pending.tool !== "google.send") {
        return { ok: false, status: "failed", message: "No encuentro un envío pendiente con ese identificador." };
      }
      if (pending.status !== "pending") {
        return {
          ok: false,
          status: "failed",
          message: `Ese envío ya fue ${pending.status === "confirmed" ? "confirmado" : "cancelado"}; no lo he repetido.`,
        };
      }
      const confirmed = options.confirmations.confirm(confirmationId, "ui");
      if (!confirmed) {
        return { ok: false, status: "failed", message: "No pude registrar la confirmación; no se envió nada." };
      }
      const execution = await options.toolRunner.executeConfirmed(confirmed);
      if (execution.decision === "deny") {
        return { ok: false, status: "denied", message: execution.message ?? "La política rechazó el envío." };
      }
      return resultFrom(execution.output, execution.message ?? "Hecho.");
    },

    deny(confirmationId: string): GoogleSendOutcome {
      const pending = options.confirmations.get(confirmationId);
      if (!pending || pending.tool !== "google.send" || pending.status !== "pending") {
        return { ok: false, status: "failed", message: "No encuentro un envío pendiente que pueda cancelar." };
      }
      options.confirmations.deny(confirmationId, "ui");
      return { ok: true, status: "cancelled", message: "Cancelado; no he enviado nada." };
    },
  };
}
