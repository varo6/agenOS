import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgenosRemoteBridge, RemoteServicesView } from "../../lib/remote-bridge";
import { RemoteServicesPanel } from "./RemoteServicesPanel";

afterEach(() => {
  delete window.agenosRemote;
});

function view(overrides: Partial<RemoteServicesView> = {}): RemoteServicesView {
  return {
    stt: { enabled: false, model: "whisper-large-v3-turbo", keyConfigured: false, active: false },
    tts: { enabled: false, region: "westeurope", voice: "es-ES-ElviraNeural", keyConfigured: false, active: false },
    ...overrides,
  };
}

function installBridge(initial: RemoteServicesView = view(), overrides: Partial<AgenosRemoteBridge> = {}) {
  const bridge = {
    isAvailable: () => true,
    get: vi.fn().mockResolvedValue(initial),
    update: vi.fn().mockResolvedValue(initial),
    setSecret: vi.fn().mockResolvedValue({ ...initial, stt: { ...initial.stt, keyConfigured: true } }),
    ...overrides,
  } as unknown as AgenosRemoteBridge;
  window.agenosRemote = bridge;
  return bridge;
}

describe("RemoteServicesPanel", () => {
  test("ofrece los dos interruptores, dictado primero", async () => {
    installBridge();
    render(<RemoteServicesPanel />);

    expect(await screen.findByRole("button", { name: "Usar dictado en la nube" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Usar voz en la nube" })).toBeInTheDocument();
  });

  test("encender el dictado en la nube manda el cambio", async () => {
    const bridge = installBridge();
    render(<RemoteServicesPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Usar dictado en la nube" }));

    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith({ stt: { enabled: true } }));
  });

  test("apagar la voz en la nube manda el cambio contrario", async () => {
    const enabled = view({ tts: { enabled: true, region: "westeurope", voice: "es-ES-ElviraNeural", keyConfigured: true, active: true } });
    const bridge = installBridge(enabled);
    render(<RemoteServicesPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Volver a la voz del equipo" }));

    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith({ tts: { enabled: false } }));
  });

  test("guarda la clave y limpia el campo para no dejarla a la vista", async () => {
    const bridge = installBridge();
    render(<RemoteServicesPanel />);

    const input = await screen.findByLabelText("Clave de Groq");
    fireEvent.change(input, { target: { value: "gsk_secreta" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar clave" })[0]);

    await waitFor(() => expect(bridge.setSecret).toHaveBeenCalledWith("groqApiKey", "gsk_secreta"));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  test("avisa si el interruptor esta puesto pero falta la clave", async () => {
    installBridge(view({
      stt: { enabled: true, model: "whisper-large-v3-turbo", keyConfigured: false, active: false },
    }));
    render(<RemoteServicesPanel />);

    expect(await screen.findByText("Falta la clave de Groq")).toBeInTheDocument();
    // El estado real manda sobre el interruptor: sigue dictando el equipo. Hay
    // dos etiquetas iguales porque la voz tambien sigue en local.
    expect(await screen.findAllByText("En el equipo")).toHaveLength(2);
  });

  test("con el servicio activo dice quien esta transcribiendo", async () => {
    installBridge(view({
      stt: { enabled: true, model: "whisper-large-v3-turbo", keyConfigured: true, active: true },
    }));
    render(<RemoteServicesPanel />);

    expect(await screen.findByText("En la nube (Groq)")).toBeInTheDocument();
  });

  test("cambiar la voz manda solo ese campo", async () => {
    const bridge = installBridge();
    render(<RemoteServicesPanel />);

    fireEvent.change(await screen.findByLabelText("Voz"), { target: { value: "es-ES-AlvaroNeural" } });

    await waitFor(() => expect(bridge.update).toHaveBeenCalledWith({ tts: { voice: "es-ES-AlvaroNeural" } }));
  });

  test("sin puente no pinta controles muertos", () => {
    const { container } = render(<RemoteServicesPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
