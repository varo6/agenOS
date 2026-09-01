import { Cloud, CloudOff, KeyRound, Laptop } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { getRemoteBridge, type RemoteSecretName, type RemoteServicesPatch, type RemoteServicesView } from "../../lib/remote-bridge";
import { Alert, Button, Field, Panel, PanelInset, Pill } from "../ui";

/**
 * Interruptor de los servicios de voz en la nube.
 *
 * Son dos decisiones independientes y en este orden: primero quién entiende lo
 * que dices, después quién te contesta. Se pueden encender por separado porque
 * el dictado es el que más CPU consume y hay quien solo querrá mover ese.
 *
 * La clave de API nunca vuelve del proceso principal: el panel solo sabe si
 * está guardada, así que el campo siempre aparece vacío.
 */

/** Modelos de Groq, duplicados aquí para no meter código de Node en el bundle. */
const GROQ_MODELS = [
  { id: "whisper-large-v3-turbo", label: "Rápido (recomendado)" },
  { id: "whisper-large-v3", label: "Preciso" },
] as const;

/** Voces castellanas de Azure. */
const AZURE_VOICES = [
  { id: "es-ES-ElviraNeural", label: "Elvira (femenina)" },
  { id: "es-ES-AlvaroNeural", label: "Álvaro (masculina)" },
  { id: "es-ES-XimenaNeural", label: "Ximena (femenina)" },
  { id: "es-ES-ArabellaNeural", label: "Arabella (femenina)" },
  { id: "es-ES-TristanNeural", label: "Tristán (masculina)" },
] as const;

