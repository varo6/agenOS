import type { PiTurnState } from "./pi-types";
import type { AgenosTtsBridge } from "./tts-bridge";
import { speechChunks } from "./speech-text";

type Utterance = { turnId: string; messageId: number; afterTools: number; text: string };
type TurnCursor = { muted: boolean; offsets: Map<number, number>; skipped: Set<number>; legacyRead: boolean };

export function createTtsNarrator(options: { getBridge: () => AgenosTtsBridge | null; onSpeaking: (speaking: boolean) => void; mountedAt: number }) {
  const cursors = new Map<string, TurnCursor>();
  let initialized = false;
  let latest: PiTurnState | undefined;
  let queue: Utterance[] = [];
  let active: { bridge: AgenosTtsBridge; token: symbol } | null = null;
  let stopping: Promise<void> | null = null;
  let disposed = false;

  function halt() {
    queue = [];
    const previous = active;
    active = null;
    if (!disposed) options.onSpeaking(false);
    if (previous) {
      const pending = previous.bridge.stop().catch(() => undefined);
      stopping = pending;
      void pending.finally(() => {
        if (stopping === pending) { stopping = null; pump(); }
      });
    }
  }

  function isCurrent(item: Utterance): boolean {
    if (!latest || item.turnId !== latest.turnId || cursors.get(item.turnId)?.muted) return false;
    if (latest.status === "failed" || latest.status === "cancelled") return false;
    const messages = latest.progress.speechMessages;
    if (!messages) return true;
    const last = messages[messages.length - 1];
    return item.afterTools === latest.progress.completedTools.length && item.messageId === last?.id;
  }

  function pump() {
    if (disposed || active || stopping) return;
    queue = queue.filter(isCurrent);
    const item = queue.shift();
    if (!item) { options.onSpeaking(false); return; }
    const bridge = options.getBridge();
    if (!bridge?.isAvailable()) { queue = []; options.onSpeaking(false); return; }
    const token = Symbol();
    active = { bridge, token };
    options.onSpeaking(true);
    let speech: ReturnType<AgenosTtsBridge["speak"]>;
    try { speech = bridge.speak(item.text); }
    catch { speech = Promise.reject(new Error("TTS no disponible.")); }
    void speech.then((outcome) => {
      if (!outcome.ok && active?.token === token) {
        const cursor = cursors.get(item.turnId);
        if (cursor) cursor.muted = true;
        queue = [];
      }
    }).catch(() => {
      if (active?.token === token) {
        const cursor = cursors.get(item.turnId);
        if (cursor) cursor.muted = true;
        queue = [];
      }
    }).finally(() => {
      if (active?.token === token) { active = null; pump(); }
    });
  }

  function update(turns: PiTurnState[]) {
    if (disposed) return;
    if (!initialized) {
      initialized = true;
      for (const turn of turns) cursors.set(turn.turnId, {
        muted: turn.status !== "processing", offsets: new Map(), legacyRead: false,
        skipped: new Set(turn.progress.speechMessages?.map((message) => message.id)),
      });
    }
    const next = turns[turns.length - 1];
    if (latest?.turnId !== next?.turnId) halt();
    latest = next;
    if (!next) return;
    let cursor = cursors.get(next.turnId);
    if (!cursor) {
      const restored = next.status === "processing"
        ? Date.parse(next.startedAt) < options.mountedAt
        : Boolean(next.finishedAt && Date.parse(next.finishedAt) <= options.mountedAt);
      cursor = { muted: restored && next.status !== "processing", offsets: new Map(), legacyRead: false,
        skipped: new Set(restored ? next.progress.speechMessages?.map((message) => message.id) : []),
      };
      cursors.set(next.turnId, cursor);
    }
    const retained = new Set(turns.map((turn) => turn.turnId));
    for (const id of cursors.keys()) if (!retained.has(id)) cursors.delete(id);
    if (next.status === "cancelled" || next.status === "failed") { cursor.muted = true; halt(); return; }
    if (cursor.muted) return;

    const messages = next.progress.speechMessages;
    if (messages) {
      const messageIds = new Set(messages.map((message) => message.id));
      for (const id of cursor.offsets.keys()) if (!messageIds.has(id)) cursor.offsets.delete(id);
      for (const id of cursor.skipped) if (!messageIds.has(id)) cursor.skipped.delete(id);
      for (const message of messages) {
        const offset = cursor.offsets.get(message.id) ?? 0;
        const relevant = message.id === messages[messages.length - 1]?.id && message.afterTools === next.progress.completedTools.length;
        if (!relevant || cursor.skipped.has(message.id)) {
          cursor.offsets.set(message.id, message.text.length);
          continue;
        }
        const fresh = speechChunks(message.text, offset, message.complete || next.status === "succeeded");
        cursor.offsets.set(message.id, fresh.offset);
        queue.push(...fresh.texts.map((text) => ({ turnId: next.turnId, messageId: message.id, afterTools: message.afterTools, text })));
      }
    } else if (next.status === "succeeded" && !cursor.legacyRead && next.reply) {
      // Los runtimes anteriores no separan los mensajes del asistente.
      cursor.legacyRead = true;
      queue.push(...speechChunks(next.reply, 0, true).texts.map((text) => ({ turnId: next.turnId, messageId: 0, afterTools: 0, text })));
    }
    pump();
  }

  return {
    update,
    stop() {
      if (latest) {
        const cursor = cursors.get(latest.turnId);
        if (cursor) cursor.muted = true;
      }
      halt();
    },
    dispose() { disposed = true; halt(); },
  };
}
