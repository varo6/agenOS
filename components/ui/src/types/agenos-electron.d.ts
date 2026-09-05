import type { AgenosSystemBridge } from "../lib/system-bridge";
import type { AgenosPiBridge } from "../lib/pi-bridge";
import type { AgenosSpeechBridge } from "../lib/speech-bridge";
import type { AgenosTtsBridge } from "../lib/tts-bridge";
import type { AgenosRemoteBridge } from "../lib/remote-bridge";
import type { AgenosNetworkBridge } from "../../../network/types";

declare global {
  interface Window {
    agenosSystem?: AgenosSystemBridge;
    agenosPi?: AgenosPiBridge;
    agenosSpeech?: AgenosSpeechBridge;
    agenosTts?: AgenosTtsBridge;
    agenosRemote?: AgenosRemoteBridge;
    agenosNetwork?: AgenosNetworkBridge;
  }
}

export {};
