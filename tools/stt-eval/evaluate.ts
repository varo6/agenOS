#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { DEFAULT_STT_SETTINGS } from "../../components/stt/config";
import { encodeVoxtypeAudio, wavToFloat32 } from "../../components/stt/voxtype-engine";

export function normalizeCommand(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function wordErrorCount(expected: string, actual: string): number {
  const left = normalizeCommand(expected).split(" ").filter(Boolean);
  const right = normalizeCommand(actual).split(" ").filter(Boolean);
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j] ?? 0;
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : 1 + Math.min(diagonal, row[j - 1] ?? 0, previous);
      diagonal = previous;
    }
  }
  return row[right.length] ?? left.length;
}

type EvalCase = { wavPath: string; expected: string; silence: boolean };
type CaseResult = EvalCase & {
  actual: string;
  readyMs: number;
  finalMs: number;
  peakRssKb: number;
  idleRssKb: number;
  error: string | null;
};

async function rssKb(pid: number): Promise<number> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    return Number.parseInt(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? "0", 10);
  } catch {
    return 0;
  }
}

async function runCase(input: {
  test: EvalCase;
  binary: string;
  model: string;
  prompt: string | null;
  threads: number;
}): Promise<CaseResult> {
  const startedAt = performance.now();
  const args = [
    ...(input.prompt ? ["--initial-prompt", input.prompt] : []),
    "--no-whisper-context-optimization",
    "transcribe-worker",
    "--model", input.model,
    "--language", "es",
    "--threads", String(input.threads),
  ];
  const child = spawn(input.binary, args, { stdio: ["pipe", "pipe", "pipe"] });
  let readyMs = 0;
  let finalMs = 0;
  let peakRssKb = 0;
  let actual = "";
  let error: string | null = null;
  let stdout = "";
  let stderr = "";
  let sentAt = 0;

  const sampler = setInterval(() => {
    void rssKb(child.pid ?? 0).then((rss) => {
      peakRssKb = Math.max(peakRssKb, rss);
    });
  }, 20);

  const timeout = setTimeout(() => child.kill("SIGKILL"), 180_000);
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.stdin?.on("error", (cause) => { error ??= `stdin: ${cause.message}`; });
  child.on("error", (cause) => { error ??= `spawn: ${cause.message}`; });
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (line === "READY" && sentAt === 0) {
        readyMs = performance.now() - startedAt;
        void readFile(input.test.wavPath)
          .then((wav) => {
            const payload = encodeVoxtypeAudio(wavToFloat32(new Uint8Array(wav)));
            child.stdin?.end(payload);
            sentAt = performance.now();
          })
          .catch((cause) => {
            error ??= cause instanceof Error ? cause.message : String(cause);
            child.kill("SIGKILL");
          });
        continue;
      }
      if (line.startsWith("{")) {
        try {
          const reply = JSON.parse(line) as { ok?: boolean; text?: unknown; error?: unknown };
          if (reply.ok === true) actual = typeof reply.text === "string" ? reply.text.trim() : "";
          else error ??= typeof reply.error === "string" ? reply.error : "Voxtype devolvio un fallo.";
          finalMs = sentAt > 0 ? performance.now() - sentAt : 0;
        } catch {
          error ??= "Voxtype devolvio JSON no valido.";
        }
      }
    }
  });

  const code = await new Promise<number | null>((done) => child.once("close", done));
  clearInterval(sampler);
  clearTimeout(timeout);
  const idleRssKb = await rssKb(child.pid ?? 0);
  peakRssKb = Math.max(peakRssKb, idleRssKb);
  if (code !== 0 && !error) error = stderr.trim() || `Voxtype termino con codigo ${code ?? "desconocido"}.`;
  if (readyMs === 0 && !error) error = "Voxtype termino sin READY.";
  if (finalMs === 0 && !error) error = "Voxtype termino sin resultado.";

  return { ...input.test, actual, readyMs, finalMs, peakRssKb, idleRssKb, error };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarize(results: CaseResult[]) {
  const spoken = results.filter((result) => !result.silence);
  const expectedWords = spoken.reduce((sum, result) => sum + normalizeCommand(result.expected).split(" ").filter(Boolean).length, 0);
  const errors = spoken.reduce((sum, result) => sum + wordErrorCount(result.expected, result.actual), 0);
  return {
    normalizedWer: expectedWords === 0 ? 0 : errors / expectedWords,
    exactCommandMatchRate: spoken.length === 0 ? 0 : spoken.filter((result) => normalizeCommand(result.expected) === normalizeCommand(result.actual)).length / spoken.length,
    meanColdModelReadyMs: mean(results.map((result) => result.readyMs)),
    meanEndOfSpeechToFinalMs: mean(results.map((result) => result.finalMs)),
    peakWorkerRssKb: Math.max(0, ...results.map((result) => result.peakRssKb)),
    idleRssAfterCompletionKb: Math.max(0, ...results.map((result) => result.idleRssKb)),
    failures: results.filter((result) => result.error).length,
    emptyTranscripts: spoken.filter((result) => !normalizeCommand(result.actual)).length,
    silenceHallucinations: results.filter((result) => result.silence && normalizeCommand(result.actual)).length,
  };
}

async function main(): Promise<void> {
  const corpusDir = process.argv[2] ? resolve(process.argv[2]) : "";
  if (!corpusDir) throw new Error("Uso: bun tools/stt-eval/evaluate.ts DIRECTORIO_CORPUS");
  const root = process.env.AGENOS_WHISPER_DIR?.trim() || "/opt/agenos/system/whisper.cpp";
  const useBaseline = process.env.AGENOS_STT_FORCE_BASELINE?.trim() === "1";
  const binary = process.env.AGENOS_VOXTYPE_BIN?.trim() || join(root, useBaseline ? "voxtype-baseline" : "voxtype");
  const model = process.env.AGENOS_STT_EVAL_MODEL?.trim() || join(root, "models", "ggml-small-q5_1.bin");
  const threads = Number.parseInt(process.env.AGENOS_STT_EVAL_THREADS ?? "4", 10) || 4;
  const promptMode = process.env.AGENOS_STT_EVAL_PROMPT_MODE?.trim() || "both";
  if (!["both", "on", "off"].includes(promptMode)) throw new Error("AGENOS_STT_EVAL_PROMPT_MODE debe ser both, on u off.");

  const names = (await readdir(corpusDir)).filter((name) => name.toLowerCase().endsWith(".wav")).sort();
  const tests: EvalCase[] = [];
  for (const name of names) {
    const expected = (await readFile(join(corpusDir, `${name.slice(0, -4)}.txt`), "utf8")).trim();
    tests.push({ wavPath: join(corpusDir, name), expected, silence: expected === "" });
  }
  if (tests.length === 0) throw new Error("El corpus no contiene WAV con su TXT esperado.");

  const modes = promptMode === "both" ? ["on", "off"] : [promptMode];
  for (const mode of modes) {
    const results: CaseResult[] = [];
    for (const test of tests) {
      const result = await runCase({
        test,
        binary,
        model,
        prompt: mode === "on" ? DEFAULT_STT_SETTINGS.initialPrompt : null,
        threads,
      });
      results.push(result);
      console.error(`${basename(test.wavPath)}: ${result.error ?? JSON.stringify(result.actual)}`);
    }
    console.log(JSON.stringify({ model, binary, prompt: mode, ...summarize(results), cases: results }, null, 2));
  }
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  });
}
