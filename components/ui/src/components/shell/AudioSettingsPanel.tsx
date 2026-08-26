import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getSystemBridge } from "../../lib/system-bridge";
import { Button, Panel } from "../ui";

export function AudioSettingsPanel() {
  const bridge = useMemo(() => getSystemBridge(), []);
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!bridge?.isAvailable()) return;

    void bridge.getAudioStatus().then((status) => {
      if (!active) return;
      setAvailable(status.available);
      setMuted(status.muted);
      if (status.volumePercent !== null) setVolume(status.volumePercent);
    }).catch(() => setAvailable(false));

    return () => { active = false; };
  }, [bridge]);

  async function saveVolume(value: number) {
    if (!bridge) return;
    const response = await bridge.setVolume(value);
    setMessage(response.message ?? null);
  }

  async function toggleMuted() {
    if (!bridge) return;
    const nextMuted = !muted;
    const response = await bridge.setMuted(nextMuted);
    if (response.ok) setMuted(nextMuted);
    setMessage(response.message ?? null);
  }

  return (
    <Panel description="Controla los altavoces del equipo." title="Sonido">
      <div className="grid gap-5">
        <label className="grid gap-3 text-sm text-ink-muted" htmlFor="audio-volume">
          <span className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2">
              {muted ? <VolumeX aria-hidden="true" className="h-5 w-5" /> : <Volume2 aria-hidden="true" className="h-5 w-5" />}
              Volumen
            </span>
            <output htmlFor="audio-volume">{available ? `${volume} %` : "No disponible"}</output>
          </span>
          <input
            aria-label="Volumen de los altavoces"
            disabled={!available}
            id="audio-volume"
            max="100"
            min="0"
            onChange={(event) => setVolume(Number(event.target.value))}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                void saveVolume(Number(event.currentTarget.value));
              }
            }}
            onPointerUp={(event) => void saveVolume(Number(event.currentTarget.value))}
            step="5"
            type="range"
            value={volume}
          />
        </label>

        <Button
          disabled={!available}
          icon={muted ? <Volume2 aria-hidden="true" className="h-5 w-5" /> : <VolumeX aria-hidden="true" className="h-5 w-5" />}
          onClick={() => void toggleMuted()}
        >
          {muted ? "Activar sonido" : "Silenciar"}
        </Button>

        {message ? <p aria-live="polite" className="text-sm text-ink-muted">{message}</p> : null}
      </div>
    </Panel>
  );
}
