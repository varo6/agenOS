import type { ShellMode } from "../../../shared/installer-types";

export function TopModeSwitch({
  currentMode,
  disabled,
  switchingMode,
  onSelectMode,
}: {
  currentMode: ShellMode;
  disabled: boolean;
  switchingMode: ShellMode | null;
  onSelectMode: (mode: ShellMode) => void;
}) {
  function buttonClass(mode: ShellMode): string {
    const isActive = currentMode === mode;

    return [
      "rounded-full px-5 py-2.5 text-sm font-semibold tracking-[0.12em] uppercase transition",
      isActive
        ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.18)]"
        : "bg-transparent text-white/72 hover:text-white",
    ].join(" ");
  }

  return (
    <div className="glass-panel flex items-center gap-2 rounded-full px-2 py-2">
      <button
        className={buttonClass("installer")}
        disabled={disabled}
        onClick={() => onSelectMode("installer")}
        type="button"
      >
        {switchingMode === "installer" ? "Cambiando..." : "Live Installation"}
      </button>
      <button
        className={buttonClass("system")}
        disabled={disabled}
        onClick={() => onSelectMode("system")}
        type="button"
      >
        {switchingMode === "system" ? "Cambiando..." : "Live System"}
      </button>
    </div>
  );
}
