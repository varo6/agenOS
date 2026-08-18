import { describe, expect, test } from "bun:test";
import { createFilesContentService, type FilesContentDeps } from "./files-content";

const HOME = "/home/tester";

type FakeFs = {
  files: Map<string, string>;
  dirs: Set<string>;
  writes: Array<{ path: string; data: string; mode: "write" | "append" }>;
  deps: FilesContentDeps;
};

function createFakeFs(seed: Record<string, string> = {}, extraDirs: string[] = []): FakeFs {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>([HOME, ...extraDirs]);
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join("/") || "/");
    }
  }

  const writes: Array<{ path: string; data: string; mode: "write" | "append" }> = [];
  const deps: FilesContentDeps = {
    homeDir: HOME,
    async readFile(path) {
      const value = files.get(path);
      if (value === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return value;
    },
    async writeFile(path, data) {
      writes.push({ path, data, mode: "write" });
      files.set(path, data);
    },
    async appendFile(path, data) {
      writes.push({ path, data, mode: "append" });
      files.set(path, (files.get(path) ?? "") + data);
    },
    async readDir(path) {
      if (!dirs.has(path)) {
        throw new Error(`ENOTDIR: not a directory, scandir '${path}'`);
      }
      const prefix = path === "/" ? "/" : `${path}/`;
      const names = new Map<string, boolean>();
      for (const dir of dirs) {
        if (dir.startsWith(prefix) && dir !== path) {
          const rest = dir.slice(prefix.length);
          if (rest && !rest.includes("/")) {
            names.set(rest, true);
          }
        }
      }
      for (const file of files.keys()) {
        if (file.startsWith(prefix)) {
          const rest = file.slice(prefix.length);
          if (rest && !rest.includes("/")) {
            names.set(rest, false);
          }
        }
      }
      return [...names.entries()].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    async stat(path) {
      if (dirs.has(path)) {
        return { isDirectory: true, size: 0, modifiedAt: "2026-08-18T10:00:00.000Z" };
      }
      const value = files.get(path);
      if (value === undefined) {
        return null;
      }
      return { isDirectory: false, size: Buffer.byteLength(value, "utf8"), modifiedAt: "2026-08-18T10:00:00.000Z" };
    },
  };

  return { files, dirs, writes, deps };
}

describe("files content service", () => {
  test("lee un archivo expandiendo ~", async () => {
    const fake = createFakeFs({ "/home/tester/Documentos/notas.md": "# Notas\nComprar pan\n" });
    const service = createFilesContentService(fake.deps);

    const result = await service.read("~/Documentos/notas.md");

    expect(result).toMatchObject({
      ok: true,
      path: "/home/tester/Documentos/notas.md",
      content: "# Notas\nComprar pan\n",
      truncated: false,
    });
  });

  test("resuelve rutas relativas contra la carpeta del usuario", async () => {
    const fake = createFakeFs({ "/home/tester/todo.txt": "uno" });
    const service = createFilesContentService(fake.deps);

    await expect(service.read("todo.txt")).resolves.toMatchObject({
      ok: true,
      path: "/home/tester/todo.txt",
      content: "uno",
    });
  });

  test("rechaza rutas vacias sin tocar el disco", async () => {
    const fake = createFakeFs();
    const service = createFilesContentService(fake.deps);

    await expect(service.read("   ")).resolves.toMatchObject({ ok: false, path: "" });
    await expect(service.write("", "x")).resolves.toMatchObject({ ok: false, path: "" });
    expect(fake.writes).toEqual([]);
  });

  test("trunca archivos que superan el limite de bytes", async () => {
    const fake = createFakeFs({ "/home/tester/grande.log": "a".repeat(500) });
    const service = createFilesContentService(fake.deps);

    const result = await service.read("~/grande.log", { maxBytes: 100 });

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(100);
    expect(result.message).toContain("recortado");
  });

  test("devuelve un error legible cuando el archivo no existe", async () => {
    const fake = createFakeFs();
    const service = createFilesContentService(fake.deps);

    const result = await service.read("~/no-existe.md");

    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.message).toContain("No pude leer");
  });

  test("crea un archivo nuevo y luego lo sobrescribe", async () => {
    const fake = createFakeFs();
    const service = createFilesContentService(fake.deps);

    const created = await service.write("~/lista.md", "leche\n");
    expect(created).toMatchObject({
      ok: true,
      path: "/home/tester/lista.md",
      bytesWritten: 6,
      created: true,
    });

    const overwritten = await service.write("~/lista.md", "pan\n");
    expect(overwritten).toMatchObject({ ok: true, created: false, bytesWritten: 4 });
    expect(fake.files.get("/home/tester/lista.md")).toBe("pan\n");
  });

  test("propaga fallos de escritura como resultado, no como excepcion", async () => {
    const fake = createFakeFs();
    const service = createFilesContentService({
      ...fake.deps,
      async writeFile() {
        throw new Error("EACCES: permission denied");
      },
    });

    const result = await service.write("/etc/hosts", "127.0.0.1 pi\n");

    expect(result).toMatchObject({ ok: false, bytesWritten: 0, path: "/etc/hosts" });
    expect(result.message).toContain("EACCES");
  });

  test("anade al final sin perder el contenido previo", async () => {
    const fake = createFakeFs({ "/home/tester/diario.md": "lunes\n" });
    const service = createFilesContentService(fake.deps);

    const result = await service.append("~/diario.md", "martes\n");

    expect(result).toMatchObject({ ok: true, created: false, bytesWritten: 7 });
    expect(fake.files.get("/home/tester/diario.md")).toBe("lunes\nmartes\n");
    expect(fake.writes.at(-1)?.mode).toBe("append");
  });

  test("lista carpetas con directorios primero y tamano de los archivos", async () => {
    const fake = createFakeFs({
      "/home/tester/Documentos/notas.md": "hola",
      "/home/tester/Documentos/sub/otro.md": "x",
    });
    const service = createFilesContentService(fake.deps);

    const result = await service.list("~/Documentos");

    expect(result.ok).toBe(true);
    expect(result.entries).toEqual([
      { name: "sub", isDirectory: true },
      { name: "notas.md", isDirectory: false, size: 4 },
    ]);
  });

  test("devuelve un error legible al listar algo que no es carpeta", async () => {
    const fake = createFakeFs({ "/home/tester/notas.md": "hola" });
    const service = createFilesContentService(fake.deps);

    const result = await service.list("~/notas.md");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("No pude listar");
  });

  test("busca por nombre saltando ocultos y node_modules", async () => {
    const fake = createFakeFs({
      "/home/tester/Documentos/informe-2026.pdf": "a",
      "/home/tester/Documentos/sub/informe-viejo.pdf": "b",
      "/home/tester/node_modules/informe-fake.pdf": "c",
      "/home/tester/.cache/informe-cache.pdf": "d",
      "/home/tester/otros/nota.txt": "e",
    });
    const service = createFilesContentService(fake.deps);

    const result = await service.search("~", "INFORME");

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.path).sort()).toEqual([
      "/home/tester/Documentos/informe-2026.pdf",
      "/home/tester/Documentos/sub/informe-viejo.pdf",
    ]);
    expect(result.truncated).toBe(false);
  });

  test("limita el numero de resultados y marca el truncado", async () => {
    const seed: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) {
      seed[`/home/tester/muchos/informe-${index}.txt`] = "x";
    }
    const fake = createFakeFs(seed);
    const service = createFilesContentService(fake.deps);

    const result = await service.search("~/muchos", "informe", { maxResults: 5 });

    expect(result.matches).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.message).toContain("Hay más resultados");
  });

  test("pide un texto de busqueda y valida la raiz", async () => {
    const fake = createFakeFs({ "/home/tester/notas.md": "hola" });
    const service = createFilesContentService(fake.deps);

    await expect(service.search("~", "  ")).resolves.toMatchObject({ ok: false, matches: [] });
    await expect(service.search("~/notas.md", "algo")).resolves.toMatchObject({ ok: false, matches: [] });
    await expect(service.search("~/no-existe", "algo")).resolves.toMatchObject({ ok: false, matches: [] });
  });
});
