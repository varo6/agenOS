import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { collectAgentDiagnostics } from "../lib/agent-diagnostics";
import { AgentDiagnosticsButton } from "./AgentDiagnosticsButton";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("AgentDiagnosticsButton", () => {
  test("opens a production diagnostics panel with broker state and log commands", async () => {
    const collectDiagnostics = vi.fn().mockResolvedValue({
      generatedAt: "2026-05-16T12:00:00.000Z",
      runtime: {
        origin: "file:///opt/agenos/system/dist/index.html",
        userAgent: "AgenOS test",
      },
      checks: [
        { name: "broker", ok: false, detail: "Failed to fetch" },
      ],
      commands: [
        "systemctl status agenos-agent-api.service",
        "cat ~/.cache/agenos-system/runtime/api.log",
        "journalctl -u agenos-agent-api.service -n 120 --no-pager",
      ],
    });

    render(<AgentDiagnosticsButton collectDiagnostics={collectDiagnostics} />);

    fireEvent.click(screen.getByRole("button", { name: "Diagnostico" }));

    expect(await screen.findByText("Diagnostico de AgenOS")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    expect(screen.getByText("systemctl status agenos-agent-api.service")).toBeInTheDocument();
    expect(screen.getByText("cat ~/.cache/agenos-system/runtime/api.log")).toBeInTheDocument();
    expect(collectDiagnostics).toHaveBeenCalledTimes(1);
  });

  test("collects and copies the full support bundle JSON", async () => {
    const bundle = {
      schemaVersion: 1,
      generatedAt: "2026-05-16T12:00:00.000Z",
      commands: [
        { command: "journalctl", args: ["-u", "agenos-agent-api.service"], ok: true, stdout: "[redacted]" },
      ],
      agent: { status: { readiness: "ready" } },
    };
    const writeText = vi.fn();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<AgentDiagnosticsButton collectDiagnostics={vi.fn().mockResolvedValue(bundle)} />);

    fireEvent.click(screen.getByRole("button", { name: "Diagnostico" }));
    expect(await screen.findByText("journalctl -u agenos-agent-api.service")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(bundle, null, 2));
    });
  });

  test("collectAgentDiagnostics reads the broker support bundle endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-16T12:00:00.000Z",
      commands: [],
    }), { status: 200 }));

    await expect(collectAgentDiagnostics()).resolves.toMatchObject({ schemaVersion: 1 });
    expect(globalThis.fetch).toHaveBeenCalledWith("http://127.0.0.1:4173/api/diagnostics/support-bundle", {
      headers: { Accept: "application/json" },
    });
  });
});
