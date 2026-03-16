import { describe, expect, test } from "bun:test";

import { buildPreflightResponse, firmwareTypeFromState, isLiveSessionFromState, totalRamBytesFromMeminfo } from "./preflight";

describe("preflight helpers", () => {
  test("detects live sessions from kernel cmdline or medium path", () => {
    expect(isLiveSessionFromState("quiet boot=live components", false)).toBe(true);
    expect(isLiveSessionFromState("quiet splash", true)).toBe(true);
    expect(isLiveSessionFromState("quiet splash", false)).toBe(false);
  });

  test("detects firmware mode", () => {
    expect(firmwareTypeFromState(true)).toBe("UEFI");
    expect(firmwareTypeFromState(false)).toBe("BIOS");
  });

  test("parses total ram from meminfo", () => {
    expect(totalRamBytesFromMeminfo("MemTotal:       4194304 kB\n")).toBe(4294967296);
  });

  test("builds warning and error checks at the configured thresholds", () => {
    const warningResponse = buildPreflightResponse({
      disks: [],
      totalRamBytes: 2 * 1024 * 1024 * 1024,
      isLiveSession: false,
      firmware: "BIOS",
    });

    expect(warningResponse.checks.find((check) => check.id === "ram")?.status).toBe("warning");
    expect(warningResponse.checks.find((check) => check.id === "storage")?.status).toBe("warning");
    expect(warningResponse.checks.find((check) => check.id === "live")?.status).toBe("error");

    const okResponse = buildPreflightResponse({
      disks: [
        {
          path: "/dev/sda",
          vendor: "",
          model: "",
          transport: "",
          sizeBytes: 64 * 1024 * 1024 * 1024,
          sizeLabel: "64 GB",
          systemDisk: false,
        },
      ],
      totalRamBytes: 8 * 1024 * 1024 * 1024,
      isLiveSession: true,
      firmware: "UEFI",
    });

    expect(okResponse.checks.find((check) => check.id === "ram")?.status).toBe("ok");
    expect(okResponse.checks.find((check) => check.id === "storage")?.status).toBe("ok");
    expect(okResponse.checks.find((check) => check.id === "live")?.status).toBe("ok");
  });
});
