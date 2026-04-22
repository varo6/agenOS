import type { AgenosSystemBridge } from "../lib/system-bridge";

declare global {
  interface Window {
    agenosSystem?: AgenosSystemBridge;
  }
}

export {};
