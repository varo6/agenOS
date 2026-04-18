import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});

function createStorage() {
  const store = new Map<string, string>();

  return {
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    get length() {
      return store.size;
    },
  };
}

if (typeof window !== "undefined") {
  const candidate = window.localStorage as Storage | undefined;

  if (!candidate || typeof candidate.clear !== "function") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorage(),
      writable: true,
    });
  }
}
