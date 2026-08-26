import { useCallback, useEffect, useRef, useState } from "react";

import type { createPiClient } from "../lib/pi-client";
import type {
  PiAuthMethod,
  PiAuthState,
  PiPendingAttempt,
  PiStatusResponse,
} from "../lib/pi-types";
import { useLatest } from "./useLatest";
import type { AlertSink } from "./useSystemAlert";

type PiClient = ReturnType<typeof createPiClient>;

const ATTEMPT_POLL_INTERVAL_MS = 1_250;

export type PiSession = {
  /** El servicio de Pi responde. */
  ready: boolean;
  authState: PiAuthState;
  providerName: string;
  modelId: string;
  /** El servicio está atendiendo otra petición. */
  busy: boolean;
  pendingAttempt: PiPendingAttempt | null;
  manualCode: string;
  setManualCode: (value: string) => void;
  refresh: (options?: { clearErrors?: boolean }) => Promise<PiStatusResponse>;
  startAuth: (method?: PiAuthMethod) => Promise<void>;
  cancelAuth: () => Promise<void>;
  logout: () => Promise<void>;
  submitManualCode: () => Promise<void>;
  /** El servidor ha rechazado la sesión: la cuenta necesita reconectarse. */
  markUnauthorized: () => void;
  noteModelId: (modelId: string) => void;
};

export type UsePiSessionOptions = {
  client: PiClient;
  alert: AlertSink;
};

/**
 * Sesión con Pi: disponibilidad del servicio, identidad del proveedor y todo el
 * ciclo de autenticación (inicio, sondeo del intento, código manual, cierre).
 *
 * Antes vivía disperso en App.tsx junto al chat y a los workspaces, lo que hacía
 * imposible razonar sobre qué re-render disparaba qué sondeo.
 */
export function usePiSession({ client, alert }: UsePiSessionOptions): PiSession {
  const [ready, setReady] = useState(true);
  const [authState, setAuthState] = useState<PiAuthState>("disconnected");
  const [providerName, setProviderName] = useState("ChatGPT/Codex");
  const [modelId, setModelId] = useState("gpt-5.6-sol");
  const [busy, setBusy] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState<PiPendingAttempt | null>(null);
  const [manualCode, setManualCode] = useState("");

  /** Descarta respuestas de intentos de login que ya han sido reemplazados. */
  const authActionIdRef = useRef(0);

  const applyStatus = useCallback((status: PiStatusResponse) => {
    setReady(true);
    setProviderName(status.providerName);
    setModelId(status.modelId);
    setBusy(status.busy);
    setPendingAttempt(status.pendingAttempt ?? null);
    setAuthState(status.authState);
  }, []);

  const refresh = useCallback(
    async (options: { clearErrors?: boolean } = {}) => {
      try {
        const status = await client.getStatus();
        applyStatus(status);

        if (status.error) {
          alert.raise(status.error);
        } else if (options.clearErrors) {
          alert.clear();
        } else {
          // Si el aviso era "el servicio no responde" y acaba de responder, sobra.
          alert.clearIf((current) => current.kind === "unreachable");
        }

        return status;
      } catch (error) {
        setReady(false);
        setAuthState("error");
        setBusy(false);
        setPendingAttempt(null);
        alert.raise(error);
        throw error;
      }
    },
    [alert, applyStatus, client],
  );

  const startAuth = useCallback(
    async (method: PiAuthMethod = "device") => {
      const actionId = authActionIdRef.current + 1;
      authActionIdRef.current = actionId;
      alert.clear();
      setAuthState("authorizing");

      try {
        const attempt = await client.startAuth(method);
        if (authActionIdRef.current !== actionId) {
          return;
        }

        setPendingAttempt(attempt);
        setManualCode("");

        if (method === "browser" && !window.open(attempt.url, "_blank", "noopener")) {
          alert.raise("No se pudo abrir una pestaña nueva. Pega el código a mano.", {
            kind: "login",
          });
        }
      } catch (error) {
        if (authActionIdRef.current !== actionId) {
          return;
        }

        setAuthState("error");
        alert.raise(error, { kind: "login" });
      }
    },
    [alert, client],
  );

  const cancelAuth = useCallback(async () => {
    if (!pendingAttempt) {
      return;
    }

    authActionIdRef.current += 1;
    alert.clear();

    try {
      await client.cancelAuth(pendingAttempt.attemptId);
      setPendingAttempt(null);
      setManualCode("");
      setBusy(false);
      setAuthState("disconnected");
      await refresh({ clearErrors: true });
    } catch (error) {
      setAuthState("error");
      alert.raise(error);
    }
  }, [alert, client, pendingAttempt, refresh]);

  const logout = useCallback(async () => {
    authActionIdRef.current += 1;
    alert.clear();

    try {
      await client.logout();
      setPendingAttempt(null);
      setManualCode("");
      setBusy(false);
      setAuthState("disconnected");
    } catch (error) {
      alert.raise(error);
    }
  }, [alert, client]);

  const submitManualCode = useCallback(async () => {
    if (!pendingAttempt) {
      return;
    }

    try {
      await client.submitManualCode(pendingAttempt.attemptId, manualCode);
      setManualCode("");
      alert.clear();
    } catch (error) {
      alert.raise(error, { kind: "login" });
    }
  }, [alert, client, manualCode, pendingAttempt]);

  const markUnauthorized = useCallback(() => {
    setAuthState("error");
  }, []);

  const noteModelId = useCallback((next: string) => {
    setModelId(next);
  }, []);

  // Sondeo del intento de login en curso.
  const attemptId = pendingAttempt?.attemptId ?? null;

  const pollAttempt = useCallback(async () => {
    if (!attemptId) {
      return;
    }

    try {
      const attempt = await client.getAuthAttempt(attemptId);

      if (attempt.status === "pending") {
        return;
      }

      if (attempt.status === "success") {
        setManualCode("");
        alert.clear();
        await refresh();
        return;
      }

      setAuthState("error");
      setPendingAttempt(null);
      alert.raise(attempt.error ?? "No se pudo completar el login.", { kind: "login" });
    } catch (error) {
      setAuthState("error");
      setPendingAttempt(null);
      alert.raise(error, { kind: "login" });
    }
  }, [alert, attemptId, client, refresh]);

  // La ref evita que el intervalo se reinicie cada vez que cambia el callback.
  const pollAttemptRef = useLatest(pollAttempt);

  useEffect(() => {
    if (!attemptId) {
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) {
        return;
      }
      void pollAttemptRef.current();
    };

    tick();
    const intervalId = window.setInterval(tick, ATTEMPT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [attemptId, pollAttemptRef]);

  return {
    ready,
    authState,
    providerName,
    modelId,
    busy,
    pendingAttempt,
    manualCode,
    setManualCode,
    refresh,
    startAuth,
    cancelAuth,
    logout,
    submitManualCode,
    markUnauthorized,
    noteModelId,
  };
}
