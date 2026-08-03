export type ClassValue = string | false | null | undefined;

/** Une clases condicionales sin dependencias externas. */
export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
