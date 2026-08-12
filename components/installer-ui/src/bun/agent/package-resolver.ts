import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";

export const DEBIAN_PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9+.-]{1,127}$/;

export type AptIndexState = {
  available: boolean;
  updatedAt?: string;
};

export type AptPackageInfo = {
  packageName: string;
  version: string;
  summary: string;
  priority: string;
  pinPriority: number;
  section: string;
  component?: "main" | "contrib" | "non-free" | "non-free-firmware";
};

export type AptSearchResult = {
  packageName: string;
  summary: string;
};

export type AptCatalog = {
  inspect(packageName: string): Promise<AptPackageInfo | null>;
  search(query: string): Promise<AptSearchResult[]>;
  isInstalled(packageName: string): Promise<boolean>;
  indexState(): Promise<AptIndexState>;
};

export type ResolvedPackage = AptPackageInfo & {
  displayName: string;
  installed: boolean;
  requestedName: string;
  resolution: "alias" | "exact" | "search";
  selectionReason: string;
  alternatives: Array<{ packageName: string; summary: string }>;
};

export type PackageResolution =
  | { ok: true; status: "resolved"; package: ResolvedPackage; index: AptIndexState }
  | {
    ok: false;
    status: "not_found" | "catalog_unavailable" | "invalid_query";
    query: string;
    message: string;
    index: AptIndexState;
  };

type PackageAlias = {
  aliases: string[];
  packageName: string;
  displayName: string;
  unavailableMessage?: string;
};

export const CURATED_PACKAGE_ALIASES: PackageAlias[] = [
  {
    aliases: ["firefox", "mozilla firefox", "navegador firefox"],
    packageName: "firefox-esr",
    displayName: "Firefox ESR",
  },
  {
    aliases: ["chrome", "google chrome", "google-chrome", "chromium", "navegador chrome"],
    packageName: "chromium",
    displayName: "Chromium",
  },
  {
    aliases: ["libreoffice", "libre office", "suite ofimatica", "suite ofimática"],
    packageName: "libreoffice",
    displayName: "LibreOffice",
  },
  {
    aliases: ["word", "libreoffice writer", "libre office writer"],
    packageName: "libreoffice-writer",
    displayName: "LibreOffice Writer",
  },
  {
    aliases: ["excel", "libreoffice calc", "libre office calc"],
    packageName: "libreoffice-calc",
    displayName: "LibreOffice Calc",
  },
  {
    aliases: ["powerpoint", "libreoffice impress", "libre office impress"],
    packageName: "libreoffice-impress",
    displayName: "LibreOffice Impress",
  },
  { aliases: ["vlc", "vlc player"], packageName: "vlc", displayName: "VLC" },
  { aliases: ["gimp", "gnu image manipulation program"], packageName: "gimp", displayName: "GIMP" },
  { aliases: ["inkscape"], packageName: "inkscape", displayName: "Inkscape" },
  { aliases: ["audacity"], packageName: "audacity", displayName: "Audacity" },
  { aliases: ["obs", "obs studio", "obs-studio"], packageName: "obs-studio", displayName: "OBS Studio" },
  { aliases: ["telegram", "telegram desktop"], packageName: "telegram-desktop", displayName: "Telegram Desktop" },
  { aliases: ["thunderbird", "mozilla thunderbird"], packageName: "thunderbird", displayName: "Thunderbird" },
  { aliases: ["steam"], packageName: "steam-installer", displayName: "Steam" },
  { aliases: ["7zip", "7-zip", "p7zip"], packageName: "p7zip-full", displayName: "7-Zip" },
  {
    aliases: ["spotify", "spotify desktop"],
    packageName: "spotify-client",
    displayName: "Spotify",
    unavailableMessage: "Spotify no está en el archivo oficial de Debian 12 configurado en AgenOS; no voy a sustituirlo por otro programa ni a añadir un repositorio externo sin una operación específica.",
  },
];

type CommandResult = { exitCode: number; stdout: string; stderr: string };
type RunFile = (command: string, args: string[]) => Promise<CommandResult>;

export type AptCatalogOptions = {
  runFile?: RunFile;
  listsDir?: string;
};

