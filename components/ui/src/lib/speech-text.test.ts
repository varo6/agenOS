import { describe, expect, test } from "bun:test";
import { speechChunks } from "./speech-text";

describe("texto narrable", () => {
  test("espera una frase completa, y vacía el resto al cerrar el mensaje", () => {
    expect(speechChunks("Voy a buscar", 0, false)).toEqual({ texts: [], offset: 0 });
    const first = speechChunks("Voy a buscar. Abierto", 0, false);
    expect(first.texts).toEqual(["Voy a buscar."]);
    expect(speechChunks("Voy a buscar. Abierto", first.offset, true).texts).toEqual(["Abierto"]);
  });
  test("omite código, incluso un bloque a medio generar", () => {
    expect(speechChunks("Voy a buscar.\n```sh\nfind / -name secret.txt\n", 0, true).texts).toEqual(["Voy a buscar."]);
    expect(speechChunks("```json\n{\"tool\": \"files_open\"}\n```\nArchivo abierto.", 0, true).texts).toEqual(["Archivo abierto."]);
  });
  test("conserva el texto de enlaces y elimina direcciones y marcado", () => {
    expect(speechChunks("Abre [el informe](https://example.com/informe.pdf). **Listo**.", 0, true).texts).toEqual(["Abre el informe.", "Listo."]);
    expect(speechChunks("[Enlace a medio generar](https://", 0, false).texts).toEqual([]);
  });
  test("respeta decimales y abreviaturas habituales", () => {
    expect(speechChunks("El Dr. López indicó 3.5 euros. Listo.", 0, false).texts).toEqual(["El Dr. López indicó 3.5 euros.", "Listo."]);
  });
  test("conserva nombres de archivos escritos como código en línea", () => {
    expect(speechChunks("He abierto `informe.pdf`.", 0, true).texts).toEqual(["He abierto informe.pdf."]);
  });
  test("no lee tablas ni objetos JSON independientes", () => {
    expect(speechChunks('| columna | valor |\n| uno | dos |\n{"tool":"open"}', 0, true).texts).toEqual([]);
  });
});
