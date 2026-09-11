/** Convierte un fragmento de Markdown en texto para escuchar. */
function spokenText(text: string): string {
  return text
    .replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/`[^`]*$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[[^\]]*$|\[[^\]]*\]\([^)]*$/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]*>/g, " ")
    .split("\n")
    .filter((line) => !/^\s*(?:\||[{}\[\]]|"[^"]+"\s*:)/.test(line))
    .map((line) => line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, ""))
    .join(" ")
    .replace(/[*_#>~]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Offsets originales: limpiar Markdown no cambia lo ya consumido. */
export function speechChunks(text: string, offset: number, complete: boolean): { texts: string[]; offset: number } {
  const texts: string[] = [];
  let consumed = offset;
  let fence: string | null = null;
  let inline = false;
  let linkDepth = 0;
  const consume = (end: number) => {
    if (end <= consumed) return;
    const cleaned = spokenText(text.slice(consumed, end));
    if (/[\p{L}\p{N}]/u.test(cleaned)) {
      let chunk = "";
      for (const word of cleaned.split(" ")) {
        if (chunk.length + word.length > 500 && chunk) { texts.push(chunk); chunk = ""; }
        chunk += `${chunk ? " " : ""}${word}`;
      }
      if (chunk) texts.push(chunk);
    }
    consumed = end;
  };
  for (let i = 0; i < text.length; i++) {
    const marker = text.slice(i, i + 3);
    if (marker === "```" || marker === "~~~") {
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      i += 2;
      continue;
    }
    if (fence) continue;
    if (text[i] === "`") { inline = !inline; continue; }
    if (inline) continue;
    if (text[i] === "[") linkDepth++;
    if (text[i] === "]" && text[i + 1] !== "(") linkDepth = Math.max(0, linkDepth - 1);
    if (text[i] === ")") linkDepth = 0;
    if (linkDepth || i < consumed) continue;
    if (/[.!?…]/.test(text[i])) {
      let end = i + 1;
      while (end < text.length && /[.!?…"'»”)]/.test(text[end])) end++;
      if (end < text.length && !/\s/.test(text[end])) continue;
      const fragment = text.slice(consumed, end).trim();
      if (/\b(?:Sr|Sra|Dr|Dra|Ud|Uds|etc)\.$/i.test(fragment) || /^\d+\.$/.test(fragment)) continue;
      consume(end);
      i = end - 1;
    }
  }
  if (complete) consume(text.length);
  return { texts, offset: consumed };
}
