import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedReply } from "../../../agent/improvements-types";
import { improvementsClient } from "../lib/clients";
import { Button, Panel, PanelInset } from "./ui";

export function SavedRepliesPanel({ client = improvementsClient }) {
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const result = await client.listSavedReplies(query, offset);
      if (id !== requestId.current) return;
      setReplies(result);
      setError("");
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : "No se pudieron leer las respuestas.");
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [client, query, offset]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 250);
    return () => { clearTimeout(timer); requestId.current++; };
  }, [refresh]);

  async function forget(turnId: string) {
    try {
      await client.forgetSavedReply(turnId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo borrar la respuesta.");
    }
  }

  return (
    <Panel title="Respuestas guardadas" description="Aquí están las respuestas que marcaste en la conversación. Se conservan en este ordenador."
      actions={<Button size="sm" loading={busy} onClick={() => void refresh()}>Actualizar respuestas</Button>}>
      <input aria-label="Buscar respuestas guardadas" className="field-input" type="search" value={query}
        onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      {!busy && !replies.length ? <p className="mt-3 text-ink-muted">No hay respuestas guardadas que mostrar.</p> : null}
      <div className="mt-3 grid gap-3" aria-busy={busy}>
        {replies.map((reply) => (
          <PanelInset key={reply.turnId}>
            <details>
              <summary className="cursor-pointer whitespace-pre-wrap break-words">{reply.input}</summary>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm">{reply.reply}</p>
              <Button size="sm" variant="danger" onClick={() => void forget(reply.turnId)}>Borrar respuesta guardada</Button>
            </details>
          </PanelInset>
        ))}
      </div>
      {offset > 0 || replies.length === 50 ? <div className="mt-3 flex gap-2">
        <Button disabled={offset === 0 || busy} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Anteriores</Button>
        <Button disabled={replies.length < 50 || busy} onClick={() => setOffset((value) => value + 50)}>Siguientes</Button>
      </div> : null}
    </Panel>
  );
}
