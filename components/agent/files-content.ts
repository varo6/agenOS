import { appendFile as appendFileNode, readdir, readFile as readFileNode, stat as statNode, writeFile as writeFileNode } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type FilesContentEntry = {
  name: string;
  isDirectory: boolean;
  size?: number;
};

export type FilesContentStat = {
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
};

export type FilesContentDeps = {
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, data: string) => Promise<void>;
  appendFile?: (path: string, data: string) => Promise<void>;
  readDir?: (path: string) => Promise<Array<{ name: string; isDirectory: boolean; size?: number }>>;
  stat?: (path: string) => Promise<{ isDirectory: boolean; size: number; modifiedAt: string } | null>;
  homeDir?: string;
};

export type FilesContentReadResult = {
  ok: boolean;
  path: string;
  content: string;
  truncated: boolean;
  message: string;
};

export type FilesContentWriteResult = {
  ok: boolean;
  path: string;
  bytesWritten: number;
  created: boolean;
  message: string;
};

export type FilesContentListResult = {
  ok: boolean;
  path: string;
  entries: FilesContentEntry[];
  message: string;
};

export type FilesContentSearchMatch = {
  path: string;
  name: string;
  isDirectory: boolean;
};

export type FilesContentSearchResult = {
  ok: boolean;
  root: string;
  query: string;
  matches: FilesContentSearchMatch[];
  truncated: boolean;
  message: string;
};

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_RESULTS = 100;
const MAX_SEARCH_DEPTH = 12;
const MAX_SEARCH_DIRS = 2000;
const MAX_LIST_STATS = 500;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "__pycache__", ".git", ".cache"]);

