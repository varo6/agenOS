import { describe, expect, test } from "bun:test";
import {
  createAptCatalog,
  createPackageResolver,
  normalizePackageQuery,
  type AptCatalog,
  type AptPackageInfo,
  type AptSearchResult,
} from "./package-resolver";

function packageInfo(packageName: string, overrides: Partial<AptPackageInfo> = {}): AptPackageInfo {
  return {
    packageName,
    version: "1.0-1",
    summary: `${packageName} application`,
    priority: "optional",
    pinPriority: 500,
    section: "utils",
    component: "main",
    ...overrides,
  };
}

function fakeCatalog(input: {
  packages?: AptPackageInfo[];
  searches?: Record<string, AptSearchResult[]>;
  installed?: string[];
  indexAvailable?: boolean;
}) {
  const packages = new Map((input.packages ?? []).map((item) => [item.packageName, item]));
  const calls = { inspect: [] as string[], search: [] as string[], installed: [] as string[] };
  const catalog: AptCatalog = {
    async inspect(packageName) {
      calls.inspect.push(packageName);
      return packages.get(packageName) ?? null;
    },
    async search(query) {
      calls.search.push(query);
      return input.searches?.[query] ?? [];
    },
    async isInstalled(packageName) {
      calls.installed.push(packageName);
      return input.installed?.includes(packageName) ?? false;
    },
    async indexState() {
      return input.indexAvailable === false
        ? { available: false }
        : { available: true, updatedAt: "2026-08-13T10:00:00.000Z" };
    },
  };
  return { catalog, calls };
}

describe("Debian package resolver", () => {
  test("normalizes a natural-language installation request", () => {
    expect(normalizePackageQuery("Por favor instala la aplicación Mozilla Firefox"))
      .toBe("mozilla firefox");
  });

  test("resolves the human alias firefox to the real Bookworm package", async () => {
    const { catalog, calls } = fakeCatalog({
      packages: [packageInfo("firefox-esr", { summary: "Mozilla Firefox web browser - Extended Support Release", section: "web" })],
    });
    const resolver = createPackageResolver({ catalog });

    await expect(resolver.resolve("instálame Firefox")).resolves.toMatchObject({
      ok: true,
      status: "resolved",
      package: {
        packageName: "firefox-esr",
        displayName: "Firefox ESR",
        resolution: "alias",
        installed: false,
      },
    });
    expect(calls.inspect).toEqual(["firefox-esr"]);
    expect(calls.search).toEqual([]);
  });

  test("searches the complete local APT catalog when no curated alias matches", async () => {
    const drawing = packageInfo("mypaint", {
      summary: "paint program for use with graphics tablets",
      section: "graphics",
      priority: "optional",
    });
    const docs = packageInfo("mypaint-data", {
      summary: "data files for mypaint",
      section: "graphics",
    });
    const { catalog, calls } = fakeCatalog({
      packages: [drawing, docs],
      searches: {
        "paint tablet": [
          { packageName: "mypaint-data", summary: docs.summary },
          { packageName: "mypaint", summary: drawing.summary },
        ],
      },
    });

    const resolution = await createPackageResolver({ catalog }).resolve("paint tablet");

    expect(resolution).toMatchObject({
      ok: true,
      package: {
        packageName: "mypaint",
        resolution: "search",
      },
    });
    expect(calls.search).toEqual(["paint tablet"]);
    expect(calls.inspect).toEqual(expect.arrayContaining(["mypaint", "mypaint-data"]));
  });

  test("chooses and explains the best ambiguous candidate instead of asking the user to pick", async () => {
    const vlc = packageInfo("vlc", {
      summary: "multimedia player and streamer",
      section: "video",
    });
    const mpv = packageInfo("mpv", {
      summary: "media player based on MPlayer and mplayer2",
      section: "video",
    });
    const library = packageInfo("libplayer-dev", {
      summary: "development library for media players",
      section: "libdevel",
      priority: "extra",
    });
    const { catalog } = fakeCatalog({
      packages: [vlc, mpv, library],
      searches: {
        "media player": [vlc, mpv, library].map((item) => ({ packageName: item.packageName, summary: item.summary })),
      },
    });

    const resolution = await createPackageResolver({ catalog }).resolve("media player");

    expect(resolution).toMatchObject({
      ok: true,
      package: {
        packageName: "vlc",
        alternatives: expect.arrayContaining([expect.objectContaining({ packageName: "mpv" })]),
      },
    });
    if (resolution.ok) {
      expect(resolution.package.selectionReason).toContain("He elegido vlc");
      expect(resolution.package.selectionReason).toContain("mpv");
    }
  });

  test("reports an absent package clearly and does not create a guessed result", async () => {
    const { catalog } = fakeCatalog({ packages: [], searches: { "does not exist": [] } });

    await expect(createPackageResolver({ catalog }).resolve("does not exist")).resolves.toMatchObject({
      ok: false,
      status: "not_found",
      message: expect.stringContaining("No encuentro un paquete razonable"),
    });
  });

  test("explains that Spotify is outside the configured Debian archive", async () => {
    const { catalog } = fakeCatalog({ packages: [] });

    await expect(createPackageResolver({ catalog }).resolve("Spotify")).resolves.toMatchObject({
      ok: false,
      status: "not_found",
      message: expect.stringContaining("no está en el archivo oficial de Debian 12"),
    });
  });

  test("uses a short query cache and invalidates it when the APT index changes", async () => {
    const info = packageInfo("vlc", { section: "video" });
    let updatedAt = "2026-08-13T10:00:00.000Z";
    let inspectCalls = 0;
    const catalog: AptCatalog = {
      inspect: async () => {
        inspectCalls += 1;
        return info;
      },
      search: async () => [],
      isInstalled: async () => false,
      indexState: async () => ({ available: true, updatedAt }),
    };
    const resolver = createPackageResolver({ catalog, cacheTtlMs: 60_000, now: () => 1_000 });

    await resolver.resolve("vlc");
    await resolver.resolve("vlc");
    expect(inspectCalls).toBe(1);

    updatedAt = "2026-08-13T11:00:00.000Z";
    await resolver.resolve("vlc");
    expect(inspectCalls).toBe(2);
  });
});

