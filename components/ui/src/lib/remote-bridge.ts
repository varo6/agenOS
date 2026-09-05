/**
 * Contrato entre el renderer y el proceso principal para los servicios de voz
 * en la nube.
 *
 * Los tipos se redeclaran aquí en vez de importarlos de `components/remote`,
 * igual que hacen `speech-bridge.ts` y `tts-bridge.ts`: el bundle del renderer
 * no debe arrastrar código de Node (`node:fs`, `node:os`) solo para conocer la
 * forma de un objeto.
 *
 * Ninguno de estos tipos incluye la clave de API. `keyConfigured` es todo lo
 * que la interfaz llega a saber de ella.
 */

export type RemoteServicesView = {
  stt: {
    enabled: boolean;
    model: string;
    keyConfigured: boolean;
    /** Falso si el interruptor está puesto pero falta la clave. */
    active: boolean;
  };
  tts: {
    enabled: boolean;
    region: string;
    voice: string;
    keyConfigured: boolean;
    active: boolean;
  };
};

export type RemoteServicesPatch = {
  stt?: { enabled?: boolean; model?: string };
  tts?: { enabled?: boolean; region?: string; voice?: string };
};

export type RemoteSecretName = "groqApiKey" | "azureSpeechKey";

export type AgenosRemoteBridge = {
  get(): Promise<RemoteServicesView>;
  update(patch: RemoteServicesPatch): Promise<RemoteServicesView>;
  /** Una cadena vacía borra la clave guardada. */
  setSecret(name: RemoteSecretName, value: string): Promise<RemoteServicesView>;
  isAvailable(): boolean;
};

export function getRemoteBridge(): AgenosRemoteBridge | null {
  const candidate = globalThis.window?.agenosRemote;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