export function createFilesContentService(deps: FilesContentDeps = {}) {
  const homeDir = deps.homeDir ?? homedir();
  const readFile = deps.readFile ?? ((path: string) => readFileNode(path, "utf8"));
  const writeFile = deps.writeFile ?? (async (path: string, data: string) => { await writeFileNode(path, data, "utf8"); });
  const appendFile = deps.appendFile ?? (async (path: string, data: string) => { await appendFileNode(path, data, "utf8"); });
  const readDir = deps.readDir ?? defaultReadDir;
  const stat = deps.stat ?? defaultStat;

  const safeStat = async (path: string): Promise<FilesContentStat | null> => {
    try {
      return await stat(path);
    } catch {
      return null;
    }
  };

  return {
    async read(path: string, options: { maxBytes?: number } = {}): Promise<FilesContentReadResult> {
      const target = normalizePath(path, homeDir);
      if (target.ok === false) {
        return { ok: false, path: "", content: "", truncated: false, message: target.message };
      }

      const maxBytes = normalizeLimit(options.maxBytes, DEFAULT_MAX_BYTES);
      let raw: string;
      try {
        raw = await readFile(target.path);
      } catch (error) {
        return {
          ok: false,
          path: target.path,
          content: "",
          truncated: false,
          message: `No pude leer ${target.path}: ${errorMessage(error)}`,
        };
      }

      const buffer = Buffer.from(raw, "utf8");
      const truncated = buffer.byteLength > maxBytes;
      const content = truncated ? buffer.subarray(0, maxBytes).toString("utf8") : raw;
      return {
        ok: true,
        path: target.path,
        content,
        truncated,
        message: truncated
          ? `Leí los primeros ${maxBytes} bytes de ${target.path}; el archivo es más grande y está recortado.`
          : `Leí ${target.path} (${buffer.byteLength} bytes).`,
      };
    },

    async write(path: string, content: string): Promise<FilesContentWriteResult> {
      const target = normalizePath(path, homeDir);
      if (target.ok === false) {
        return { ok: false, path: "", bytesWritten: 0, created: false, message: target.message };
      }
      if (typeof content !== "string") {
        return { ok: false, path: target.path, bytesWritten: 0, created: false, message: "El contenido a escribir es obligatorio." };
      }

      const existing = await safeStat(target.path);
      try {
        await writeFile(target.path, content);
      } catch (error) {
        return {
          ok: false,
          path: target.path,
          bytesWritten: 0,
          created: false,
          message: `No pude escribir ${target.path}: ${errorMessage(error)}`,
        };
      }

      const bytesWritten = Buffer.byteLength(content, "utf8");
      const created = existing === null;
      return {
        ok: true,
        path: target.path,
        bytesWritten,
        created,
        message: created
          ? `Creé ${target.path} con ${bytesWritten} bytes.`
          : `Sobrescribí ${target.path} con ${bytesWritten} bytes.`,
      };
    },

    async append(path: string, content: string): Promise<FilesContentWriteResult> {
      const target = normalizePath(path, homeDir);
      if (target.ok === false) {
        return { ok: false, path: "", bytesWritten: 0, created: false, message: target.message };
      }
      if (typeof content !== "string") {
        return { ok: false, path: target.path, bytesWritten: 0, created: false, message: "El contenido a añadir es obligatorio." };
      }

      const existing = await safeStat(target.path);
      try {
        await appendFile(target.path, content);
      } catch (error) {
        return {
          ok: false,
          path: target.path,
          bytesWritten: 0,
          created: false,
          message: `No pude añadir contenido a ${target.path}: ${errorMessage(error)}`,
        };
      }

      const bytesWritten = Buffer.byteLength(content, "utf8");
      const created = existing === null;
      return {
        ok: true,
        path: target.path,
        bytesWritten,
        created,
        message: created
          ? `Creé ${target.path} y añadí ${bytesWritten} bytes.`
          : `Añadí ${bytesWritten} bytes al final de ${target.path}.`,
      };
    },

    async list(path: string): Promise<FilesContentListResult> {
      const target = normalizePath(path, homeDir);
      if (target.ok === false) {
        return { ok: false, path: "", entries: [], message: target.message };
      }

      let rawEntries: FilesContentEntry[];
      try {
        rawEntries = await readDir(target.path);
      } catch (error) {
        return { ok: false, path: target.path, entries: [], message: `No pude listar ${target.path}: ${errorMessage(error)}` };
      }

      const entries = [...rawEntries].sort(compareEntries);
      let stats = 0;
      for (const entry of entries) {
        if (entry.isDirectory || typeof entry.size === "number" || stats >= MAX_LIST_STATS) {
          continue;
        }
        stats += 1;
        const info = await safeStat(join(target.path, entry.name));
        if (info) {
          entry.size = info.size;
        }
      }

      return {
        ok: true,
        path: target.path,
        entries,
        message: entries.length
          ? `${entries.length} elementos en ${target.path}.`
          : `${target.path} está vacío.`,
      };
    },

    async search(root: string, query: string, options: { maxResults?: number } = {}): Promise<FilesContentSearchResult> {
      const target = normalizePath(root, homeDir);
      if (target.ok === false) {
        return { ok: false, root: "", query: "", matches: [], truncated: false, message: target.message };
      }

      const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
      if (!needle) {
        return {
          ok: false,
          root: target.path,
          query: "",
          matches: [],
          truncated: false,
          message: "Necesito un texto para buscar en los nombres de archivo.",
        };
      }

      const rootInfo = await safeStat(target.path);
      if (rootInfo && !rootInfo.isDirectory) {
        return {
          ok: false,
          root: target.path,
          query: needle,
          matches: [],
          truncated: false,
          message: `${target.path} no es una carpeta, así que no puedo buscar dentro.`,
        };
      }

      const maxResults = normalizeLimit(options.maxResults, DEFAULT_MAX_RESULTS);
      const matches: FilesContentSearchMatch[] = [];
      const pending: Array<{ path: string; depth: number }> = [{ path: target.path, depth: 0 }];
      let visitedDirs = 0;
      let truncated = false;
      let readFailures = 0;

      while (pending.length > 0 && matches.length < maxResults && visitedDirs < MAX_SEARCH_DIRS) {
        const current = pending.shift();
        if (!current) {
          break;
        }
        visitedDirs += 1;

        let entries: FilesContentEntry[];
        try {
          entries = await readDir(current.path);
        } catch (error) {
          if (current.depth === 0) {
            return {
              ok: false,
              root: target.path,
              query: needle,
              matches: [],
              truncated: false,
              message: `No pude buscar en ${target.path}: ${errorMessage(error)}`,
            };
          }
          readFailures += 1;
          continue;
        }

        for (const entry of entries) {
          const entryPath = join(current.path, entry.name);
          if (entry.name.toLowerCase().includes(needle)) {
            if (matches.length >= maxResults) {
              truncated = true;
              break;
            }
            matches.push({ path: entryPath, name: entry.name, isDirectory: entry.isDirectory });
          }
          if (entry.isDirectory && !isSkippedDirectory(entry.name) && current.depth < MAX_SEARCH_DEPTH) {
            pending.push({ path: entryPath, depth: current.depth + 1 });
          }
        }
      }

      if (pending.length > 0 && matches.length >= maxResults) {
        truncated = true;
      }

      const skipped = readFailures > 0 ? ` Salté ${readFailures} carpetas sin permisos.` : "";
      return {
        ok: true,
        root: target.path,
        query: needle,
        matches,
        truncated,
        message: matches.length
          ? `${matches.length} coincidencias para "${needle}" en ${target.path}.${truncated ? ` Hay más resultados; muestro los primeros ${maxResults}.` : ""}${skipped}`
          : `No encontré nada que coincida con "${needle}" en ${target.path}.${skipped}`,
      };
    },
  };
}

export function normalizeContentPath(path: unknown, homeDir: string): { ok: true; path: string } | { ok: false; message: string } {
  return normalizePath(path, homeDir);
}

function normalizePath(path: unknown, homeDir: string): { ok: true; path: string } | { ok: false; message: string } {
  if (typeof path !== "string") {
    return { ok: false, message: "La ruta del archivo es obligatoria." };
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return { ok: false, message: "La ruta del archivo es obligatoria." };
  }
  if (trimmed === "~") {
    return { ok: true, path: homeDir };
  }
  if (trimmed.startsWith("~/")) {
    return { ok: true, path: resolve(homeDir, trimmed.slice(2)) };
  }
  if (isAbsolute(trimmed)) {
    return { ok: true, path: resolve(trimmed) };
  }
  return { ok: true, path: resolve(homeDir, trimmed) };
}

function isSkippedDirectory(name: string): boolean {
  return name.startsWith(".") || SKIPPED_DIRECTORIES.has(name);
}

function compareEntries(left: FilesContentEntry, right: FilesContentEntry): number {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "es");
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.trunc(value);
}

async function defaultReadDir(path: string): Promise<FilesContentEntry[]> {
  const dirents = await readdir(path, { withFileTypes: true });
  return dirents.map((dirent) => ({ name: dirent.name, isDirectory: dirent.isDirectory() }));
}

async function defaultStat(path: string): Promise<FilesContentStat | null> {
  try {
    const info = await statNode(path);
    return {
      isDirectory: info.isDirectory(),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
