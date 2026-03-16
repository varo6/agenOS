import { describe, expect, test } from "bun:test";

import { buildGuiEnvFromContext, detectWaylandSocketFromState } from "./gui-env";

describe("gui env", () => {
  test("builds the Wayland environment and points root at its own runtime dir", () => {
    const env = buildGuiEnvFromContext({
      env: {
        LANG: "es_ES.UTF-8",
      },
      originalUserHome: "/home/live",
      originalRuntimeDir: "/run/user/1000",
      rootRuntimeDir: "/run/user/0",
      busExists: true,
      waylandSocketPath: "/run/user/1000/wayland-1",
      xauthorityExists: false,
    });

    expect(env.WAYLAND_DISPLAY).toBe("/run/user/1000/wayland-1");
    expect(env.XDG_RUNTIME_DIR).toBe("/run/user/0");
    expect(env.XDG_SESSION_TYPE).toBe("wayland");
    expect(env.QT_QPA_PLATFORM).toBe("wayland;xcb");
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/run/user/1000/bus");
  });

  test("builds the X11 environment and infers XAUTHORITY", () => {
    const env = buildGuiEnvFromContext({
      env: {
        DISPLAY: ":0",
      },
      originalUserHome: "/home/live",
      originalRuntimeDir: "/run/user/1000",
      rootRuntimeDir: "/run/user/0",
      busExists: false,
      waylandSocketPath: null,
      xauthorityExists: true,
    });

    expect(env.XDG_SESSION_TYPE).toBe("x11");
    expect(env.QT_QPA_PLATFORM).toBe("xcb");
    expect(env.XAUTHORITY).toBe("/home/live/.Xauthority");
  });

  test("falls back to the dbus socket when the environment does not provide one", () => {
    const env = buildGuiEnvFromContext({
      env: {},
      originalUserHome: "/home/live",
      originalRuntimeDir: "/run/user/1000",
      rootRuntimeDir: "/run/user/0",
      busExists: true,
      waylandSocketPath: null,
      xauthorityExists: false,
    });

    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/run/user/1000/bus");
  });

  test("detects configured and discovered wayland sockets", () => {
    const socket = detectWaylandSocketFromState({
      configuredWaylandDisplay: "wayland-2",
      originalRuntimeDir: "/run/user/1000",
      existingPaths: new Set(["/run/user/1000/wayland-2", "/run/user/1000/wayland-3"]),
      socketPaths: new Set(["/run/user/1000/wayland-2"]),
    });

    expect(socket).toBe("/run/user/1000/wayland-2");
  });
});