export function RemoteServicesPanel() {
  const bridge = useMemo(() => getRemoteBridge(), []);
  const [view, setView] = useState<RemoteServicesView | null>(null);
  const [groqKey, setGroqKey] = useState("");
  const [azureKey, setAzureKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!bridge?.isAvailable()) return;

    void bridge.get()
      .then((next) => {
        if (active) setView(next);
      })
      .catch(() => {
        if (active) setMessage("No se han podido leer los ajustes de la nube.");
      });

    return () => { active = false; };
  }, [bridge]);

  async function apply(patch: RemoteServicesPatch, note: string) {
    if (!bridge) return;
    try {
      setView(await bridge.update(patch));
      setMessage(note);
    } catch {
      setMessage("No se ha podido guardar el cambio.");
    }
  }

  async function saveKey(name: RemoteSecretName, value: string, clear: () => void) {
    if (!bridge) return;
    try {
      setView(await bridge.setSecret(name, value));
      // El campo se vacía siempre: la clave ya está guardada y no debe quedarse
      // a la vista de quien pase por delante del portátil.
      clear();
      setMessage(value.trim() ? "Clave guardada." : "Clave borrada.");
    } catch {
      setMessage("No se ha podido guardar la clave.");
    }
  }

  // Sin puente no hay nada que ajustar: el panel se calla en vez de enseñar
  // controles muertos.
  if (!bridge?.isAvailable() || !view) {
    return null;
  }

  return (
    <Panel
      description="Puedes dejar que el dictado y la voz se hagan en internet en vez de en el ordenador. Va más rápido y libera el equipo, pero necesita conexión y envía el audio a un servicio externo."
      title="Voz en la nube"
    >
      <div className="grid gap-5">
        <PanelInset>
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-base font-medium text-ink">Dictado (lo que dices)</h3>
              <Pill dot tone={view.stt.active ? "accent" : "neutral"}>
                {view.stt.active ? "En la nube (Groq)" : "En el equipo"}
              </Pill>
            </div>

            <Button
              aria-pressed={view.stt.enabled}
              icon={view.stt.enabled
                ? <Laptop aria-hidden="true" className="h-5 w-5" />
                : <Cloud aria-hidden="true" className="h-5 w-5" />}
              onClick={() => void apply(
                { stt: { enabled: !view.stt.enabled } },
                view.stt.enabled ? "El dictado vuelve al equipo." : "El dictado pasa a la nube.",
              )}
            >
              {view.stt.enabled ? "Volver al dictado del equipo" : "Usar dictado en la nube"}
            </Button>

            {view.stt.enabled && !view.stt.keyConfigured ? (
              <Alert title="Falta la clave de Groq" tone="warning">
                Hasta que la escribas aquí abajo se seguirá usando el dictado del equipo.
              </Alert>
            ) : null}

            <form
              className="grid gap-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void saveKey("groqApiKey", groqKey, () => setGroqKey(""));
              }}
            >
              <Field
                autoComplete="off"
                hint={view.stt.keyConfigured
                  ? "Ya hay una clave guardada. Escribe otra para reemplazarla o guarda el campo vacío para borrarla."
                  : "Se consigue gratis en console.groq.com."}
                label="Clave de Groq"
                onChange={(event) => setGroqKey(event.target.value)}
                placeholder={view.stt.keyConfigured ? "Clave guardada" : "gsk_..."}
                type="password"
                value={groqKey}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button icon={<KeyRound aria-hidden="true" className="h-5 w-5" />} size="sm" type="submit">
                  Guardar clave
                </Button>
                {view.stt.keyConfigured ? <Pill tone="positive">Clave guardada</Pill> : null}
              </div>
            </form>

            <label className="grid gap-2 text-sm text-ink-muted" htmlFor="remote-stt-model">
              <span className="eyebrow">Calidad del dictado</span>
              <select
                className="field-input"
                id="remote-stt-model"
                onChange={(event) => void apply({ stt: { model: event.target.value } }, "Modelo actualizado.")}
                value={view.stt.model}
              >
                {GROQ_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
          </div>
        </PanelInset>

        <PanelInset>
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-base font-medium text-ink">Voz (lo que te contesta)</h3>
              <Pill dot tone={view.tts.active ? "accent" : "neutral"}>
                {view.tts.active ? "En la nube (Azure)" : "En el equipo"}
              </Pill>
            </div>

            <Button
              aria-pressed={view.tts.enabled}
              icon={view.tts.enabled
                ? <CloudOff aria-hidden="true" className="h-5 w-5" />
                : <Cloud aria-hidden="true" className="h-5 w-5" />}
              onClick={() => void apply(
                { tts: { enabled: !view.tts.enabled } },
                view.tts.enabled ? "La voz vuelve al equipo." : "La voz pasa a la nube.",
              )}
            >
              {view.tts.enabled ? "Volver a la voz del equipo" : "Usar voz en la nube"}
            </Button>

            {view.tts.enabled && !view.tts.keyConfigured ? (
              <Alert title="Falta la clave de Azure" tone="warning">
                Hasta que la escribas aquí abajo se seguirá usando la voz del equipo.
              </Alert>
            ) : null}

            <form
              className="grid gap-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void saveKey("azureSpeechKey", azureKey, () => setAzureKey(""));
              }}
            >
              <Field
                autoComplete="off"
                hint={view.tts.keyConfigured
                  ? "Ya hay una clave guardada. Escribe otra para reemplazarla o guarda el campo vacío para borrarla."
                  : "Se consigue en el portal de Azure, en un recurso de Speech."}
                label="Clave de Azure Speech"
                onChange={(event) => setAzureKey(event.target.value)}
                placeholder={view.tts.keyConfigured ? "Clave guardada" : "Clave del recurso"}
                type="password"
                value={azureKey}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button icon={<KeyRound aria-hidden="true" className="h-5 w-5" />} size="sm" type="submit">
                  Guardar clave
                </Button>
                {view.tts.keyConfigured ? <Pill tone="positive">Clave guardada</Pill> : null}
              </div>
            </form>

            <label className="grid gap-2 text-sm text-ink-muted" htmlFor="remote-tts-voice">
              <span className="eyebrow">Voz</span>
              <select
                className="field-input"
                id="remote-tts-voice"
                onChange={(event) => void apply({ tts: { voice: event.target.value } }, "Voz actualizada.")}
                value={view.tts.voice}
              >
                {AZURE_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </select>
            </label>

            <Field
              hint="La región del recurso de Azure, por ejemplo westeurope."
              label="Región de Azure"
              onBlur={(event) => void apply({ tts: { region: event.target.value } }, "Región actualizada.")}
              onChange={(event) => setView({ ...view, tts: { ...view.tts, region: event.target.value } })}
              value={view.tts.region}
            />
          </div>
        </PanelInset>

        {message ? <p aria-live="polite" className="text-sm text-ink-muted">{message}</p> : null}
      </div>
    </Panel>
  );
}
