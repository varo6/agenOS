import { MonitorOff, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getSystemBridge } from "../../lib/system-bridge";
import { Panel } from "../ui";

export function DisplaySettingsPanel() {
  const bridge = useMemo(() => getSystemBridge(), []);
  const [brightness, setBrightness] = useState(50);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!bridge?.isAvailable()) return;

    void bridge.getDisplayStatus().then((status) => {
      if (!active) return;
      setAvailable(status.available);
      if (status.brightnessPercent !== null) setBrightness(status.brightnessPercent);
    }).catch(() => setAvailable(false));
    return () => { active = false; };
  }, [bridge]);

  async function saveBrightness(value: number) {
    if (!bridge) return;
    const response = await bridge.setBrightness(value);
    setMessage(response.message ?? null);
  }

  async function turnOff() {
    if (!bridge) return;
    const response = await bridge.turnOffDisplay();
    setMessage(response.message ?? null);
  }

  return (
    <Panel description="Ajusta el panel del portátil. Al apagarlo, cualquier tecla o movimiento vuelve a encenderlo." title="Pantalla">
      <div className="grid gap-5">
        <label className="grid gap-3 text-sm text-ink-muted" htmlFor="display-brightness">
          <span className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2"><Sun aria-hidden="true" className="h-5 w-5" /> Brillo</span>
            <output htmlFor="display-brightness">{available ? `${brightness} %` : "No disponible"}</output>
          </span>
          <input
            aria-label="Brillo de la pantalla"
            disabled={!available}
            id="display-brightness"
            max="100"
            min="5"
            onChange={(event) => setBrightness(Number(event.target.value))}
            onPointerUp={(event) => void saveBrightness(Number(event.currentTarget.value))}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                void saveBrightness(Number(event.currentTarget.value));
              }
            }}
            step="5"
            type="range"
            value={brightness}
          />
        </label>
        <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line bg-surface-strong px-4 text-sm hover:border-line-strong" onClick={() => void turnOff()} type="button">
          <MonitorOff aria-hidden="true" className="h-5 w-5" /> Apagar pantalla
        </button>
        {message ? <p aria-live="polite" className="text-sm text-ink-muted">{message}</p> : null}
      </div>
    </Panel>
  );
}