describe("APT catalog adapter", () => {
  test("uses apt-cache policy/show/search and parses only an exact candidate", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const catalog = createAptCatalog({
      listsDir: "/path/that/does/not/exist",
      async runFile(command, args) {
        calls.push({ command, args });
        if (args[0] === "policy") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: "firefox-esr:\n  Candidate: 128.8.0esr-1~deb12u1\n     128.8.0esr-1~deb12u1 500\n        500 http://deb.debian.org/debian-security bookworm-security/main amd64 Packages\n",
          };
        }
        if (args[0] === "show") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: "Package: firefox-esr\nVersion: 128.8.0esr-1~deb12u1\nPriority: optional\nSection: web\nDescription: Mozilla Firefox web browser - Extended Support Release\n",
          };
        }
        if (args[0] === "search") {
          return { exitCode: 0, stderr: "", stdout: "firefox-esr - Mozilla Firefox web browser\n" };
        }
        return { exitCode: 1, stderr: "not installed", stdout: "" };
      },
    });

    await expect(catalog.inspect("firefox-esr")).resolves.toMatchObject({
      packageName: "firefox-esr",
      version: "128.8.0esr-1~deb12u1",
      section: "web",
      component: "main",
    });
    await expect(catalog.search("firefox browser")).resolves.toEqual([
      { packageName: "firefox-esr", summary: "Mozilla Firefox web browser" },
    ]);
    expect(calls).toEqual(expect.arrayContaining([
      { command: "/usr/bin/apt-cache", args: ["policy", "firefox-esr"] },
      { command: "/usr/bin/apt-cache", args: ["show", "--no-all-versions", "firefox-esr"] },
      { command: "/usr/bin/apt-cache", args: ["search", "firefox.*browser"] },
    ]));
  });

  test("rejects option-like or shell-like package names before invoking apt-cache", async () => {
    const calls: string[][] = [];
    const catalog = createAptCatalog({
      listsDir: "/missing",
      async runFile(_command, args) {
        calls.push(args);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await expect(catalog.inspect("--option")).resolves.toBeNull();
    await expect(catalog.inspect("vlc;id")).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});
