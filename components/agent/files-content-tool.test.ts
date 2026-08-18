import { describe, expect, test } from "bun:test";
import { createFilesContentModelTool } from "./files-content-tool";
import { createFilesContentService, type FilesContentDeps } from "./files-content";

const HOME = "/home/tester";

function createService(seed: Record<string, string> = {}, overrides: Partial<FilesContentDeps> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>([HOME]);
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join("/") || "/");
    }
  }

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
      files.set(path, data);
    },
    async appendFile(path, data) {
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
    ...overrides,
  };

  return { files, service: createFilesContentService(deps) };
}

describe("files_manage model tool", () => {
  test("expone el contrato del tool", () => {
    const tool = createFilesContentModelTool(createService().service);
    expect(tool.name).toBe("files_manage");
    expect(tool.label).toBe("Leer y escribir archivos");
    expect(tool.parameters).toMatchObject({
      type: "object",
      required: ["action"],
      additionalProperties: false,
      properties: { action: { enum: ["read", "write", "append", "list", "search"] } },
    });
  });

  test("read devuelve el contenido del archivo al modelo", async () => {
    const { service } = createService({ "/home/tester/Documentos/notas.md": "Comprar pan\n" });
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "read", path: "~/Documentos/notas.md" });

    expect(result.content[0]?.text).toContain("Comprar pan");
    expect(result.details).toMatchObject({ action: "read", ok: true, path: "/home/tester/Documentos/notas.md" });
  });

  test("read informa del archivo que falta sin lanzar", async () => {
    const { service } = createService();
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "read", path: "~/nada.md" });

    expect(result.details).toMatchObject({ action: "read", ok: false });
    expect(result.content[0]?.text).toContain("No pude leer");
  });

  test("write escribe el contenido y lo confirma", async () => {
    const { files, service } = createService();
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "write", path: "~/lista.md", content: "leche\n" });

    expect(files.get("/home/tester/lista.md")).toBe("leche\n");
    expect(result.details).toMatchObject({ action: "write", ok: true, created: true, bytesWritten: 6 });
  });

  test("write sin content falla con un mensaje claro y no escribe nada", async () => {
    const { files, service } = createService();
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "write", path: "~/lista.md" });

    expect(files.size).toBe(0);
    expect(result.details).toMatchObject({ ok: false, action: "write" });
    expect(result.content[0]?.text).toContain("content");
  });

  test("write acepta contenido vacio para vaciar un archivo", async () => {
    const { files, service } = createService({ "/home/tester/lista.md": "viejo" });
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "write", path: "~/lista.md", content: "" });

    expect(files.get("/home/tester/lista.md")).toBe("");
    expect(result.details).toMatchObject({ ok: true, created: false, bytesWritten: 0 });
  });

  test("append conserva lo anterior", async () => {
    const { files, service } = createService({ "/home/tester/diario.md": "lunes\n" });
    const tool = createFilesContentModelTool(service);

    await tool.execute("call_1", { action: "append", path: "~/diario.md", content: "martes\n" });

    expect(files.get("/home/tester/diario.md")).toBe("lunes\nmartes\n");
  });

  test("las acciones de ruta piden la ruta cuando falta", async () => {
    const { service } = createService();
    const tool = createFilesContentModelTool(service);

    for (const action of ["read", "write", "append", "list", "search"]) {
      const result = await tool.execute("call_1", { action, content: "x", query: "y" });
      expect(result.details).toMatchObject({ ok: false, action });
    }
  });

  test("search sin query falla antes de tocar el disco", async () => {
    const { service } = createService({ "/home/tester/notas.md": "hola" });
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "search", path: "~" });

    expect(result.details).toMatchObject({ ok: false, action: "search" });
    expect(result.content[0]?.text).toContain("query");
  });

  test("list formatea una entrada por linea con las carpetas marcadas", async () => {
    const { service } = createService({
      "/home/tester/Documentos/notas.md": "hola",
      "/home/tester/Documentos/sub/otro.md": "x",
    });
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "list", path: "~/Documentos" });
    const lines = (result.content[0]?.text ?? "").split("\n");

    expect(lines[1]).toBe("sub/");
    expect(lines[2]).toBe("notas.md (4 bytes)");
    expect(result.details).toMatchObject({ action: "list", ok: true });
  });

  test("search devuelve las rutas encontradas una por linea", async () => {
    const { service } = createService({
      "/home/tester/Documentos/informe-2026.pdf": "a",
      "/home/tester/Documentos/otro.txt": "b",
    });
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "search", path: "~", query: "informe" });
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("/home/tester/Documentos/informe-2026.pdf");
    expect(text).not.toContain("otro.txt");
    expect(result.details).toMatchObject({ action: "search", ok: true });
  });

  test("una accion desconocida se explica en vez de lanzar", async () => {
    const { service } = createService();
    const tool = createFilesContentModelTool(service);

    const result = await tool.execute("call_1", { action: "borrar", path: "~/lista.md" });

    expect(result.details).toMatchObject({ ok: false, action: "borrar" });
    expect(result.content[0]?.text).toContain("read, write, append, list o search");
  });
});
