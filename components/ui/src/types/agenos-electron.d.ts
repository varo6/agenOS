import type { AgenosSystemBridge } from "../lib/system-bridge";
import type { AgenosPiBridge } from "../lib/pi-bridge";

declare global {
  interface Window {
    agenosSystem?: AgenosSystemBridge;
    agenosPi?: AgenosPiBridge;
  }
}

export {};