const APT_CACHE = "/usr/bin/apt-cache";
const DPKG_QUERY = "/usr/bin/dpkg-query";
const SEARCH_RESULT_LIMIT = 60;

export function isDebianPackageName(value: string): boolean {
  return DEBIAN_PACKAGE_NAME_PATTERN.test(value);
}

export function normalizePackageQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(?:(?:por favor\s+)?(?:instala(?:r|me)?|descarga(?:r|me)?|pon(?:er|me)?)(?:\s+la|\s+el|\s+los|\s+las)?\s+)/, "")
    .replace(/^(?:la|el|los|las|una?|aplicacion|aplicación|programa|paquete)\s+/, "")
    .replace(/\s+(?:app|aplicacion|aplicación|programa|paquete)$/, "")
    .replace(/[^a-z0-9+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createAptCatalog(options: AptCatalogOptions = {}): AptCatalog {
  const runFile = options.runFile ?? exec;
  const listsDir = options.listsDir ?? "/var/lib/apt/lists";

  return {
    async inspect(packageName) {
      if (!isDebianPackageName(packageName)) {
        return null;
      }

      const policy = await runFile(APT_CACHE, ["policy", packageName]);
      if (policy.exitCode !== 0) {
        return null;
      }
      const candidate = policy.stdout.match(/^\s*Candidate:\s*(\S+)\s*$/m)?.[1];
      if (!candidate || candidate === "(none)") {
        return null;
      }

      const show = await runFile(APT_CACHE, ["show", "--no-all-versions", packageName]);
      if (show.exitCode !== 0) {
        return null;
      }
      const stanza = parsePackageStanzas(show.stdout).find((record) => (
        record.Package === packageName && (!record.Version || record.Version === candidate)
      )) ?? parsePackageStanzas(show.stdout).find((record) => record.Package === packageName);
      if (!stanza) {
        return null;
      }

      return {
        packageName,
        version: candidate,
        summary: stanza.Description || packageName,
        priority: (stanza.Priority || "optional").toLowerCase(),
        pinPriority: parsePinPriority(policy.stdout),
        section: (stanza.Section || "unknown").toLowerCase(),
        component: parseComponent(policy.stdout),
      };
    },
    async search(query) {
      const expression = safeSearchExpression(query);
      if (!expression) {
        return [];
      }
      const result = await runFile(APT_CACHE, ["search", expression]);
      if (result.exitCode !== 0) {
        return [];
      }

      const matches: AptSearchResult[] = [];
      const seen = new Set<string>();
      for (const line of result.stdout.split(/\r?\n/)) {
        const match = line.match(/^([a-z0-9][a-z0-9+.-]{1,127})\s+-\s+(.+)$/);
        if (!match || seen.has(match[1]!)) {
          continue;
        }
        seen.add(match[1]!);
        matches.push({ packageName: match[1]!, summary: match[2]!.trim() });
        if (matches.length >= SEARCH_RESULT_LIMIT) {
          break;
        }
      }
      return matches;
    },
    async isInstalled(packageName) {
      if (!isDebianPackageName(packageName)) {
        return false;
      }
      const result = await runFile(DPKG_QUERY, ["-W", "-f=${db:Status-Abbrev}", packageName]);
      return result.exitCode === 0 && result.stdout.startsWith("ii ");
    },
    async indexState() {
      if (!existsSync(listsDir)) {
        return { available: false };
      }
      let latest = 0;
      try {
        for (const entry of readdirSync(listsDir)) {
          if (entry === "lock" || entry === "partial") {
            continue;
          }
          const modified = statSync(`${listsDir}/${entry}`).mtimeMs;
          latest = Math.max(latest, modified);
        }
      } catch {
        return { available: false };
      }
      return latest > 0
        ? { available: true, updatedAt: new Date(latest).toISOString() }
        : { available: false };
    },
  };
}

export type PackageResolverOptions = {
  catalog?: AptCatalog;
  aliases?: PackageAlias[];
  cacheTtlMs?: number;
  now?: () => number;
};

export function createPackageResolver(options: PackageResolverOptions = {}) {
  const catalog = options.catalog ?? createAptCatalog();
  const aliases = options.aliases ?? CURATED_PACKAGE_ALIASES;
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; indexKey: string; value: PackageResolution }>();

  return {
    async resolve(requestedName: string): Promise<PackageResolution> {
      const query = normalizePackageQuery(requestedName);
      const index = await catalog.indexState();
      const indexKey = `${index.available}:${index.updatedAt ?? "unknown"}`;
      const cached = cache.get(query);
      if (cached && cached.expiresAt > now() && cached.indexKey === indexKey) {
        return cached.value;
      }

      const value = await resolveUncached(requestedName, query, index);
      cache.set(query, { expiresAt: now() + cacheTtlMs, indexKey, value });
      return value;
    },
    clearCache() {
      cache.clear();
    },
  };

  async function resolveUncached(requestedName: string, query: string, index: AptIndexState): Promise<PackageResolution> {
    if (query.length < 2 || query.length > 100) {
      return {
        ok: false,
        status: "invalid_query",
        query: requestedName,
        message: "Necesito un nombre de aplicación o paquete más concreto.",
        index,
      };
    }

    const alias = aliases.find((entry) => entry.aliases.some((value) => normalizePackageQuery(value) === query));
    if (alias) {
      const info = await catalog.inspect(alias.packageName);
      if (info) {
        return resolved(info, alias.displayName, requestedName, "alias", `El alias «${query}» corresponde a ${alias.packageName} en Debian 12.`, [], index);
      }
      if (alias.unavailableMessage) {
        return { ok: false, status: "not_found", query: requestedName, message: alias.unavailableMessage, index };
      }
    }

    const exactPackageName = query.replace(/\s+/g, "-");
    if (isDebianPackageName(exactPackageName)) {
      const exact = await catalog.inspect(exactPackageName);
      if (exact) {
        return resolved(exact, displayNameFor(exact.packageName, aliases), requestedName, "exact", "Coincide exactamente con un paquete disponible.", [], index);
      }
    }

    const searchResults = await catalog.search(query);
    const inspected = (await Promise.all(searchResults.map(async (result) => {
      const info = await catalog.inspect(result.packageName);
      return info ? { ...info, summary: info.summary || result.summary } : null;
    }))).filter((candidate): candidate is AptPackageInfo => candidate !== null);

    const ranked = inspected
      .map((candidate) => ({ candidate, score: scoreCandidate(query, candidate) }))
      .filter((entry) => entry.score >= 80)
      .sort((left, right) => right.score - left.score || left.candidate.packageName.localeCompare(right.candidate.packageName));
    const winner = ranked[0];
    if (!winner) {
      const message = index.available
        ? `No encuentro un paquete razonable para «${requestedName.trim()}» en los repositorios configurados de Debian 12.`
        : "El índice local de paquetes no está disponible. Conecta el equipo y actualiza el catálogo del sistema antes de intentarlo de nuevo.";
      return {
        ok: false,
        status: index.available ? "not_found" : "catalog_unavailable",
        query: requestedName,
        message,
        index,
      };
    }

    const alternatives = ranked.slice(1, 4).map(({ candidate }) => ({
      packageName: candidate.packageName,
      summary: candidate.summary,
    }));
    const reason = alternatives.length > 0
      ? `He elegido ${winner.candidate.packageName}: es la mejor coincidencia por nombre, prioridad y sección; también aparecieron ${alternatives.map((item) => item.packageName).join(", ")}.`
      : `He elegido ${winner.candidate.packageName}: es la mejor coincidencia por nombre, prioridad y sección.`;
    return resolved(
      winner.candidate,
      displayNameFor(winner.candidate.packageName, aliases),
      requestedName,
      "search",
      reason,
      alternatives,
      index,
    );
  }

  async function resolved(
    info: AptPackageInfo,
    displayName: string,
    requestedName: string,
    resolution: ResolvedPackage["resolution"],
    selectionReason: string,
    alternatives: ResolvedPackage["alternatives"],
    index: AptIndexState,
  ): Promise<PackageResolution> {
    return {
      ok: true,
      status: "resolved",
      index,
      package: {
        ...info,
        displayName,
        installed: await catalog.isInstalled(info.packageName),
        requestedName,
        resolution,
        selectionReason,
        alternatives,
      },
    };
  }
}

const POPULAR_PACKAGES = new Map<string, number>([
  ["vlc", 80],
  ["gimp", 75],
  ["inkscape", 70],
  ["audacity", 70],
  ["thunderbird", 70],
  ["chromium", 70],
  ["firefox-esr", 70],
  ["libreoffice", 70],
]);

function scoreCandidate(query: string, candidate: AptPackageInfo): number {
  const compactQuery = query.replace(/\s+/g, "-");
  const queryTokens = query.split(" ").filter(Boolean);
  const packageTokens = candidate.packageName.split(/[+.-]/).filter(Boolean);
  const searchable = `${candidate.packageName} ${candidate.summary}`.toLowerCase();
  let score = 0;

  if (candidate.packageName === compactQuery) {
    score += 10_000;
  } else if (candidate.packageName.startsWith(`${compactQuery}-`) || candidate.packageName.endsWith(`-${compactQuery}`)) {
    score += 700;
  }
  score += queryTokens.filter((token) => packageTokens.includes(token)).length * 180;
  score += queryTokens.filter((token) => searchable.includes(token)).length * 45;
  score += Math.min(Math.max(candidate.pinPriority, 0), 1_000) / 10;
  score += priorityScore(candidate.priority);
  score += POPULAR_PACKAGES.get(candidate.packageName) ?? 0;
  score += sectionScore(candidate.section);

  if (/(?:^|-)(?:dev|dbg|dbgsym|doc|common|data|l10n|locale|plugin|plugins|theme|themes)(?:$|-)/.test(candidate.packageName)) {
    score -= 1_200;
  }
  if (/^(?:lib|gir1\.2-)/.test(candidate.packageName) || candidate.section.includes("lib")) {
    score -= 600;
  }
  return score;
}

function priorityScore(priority: string): number {
  return ({ required: 60, important: 55, standard: 50, optional: 35, extra: 10 } as Record<string, number>)[priority] ?? 0;
}

function sectionScore(section: string): number {
  const normalized = section.includes("/") ? section.split("/").at(-1)! : section;
  return new Set(["web", "graphics", "video", "sound", "editors", "office", "games", "utils", "net"]).has(normalized)
    ? 45
    : new Set(["debug", "devel", "doc", "libs", "libdevel", "localization"]).has(normalized)
      ? -80
      : 0;
}

function displayNameFor(packageName: string, aliases: PackageAlias[]): string {
  return aliases.find((entry) => entry.packageName === packageName)?.displayName ?? packageName;
}

function safeSearchExpression(query: string): string {
  return normalizePackageQuery(query)
    .split(" ")
    .filter((token) => token.length >= 2)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
}

function parsePackageStanzas(output: string): Array<Record<string, string>> {
  return output.split(/\n\s*\n/).map((block) => {
    const fields: Record<string, string> = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator > 0 && !/^\s/.test(line)) {
        fields[line.slice(0, separator)] = line.slice(separator + 1).trim();
      }
    }
    return fields;
  });
}

function parsePinPriority(output: string): number {
  const priorities = [...output.matchAll(/^\s*(\d+)\s+(?:https?:|file:|\/)/gm)].map((match) => Number(match[1]));
  return priorities.length > 0 ? Math.max(...priorities) : 0;
}

function parseComponent(output: string): AptPackageInfo["component"] {
  const releaseComponent = output.match(/\bc=(main|contrib|non-free-firmware|non-free)\b/)?.[1];
  const pathComponent = output.match(/\bbookworm(?:-updates|-security)?\/(main|contrib|non-free-firmware|non-free)\b/)?.[1];
  const component = releaseComponent ?? pathComponent;
  return component === "main" || component === "contrib" || component === "non-free" || component === "non-free-firmware"
    ? component
    : undefined;
}

function exec(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, {
      encoding: "utf8",
      env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
    }, (error, stdout, stderr) => {
      const code = typeof (error as (NodeJS.ErrnoException & { code?: unknown }) | null)?.code === "number"
        ? (error as NodeJS.ErrnoException & { code: number }).code
        : error
          ? 1
          : 0;
      resolve({ exitCode: code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}
