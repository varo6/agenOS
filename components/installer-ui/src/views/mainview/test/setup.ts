import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
